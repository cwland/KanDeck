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
import { getBackupConfig } from '../storage/settings.js';
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
    const full = path.join(config.backupsDir, f);
    const st = await fs.stat(full);
    // The snapshot carries its own `reason`; surface it so the UI can tell an
    // automated (scheduled) backup from a manual/pre-restore one.
    let reason = 'manual';
    let createdAt = st.mtime.toISOString();
    try {
      const snap = await readJson(full, null);
      if (snap && snap.reason) reason = snap.reason;
      if (snap && snap.createdAt) createdAt = snap.createdAt;
    } catch { /* fall back to fs mtime */ }
    out.push({ file: f, size: st.size, createdAt, reason, automated: reason === 'scheduled' });
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

// Frequency (from settings) → cron expression. Backups run at 03:00 local.
const FREQUENCY_CRON = {
  daily: '0 3 * * *',
  weekly: '0 3 * * 0',   // Sundays
  monthly: '0 3 1 * *',  // 1st of the month
};

let backupTask = null;

/**
 * (Re)schedule automated backups from the user's settings. Call again after the
 * user changes the auto-backup config to apply it live. Returns the task (or null
 * when auto-backup is disabled). Falls back to the legacy BACKUP_CRON env var
 * only when settings can't be read.
 */
export async function scheduleBackups() {
  if (backupTask) { backupTask.stop(); backupTask = null; }
  let cfg;
  try {
    cfg = await getBackupConfig();
  } catch {
    cfg = { autoEnabled: !!config.backupCron, frequency: null };
  }
  if (!cfg.autoEnabled) {
    console.log('[backup] automatic backups disabled');
    return null;
  }
  const expr = FREQUENCY_CRON[cfg.frequency] || (cron.validate(config.backupCron) ? config.backupCron : FREQUENCY_CRON.weekly);
  console.log(`[backup] automatic backups: ${cfg.frequency || 'custom'} (${expr})`);
  backupTask = cron.schedule(expr, () =>
    createBackup('scheduled').then((b) => console.log('[backup] created', b.file)).catch((e) => console.error('[backup]', e))
  );
  return backupTask;
}

/** Alias for clarity when called after a settings change. */
export const rescheduleBackups = scheduleBackups;

// CLI: `node src/services/backup.js --once`
if (process.argv[1] && process.argv[1].endsWith('backup.js') && process.argv.includes('--once')) {
  createBackup('cli').then((b) => { console.log('Backup created:', b.file); process.exit(0); });
}
