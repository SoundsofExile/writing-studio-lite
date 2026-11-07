// Handoff JSON for the desktop, and the .docx records copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const P = require('../shared/prose-format.cjs');
const X = require('../src/export.js');

// What the desktop on main does with a handoff file (main.cjs 'import'), kept to the parts that
// decide what lands: the whole file has CRLF turned to LF and a BOM dropped before parsing.
function desktopImport(fileText) {
  const normalizeText = (t) => String(t).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const x = JSON.parse(normalizeText(fileText));
  if (x.format !== 'writing-studio-handoff-v1' || typeof x.prose !== 'string' || typeof x.story !== 'string') throw Error('Not a Studio handoff file');
  return { project: x.story, title: normalizeText(x.scene || 'Imported scene'), body: x.prose, scratch: normalizeText(x.resumeNote || ''), handoffId: x.handoffId, bodyFormat: x.bodyFormat === 'markdown' ? 'markdown' : 'rough' };
}

const tricky = `${P.TITLE}One\n${P.ITALIC_ON}soft${P.ITALIC_OFF}  ${P.BOLD_ON}words${P.BOLD_OFF}\r\n\n\n${P.SCENE_BREAK}\n\t“quoted” café — end `;

test('a scene reaches the desktop byte for byte, hidden marks, CRLF, spaces and all', () => {
  const h = X.sceneHandoff({ story: 'The Veil Age', sceneId: 's1', title: 'The archivist lies', text: tricky, notes: 'stopped at the lamp\nnext: the flood' });
  const landed = desktopImport(JSON.stringify(h, null, 1));
  assert.equal(landed.body, tricky);
  assert.equal(landed.project, 'The Veil Age');
  assert.equal(landed.title, 'The archivist lies');
  assert.equal(landed.scratch, 'stopped at the lamp\nnext: the flood');
  assert.equal(landed.bodyFormat, 'rough');
});

test('format labels are carried as they are; the desktop keeps markdown', () => {
  for (const f of ['rough', 'manuscript', 'markdown', 'plain']) {
    const h = X.sceneHandoff({ story: 'S', sceneId: 'a', title: 't', text: 'x', bodyFormat: f });
    assert.equal(h.bodyFormat, f);
  }
  assert.equal(desktopImport(JSON.stringify(X.sceneHandoff({ story: 'S', sceneId: 'a', title: 't', text: '# x', bodyFormat: 'markdown' }))).bodyFormat, 'markdown');
});

test('sending the same scene twice gives the same handoffId; any change gives a new one', () => {
  const base = { story: 'S', sceneId: 'a', title: 't', text: 'words', notes: 'n' };
  const id = (over = {}) => X.sceneHandoff({ ...base, ...over }, { now: Date.now() + Math.random() * 1e6 }).handoffId;
  assert.equal(id(), id());
  for (const change of [{ text: 'words ' }, { notes: 'n2' }, { title: 'u' }, { story: 'T' }, { sceneId: 'b' }]) assert.notEqual(id(change), id());
});

test('a story with no name is refused with a plain reason', () => {
  assert.throws(() => X.sceneHandoff({ story: '  ', sceneId: 'a', title: 't', text: 'x' }), /needs a name/);
});

test('open ideas go as one Rough scene, a blank line between them', () => {
  const h = X.ideasHandoff('The Veil Age', [{ text: 'Mara lied about the lamp ' }, { text: 'the flood\r\nrecords' }], { now: new Date(2026, 10, 6, 23, 30).getTime() });
  assert.equal(h.scene, 'Ideas from phone 2026-11-06');
  assert.equal(h.prose, 'Mara lied about the lamp\n\nthe flood\nrecords');
  assert.equal(h.bodyFormat, 'rough');
  assert.throws(() => X.ideasHandoff('S', []), /no open ideas/);
});

test('file names are safe on Android, OneDrive and Windows', () => {
  assert.equal(X.fileName('The Veil: Age', 'A/B?', `${P.ITALIC_ON}x`), 'The Veil Age - A B - x');
  assert.equal(X.fileName('', '  '), 'Untitled');
  assert.ok(X.fileName('x'.repeat(300)).length <= 100);
});

test('the .docx records copy holds the text, with italic, bold, titles and breaks', async () => {
  const b64 = await X.recordsDocBase64('The Veil Age', [
    { title: 'Scene one', text: tricky, bodyFormat: 'rough' },
    { title: 'Notes in Markdown', text: '# Heading\nplain *line*', bodyFormat: 'markdown' },
  ]);
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  const xml = await zip.file('word/document.xml').async('string');
  for (const words of ['The Veil Age', 'Scene one', 'One', 'soft', 'words', '“quoted” café — end', 'Notes in Markdown', '# Heading', 'plain *line*']) {
    assert.ok(xml.includes(words), `missing ${words}`);
  }
  assert.match(xml, /<w:i\/>[\s\S]*soft/);
  assert.match(xml, /<w:b\/>[\s\S]*words/);
  assert.ok(xml.includes('>#<'), 'scene break shows as #');
  assert.ok(!/[-]/.test(xml), 'no hidden characters in Word');
});

// ---- Handoff v2, read by the desktop's own parser and planner (shared/handoff.cjs)

const H = require('../shared/handoff.cjs');

test('v2: desktop scenes go back by id and version, phone scenes as new, ideas as captures', () => {
  const h = X.storyHandoff({ story: 'The Veil Age', scenes: [
    { id: 'p1', desktopId: 'd1', desktopVersion: 5, title: 'Selfie', text: tricky, notes: 'n', bodyFormat: 'manuscript' },
    { id: 'p2', desktopId: null, title: 'Bus', text: 'x', notes: '', bodyFormat: 'markdown' },
  ], captures: [{ text: 'idea', createdAt: '2026-11-07T10:00:00.000Z' }] });
  const parsed = H.parseHandoff(JSON.stringify(h, null, 1));
  assert.equal(parsed.version, 2);
  assert.deepEqual([parsed.scenes[0].sceneId, parsed.scenes[0].baseVersion, parsed.scenes[0].bodyFormat, parsed.scenes[0].prose], ['d1', 5, null, tricky]);
  assert.deepEqual([parsed.scenes[1].sceneId, parsed.scenes[1].phoneId, parsed.scenes[1].bodyFormat], [null, 'p2', 'markdown']);
  assert.equal(parsed.captures[0].text, 'idea');
});

test('v2: the same content gets the same handoffId, so sending twice is harmless', () => {
  const make = (text) => X.storyHandoff({ story: 'S', scenes: [{ id: 'p', desktopId: 'd', desktopVersion: 1, title: 't', text }] }, { now: Math.random() * 1e12 }).handoffId;
  assert.equal(make('a'), make('a'));
  assert.notEqual(make('a'), make('b'));
  assert.throws(() => X.storyHandoff({ story: 'S' }), /nothing new/);
});
