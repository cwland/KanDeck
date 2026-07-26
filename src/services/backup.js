/**
 * Backup & disaster recovery (spec 2.1).
 *   - Automated backups on a configurable cron (default weekly).
 *   - Datetime-stamped files in data/backups (kandeck_backup_<stamp>.json).
 *   - Manual create / list / restore (used by the Settings UI).
 * A backup bundles config + every board into one JSON snapshot.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import cron from 'node-cron';
import config from '../config.js';
import { fileStamp } from '../util.js';
import {
  readJson,
  writeJsonAtomic,
  listJson,
  ensureDir,
} from '../storage/store.js';

function backupPath(stamp) {
  return path.join(config.backupsDir, `kandeck_backup_${stamp}.json`);
}

export async function createBackup(reason = 'manual') {
  await ensureDir(config.backupsDir);
  const boardIds = (await listJson(config.boardsDir)).filter((id) => id !== '_index');
  const boards = {};
  for (const id of boardIds) boards[id] = await readJson(path.join(config.boardsDir, `${id}.json`));
  const index = await readJson(path.join(config.boardsDir, '_index.json'), { boards: [] });
  const snapshot = {
    kind: 'kandeck-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    reason,
    index,
    boards,
  };
  const stamp = fileStamp();
  const file = backupPath(stamp);
  await writeJsonAtomic(file, snapshot);
  await pruneOld();
  return { file: path.basename(file), createdAt: snapshot.createdAt };
}

export async function listBackups() {
  await ensureDir(config.backupsDir);
  const entries = await fs.readdir(config.backupsDir);
  const files = entries.filter((f) => f.startsWith('kandeck_backup_') && f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const st = await fs.stat(path.join(config.backupsDir, f));
    out.push({ file: f, size: st.size, createdAt: st.mtime.toISOString() });
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function restoreBackup(fileName) {
  // guard against path traversal
  const safe = path.basename(fileName);
  const full = path.join(config.backupsDir, safe);
  const snap = await readJson(full, null);
  if (!snap || snap.kind !== 'kandeck-backup') throw new Error('Invalid backup file');
  // Safety backup of current state first.
  await createBackup('pre-restore');
  // Wipe current boards and write snapshot boards.
  const existing = (await listJson(config.boardsDir)).filter((id) => id !== '_index');
  for (const id of existing) await fs.rm(path.join(config.boardsDir, `${id}.json`), { force: true });
  for (const [id, board] of Object.entries(snap.boards || {}))
    if (board) await writeJsonAtomic(path.join(config.boardsDir, `${id}.json`), board);
  await writeJsonAtomic(path.join(config.boardsDir, '_index.json'), snap.index || { boards: [] });
  return { restored: safe, boards: Object.keys(snap.boards || {}).length };
}

async function pruneOld() {
  const list = await listBackups();
  const keep = config.backupRetention;
  if (list.length <= keep) return;
  for (const b of list.slice(keep))
    await fs.rm(path.join(config.backupsDir, b.file), { force: true });
}

/** Schedule automated backups. Returns the scheduled task. */
export function scheduleBackups() {
  if (!cron.validate(config.backupCron)) {
    console.warn('[backup] invalid BACKUP_CRON, skipping schedule:', config.backupCron);
    return null;
  }
  console.log(`[backup] automated backups scheduled: ${config.backupCron}`);
  return cron.schedule(config.backupCron, () =>
    createBackup('scheduled').then((b) => console.log('[backup] created', b.file)).catch((e) => console.error('[backup]', e))
  );
}

// CLI: `node src/services/backup.js --once`
if (process.argv[1] && process.argv[1].endsWith('backup.js') && process.argv.includes('--once')) {
  createBackup('cli').then((b) => { console.log('Backup created:', b.file); process.exit(0); });
}
