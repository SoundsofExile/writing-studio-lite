// The Rough page's text logic: styling never changes the words, and the stored text stays in the
// desktop's format.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EditorState, EditorSelection } = require('@codemirror/state');
const { toggleStyleSpec, stylesAt, wordCount, markersPaired, charsOf, storedLine } = require('../src/rough.js');
const P = require('../shared/prose-format.cjs');

const I = P.ITALIC_ON;
const i = P.ITALIC_OFF;
const B = P.BOLD_ON;
const b = P.BOLD_OFF;

const stateWith = (doc, anchor, head = anchor) => EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
const apply = (state, style) => {
  const spec = toggleStyleSpec(state, style);
  return spec ? state.update(spec).state : state;
};

test('italic on a selection wraps it in the hidden characters', () => {
  const s = apply(stateWith('one two three', 4, 7), 'italic');
  assert.equal(s.doc.toString(), `one ${I}two${i} three`);
  assert.equal(P.stripMarkers(s.doc.toString()), 'one two three');
});

test('italic again on the same words takes it off, back to the exact text', () => {
  const s1 = apply(stateWith('one two three', 4, 7), 'italic');
  const sel = s1.selection.main;
  const s2 = apply(stateWith(s1.doc.toString(), sel.from, sel.to), 'italic');
  assert.equal(s2.doc.toString(), 'one two three');
});

test('bold inside italic keeps both, closed in order', () => {
  const s1 = apply(stateWith('one two three', 0, 13), 'italic');
  const doc = s1.doc.toString();
  const from = doc.indexOf('two');
  const s2 = apply(stateWith(doc, from, from + 3), 'bold');
  const out = s2.doc.toString();
  assert.equal(P.stripMarkers(out), 'one two three');
  assert.ok(markersPaired(out));
  const runs = P.parseLine(out).runs;
  assert.deepEqual(runs.map((r) => [r.text, r.italic, r.bold]), [['one ', true, false], ['two', true, true], [' three', true, false]]);
});

test('with no selection, italic turns on for what you type next', () => {
  const s = apply(stateWith('Hello ', 6), 'italic');
  assert.equal(s.doc.toString(), `Hello ${I}${i}`);
  assert.equal(s.selection.main.head, 7);
  assert.deepEqual(stylesAt(s), { italic: true, bold: false });
  const typed = s.update(s.replaceSelection('there')).state;
  assert.equal(typed.doc.toString(), `Hello ${I}there${i}`);
});

test('with the cursor inside a word, bold styles that whole word and keeps the cursor', () => {
  const s = apply(stateWith('the window opened', 7), 'bold'); // the|win|dow
  assert.equal(s.doc.toString(), `the ${B}window${b} opened`);
  assert.equal(P.stripMarkers(s.doc.sliceString(0, s.selection.main.head)), 'the win');
  // Typing carries on inside the bold word.
  const typed = s.update(s.replaceSelection('x')).state;
  assert.equal(typed.doc.toString(), `the ${B}winxdow${b} opened`);
});

test('bold again inside that word takes it off, back to the exact text', () => {
  const on = apply(stateWith('the window opened', 7), 'bold');
  const off = apply(on, 'bold');
  assert.equal(off.doc.toString(), 'the window opened');
  assert.equal(off.selection.main.head, 7);
});

test('inside a word that is part of a longer italic run, only that word loses italic', () => {
  const doc = `${I}one two three${i}`;
  const s = apply(stateWith(doc, 1 + 5), 'italic'); // o|ne t|wo
  assert.equal(s.doc.toString(), `${I}one ${i}two${I} three${i}`);
  assert.equal(P.stripMarkers(s.doc.sliceString(0, s.selection.main.head)), 'one t');
});

test('accented letters and apostrophes count as part of the word', () => {
  const s = apply(stateWith("don't café", 8), 'italic'); // ca|fé
  assert.equal(s.doc.toString(), `don't ${I}café${i}`);
  const t = apply(stateWith("don't café", 2), 'italic'); // do|n't
  assert.equal(t.doc.toString(), `${I}don't${i} café`);
});

test('turning italic on and straight off again leaves nothing behind', () => {
  const on = apply(stateWith('Hello ', 6), 'italic');
  const off = apply(on, 'italic');
  assert.equal(off.doc.toString(), 'Hello ');
});

test('turning italic off after typing moves past the closing mark', () => {
  const on = apply(stateWith('Hello ', 6), 'italic');
  const typed = on.update(on.replaceSelection('there')).state;
  const off = apply(typed, 'italic');
  assert.equal(off.doc.toString(), `Hello ${I}there${i}`);
  const more = off.update(off.replaceSelection(' friend')).state;
  assert.equal(more.doc.toString(), `Hello ${I}there${i} friend`);
  assert.deepEqual(stylesAt(more), { italic: false, bold: false });
});

test('styling across lines closes each line, and skips scene breaks', () => {
  const doc = `first\n${P.SCENE_BREAK}\nsecond`;
  const s = apply(stateWith(doc, 0, doc.length), 'bold');
  assert.equal(s.doc.toString(), `${B}first${b}\n${P.SCENE_BREAK}\n${B}second${b}`);
});

test('a title line keeps its title mark when styled', () => {
  const doc = `${P.TITLE}Chapter One`;
  const s = apply(stateWith(doc, 1, doc.length), 'italic');
  assert.equal(s.doc.toString(), `${P.TITLE}${I}Chapter One${i}`);
});

test('nothing to style on a scene break line', () => {
  assert.equal(toggleStyleSpec(stateWith(P.SCENE_BREAK, 0), 'italic'), null);
});

test('stored lines round-trip through characters and back', () => {
  for (const line of ['plain', `${I}a${i} b ${B}c${b}`, `${P.TITLE}T ${I}x${i}`, `${I}${B}both${i}${b}`, '']) {
    assert.equal(storedLine(line, charsOf(line)).text, line);
  }
});

test('closing marks in another order come back in the desktop order, with the same words and styles', () => {
  const line = `${I}${B}both${b}${i}`;
  const out = storedLine(line, charsOf(line)).text;
  assert.equal(out, `${I}${B}both${i}${b}`);
  assert.deepEqual(P.parseLine(out), P.parseLine(line));
});

test('word count ignores hidden characters and scene breaks', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('  one  two\nthree '), 3);
  assert.equal(wordCount(`${P.TITLE}Title\n${I}soft${i} ${B}loud${b}\n${P.SCENE_BREAK}\nend`), 4);
  assert.equal(wordCount(`half${I}way${i}`), 1);
});

test('style marks pairing check', () => {
  assert.ok(markersPaired('no styles'));
  assert.ok(markersPaired(`${I}a${i}\n${B}b${b}`));
  assert.ok(markersPaired(`${I}${i}`));
  assert.equal(markersPaired(`${I}open`), false);
  assert.equal(markersPaired(`close${i}`), false);
  assert.equal(markersPaired(`${I}a\nb${i}`), false, 'styles end with the line');
  assert.equal(markersPaired(`${I}${I}a${i}`), false);
});
