// Stories, scenes, notes and captured ideas on the phone.
//
// Layout in the app's private folder (every file goes through the safe save in scene-store.js):
//   stories/<storyId>/scenes/meta.txt        the story: name, scene list, where it came from (JSON)
//   stories/<storyId>/scenes/<sceneId>.txt   a scene's text, byte for byte
//   stories/<storyId>/scenes/<sceneId>--notes.txt   its notes
//   stories/<storyId>/recovery/...           recovery copies
//   inbox/scenes/captures.txt                ideas caught from Home (JSON)
//   app/scenes/state.txt                     what was open last (JSON)
// Nothing is ever deleted: a discarded scene is only marked, and can be brought back.
const { createSceneStore } = require('./scene-store.js');
const { wordCount: wordsIn } = require('./rough.js');

const STORY_FORMAT = 'writing-studio-story-v1';
const FORMATS = ['rough', 'manuscript', 'markdown', 'plain'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cleanName = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function createLibrary(fs, { now = () => Date.now() } = {}) {
  const stores = new Map();
  const storeFor = (dir) => {
    if (!stores.has(dir)) stores.set(dir, createSceneStore(fs, { now, dir }));
    return stores.get(dir);
  };
  const storyStore = (storyId) => storeFor(`stories/${storyId}/`);
  const metas = new Map();

  // Changes run one at a time, so two quick edits can never save over each other.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  async function readJson(store, id, fallback) {
    const text = await store.load(id);
    return text === null ? fallback : JSON.parse(text);
  }
  const writeJson = (store, id, value) => store.save(id, JSON.stringify(value, null, 1));

  async function meta(storyId) {
    if (!metas.has(storyId)) {
      const m = await readJson(storyStore(storyId), 'meta', null);
      if (!m) throw new Error('That story is missing.');
      metas.set(storyId, m);
    }
    return metas.get(storyId);
  }
  async function saveMeta(m) {
    m.updatedAt = new Date(now()).toISOString();
    metas.set(m.id, m);
    await writeJson(storyStore(m.id), 'meta', m);
  }
  const sceneOf = (m, sceneId) => {
    const scene = m.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error('That scene is missing.');
    return scene;
  };
  const nextOrder = (m) => m.scenes.reduce((top, s) => Math.max(top, s.order), 0) + 1;

  // ---- Stories

  async function listStories() {
    const out = [];
    for (const id of await fs.list('stories')) {
      try {
        const m = await meta(id);
        const live = m.scenes.filter((s) => !s.discarded);
        out.push({ id, name: m.name, scenes: live.length, words: live.reduce((n, s) => n + (s.words || 0), 0), updatedAt: m.updatedAt, fromDesktop: Boolean(m.source) });
      } catch { /* a folder without a story file is skipped, never removed */ }
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  const createStory = (name) => serial(async () => {
    const m = { id: newId(), name: cleanName(name) || 'Untitled story', createdAt: new Date(now()).toISOString(), source: null, scenes: [] };
    await saveMeta(m);
    return m.id;
  });

  const renameStory = (storyId, name) => serial(async () => {
    const m = await meta(storyId);
    m.name = cleanName(name) || m.name;
    await saveMeta(m);
  });

  async function getStory(storyId) {
    const m = await meta(storyId);
    return { ...m, scenes: [...m.scenes].sort((a, b) => a.order - b.order) };
  }

  // ---- Scenes

  const addScene = (storyId, title, { bodyFormat = 'rough' } = {}) => serial(async () => {
    const m = await meta(storyId);
    const scene = { id: newId(), title: cleanName(title) || 'Untitled scene', order: nextOrder(m), status: 'Draft', bodyFormat, desktopId: null, desktopVersion: null, words: 0, changed: true, discarded: false, cursor: 0 };
    await storyStore(storyId).save(scene.id, '');
    m.scenes.push(scene);
    await saveMeta(m);
    return scene.id;
  });

  async function loadScene(storyId, sceneId) {
    const m = await meta(storyId);
    const scene = sceneOf(m, sceneId);
    const text = await storyStore(storyId).load(sceneId);
    return { ...scene, text: text ?? '' };
  }

  // The text itself is saved first; the scene list only records the word count and "changed".
  const saveSceneText = (storyId, sceneId, text, { words, keepRecovery = false } = {}) => serial(async () => {
    const m = await meta(storyId);
    const scene = sceneOf(m, sceneId);
    await storyStore(storyId).save(sceneId, text, { keepRecovery });
    if (words !== undefined) scene.words = words;
    scene.changed = true;
    await saveMeta(m);
  });

  const updateScene = (storyId, sceneId, change) => serial(async () => {
    const m = await meta(storyId);
    const scene = sceneOf(m, sceneId);
    if ('title' in change) scene.title = cleanName(change.title) || scene.title;
    if ('discarded' in change) scene.discarded = Boolean(change.discarded);
    if ('cursor' in change) scene.cursor = Math.max(0, Number(change.cursor) || 0);
    await saveMeta(m);
  });

  const loadNotes = async (storyId, sceneId) => (await storyStore(storyId).load(`${sceneId}--notes`)) ?? '';
  const saveNotes = (storyId, sceneId, text) => serial(async () => {
    const m = await meta(storyId);
    sceneOf(m, sceneId).changed = true;
    await storyStore(storyId).save(`${sceneId}--notes`, text);
    await saveMeta(m);
  });

  // ---- Story files from the desktop

  function parseStoryFile(raw) {
    if (typeof raw !== 'string') throw new Error('That file could not be read.');
    if (raw.length > MAX_FILE_BYTES) throw new Error('That file is too large to be a story file.');
    let x;
    try { x = JSON.parse(raw.replace(/^﻿/, '')); } catch { throw new Error('That isn’t a story file: it isn’t JSON.'); }
    if (!x || x.format !== STORY_FORMAT) throw new Error('That isn’t a story file from Writing Studio.');
    if (typeof x.story !== 'string' || !cleanName(x.story)) throw new Error('The story file has no story name.');
    if (!Array.isArray(x.scenes)) throw new Error('The story file has no scene list.');
    const scenes = x.scenes.map((s, i) => {
      if (!s || typeof s !== 'object') throw new Error(`Scene ${i + 1} in the file is damaged.`);
      if (typeof s.body !== 'string') throw new Error(`Scene ${i + 1} in the file has no text.`);
      return {
        desktopId: typeof s.id === 'string' ? s.id : null,
        desktopVersion: Number.isFinite(s.version) ? s.version : null,
        title: cleanName(s.title) || `Scene ${i + 1}`,
        status: typeof s.status === 'string' ? s.status : 'Draft',
        // Labels are kept exactly. No label means plain, as on the desktop.
        bodyFormat: FORMATS.includes(s.bodyFormat) ? s.bodyFormat : 'plain',
        body: s.body,
        notes: typeof s.scratch === 'string' ? s.scratch : '',
      };
    });
    const references = (Array.isArray(x.references) ? x.references : [])
      .filter((r) => r && typeof r.body === 'string')
      .map((r) => ({ kind: String(r.kind || ''), title: cleanName(r.title), bodyFormat: FORMATS.includes(r.bodyFormat) ? r.bodyFormat : 'plain', body: r.body }));
    return { story: cleanName(x.story), exportId: typeof x.exportId === 'string' ? x.exportId : null, exportedAt: x.exportedAt || null, scenes, references };
  }

  // A story already on the phone that this file is for: same desktop story name, made from a file.
  async function matchingStory(storyName) {
    const key = storyName.toLowerCase();
    for (const s of await listStories()) {
      const m = await meta(s.id);
      if (m.source && m.source.story.toLowerCase() === key) return m.id;
    }
    return null;
  }

  // Opening a file again never overwrites a scene changed on the phone since it last came over.
  const importStoryFile = (raw) => serial(async () => {
    const file = parseStoryFile(raw);
    const existingId = await matchingStory(file.story);
    const m = existingId ? await meta(existingId) : { id: newId(), name: file.story, createdAt: new Date(now()).toISOString(), scenes: [] };
    m.source = { story: file.story, exportId: file.exportId, exportedAt: file.exportedAt };
    m.references = file.references;
    const store = storyStore(m.id);
    const summary = { storyId: m.id, story: m.name, updated: false, added: 0, refreshed: 0, kept: [], unchanged: 0 };
    summary.updated = Boolean(existingId);
    for (const s of file.scenes) {
      const mine = s.desktopId && m.scenes.find((x) => x.desktopId === s.desktopId);
      if (!mine) {
        const scene = { id: newId(), title: s.title, order: nextOrder(m), status: s.status, bodyFormat: s.bodyFormat, desktopId: s.desktopId, desktopVersion: s.desktopVersion, words: 0, changed: false, discarded: false, cursor: 0 };
        await store.save(scene.id, s.body);
        if (s.notes) await store.save(`${scene.id}--notes`, s.notes);
        scene.words = wordsIn(s.body);
        m.scenes.push(scene);
        summary.added++;
        continue;
      }
      if (mine.changed) { summary.kept.push(mine.title); continue; }
      const current = (await store.load(mine.id)) ?? '';
      const notes = (await store.load(`${mine.id}--notes`)) ?? '';
      if (current === s.body && notes === s.notes && mine.title === s.title && mine.bodyFormat === s.bodyFormat) {
        mine.desktopVersion = s.desktopVersion;
        summary.unchanged++;
        continue;
      }
      // The phone copy is replaced, and kept as a recovery copy first.
      await store.save(mine.id, s.body, { keepRecovery: true });
      await store.save(`${mine.id}--notes`, s.notes, { keepRecovery: true });
      Object.assign(mine, { title: s.title, status: s.status, bodyFormat: s.bodyFormat, desktopVersion: s.desktopVersion, words: wordsIn(s.body) });
      summary.refreshed++;
    }
    await saveMeta(m);
    return summary;
  });

  // ---- Quick Capture

  const inbox = () => storeFor('inbox/');
  const listCaptures = () => readJson(inbox(), 'captures', []);
  const addCapture = (text) => serial(async () => {
    if (!String(text).trim()) return null;
    const list = await listCaptures();
    const item = { id: newId(), text: String(text), createdAt: new Date(now()).toISOString() };
    list.push(item);
    await writeJson(inbox(), 'captures', list);
    return item.id;
  });
  // An idea that's been used or isn't wanted is only marked, like a discarded scene, so it can come
  // back. state: 'developed', 'discarded', or null to put it back with the open ideas.
  const IDEA_STATES = [null, 'developed', 'discarded'];
  const setCaptureState = (id, state) => serial(async () => {
    if (!IDEA_STATES.includes(state)) throw new Error('Unknown idea state.');
    const list = await listCaptures();
    const item = list.find((c) => c.id === id);
    if (!item) throw new Error('That idea is missing.');
    if (state) Object.assign(item, { state, stateAt: new Date(now()).toISOString() });
    else { delete item.state; delete item.stateAt; }
    await writeJson(inbox(), 'captures', list);
  });

  // ---- What was open last

  const appStore = () => storeFor('app/');
  const loadState = () => readJson(appStore(), 'state', {});
  const saveState = (change) => serial(async () => writeJson(appStore(), 'state', { ...(await loadState()), ...change }));

  // The one scene from the milestone 1 and 2 prototype becomes the first scene of a story.
  // Its file is copied, never moved, so the original stays where it was.
  const adoptPrototype = () => serial(async () => {
    const state = await readJson(appStore(), 'state', {});
    if (state.adoptedPrototype) return null;
    const old = await createSceneStore(fs, { now }).load('prototype');
    let storyId = null;
    if (old !== null) {
      const m = { id: newId(), name: 'My first story', createdAt: new Date(now()).toISOString(), source: null, scenes: [] };
      const scene = { id: newId(), title: 'First scene', order: 1, status: 'Draft', bodyFormat: 'rough', desktopId: null, desktopVersion: null, words: wordsIn(old), changed: true, discarded: false, cursor: 0 };
      await storyStore(m.id).save(scene.id, old);
      m.scenes.push(scene);
      await saveMeta(m);
      storyId = m.id;
    }
    await writeJson(appStore(), 'state', { ...state, adoptedPrototype: true });
    return storyId;
  });

  return {
    listStories, createStory, renameStory, getStory,
    addScene, loadScene, saveSceneText, updateScene, loadNotes, saveNotes,
    parseStoryFile, importStoryFile, matchingStory,
    listCaptures, addCapture, setCaptureState,
    loadState, saveState, adoptPrototype,
  };
}

module.exports = { createLibrary, STORY_FORMAT };
