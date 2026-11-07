// Stories, scenes, notes, story files and Quick Capture. All in a throwaway temp folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLibrary } = require('../src/library.js');
const { createSceneStore } = require('../src/scene-store.js');
const { fsNode } = require('./fs-node.cjs');
const P = require('../shared/prose-format.cjs');

async function fresh(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xochi-pocket-lib-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = fsNode(root);
  return { root, files, lib: createLibrary(files) };
}

const storyFile = (scenes, extra = {}) => JSON.stringify({
  format: 'writing-studio-story-v1', exportId: 'exp1', exportedAt: '2026-11-06T10:00:00.000Z', story: 'The Veil Age', scenes, references: [], ...extra,
});
const rough = `${P.TITLE}One\n${P.ITALIC_ON}soft${P.ITALIC_OFF}  words\r\n\n\n${P.SCENE_BREAK}\nend `;

test('a story started on the phone, with scenes, survives the app being reopened', async (t) => {
  const { files, lib } = await fresh(t);
  const storyId = await lib.createStory('  Night   Market ');
  const a = await lib.addScene(storyId, 'Arrival');
  await lib.addScene(storyId, 'Lanterns');
  await lib.saveSceneText(storyId, a, rough, { words: 4 });
  await lib.saveNotes(storyId, a, 'stopped at the gate');
  const again = createLibrary(files);
  const [summary] = await again.listStories();
  assert.equal(summary.name, 'Night Market');
  assert.equal(summary.scenes, 2);
  assert.equal(summary.words, 4);
  const story = await again.getStory(storyId);
  assert.deepEqual(story.scenes.map((s) => s.title), ['Arrival', 'Lanterns']);
  assert.equal((await again.loadScene(storyId, a)).text, rough);
  assert.equal(await again.loadNotes(storyId, a), 'stopped at the gate');
});

test('rename and discard change only the scene list; a discarded scene comes back whole', async (t) => {
  const { lib } = await fresh(t);
  const storyId = await lib.createStory('S');
  const a = await lib.addScene(storyId, 'Old name');
  await lib.saveSceneText(storyId, a, 'keep me');
  await lib.updateScene(storyId, a, { title: 'New name' });
  await lib.updateScene(storyId, a, { discarded: true });
  assert.equal((await lib.listStories())[0].scenes, 0);
  let scene = (await lib.getStory(storyId)).scenes[0];
  assert.equal(scene.title, 'New name');
  assert.equal(scene.discarded, true);
  await lib.updateScene(storyId, a, { discarded: false });
  scene = await lib.loadScene(storyId, a);
  assert.equal(scene.discarded, false);
  assert.equal(scene.text, 'keep me');
});

test('a blank rename keeps the old name', async (t) => {
  const { lib } = await fresh(t);
  const storyId = await lib.createStory('S');
  const a = await lib.addScene(storyId, 'Keep');
  await lib.updateScene(storyId, a, { title: '   ' });
  assert.equal((await lib.getStory(storyId)).scenes[0].title, 'Keep');
});

test('the cursor position is remembered per scene', async (t) => {
  const { files, lib } = await fresh(t);
  const storyId = await lib.createStory('S');
  const a = await lib.addScene(storyId, 'A');
  await lib.updateScene(storyId, a, { cursor: 42 });
  assert.equal((await createLibrary(files).loadScene(storyId, a)).cursor, 42);
});

test('quick edits saved together all land, in order', async (t) => {
  const { files, lib } = await fresh(t);
  const storyId = await lib.createStory('S');
  const a = await lib.addScene(storyId, 'A');
  await Promise.all([
    lib.saveSceneText(storyId, a, 'one', { words: 1 }),
    lib.updateScene(storyId, a, { title: 'Renamed' }),
    lib.saveSceneText(storyId, a, 'one two', { words: 2 }),
    lib.updateScene(storyId, a, { cursor: 7 }),
  ]);
  const scene = await createLibrary(files).loadScene(storyId, a);
  assert.deepEqual([scene.title, scene.text, scene.words, scene.cursor], ['Renamed', 'one two', 2, 7]);
});

test('a story file opens with exact text, notes and all four format labels', async (t) => {
  const { lib } = await fresh(t);
  const raw = storyFile([
    { id: 'd1', version: 3, title: 'Rough one', order: 1, status: 'Draft', bodyFormat: 'rough', body: rough, scratch: 'note 1' },
    { id: 'd2', version: 1, title: 'Manuscript', order: 2, bodyFormat: 'manuscript', body: 'Clean.\n', scratch: '' },
    { id: 'd3', version: 1, title: 'Md', order: 3, bodyFormat: 'markdown', body: '# Head\n\n*em*  \n', scratch: '' },
    { id: 'd4', version: 1, title: 'Unlabeled', order: 4, body: 'plain\ttext', scratch: '' },
  ]);
  const summary = await lib.importStoryFile(raw);
  assert.equal(summary.added, 4);
  assert.equal(summary.updated, false);
  const story = await lib.getStory(summary.storyId);
  assert.equal(story.name, 'The Veil Age');
  assert.deepEqual(story.scenes.map((s) => s.bodyFormat), ['rough', 'manuscript', 'markdown', 'plain']);
  assert.deepEqual(story.scenes.map((s) => [s.desktopId, s.desktopVersion]), [['d1', 3], ['d2', 1], ['d3', 1], ['d4', 1]]);
  const first = await lib.loadScene(summary.storyId, story.scenes[0].id);
  assert.equal(first.text, rough);
  assert.equal(await lib.loadNotes(summary.storyId, story.scenes[0].id), 'note 1');
  assert.equal((await lib.loadScene(summary.storyId, story.scenes[2].id)).text, '# Head\n\n*em*  \n');
  assert.equal(first.changed, false);
});

test('opening a newer story file refreshes untouched scenes but never a scene changed on the phone', async (t) => {
  const { root, lib } = await fresh(t);
  const v1 = storyFile([
    { id: 'd1', version: 1, title: 'A', bodyFormat: 'rough', body: 'desk A1', scratch: '' },
    { id: 'd2', version: 1, title: 'B', bodyFormat: 'rough', body: 'desk B1', scratch: '' },
  ]);
  const { storyId } = await lib.importStoryFile(v1);
  const [a, b] = (await lib.getStory(storyId)).scenes;
  await lib.saveSceneText(storyId, b.id, 'phone B2');
  const v2 = storyFile([
    { id: 'd1', version: 2, title: 'A renamed', bodyFormat: 'rough', body: 'desk A2', scratch: 'n' },
    { id: 'd2', version: 2, title: 'B', bodyFormat: 'rough', body: 'desk B2', scratch: '' },
    { id: 'd3', version: 1, title: 'C', bodyFormat: 'rough', body: 'desk C1', scratch: '' },
  ], { exportId: 'exp2' });
  const summary = await lib.importStoryFile(v2);
  assert.equal(summary.storyId, storyId);
  assert.equal(summary.updated, true);
  assert.deepEqual([summary.refreshed, summary.added, summary.kept], [1, 1, ['B']]);
  assert.equal((await lib.loadScene(storyId, a.id)).text, 'desk A2');
  assert.equal((await lib.loadScene(storyId, a.id)).title, 'A renamed');
  assert.equal((await lib.loadScene(storyId, b.id)).text, 'phone B2');
  // The replaced phone copy of A is kept as a recovery copy.
  const recovery = await createSceneStore(fsNode(root), { dir: `stories/${storyId}/` }).recoveryCopies(a.id);
  assert.ok(recovery.length >= 1);
});

test('opening the same story file twice changes nothing', async (t) => {
  const { lib } = await fresh(t);
  const raw = storyFile([{ id: 'd1', version: 1, title: 'A', bodyFormat: 'rough', body: 'x', scratch: '' }]);
  await lib.importStoryFile(raw);
  const second = await lib.importStoryFile(raw);
  assert.deepEqual([second.added, second.refreshed, second.unchanged], [0, 0, 1]);
  assert.equal((await lib.listStories()).length, 1);
});

test('files that are not story files are refused with a plain reason, and nothing is made', async (t) => {
  const { lib } = await fresh(t);
  await assert.rejects(lib.importStoryFile('not json'), /isn’t JSON/);
  await assert.rejects(lib.importStoryFile(JSON.stringify({ format: 'writing-studio-handoff-v1' })), /isn’t a story file/);
  await assert.rejects(lib.importStoryFile(JSON.stringify({ format: 'writing-studio-story-v1', story: 'S', scenes: [{ title: 'x' }] })), /no text/);
  assert.equal((await lib.listStories()).length, 0);
});

test('Quick Capture keeps ideas in order, exactly as typed, and ignores blank ones', async (t) => {
  const { files, lib } = await fresh(t);
  await lib.addCapture('the flood records\nwere forged ');
  await lib.addCapture('   ');
  await lib.addCapture('second idea');
  const list = await createLibrary(files).listCaptures();
  assert.deepEqual(list.map((c) => c.text), ['the flood records\nwere forged ', 'second idea']);
});

test('ideas marked developed or discarded are kept, text untouched, and can be brought back', async (t) => {
  const { files, lib } = await fresh(t);
  const a = await lib.addCapture('Mara lied about the lamp');
  const b = await lib.addCapture('a second idea');
  await lib.setCaptureState(a, 'developed');
  await lib.setCaptureState(b, 'discarded');
  let list = await createLibrary(files).listCaptures();
  assert.deepEqual(list.map((c) => [c.text, c.state]), [['Mara lied about the lamp', 'developed'], ['a second idea', 'discarded']]);
  await lib.setCaptureState(b, null);
  list = await createLibrary(files).listCaptures();
  assert.equal(list[1].state, undefined);
  assert.equal(list[1].text, 'a second idea');
  await assert.rejects(lib.setCaptureState(a, 'gone'), /Unknown/);
  await assert.rejects(lib.setCaptureState('nope', 'discarded'), /missing/);
});

test('the prototype scene becomes the first scene of a story, once, and its file stays', async (t) => {
  const { files, lib } = await fresh(t);
  await createSceneStore(files).save('prototype', `I like pi\n${P.BOLD_ON}Pi${P.BOLD_OFF}`);
  const storyId = await lib.adoptPrototype();
  const story = await lib.getStory(storyId);
  assert.equal(story.name, 'My first story');
  assert.equal((await lib.loadScene(storyId, story.scenes[0].id)).text, `I like pi\n${P.BOLD_ON}Pi${P.BOLD_OFF}`);
  assert.equal(await createSceneStore(files).load('prototype'), `I like pi\n${P.BOLD_ON}Pi${P.BOLD_OFF}`);
  assert.equal(await createLibrary(files).adoptPrototype(), null);
  assert.equal((await lib.listStories()).length, 1);
});

test('app state keeps earlier fields when new ones are saved', async (t) => {
  const { lib } = await fresh(t);
  await lib.adoptPrototype();
  await lib.saveState({ storyId: 'x', sceneId: 'y' });
  const state = await lib.loadState();
  assert.equal(state.adoptedPrototype, true);
  assert.equal(state.sceneId, 'y');
});

// ---- After sending to the desktop (handoff v2)

const sceneFrom = (over = {}) => ({ id: 'd1', version: 5, title: 'Selfie', order: 1, status: 'Draft', bodyFormat: 'rough', body: 'desk text', scratch: '', ...over });

test('a scene sent to the desktop and not touched since takes the desktop version once it is newer', async (t) => {
  const { lib } = await fresh(t);
  const { storyId } = await lib.importStoryFile(storyFile([sceneFrom()]));
  const [scene] = (await lib.getStory(storyId)).scenes;
  await lib.saveSceneText(storyId, scene.id, 'phone text', { words: 2 });
  await lib.markSent(storyId, [scene.id]);
  // The desktop hasn't brought it in yet: same version, so the phone text stays.
  assert.deepEqual((await lib.importStoryFile(storyFile([sceneFrom()]))).kept, ['Selfie']);
  // The desktop brought it in and carried on: newer version, so the phone takes it.
  const s = await lib.importStoryFile(storyFile([sceneFrom({ version: 7, body: 'phone text, then the desk' })]));
  assert.equal(s.refreshed, 1);
  assert.equal((await lib.loadScene(storyId, scene.id)).text, 'phone text, then the desk');
  const after = (await lib.getStory(storyId)).scenes[0];
  assert.equal(after.changed, false);
  assert.equal(after.desktopVersion, 7);
});

test('a scene edited on the phone after it was sent is never overwritten', async (t) => {
  const { lib } = await fresh(t);
  const { storyId } = await lib.importStoryFile(storyFile([sceneFrom()]));
  const [scene] = (await lib.getStory(storyId)).scenes;
  await lib.saveSceneText(storyId, scene.id, 'phone text', { words: 2 });
  await lib.markSent(storyId, [scene.id]);
  await lib.saveSceneText(storyId, scene.id, 'phone text, more', { words: 3 });
  assert.deepEqual((await lib.importStoryFile(storyFile([sceneFrom({ version: 7, body: 'desk' })]))).kept, ['Selfie']);
  assert.equal((await lib.loadScene(storyId, scene.id)).text, 'phone text, more');
});

test('a scene made on the phone comes back linked, not doubled', async (t) => {
  const { lib } = await fresh(t);
  const { storyId } = await lib.importStoryFile(storyFile([sceneFrom()]));
  const mine = await lib.addScene(storyId, 'Phone only');
  await lib.saveSceneText(storyId, mine, 'written on the bus', { words: 4 });
  await lib.markSent(storyId, [mine]);
  const s = await lib.importStoryFile(storyFile([sceneFrom(), sceneFrom({ id: 'd2', version: 1, phoneId: mine, title: 'Phone only', body: 'written on the bus' })]));
  assert.equal(s.added, 0);
  const story = await lib.getStory(storyId);
  assert.equal(story.scenes.length, 2);
  assert.equal(story.scenes.find((x) => x.id === mine).desktopId, 'd2');
});

test('ideas are marked sent, and stay on the phone', async (t) => {
  const { lib } = await fresh(t);
  const a = await lib.addCapture('one');
  await lib.addCapture('two');
  await lib.markCapturesSent([a]);
  const list = await lib.listCaptures();
  assert.ok(list.find((i) => i.id === a).sentAt);
  assert.equal(list.length, 2);
  assert.equal(list.find((i) => i.text === 'two').sentAt, undefined);
});
