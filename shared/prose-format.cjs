// How Rough and Manuscript scenes store their few styles, shared by the editor and Word export.
// The styles are private characters inside the text, so a typed * or # stays exactly what it is.
const ITALIC_ON = '\uE000';
const ITALIC_OFF = '\uE001';
const TITLE = '\uE002';
const SCENE_BREAK = '\uE003';
const BOLD_ON = '\uE004';
const BOLD_OFF = '\uE005';
const MARKERS = /[\uE000-\uE005]/g;

const stripMarkers = (text) => String(text).replace(MARKERS, '');

// A line as its kind and its runs of text. Styles end with the line.
function parseLine(line) {
  if (line === SCENE_BREAK) return { kind: 'break', runs: [] };
  const kind = line.startsWith(TITLE) ? 'title' : 'text';
  const runs = [];
  let italic = false;
  let bold = false;
  let text = '';
  const flush = () => { if (text) runs.push({ text, italic, bold }); text = ''; };
  for (const c of kind === 'title' ? line.slice(1) : line) {
    if (c === ITALIC_ON || c === ITALIC_OFF) { flush(); italic = c === ITALIC_ON; }
    else if (c === BOLD_ON || c === BOLD_OFF) { flush(); bold = c === BOLD_ON; }
    else if (c !== TITLE && c !== SCENE_BREAK) text += c;
  }
  flush();
  return { kind, runs };
}

module.exports = { ITALIC_ON, ITALIC_OFF, BOLD_ON, BOLD_OFF, TITLE, SCENE_BREAK, stripMarkers, parseLine };
