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
import { requireSession, requireApiAuth, getAppConfig, upgradeLegacySession } from './auth.js';
import apiRoutes from './api/routes.js';
import authRoutes, { accountRouter } from './api/auth-routes.js';
import { scheduleBackups, createBackup } from './services/backup.js';
import { updateJson } from './storage/store.js';
import { startNotifications } from './services/notify.js';
import { icsHandler } from './services/ics.js';
import { runEmergencyReset } from './auth-reset.js';

const app = express();
const HSTS_HOST = (() => { try { return config.appUrl ? new URL(config.appUrl).hostname.toLowerCase() : ''; } catch { return ''; } })();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Security headers on every response.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // small inline boot scripts (theme paint, login)
      "style-src 'self' 'unsafe-inline'",  // inline style attributes (lane colors, badges)
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  // HSTS only for the public hostname in APP_URL, and only over HTTPS
  // (req.secure honors TRUST_PROXY + X-Forwarded-Proto). Internal/LAN names
  // never get it, so a browser can still click past a self-signed or
  // mismatched internal certificate. No APP_URL → no HSTS.
  if (req.secure && HSTS_HOST && req.hostname === HSTS_HOST)
    res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(upgradeLegacySession); // give pre-3.1 cookies a listed session

// Health check (unauthenticated) — handy for Docker + uptime checks.
app.get('/healthz', (req, res) => res.json({ ok: true, name: 'KanDeck' }));

// Per-board calendar feed. Public by necessity (calendar apps can't log in);
// authorised by the secret token in the URL. See services/ics.js.
app.get('/ics/:boardId/:file', icsHandler);

// Auth endpoints (unauthenticated by nature).
app.use('/api/auth', authRoutes);
// Account management (username / password / log out everywhere) — session only.
app.use('/api/account', accountRouter);

// Protected REST API (session cookie OR bearer key).
app.use('/api', requireApiAuth, apiRoutes);

// ---- Static UI + page gating ----------------------------------------------
// login/setup pages are public; everything else requires a session.
const pub = config.publicDir;
// no-cache = the browser may keep a copy but must check it's current (cheap
// 304 via ETag), so an update shows up on the next load instead of stale JS/CSS.
const noCache = (res) => res.set('Cache-Control', 'no-cache');
app.get(['/login', '/setup'], (req, res) => {
  noCache(res);
  res.sendFile(path.join(pub, 'login.html'));
});

// Gate the app shell. Also redirect a direct /index.html hit through the gate
// so the shell isn't served unauthenticated by the static handler below.
app.get(['/', '/index.html'], requireSession, (req, res) => {
  noCache(res);
  res.sendFile(path.join(pub, 'index.html'));
});

// Browsers fetch /favicon.ico on their own: hand them the KanDeck icon.
app.get('/favicon.ico', (req, res) => {
  res.type('image/png').set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(pub, 'icons', 'favicon-32.png'));
});

// Serve static assets (css/js/img). These are non-sensitive.
app.use(express.static(pub, { index: false, setHeaders: noCache }));

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

// Upgrading a pre-2.0 install (password but no username yet): take one full
// backup before the account format changes, so nothing can be lost.
async function preUpgradeBackup() {
  try {
    const c = await getAppConfig();
    if (!c || !c.passwordHash || c.username || c.preV2BackupAt) return;
    const b = await createBackup('pre-upgrade');
    await updateJson(config.configFile, (cur) => ({ ...(cur || {}), preV2BackupAt: b.createdAt }), {});
    console.log(`[upgrade] pre-2.0 safety backup created: ${b.file}`);
  } catch (err) {
    console.error('[upgrade] could not create pre-upgrade backup:', err.message);
  }
}

async function start() {
  assertSecrets();
  // Emergency sign-in override at startup (see src/auth-reset.js).
  if (process.argv.includes('--disable-oauth-passkeys') || /^(1|true|yes)$/i.test(process.env.AUTH_RESET || '')) {
    await runEmergencyReset({ strict: process.argv.includes('--disable-oauth-passkeys') });
    console.warn('  Remove AUTH_RESET / --disable-oauth-passkeys once you are back in, or it runs on every start.\n');
  }
  await settingsStore.init();
  await inboxStore.init();
  await boardStore.init();
  await preUpgradeBackup();
  boardStore.startAutoArchive();
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
