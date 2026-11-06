// The Rough page: CodeMirror showing the desktop's hidden style characters as italic, bold,
// titles and scene breaks. The stored text is always the source; styles only change the drawing.
// The display and style logic follows the desktop's src/markdown-editor.js (Rough and Manuscript
// part), trimmed to what the phone needs. Keep the two in step.
const { EditorState, EditorSelection } = require('@codemirror/state');
const { EditorView, Decoration, ViewPlugin, WidgetType, keymap } = require('@codemirror/view');
const { history, historyKeymap, defaultKeymap, undo, redo, undoDepth, redoDepth, insertNewline } = require('@codemirror/commands');
const { ITALIC_ON, ITALIC_OFF, BOLD_ON, BOLD_OFF, TITLE, SCENE_BREAK, stripMarkers } = require('../shared/prose-format.cjs');

// ---- Plain text logic, no screen needed (tested on the PC).

const STYLES = { italic: [ITALIC_ON, ITALIC_OFF], bold: [BOLD_ON, BOLD_OFF] };

// Same rule as the desktop's model.cjs wordCount, on the text without hidden characters.
const wordCount = (text) => (stripMarkers(String(text || '').replaceAll(SCENE_BREAK, ' ')).trim().match(/\S+/g) || []).length;

// Every line has to close what it opens, in order. The desktop always writes text this way.
function markersPaired(text) {
  for (const line of String(text).split('\n')) {
    const open = { italic: false, bold: false };
    for (const c of line) {
      for (const [style, [on, off]] of Object.entries(STYLES)) {
        if (c === on) { if (open[style]) return false; open[style] = true; }
        if (c === off) { if (!open[style]) return false; open[style] = false; }
      }
    }
    if (open.italic || open.bold) return false;
  }
  return true;
}

// A line's characters with their styles, without its hidden characters.
function charsOf(text) {
  const out = [];
  let italic = false;
  let bold = false;
  for (const c of text.startsWith(TITLE) ? text.slice(1) : text) {
    if (c === ITALIC_ON) italic = true;
    else if (c === ITALIC_OFF) italic = false;
    else if (c === BOLD_ON) bold = true;
    else if (c === BOLD_OFF) bold = false;
    else out.push({ c, italic, bold });
  }
  return out;
}
// Back to stored text. rawAt turns a position among the characters into one in the stored line.
function storedLine(text, chars) {
  let out = text.startsWith(TITLE) ? TITLE : '';
  const on = { italic: false, bold: false };
  const positions = [];
  for (const ch of chars) {
    for (const style of Object.keys(STYLES)) {
      if (ch[style] !== on[style]) { out += STYLES[style][ch[style] ? 0 : 1]; on[style] = ch[style]; }
    }
    positions.push(out.length);
    out += ch.c;
  }
  const end = out.length;
  for (const style of Object.keys(STYLES)) if (on[style]) out += STYLES[style][1];
  return { text: out, rawAt: (i) => (i < positions.length ? positions[i] : end) };
}
const plainOffset = (text, raw) => charsOf(text.slice(0, raw)).length;
// The stored position just before the plain character at `plain`.
function rawFromPlain(text, plain) {
  let count = 0;
  for (let at = text.startsWith(TITLE) ? 1 : 0; at < text.length; at++) {
    if (/[-]/.test(text[at])) continue;
    if (count === plain) return at;
    count++;
  }
  return text.length;
}
// The word the cursor sits inside (letters on both sides, no hidden marks), as line offsets.
const WORD = /[\p{L}\p{N}\p{M}'’]/u;
function wordAround(text, offset) {
  if (!WORD.test(text[offset - 1] || '') || !WORD.test(text[offset] || '')) return null;
  let from = offset;
  let to = offset;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  while (to < text.length && WORD.test(text[to])) to++;
  return { from, to };
}
const isOpen = (before, style) => before.lastIndexOf(STYLES[style][0]) > before.lastIndexOf(STYLES[style][1]);

// The change that turns a style on or off: for the selection, or from the cursor onwards.
function toggleStyleSpec(state, style) {
  const [turnOn, turnOff] = STYLES[style];
  const { from, to, empty, head } = state.selection.main;
  if (empty) {
    const line = state.doc.lineAt(head);
    const offset = head - line.from;
    const before = line.text.slice(0, offset);
    // Phone only: with the cursor inside a word, style the whole word. Inserting marks in the
    // middle of a word the keyboard is still composing breaks the line on Android keyboards.
    const word = wordAround(line.text, offset);
    if (word) {
      if (!isOpen(before, style)) {
        return { changes: [{ from: line.from + word.from, insert: turnOn }, { from: line.from + word.to, insert: turnOff }], selection: { anchor: head + 1 } };
      }
      const plain = plainOffset(line.text, offset);
      const spec = toggleStyleSpec(state.update({ selection: { anchor: line.from + word.from, head: line.from + word.to } }).state, style);
      if (!spec) return null;
      const next = spec.changes.find((c) => c.from === line.from).insert;
      return { changes: spec.changes, selection: { anchor: line.from + rawFromPlain(next, plain) } };
    }
    if (isOpen(before, style)) {
      const close = line.text.indexOf(turnOff, offset);
      if (close === offset && before.endsWith(turnOn)) return { changes: { from: head - 1, to: head + 1 }, selection: { anchor: head - 1 } };
      return { selection: { anchor: line.from + (close < 0 ? line.length : close + 1) } };
    }
    if (line.text === SCENE_BREAK) return null;
    return { changes: { from: head, insert: turnOn + turnOff }, selection: { anchor: head + 1 } };
  }
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const lines = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    const start = n === first.number ? plainOffset(line.text, from - line.from) : 0;
    const chars = charsOf(line.text);
    const end = n === last.number ? plainOffset(line.text, to - line.from) : chars.length;
    lines.push({ line, chars, start, end, skip: line.text === SCENE_BREAK });
  }
  const chosen = lines.filter((l) => !l.skip).flatMap((l) => l.chars.slice(l.start, l.end));
  if (!chosen.length) return null;
  const wanted = !chosen.every((c) => c[style]);
  const changes = [];
  let shift = 0;
  let anchor = from;
  let target = to;
  for (const l of lines) {
    if (l.skip) continue;
    l.chars.slice(l.start, l.end).forEach((c) => { c[style] = wanted; });
    const next = storedLine(l.line.text, l.chars);
    if (l.line.number === first.number) anchor = l.line.from + shift + next.rawAt(l.start);
    if (l.line.number === last.number) target = l.line.from + shift + next.rawAt(l.end);
    changes.push({ from: l.line.from, to: l.line.to, insert: next.text });
    shift += next.text.length - l.line.length;
  }
  return { changes, selection: EditorSelection.single(anchor, target) };
}

// Which styles are on at the cursor, for lighting up the buttons.
function stylesAt(state) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  return { italic: isOpen(before, 'italic'), bold: isOpen(before, 'bold') };
}

// ---- Drawing.

class ProseBreak extends WidgetType {
  toDOM() {
    const node = document.createElement('span');
    node.className = 'cm-ms-break';
    node.textContent = '#';
    return node;
  }
}
const hide = Decoration.replace({});
const proseBreak = Decoration.replace({ widget: new ProseBreak() });
const italicMark = Decoration.mark({ class: 'cm-ms-em' });
const boldMark = Decoration.mark({ class: 'cm-ms-strong' });
const titleLine = (first, last) => Decoration.line({ class: 'cm-ms-title' + (first ? ' cm-ms-titlefirst' : '') + (last ? ' cm-ms-titlelast' : '') });
const breakLine = Decoration.line({ class: 'cm-ms-breakline' });

function buildProse(view) {
  const { doc } = view.state;
  const ranges = [];
  const hidden = [];
  for (const { from, to } of view.visibleRanges) {
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
      const line = doc.line(n);
      if (line.text === SCENE_BREAK) {
        ranges.push(breakLine.range(line.from));
        hidden.push(proseBreak.range(line.from, line.to));
        continue;
      }
      if (line.text.startsWith(TITLE)) {
        const first = n === 1 || !doc.line(n - 1).text.startsWith(TITLE);
        const lastLine = n === doc.lines || !doc.line(n + 1).text.startsWith(TITLE);
        ranges.push(titleLine(first, lastLine).range(line.from));
        hidden.push(hide.range(line.from, line.from + 1));
      }
      const open = { italic: null, bold: null };
      const close = (style, mark, at) => { if (open[style] !== null && at > open[style]) ranges.push(mark.range(open[style], at)); open[style] = null; };
      for (let i = 0; i < line.text.length; i++) {
        const at = line.from + i;
        const c = line.text[i];
        if (c === ITALIC_ON || c === ITALIC_OFF || c === BOLD_ON || c === BOLD_OFF) hidden.push(hide.range(at, at + 1));
        if (c === ITALIC_ON) open.italic = at + 1;
        else if (c === ITALIC_OFF) close('italic', italicMark, at);
        else if (c === BOLD_ON) open.bold = at + 1;
        else if (c === BOLD_OFF) close('bold', boldMark, at);
      }
      close('italic', italicMark, line.to);
      close('bold', boldMark, line.to);
    }
  }
  // Only the hidden characters are stepped over. Styled text stays reachable by the cursor.
  return { atomic: Decoration.set(hidden, true), decorations: Decoration.set([...ranges, ...hidden], true) };
}

const proseView = ViewPlugin.fromClass(class {
  constructor(view) { Object.assign(this, buildProse(view)); }
  update(u) { if (u.docChanged || u.viewportChanged) Object.assign(this, buildProse(u.view)); }
}, { decorations: (p) => p.decorations, provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic || Decoration.none) });

// Enter stays centered on a title line, like the desktop.
function titleEnter(view) {
  const { state } = view;
  if (!state.doc.lineAt(state.selection.main.head).text.startsWith(TITLE)) return false;
  view.dispatch(state.replaceSelection('\n' + TITLE), { scrollIntoView: true, userEvent: 'input' });
  return true;
}

// ---- The editor.

function createRoughEditor(parent, { doc, onChange, onSelection }) {
  let spelling = false;
  const toggle = (view, style) => {
    const spec = toggleStyleSpec(view.state, style);
    if (spec) view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input.style' });
    return true;
  };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([
          { key: 'Enter', run: (v) => titleEnter(v) || insertNewline(v) },
          { key: 'Mod-i', run: (v) => toggle(v, 'italic') },
          { key: 'Mod-b', run: (v) => toggle(v, 'bold') },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        proseView,
        EditorView.lineWrapping,
        // Text leaving or arriving never carries the hidden characters.
        EditorView.clipboardOutputFilter.of((text) => stripMarkers(text.replaceAll(SCENE_BREAK, '#'))),
        EditorView.clipboardInputFilter.of((text) => stripMarkers(text)),
        // Rough stays quiet, like the desktop: no spelling marks unless asked for.
        // The keyboard's own word suggestions are untouched.
        EditorView.contentAttributes.of(() => ({ spellcheck: spelling ? 'true' : 'false', autocapitalize: 'sentences', 'aria-label': 'Scene' })),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange?.(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) onSelection?.(u.state);
        }),
      ],
    }),
  });
  return {
    view,
    getText: () => view.state.doc.toString(),
    toggle(style) { toggle(view, style); view.focus(); },
    undo() { undo(view); view.focus(); },
    redo() { redo(view); view.focus(); },
    canUndo: () => undoDepth(view.state) > 0,
    canRedo: () => redoDepth(view.state) > 0,
    stylesAt: () => stylesAt(view.state),
    setSpelling(on) {
      spelling = on;
      view.contentDOM.setAttribute('spellcheck', on ? 'true' : 'false');
      // The browser only redraws spelling marks when the text is touched or focus changes.
      view.contentDOM.blur();
      view.focus();
    },
  };
}

module.exports = { createRoughEditor, toggleStyleSpec, stylesAt, wordCount, markersPaired, charsOf, storedLine };
