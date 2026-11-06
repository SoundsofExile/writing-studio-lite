// Milestone 1 prototype: one scene. Type, swipe the app away, reopen, and the exact text is back.
const { App } = require('@capacitor/app');
const { createSceneStore } = require('./scene-store.js');
const { fsCapacitor } = require('./fs-capacitor.js');

const SCENE = 'prototype';
const store = createSceneStore(fsCapacitor);
const page = document.getElementById('page');
const status = document.getElementById('status');

let saved = '';
let timer = null;
let saving = Promise.resolve();

const show = (text) => { status.textContent = text; };

// Saves run one after another, so an older save can never land on top of a newer one.
function saveNow() {
  clearTimeout(timer);
  timer = null;
  const text = page.value;
  if (text === saved) return saving;
  saving = saving.then(async () => {
    try {
      await store.save(SCENE, text);
      saved = text;
      show(page.value === saved ? 'Saved' : 'Editing');
    } catch (err) {
      show('Not saved: ' + err.message);
    }
  });
  return saving;
}

page.addEventListener('input', () => {
  show('Editing');
  clearTimeout(timer);
  timer = setTimeout(saveNow, 1000);
});

// Save straight away when the app is hidden, the screen locks, or the app is closed.
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('pagehide', saveNow);
App.addListener('pause', saveNow);

(async () => {
  try {
    const text = await store.load(SCENE);
    saved = text ?? '';
    page.value = saved;
    show(text === null ? 'New scene' : 'Saved');
  } catch (err) {
    page.readOnly = true;
    show('Could not open: ' + err.message);
  }
})();
