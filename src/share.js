// Hands finished files to Android's Share sheet, where you pick OneDrive, Drive, email or "Save to
// device". The files are written to the app's cache first (the only place the Share sheet can
// read them from), and the previous export there is cleared each time. Nothing in your stories
// is touched. In a desktop browser, used for checking, each file downloads instead.
const { Capacitor } = require('@capacitor/core');
const { Filesystem, Directory, Encoding } = require('@capacitor/filesystem');
const { Share } = require('@capacitor/share');

const MIME = {
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// files: [{ name: 'Story - Scene.json', text }] or [{ name: '….docx', base64 }]
async function shareFiles(files, title) {
  if (!Capacitor.isNativePlatform()) return downloadAll(files);
  await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true }).catch(() => {});
  const uris = [];
  for (const f of files) {
    const written = await Filesystem.writeFile({
      path: `exports/${f.name}`, directory: Directory.Cache, recursive: true,
      ...(f.base64 !== undefined ? { data: f.base64 } : { data: f.text, encoding: Encoding.UTF8 }),
    });
    uris.push(written.uri);
  }
  try {
    await Share.share({ title, dialogTitle: title, files: uris });
    return true;
  } catch (err) {
    if (/cancel/i.test(String(err && err.message))) return false; // closed the Share sheet: not a problem
    throw err;
  }
}

function downloadAll(files) {
  for (const f of files) {
    const ext = f.name.split('.').pop();
    const blob = f.base64 !== undefined
      ? new Blob([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], { type: MIME[ext] })
      : new Blob([f.text], { type: MIME[ext] || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  return true;
}

module.exports = { shareFiles };
