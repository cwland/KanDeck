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
import { icsHandler } from './services/ics.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Health check (unauthenticated) — handy for Docker + uptime checks.
app.get('/healthz', (req, res) => res.json({ ok: true, name: 'KanDeck' }));

// Per-board calendar feed. Public by necessity (calendar apps can't log in);
// authorised by the secret token in the URL. See services/ics.js.
app.get('/ics/:boardId/:file', icsHandler);

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

// Gate the app shell. Also redirect a direct /index.html hit through the gate
// so the shell isn't served unauthenticated by the static handler below.
app.get(['/', '/index.html'], requireSession, (req, res) => {
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

// Refuse to run in production with a weak/default session secret — otherwise
// anyone could forge a session cookie (and the secrets-at-rest key is weak too).
function assertSecrets() {
  const s = process.env.JWT_SECRET || '';
  const weak = !s || s === 'change-me-to-a-long-random-string' || s.length < 32;
  if (weak) {
    const msg = 'JWT_SECRET is unset, default, or shorter than 32 chars. Set a strong random value (e.g. `openssl rand -base64 32`).';
    if (config.env === 'production') {
      console.error('FATAL:', msg);
      process.exit(1);
    }
    console.warn('WARNING:', msg, '(allowed in development only)');
  }
}

async function start() {
  assertSecrets();
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
