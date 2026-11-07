// Saves scene text so nothing is ever half-written.
// Each save writes a temp file, reads it back, then swaps it in. The old file stays whole until
// the new one is complete. Recovery copies are kept now and then, newest five per scene.
// `fs` is a small adapter (see fs-capacitor.js for the phone, test/fs-node.cjs for the PC).

const RECOVERY_KEEP = 5;
const RECOVERY_EVERY_MS = 10 * 60 * 1000;

const safeId = (id) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('Bad scene id: ' + id);
  return String(id);
};

// `dir` puts this store's scenes/ and recovery/ folders inside another folder, e.g. 'stories/abc/'.
function createSceneStore(fs, { now = () => Date.now(), dir = '' } = {}) {
  const lastRecovery = new Map();
  const mainPath = (id) => `${dir}scenes/${safeId(id)}.txt`;
  const tmpPath = (id) => `${dir}scenes/${safeId(id)}.tmp`;
  const recoveryDir = `${dir}recovery`;

  async function keepRecovery(id, text) {
    const stamp = String(now()).padStart(15, '0');
    await fs.write(`${recoveryDir}/${safeId(id)}.${stamp}.txt`, text);
    lastRecovery.set(id, now());
    const mine = (await fs.list(recoveryDir))
      .filter((name) => name.startsWith(id + '.') && name.endsWith('.txt'))
      .sort();
    for (const old of mine.slice(0, Math.max(0, mine.length - RECOVERY_KEEP))) {
      await fs.remove(`${recoveryDir}/${old}`);
    }
  }

  async function load(id) {
    if (await fs.exists(mainPath(id))) {
      // A leftover temp file means a save was cut short. Keep it as a recovery copy, never
      // in place of the main file, since it may be incomplete.
      if (await fs.exists(tmpPath(id))) {
        await keepRecovery(id, await fs.read(tmpPath(id)));
        await fs.remove(tmpPath(id));
      }
      return fs.read(mainPath(id));
    }
    if (await fs.exists(tmpPath(id))) {
      // The swap was cut short after the old file was gone. The temp file is all there is.
      const text = await fs.read(tmpPath(id));
      await fs.rename(tmpPath(id), mainPath(id));
      return text;
    }
    return null;
  }

  // keepRecovery: always keep a copy of what's being replaced, for saves that look unusual.
  async function save(id, text, { keepRecovery: forceRecovery = false } = {}) {
    if (typeof text !== 'string') throw new Error('Scene text must be a string');
    await fs.write(tmpPath(id), text);
    const back = await fs.read(tmpPath(id));
    if (back !== text) {
      await fs.remove(tmpPath(id));
      throw new Error('Save check failed: the file read back differently. The previous copy is kept.');
    }
    if (await fs.exists(mainPath(id))) {
      const due = now() - (lastRecovery.get(id) ?? -Infinity) >= RECOVERY_EVERY_MS;
      if (due || forceRecovery) await keepRecovery(id, await fs.read(mainPath(id)));
    }
    await fs.rename(tmpPath(id), mainPath(id));
  }

  async function recoveryCopies(id) {
    safeId(id);
    return (await fs.list(recoveryDir))
      .filter((name) => name.startsWith(id + '.') && name.endsWith('.txt'))
      .sort()
      .reverse();
  }

  return { load, save, recoveryCopies };
}

module.exports = { createSceneStore, RECOVERY_KEEP, RECOVERY_EVERY_MS };
