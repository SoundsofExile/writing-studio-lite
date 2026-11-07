// Files copied from the desktop app must stay identical to the desktop's version on main.
// If this fails, the desktop changed its format: copy the new file over and check the phone code.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Git's own fingerprint for a file, ignoring Windows line endings.
const gitHash = (buf) => {
  const body = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
};

const copies = {
  // From SoundsofExile/writing-studio, main, commit d72b267.
  'prose-format.cjs': '655140b16ce681f501eef7e8fbd811ef75b98508',
  // From the desktop's feature/phone-sync branch (studio-dev), which brings handoff v2 to the desktop.
  'handoff.cjs': '0badfc06e05f9bda1d8eb0632cec6763d5fc8637',
};

for (const [name, expected] of Object.entries(copies)) {
  test(`shared/${name} matches the copy it was taken from`, () => {
    assert.equal(gitHash(fs.readFileSync(path.join(__dirname, '..', 'shared', name))), expected);
  });

  // When the desktop checkout sits next to this folder, compare with it directly too.
  const desktop = path.join(__dirname, '..', '..', 'rev03', name);
  test(`shared/${name} still matches the desktop's main`, { skip: !fs.existsSync(desktop) && 'no desktop checkout next to this folder' }, () => {
    assert.equal(gitHash(fs.readFileSync(desktop)), expected,
      'The desktop file changed. Copy it into shared/, update the fingerprint, and check the phone code.');
  });
}
