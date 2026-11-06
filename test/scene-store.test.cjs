// Saving and reopening keeps text exactly, and an interrupted save never loses the scene.
// Every test uses its own throwaway folder in the system temp directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSceneStore, RECOVERY_KEEP, RECOVERY_EVERY_MS } = require('../src/scene-store.js');
const { fsNode } = require('./fs-node.cjs');
const P = require('../shared/prose-format.cjs');

async function fresh(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xochi-pocket-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, fs: fsNode(root) };
}

const cases = {
  'Windows line endings': 'One.\r\nTwo.\r\n',
  'Unix line endings': 'One.\nTwo.\n',
  'old Mac line endings': 'One.\rTwo.\r',
  'mixed line endings': 'a\r\nb\nc\rd',
  'trailing spaces': 'Line with spaces   \nand a tab\t\n',
  'leading spaces and tabs': '    indented\n\tTabbed',
  'several blank lines': 'Before.\n\n\n\n\nAfter.',
  'no final newline': 'Ends here',
  'empty scene': '',
  'only whitespace': ' \n\t \r\n ',
  'curly quotes, dashes, ellipsis': '“She said—” … ‘no’',
  'accents, composed and decomposed, kept apart': 'café / café',
  'emoji and other scripts': 'Xóchitl 🌺 — 日本語 — עברית — Ελληνικά',
  'zero-width and non-breaking spaces': 'a​b c﻿d',
  'Rough hidden styles': `${P.TITLE}Chapter One\n${P.ITALIC_ON}soft${P.ITALIC_OFF} and ${P.BOLD_ON}loud${P.BOLD_OFF}\n${P.SCENE_BREAK}\nAfter.`,
  'typed asterisks and hashes stay text': '*not italic* # not a heading _x_',
  'long scene': ('A sentence that goes on for a while. ').repeat(20000),
};

for (const [name, text] of Object.entries(cases)) {
  test(`keeps exactly: ${name}`, async (t) => {
    const { fs: files } = await fresh(t);
    await createSceneStore(files).save('s1', text);
    // A new store is like the app being swiped away and opened again.
    assert.equal(await createSceneStore(files).load('s1'), text);
  });
}

test('reopening without typing changes nothing on disk', async (t) => {
  const { root, fs: files } = await fresh(t);
  const text = 'Line\r\n\r\n  end ';
  await createSceneStore(files).save('s1', text);
  const before = await fs.readFile(path.join(root, 'scenes/s1.txt'));
  await createSceneStore(files).load('s1');
  assert.deepEqual(await fs.readFile(path.join(root, 'scenes/s1.txt')), before);
});

test('a scene never saved loads as nothing', async (t) => {
  const { fs: files } = await fresh(t);
  assert.equal(await createSceneStore(files).load('s1'), null);
});

test('no temp file is left after a save', async (t) => {
  const { root, fs: files } = await fresh(t);
  await createSceneStore(files).save('s1', 'x');
  assert.deepEqual(await fs.readdir(path.join(root, 'scenes')), ['s1.txt']);
});

test('a save cut off while writing keeps the old text, and the partial text as a recovery copy', async (t) => {
  const { fs: files } = await fresh(t);
  await createSceneStore(files).save('s1', 'the whole old scene');
  await files.write('scenes/s1.tmp', 'the new sce'); // the battery died here
  const store = createSceneStore(files);
  assert.equal(await store.load('s1'), 'the whole old scene');
  const copies = await store.recoveryCopies('s1');
  assert.equal(await files.read('recovery/' + copies[0]), 'the new sce');
  assert.equal(await files.exists('scenes/s1.tmp'), false);
});

test('a swap cut off after the old file was removed uses the complete temp file', async (t) => {
  const { fs: files } = await fresh(t);
  await files.write('scenes/s1.tmp', 'finished text');
  assert.equal(await createSceneStore(files).load('s1'), 'finished text');
  assert.equal(await files.read('scenes/s1.txt'), 'finished text');
});

test('if the read-back check fails, the previous copy is kept', async (t) => {
  const { fs: files } = await fresh(t);
  await createSceneStore(files).save('s1', 'good');
  const lying = { ...files, read: async (p) => (p.endsWith('.tmp') ? 'garbled' : files.read(p)) };
  await assert.rejects(createSceneStore(lying).save('s1', 'new'), /Save check failed/);
  assert.equal(await createSceneStore(files).load('s1'), 'good');
});

test('recovery copies: one per ten minutes, newest five kept', async (t) => {
  const { fs: files } = await fresh(t);
  let clock = 1_000_000;
  const store = createSceneStore(files, { now: () => clock });
  await store.save('s1', 'v0');
  await store.save('s1', 'v1');
  assert.equal((await store.recoveryCopies('s1')).length, 1, 'first save over a file keeps a copy');
  await store.save('s1', 'v2');
  assert.equal((await store.recoveryCopies('s1')).length, 1, 'not again within ten minutes');
  for (let i = 3; i < 12; i++) {
    clock += RECOVERY_EVERY_MS;
    await store.save('s1', 'v' + i);
  }
  const copies = await store.recoveryCopies('s1');
  assert.equal(copies.length, RECOVERY_KEEP);
  assert.equal(await files.read('recovery/' + copies[0]), 'v10');
});

test('scene ids cannot reach outside the scenes folder', async (t) => {
  const { fs: files } = await fresh(t);
  await assert.rejects(createSceneStore(files).save('../x', 'a'), /Bad scene id/);
});
