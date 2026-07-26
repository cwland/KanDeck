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

  jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
  sessionTtl: process.env.SESSION_TTL || '7d',
  apiKey: process.env.API_KEY || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'KanDeck <no-reply@example.com>',
    to: process.env.SMTP_TO || '',
  },
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',

  backupCron: process.env.BACKUP_CRON || '0 3 * * 0',
  backupRetention: parseInt(process.env.BACKUP_RETENTION || '12', 10),
};

export default config;
