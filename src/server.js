/**
 * KanDeck server entrypoint.
 * Wires Express, static UI, auth gates, and the REST API together.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';

import config from './config.js';
import * as boardStore from './storage/boards.js';
import * as settingsStore from './storage/settings.js';
import * as inboxStore from './storage/inbox.js';
import { requireSession, requireApiAuth } from './auth.js';
import apiRoutes from './api/routes.js';
import authRoutes from './api/auth-routes.js';
import { scheduleBackups } from './services/backup.js';
import { startNotifications } from './services/notify.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Health check (unauthenticated) — handy for Docker + uptime checks.
app.get('/healthz', (req, res) => res.json({ ok: true, name: 'KanDeck' }));

// Auth endpoints (unauthenticated by nature).
app.use('/api/auth', authRoutes);

// Protected REST API (session cookie OR bearer key).
app.use('/api', requireApiAuth, apiRoutes);

// ---- Static UI + page gating ----------------------------------------------
// login/setup pages are public; everything else requires a session.
const pub = config.publicDir;
app.get(['/login', '/setup'], (req, res) => {
  res.sendFile(path.join(pub, 'login.html'));
});

// Gate the app shell.
app.get('/', requireSession, (req, res) => {
  res.sendFile(path.join(pub, 'index.html'));
});

// Serve static assets (css/js/img). These are non-sensitive.
app.use(express.static(pub, { index: false }));

// 404 for anything else.
app.use((req, res) => {
  if (req.path.startsWith('/api'))
    return res.status(404).json({ error: 'Not found' });
  res.redirect('/');
});

async function start() {
  await settingsStore.init();
  await inboxStore.init();
  await boardStore.init();
  await scheduleBackups();
  startNotifications();
  app.listen(config.port, config.host, () => {
    console.log(
      `\n  🗂  KanDeck running → http://localhost:${config.port}` +
        `  (env: ${config.env})\n     data dir: ${config.dataDir}\n`
    );
  });
}

start().catch((err) => {
  console.error('Failed to start KanDeck:', err);
  process.exit(1);
});

export default app;
