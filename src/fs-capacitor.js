// The phone's file adapter: the app's private data folder through Capacitor Filesystem.
const { Filesystem, Directory, Encoding } = require('@capacitor/filesystem');

const base = { directory: Directory.Data };

const fsCapacitor = {
  async read(path) {
    const { data } = await Filesystem.readFile({ ...base, path, encoding: Encoding.UTF8 });
    return data;
  },
  async write(path, data) {
    await Filesystem.writeFile({ ...base, path, data, encoding: Encoding.UTF8, recursive: true });
  },
  async rename(from, to) {
    try {
      await Filesystem.rename({ ...base, from, to, toDirectory: Directory.Data });
    } catch (err) {
      // If this Android version won't replace an existing file, remove it and try again.
      // The store copes with a missing main file by using the temp file.
      if (!(await fsCapacitor.exists(to))) throw err;
      await Filesystem.deleteFile({ ...base, path: to });
      await Filesystem.rename({ ...base, from, to, toDirectory: Directory.Data });
    }
  },
  async remove(path) {
    await Filesystem.deleteFile({ ...base, path });
  },
  async exists(path) {
    try { await Filesystem.stat({ ...base, path }); return true; } catch { return false; }
  },
  async list(dir) {
    try {
      const { files } = await Filesystem.readdir({ ...base, path: dir });
      return files.map((f) => (typeof f === 'string' ? f : f.name));
    } catch { return []; }
  },
};

module.exports = { fsCapacitor };
