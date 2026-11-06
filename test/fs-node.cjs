// The PC stand-in for the phone's file adapter, rooted in a throwaway test folder.
const fs = require('node:fs/promises');
const path = require('node:path');

function fsNode(root) {
  const at = (p) => path.join(root, p);
  return {
    read: (p) => fs.readFile(at(p), 'utf8'),
    async write(p, data) {
      await fs.mkdir(path.dirname(at(p)), { recursive: true });
      await fs.writeFile(at(p), data, 'utf8');
    },
    rename: (a, b) => fs.rename(at(a), at(b)),
    remove: (p) => fs.rm(at(p)),
    exists: (p) => fs.access(at(p)).then(() => true, () => false),
    list: (d) => fs.readdir(at(d)).catch(() => []),
  };
}

module.exports = { fsNode };
