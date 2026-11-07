// Milestones 3 and 4: Home (Quick Capture and stories), Ideas, a story's scene list, and the
// page with notes and page settings. Saving works as before: a second after typing stops, and straight away when the
// app is hidden.
const { App } = require('@capacitor/app');
const { EditorView } = require('@codemirror/view');
const { fsCapacitor } = require('./fs-capacitor.js');
const { createLibrary } = require('./library.js');
const { createRoughEditor, wordCount, markersPaired } = require('./rough.js');
const { DEFAULTS, cleanSettings, stepTextSize } = require('./settings.js');

const lib = createLibrary(fsCapacitor);
const $ = (id) => document.getElementById(id);
const screens = { home: $('home'), ideas: $('ideasScreen'), story: $('story'), editor: $('editor') };
const FORMAT_NAMES = { rough: 'Rough', manuscript: 'Manuscript', markdown: 'Markdown', plain: 'Plain text' };

let screen = null;
let storyId = null;
let showDiscarded = false;
let showDoneIdeas = false;

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.includes('-')) node.setAttribute(key, value); else node[key] = value;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
function problem(err) {
  console.error(err);
  alert(err && err.message ? err.message : String(err));
}

function show(name) {
  screen = name;
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  // Focus Mode belongs to the page; the other screens always show their bars.
  document.body.classList.toggle('focus', settings.focus && name === 'editor');
}

// ---- A small menu of actions

function sheet(title, actions) {
  $('sheetTitle').textContent = title;
  const box = $('sheetButtons');
  box.replaceChildren(...actions.map(([label, run, danger]) => el('button', {
    type: 'button', textContent: label, className: danger ? 'danger' : '',
    onclick: () => { $('sheet').hidden = true; run(); },
  })));
  $('sheet').hidden = false;
}
$('sheetCancel').onclick = () => { $('sheet').hidden = true; };
$('sheet').onclick = (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; };

// ---- Home

async function openHome() {
  await leaveEditor();
  storyId = null;
  show('home');
  lib.saveState({ screen: 'home' }).catch(problem);
  const stories = await lib.listStories();
  $('noStories').hidden = stories.length > 0;
  $('stories').replaceChildren(...stories.map((s) => el('li', {},
    el('button', { type: 'button', className: 'item', onclick: () => openStory(s.id).catch(problem) },
      el('span', { className: 'name', textContent: s.name }),
      el('span', { className: 'meta', textContent: `${plural(s.scenes, 'scene')} · ${plural(s.words, 'word')}${s.fromDesktop ? ' · from desktop' : ''}` })))));
  await refreshIdeas();
}

async function refreshIdeas() {
  const ideas = await lib.listCaptures();
  $('captureIdeas').textContent = `Ideas (${ideas.filter((i) => !i.state).length}) ›`;
}

$('captureText').addEventListener('input', () => { $('captureSave').disabled = !$('captureText').value.trim(); });
$('captureSave').onclick = async () => {
  try {
    await lib.addCapture($('captureText').value);
    $('captureText').value = '';
    $('captureSave').disabled = true;
    await refreshIdeas();
  } catch (err) { problem(err); }
};
$('captureIdeas').onclick = () => openIdeas().catch(problem);

// ---- Ideas: open ones first, newest at the top. Developed and discarded ones are kept, out of the way.

const IDEA_LABELS = { developed: 'developed', discarded: 'discarded' };

async function openIdeas() {
  show('ideas');
  lib.saveState({ screen: 'ideas' }).catch(problem);
  await drawIdeas();
}

async function drawIdeas() {
  const ideas = [...await lib.listCaptures()].reverse();
  const live = ideas.filter((i) => !i.state);
  const done = ideas.filter((i) => i.state);
  const shown = showDoneIdeas ? [...live, ...done] : live;
  $('noIdeas').hidden = live.length > 0;
  $('showDoneIdeas').hidden = done.length === 0;
  $('showDoneIdeas').textContent = showDoneIdeas ? 'Hide developed and discarded' : `Developed and discarded (${done.length})`;
  $('ideas').replaceChildren(...shown.map((idea) => el('li', { className: idea.state ? `done ${idea.state}` : '' },
    el('button', { type: 'button', className: 'item', onclick: () => ideaMenu(idea) },
      el('span', { className: 'idea-text', textContent: idea.text }),
      el('span', { className: 'meta', textContent: [new Date(idea.createdAt).toLocaleString(), IDEA_LABELS[idea.state]].filter(Boolean).join(' · ') })),
    el('button', { type: 'button', className: 'more', textContent: '⋯', 'aria-label': 'More for this idea', onclick: () => ideaMenu(idea) }))));
}

function ideaMenu(idea) {
  const mark = (state) => () => lib.setCaptureState(idea.id, state).then(drawIdeas).catch(problem);
  const title = idea.text.length > 80 ? idea.text.slice(0, 80).trimEnd() + '…' : idea.text;
  sheet(title, idea.state
    ? [['Bring back', mark(null)]]
    : [['Developed — used it', mark('developed')], ['Discard', mark('discarded'), true]]);
}

$('ideasBack').onclick = () => openHome().catch(problem);
$('showDoneIdeas').onclick = () => { showDoneIdeas = !showDoneIdeas; drawIdeas().catch(problem); };

$('newStory').onclick = async () => {
  const name = prompt('Name of the new story');
  if (name === null) return;
  try { await openStory(await lib.createStory(name)); } catch (err) { problem(err); }
};

$('openStory').onclick = () => { $('storyFile').value = ''; $('storyFile').click(); };
$('storyFile').addEventListener('change', async () => {
  const file = $('storyFile').files[0];
  if (!file) return;
  try {
    const raw = await file.text();
    const parsed = lib.parseStoryFile(raw);
    if (await lib.matchingStory(parsed.story)) {
      const ok = confirm(`“${parsed.story}” is already on the phone. Update it from this file?\n\nScenes you’ve changed on the phone stay exactly as they are. Other scenes take the file’s text, and the phone’s old text is kept as a recovery copy.`);
      if (!ok) return;
    }
    const s = await lib.importStoryFile(raw);
    const parts = [];
    if (s.added) parts.push(`${plural(s.added, 'scene')} added`);
    if (s.refreshed) parts.push(`${plural(s.refreshed, 'scene')} updated`);
    if (s.unchanged) parts.push(`${plural(s.unchanged, 'scene')} already the same`);
    if (s.kept.length) parts.push(`kept your phone changes in: ${s.kept.join(', ')}`);
    alert(`${s.story}\n\n${parts.join('\n') || 'Nothing to change.'}`);
    await openStory(s.storyId);
  } catch (err) { problem(err); }
});

// ---- One story

async function openStory(id) {
  await leaveEditor();
  storyId = id;
  show('story');
  lib.saveState({ screen: 'story', storyId: id }).catch(problem);
  await drawStory();
}

async function drawStory() {
  const story = await lib.getStory(storyId);
  $('storyName').textContent = story.name;
  const live = story.scenes.filter((s) => !s.discarded);
  const gone = story.scenes.filter((s) => s.discarded);
  const shown = showDiscarded ? story.scenes : live;
  $('noScenes').hidden = shown.length > 0;
  $('showDiscarded').hidden = gone.length === 0;
  $('showDiscarded').textContent = showDiscarded ? 'Hide discarded' : `Discarded (${gone.length})`;
  $('scenes').replaceChildren(...shown.map((s) => el('li', { className: s.discarded ? 'discarded' : '' },
    el('button', { type: 'button', className: 'item', onclick: () => (s.discarded ? sceneMenu(s) : openScene(s.id).catch(problem)) },
      el('span', { className: 'name', textContent: s.title }),
      el('span', { className: 'meta', textContent: [plural(s.words || 0, 'word'), s.bodyFormat !== 'rough' ? FORMAT_NAMES[s.bodyFormat] : null, s.discarded ? 'discarded' : null].filter(Boolean).join(' · ') })),
    el('button', { type: 'button', className: 'more', textContent: '⋯', 'aria-label': `More for ${s.title}`, onclick: () => sceneMenu(s) }))));
}

function sceneMenu(scene) {
  const act = (fn) => () => fn().then(drawStory).catch(problem);
  const rename = act(async () => {
    const title = prompt('Scene name', scene.title);
    if (title !== null) await lib.updateScene(storyId, scene.id, { title });
  });
  sheet(scene.title, scene.discarded
    ? [['Bring back', act(() => lib.updateScene(storyId, scene.id, { discarded: false }))], ['Rename', rename]]
    : [['Open', () => openScene(scene.id).catch(problem)], ['Rename', rename], ['Discard', act(() => lib.updateScene(storyId, scene.id, { discarded: true })), true]]);
}

$('storyBack').onclick = () => openHome().catch(problem);
$('storyName').onclick = async () => {
  const name = prompt('Story name', $('storyName').textContent);
  if (name === null) return;
  try { await lib.renameStory(storyId, name); await drawStory(); } catch (err) { problem(err); }
};
$('showDiscarded').onclick = () => { showDiscarded = !showDiscarded; drawStory().catch(problem); };
$('newScene').onclick = async () => {
  const title = prompt('Name of the new scene');
  if (title === null) return;
  try { await openScene(await lib.addScene(storyId, title)); } catch (err) { problem(err); }
};

// ---- The page

const editorButtons = { undo: $('undo'), redo: $('redo'), italic: $('italic'), bold: $('bold'), spelling: $('spelling'), notes: $('notesToggle') };
let editor = null;
let open = null; // { storyId, sceneId, saved, notesSaved, format }
let textTimer = null;
let notesTimer = null;
let cursorTimer = null;
let saving = Promise.resolve();
let warned = false;

const say = (text) => { $('status').textContent = text; };
const countWords = (text) => { $('words').textContent = plural(wordCount(text), 'word'); };

function refreshButtons() {
  if (!editor) return;
  const on = editor.stylesAt();
  editorButtons.italic.setAttribute('aria-pressed', String(editor.prose && on.italic));
  editorButtons.bold.setAttribute('aria-pressed', String(editor.prose && on.bold));
  editorButtons.italic.disabled = !editor.prose;
  editorButtons.bold.disabled = !editor.prose;
  editorButtons.undo.disabled = !editor.canUndo();
  editorButtons.redo.disabled = !editor.canRedo();
}

// Saves run one after another, so an older save can never land on top of a newer one.
function saveText() {
  clearTimeout(textTimer);
  textTimer = null;
  if (!editor || !open) return saving;
  const target = open;
  const text = editor.getText();
  if (text === target.saved) return saving;
  saving = saving.then(async () => {
    // Style marks that don't pair up mean something went wrong while typing.
    // Save anyway, so no words are lost, but keep the copy from before as well.
    const odd = target.prose && !markersPaired(text);
    try {
      await lib.saveSceneText(target.storyId, target.sceneId, text, { words: wordCount(text), keepRecovery: odd });
      target.saved = text;
      if (open !== target) return;
      if (odd && !warned) { warned = true; say('Saved · styles look odd, earlier copy kept'); }
      else say(editor && editor.getText() === target.saved ? 'Saved' : 'Editing');
    } catch (err) {
      say('Not saved: ' + err.message);
    }
  });
  return saving;
}

function saveNotes() {
  clearTimeout(notesTimer);
  notesTimer = null;
  if (!open) return saving;
  const target = open;
  const notes = $('notes').value;
  if (notes === target.notesSaved) return saving;
  saving = saving.then(async () => {
    try {
      await lib.saveNotes(target.storyId, target.sceneId, notes);
      target.notesSaved = notes;
    } catch (err) {
      say('Notes not saved: ' + err.message);
    }
  });
  return saving;
}

function saveCursor() {
  clearTimeout(cursorTimer);
  cursorTimer = null;
  if (!editor || !open) return saving;
  const { storyId: s, sceneId } = open;
  const cursor = editor.cursor();
  if (cursor === open.cursorSaved) return saving;
  open.cursorSaved = cursor;
  saving = saving.then(() => lib.updateScene(s, sceneId, { cursor }).catch(() => {}));
  return saving;
}

const saveAll = () => Promise.all([saveText(), saveNotes(), saveCursor()]);

async function openScene(sceneId) {
  await leaveEditor();
  const scene = await lib.loadScene(storyId, sceneId);
  const notes = await lib.loadNotes(storyId, sceneId);
  const prose = scene.bodyFormat === 'rough' || scene.bodyFormat === 'manuscript';
  open = { storyId, sceneId, saved: scene.text, notesSaved: notes, prose, cursorSaved: scene.cursor || 0 };
  show('editor');
  lib.saveState({ screen: 'editor', storyId, sceneId }).catch(problem);
  $('sceneTitle').textContent = scene.title;
  $('notes').value = notes;
  $('notesPanel').hidden = true;
  editorButtons.notes.setAttribute('aria-pressed', 'false');
  $('viewPanel').hidden = true;
  $('viewToggle').setAttribute('aria-pressed', 'false');
  editorButtons.notes.textContent = notes.trim() ? 'Notes •' : 'Notes';
  editorButtons.spelling.setAttribute('aria-pressed', 'false');
  $('page').dataset.format = scene.bodyFormat;
  editor = createRoughEditor($('page'), {
    doc: scene.text,
    prose,
    cursor: scene.cursor || 0,
    onChange(next) {
      say('Editing');
      countWords(next);
      clearTimeout(textTimer);
      textTimer = setTimeout(saveText, 1000);
    },
    onSelection() {
      refreshButtons();
      // Remember where the cursor is shortly after it moves, not only when the app is left:
      // swiping the app away can end it before a last save gets through.
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(saveCursor, 1000);
    },
  });
  // Put the cursor back where it was, ready to type.
  requestAnimationFrame(() => editor?.focus());
  countWords(scene.text);
  refreshButtons();
  say(prose ? 'Saved' : `${FORMAT_NAMES[scene.bodyFormat]} · Saved`);
}

async function leaveEditor() {
  if (!editor) return;
  await saveAll();
  editor.destroy();
  editor = null;
  open = null;
  $('page').replaceChildren();
}

// Buttons act without taking focus, so the keyboard stays open.
function wire(button, action) {
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', () => { action(); refreshButtons(); });
}
wire(editorButtons.undo, () => editor?.undo());
wire(editorButtons.redo, () => editor?.redo());
wire(editorButtons.italic, () => editor?.toggle('italic'));
wire(editorButtons.bold, () => editor?.toggle('bold'));
wire(editorButtons.spelling, () => {
  const on = editorButtons.spelling.getAttribute('aria-pressed') !== 'true';
  editorButtons.spelling.setAttribute('aria-pressed', String(on));
  editor?.setSpelling(on);
});
editorButtons.notes.onclick = () => {
  const opening = $('notesPanel').hidden;
  $('notesPanel').hidden = !opening;
  editorButtons.notes.setAttribute('aria-pressed', String(opening));
  if (opening) $('notes').focus(); else { saveNotes(); editor?.focus(); }
};
$('notes').addEventListener('input', () => {
  editorButtons.notes.textContent = $('notes').value.trim() ? 'Notes •' : 'Notes';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotes, 1000);
});
$('editorBack').onclick = () => { if (storyId) openStory(storyId).catch(problem); };

// ---- Page settings: Focus Mode, Dyslexia comfort and text size. They change only how the page
// looks, never the text, and each is independent of the others.

let settings = { ...DEFAULTS };

function applySettings() {
  document.body.classList.toggle('focus', settings.focus && screen === 'editor');
  document.body.classList.toggle('comfort', settings.comfort);
  $('page').style.setProperty('--text-size', `${settings.textSize}px`);
  $('comfortToggle').setAttribute('aria-pressed', String(settings.comfort));
  $('sizeLabel').textContent = settings.textSize;
  $('smaller').disabled = stepTextSize(settings.textSize, -1) === settings.textSize;
  $('larger').disabled = stepTextSize(settings.textSize, 1) === settings.textSize;
}

function changeSettings(change) {
  settings = { ...settings, ...change };
  applySettings();
  // The page's size or spacing changed: keep the cursor's line on screen.
  if (editor) {
    editor.view.requestMeasure();
    editor.view.dispatch({ effects: EditorView.scrollIntoView(editor.view.state.selection.main.head, { y: 'center' }) });
  }
  lib.saveState({ settings }).catch(problem);
}

editorButtons.view = $('viewToggle');
editorButtons.view.onclick = () => {
  const opening = $('viewPanel').hidden;
  $('viewPanel').hidden = !opening;
  editorButtons.view.setAttribute('aria-pressed', String(opening));
};
wire($('focusOn'), () => { $('viewPanel').hidden = true; editorButtons.view.setAttribute('aria-pressed', 'false'); changeSettings({ focus: true }); });
wire($('focusExit'), () => changeSettings({ focus: false }));
wire($('comfortToggle'), () => changeSettings({ comfort: !settings.comfort }));
wire($('smaller'), () => changeSettings({ textSize: stepTextSize(settings.textSize, -1) }));
wire($('larger'), () => changeSettings({ textSize: stepTextSize(settings.textSize, 1) }));

// ---- Leaving the app and the Back button

document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll(); });
window.addEventListener('pagehide', () => { saveAll(); });
App.addListener('pause', () => { saveAll(); });
App.addListener('backButton', () => {
  if (!$('sheet').hidden) { $('sheet').hidden = true; return; }
  if (screen === 'editor' && settings.focus) { changeSettings({ focus: false }); return; }
  if (screen === 'editor') openStory(storyId).catch(problem);
  else if (screen === 'story' || screen === 'ideas') openHome().catch(problem);
  else App.minimizeApp();
});

// ---- Start where you left off

(async () => {
  try {
    await lib.adoptPrototype();
    const state = await lib.loadState();
    settings = cleanSettings(state.settings);
    applySettings();
    const stories = await lib.listStories();
    const known = stories.some((s) => s.id === state.storyId);
    if (known && state.screen === 'editor' && state.sceneId) {
      storyId = state.storyId;
      try { await openScene(state.sceneId); return; } catch { /* the scene is gone: fall through */ }
    }
    if (known && (state.screen === 'story' || state.screen === 'editor')) { await openStory(state.storyId); return; }
    if (state.screen === 'ideas') { await openHome(); await openIdeas(); return; }
    await openHome();
  } catch (err) {
    show('home');
    problem(err);
  }
})();
