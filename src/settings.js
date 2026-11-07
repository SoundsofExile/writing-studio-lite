// How the page looks: Focus Mode, Dyslexia comfort and text size. Each is independent, and none of
// them ever touches the text. Kept with the app state, so they survive the app being closed.
const TEXT_SIZES = [14, 16, 18, 20, 22, 24, 26];
const DEFAULTS = Object.freeze({ focus: false, comfort: false, textSize: 18 });

// Anything odd in a saved file falls back to the default, one setting at a time.
function cleanSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    focus: typeof s.focus === 'boolean' ? s.focus : DEFAULTS.focus,
    comfort: typeof s.comfort === 'boolean' ? s.comfort : DEFAULTS.comfort,
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : DEFAULTS.textSize,
  };
}

// One step smaller (-1) or larger (+1), stopping at the ends.
function stepTextSize(size, direction) {
  const at = TEXT_SIZES.indexOf(size);
  const from = at === -1 ? TEXT_SIZES.indexOf(DEFAULTS.textSize) : at;
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, from + Math.sign(direction)))];
}

module.exports = { TEXT_SIZES, DEFAULTS, cleanSettings, stepTextSize };
