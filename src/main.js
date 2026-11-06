// Milestone 2: one scene on the Rough page, with italic, bold, undo, redo, word count and a
// spelling switch. Saving is unchanged from milestone 1.
const { App } = require('@capacitor/app');
const { createSceneStore } = require('./scene-store.js');
const { fsCapacitor } = require('./fs-capacitor.js');
const { createRoughEditor, wordCount, markersPaired } = require('./rough.js');

const SCENE = 'prototype';
const store = createSceneStore(fsCapacitor);
const $ = (id) => document.getElementById(id);
const status = $('status');
const words = $('words');
const buttons = { undo: $('undo'), redo: $('redo'), italic: $('italic'), bold: $('bold'), spelling: $('spelling') };

let editor = null;
let saved = '';
let timer = null;
let saving = Promise.resolve();
let warned = false;

const show = (text) => { status.textContent = text; };
const countWords = (text) => {
  const n = wordCount(text);
  words.textContent = `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`;
};

function refreshButtons() {
  if (!editor) return;
  const on = editor.stylesAt();
  buttons.italic.setAttribute('aria-pressed', String(on.italic));
  buttons.bold.setAttribute('aria-pressed', String(on.bold));
  buttons.undo.disabled = !editor.canUndo();
  buttons.redo.disabled = !editor.canRedo();
}

// Saves run one after another, so an older save can never land on top of a newer one.
function saveNow() {
  clearTimeout(timer);
  timer = null;
  if (!editor) return saving;
  const text = editor.getText();
  if (text === saved) return saving;
  saving = saving.then(async () => {
    // Style marks that don't pair up mean something went wrong while typing.
    // Save anyway, so no words are lost, but keep the copy from before as well.
    const odd = !markersPaired(text);
    try {
      await store.save(SCENE, text, { keepRecovery: odd });
      saved = text;
      if (odd && !warned) { warned = true; show('Saved · styles look odd, earlier copy kept'); }
      else show(editor.getText() === saved ? 'Saved' : 'Editing');
    } catch (err) {
      show('Not saved: ' + err.message);
    }
  });
  return saving;
}

// Buttons act without taking focus, so the keyboard stays open.
function wire(button, action) {
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', () => { action(); refreshButtons(); });
}
wire(buttons.undo, () => editor?.undo());
wire(buttons.redo, () => editor?.redo());
wire(buttons.italic, () => editor?.toggle('italic'));
wire(buttons.bold, () => editor?.toggle('bold'));
wire(buttons.spelling, () => {
  const on = buttons.spelling.getAttribute('aria-pressed') !== 'true';
  buttons.spelling.setAttribute('aria-pressed', String(on));
  editor?.setSpelling(on);
});

// Save straight away when the app is hidden, the screen locks, or the app is closed.
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('pagehide', saveNow);
App.addListener('pause', saveNow);

(async () => {
  try {
    const text = await store.load(SCENE);
    saved = text ?? '';
    editor = createRoughEditor($('page'), {
      doc: saved,
      onChange(next) {
        show('Editing');
        countWords(next);
        clearTimeout(timer);
        timer = setTimeout(saveNow, 1000);
      },
      onSelection: refreshButtons,
    });
    countWords(saved);
    refreshButtons();
    show(text === null ? 'New scene' : 'Saved');
  } catch (err) {
    show('Could not open: ' + err.message);
  }
})();
