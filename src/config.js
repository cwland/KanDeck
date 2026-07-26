/**
 * Central configuration + filesystem paths for KanDeck.
 * Reads from environment (.env) with sane defaults.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pkgVersion = '0.0.0';
try {
  pkgVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || pkgVersion;
} catch {}

const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || './data');

export const config = {
  root: ROOT,
  version: pkgVersion,
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',

  dataDir: DATA_DIR,
  boardsDir: path.join(DATA_DIR, 'boards'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  configFile: path.join(DATA_DIR, 'config.json'),
  settingsFile: path.join(DATA_DIR, 'settings.json'),
  inboxFile: path.join(DATA_DIR, 'inbox.json'),
  publicDir: path.join(ROOT, 'src', 'public'),

  // Public base URL of this app, used for "open in KanDeck" links in
  // notifications (e.g. https://kandeck.example.com). Optional.
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),

  jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
  // Dedicated key for encrypting secrets at rest (SMTP password, AI token).
  // Decoupled from JWT_SECRET so rotating the session secret doesn't make
  // stored secrets undecryptable. Falls back to jwtSecret for existing installs.
  secretsKey: process.env.SECRETS_KEY || '',
  sessionTtl: process.env.SESSION_TTL || '7d',
  apiKey: process.env.API_KEY || '',

  // Email/Discord are configured in the app (App Settings → Notifications),
  // not via env. Backup schedule + retention are configured there too; the env
  // vars below remain only as a fallback / default before the UI is used.
  backupCron: process.env.BACKUP_CRON || '0 3 * * 0',
  backupRetention: parseInt(process.env.BACKUP_RETENTION || '12', 10),
};

export default config;
