/**
 * Flat-file storage engine for KanDeck.
 *
 * Design goals (from spec 2.1):
 *   - All boards/columns/cards/preferences persist in local JSON files.
 *   - Data integrity: atomic writes (write temp file, fsync, rename) so a
 *     crash mid-write never corrupts the live file.
 *   - File locking: an in-process, per-path async mutex serialises concurrent
 *     writes coming from the UI and the REST API (both served by this one
 *     Node process), preventing lost updates / interleaved writes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Map<absPath, Promise> — tail of the write queue for each file path. */
const locks = new Map();

/**
 * Run `fn` while holding an exclusive lock for `key`. Calls for the same key
 * are serialised; calls for different keys run concurrently.
 */
export async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((res) => (release = res));
  locks.set(key, prev.then(() => next));
  try {
    await prev.catch(() => {}); // wait our turn; ignore prior errors
    return await fn();
  } finally {
    release();
    // Clean up if we were the last waiter in the chain.
    if (locks.get(key) === next) locks.delete(key);
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/** Read + parse a JSON file. Returns `fallback` if the file does not exist. */
export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim() === '' ? fallback : JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/**
 * Atomically write `data` (serialised to pretty JSON) to `filePath`.
 * Writes to a temp file in the same directory, fsyncs, then renames over the
 * target — rename is atomic on POSIX filesystems.
 */
export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const json = JSON.stringify(data, null, 2);
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(json, 'utf8');
    await fh.sync(); // flush to disk before rename
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, filePath);
  return data;
}

/** Locked read-modify-write helper. `mutator(current)` returns the new value. */
export async function updateJson(filePath, mutator, fallback = null) {
  return withLock(filePath, async () => {
    const current = await readJson(filePath, fallback);
    const next = await mutator(current);
    await writeJsonAtomic(filePath, next);
    return next;
  });
}

/** List *.json basenames (without extension) in a directory. */
export async function listJson(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .map((f) => f.slice(0, -'.json'.length));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export { ensureDir };
