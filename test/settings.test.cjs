// Focus Mode, Dyslexia comfort and text size settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TEXT_SIZES, DEFAULTS, cleanSettings, stepTextSize } = require('../src/settings.js');

test('missing or odd saved settings fall back to the defaults, one at a time', () => {
  assert.deepEqual(cleanSettings(undefined), DEFAULTS);
  assert.deepEqual(cleanSettings('nope'), DEFAULTS);
  assert.deepEqual(cleanSettings({ focus: 'yes', comfort: true, textSize: 17 }), { focus: false, comfort: true, textSize: 18 });
  assert.deepEqual(cleanSettings({ focus: true, comfort: false, textSize: 24, extra: 1 }), { focus: true, comfort: false, textSize: 24 });
});

test('text size steps one size at a time and stops at the ends', () => {
  assert.equal(stepTextSize(18, 1), 20);
  assert.equal(stepTextSize(18, -1), 16);
  assert.equal(stepTextSize(TEXT_SIZES[0], -1), TEXT_SIZES[0]);
  assert.equal(stepTextSize(TEXT_SIZES.at(-1), 1), TEXT_SIZES.at(-1));
  assert.equal(stepTextSize(17, 1), 20);
});
