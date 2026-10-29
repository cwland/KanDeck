/** Auth endpoints: first-run setup, login, logout, status, and account
 *  management (username / password / log out everywhere). */
import crypto from 'node:crypto';
import { Router } from 'express';
import {
  isPasswordSet,
  getUsername,
  getAppConfig,
  setCredentials,
  verifyPassword,
  verifyLogin,
  validateUsername,
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  validCookie,
  bumpSessionVersion,
  requireSessionApi,
  MIN_PASSWORD,
} from '../auth.js';
import config from '../config.js';
import * as passkeys from '../services/passkeys.js';

const router = Router();

// ---- Login throttle ---------------------------------------------------------
// Per client IP (req.ip — only derived from X-Forwarded-For when TRUST_PROXY is
// set, so it can't be spoofed by sending a fake header) PLUS an app-wide cap,
// so rotating IPs doesn't buy unlimited guesses. Successful login clears the
// caller's per-IP count.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_GLOBAL = 100;
const attempts = new Map(); // ip -> { count, first }
let globalFails = { count: 0, first: Date.now() };

function throttled(ip) {
  if (Date.now() - globalFails.first > WINDOW_MS) globalFails = { count: 0, first: Date.now() };
  if (globalFails.count >= MAX_FAILS_GLOBAL) return true;
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(ip); return false; }
  return rec.count >= MAX_FAILS_PER_IP;
}
function recordFail(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
  if (attempts.size > 10000) attempts.clear(); // bound memory
  globalFails.count += 1;
}

// ---- First-run setup lock ----------------------------------------------------
// On a fresh install (or after a credentials reset) the first visitor would get
// to create the account. To keep strangers on a public IP from claiming it,
// setup is only allowed (a) with SETUP_TOKEN when that env var is set, or else
// (b) from a direct local-network request (no proxy headers, private source IP).
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip'];
function isDirectLocal(req) {
  if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
  const a = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return (
    a === '127.0.0.1' || a === '::1' ||
    /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)
  );
}
function tokenMatches(given) {
  if (!config.setupToken || !given) return false;
  const a = crypto.createHash('sha256').update(String(config.setupToken)).digest();
  const b = crypto.createHash('sha256').update(String(given)).digest();
  return crypto.timingSafeEqual(a, b);
}
function setupAllowed(req, token) {
  return config.setupToken ? tokenMatches(token) : isDirectLocal(req);
}

// ---- Routes -----------------------------------------------------------------

router.get('/status', async (req, res) => {
  const passwordSet = await isPasswordSet();
  const usernameSet = !!(await getUsername());
  const loggedIn = await validCookie(req);
  // Passkeys usable on THIS hostname (the page passes location.hostname).
  const rpHost = String(req.query.host || '').toLowerCase().replace(/[^a-z0-9.\-]/g, '') || passkeys.relyingParty(req).rpID;
  res.json({
    passwordSet,
    usernameSet,
    loggedIn,
    passkeys: passwordSet && usernameSet ? await passkeys.countFor(rpHost) : 0,
    minPassword: MIN_PASSWORD,
    setupTokenRequired: !passwordSet && !!config.setupToken,
    setupBlocked: !passwordSet && !config.setupToken && !isDirectLocal(req),
    version: config.version,
  });
});

// First-run: create the account (only if none exists yet, and only when the
// setup lock allows it).
router.post('/setup', async (req, res) => {
  if (await isPasswordSet())
    return res.status(409).json({ error: 'Account already set up' });
  if (!setupAllowed(req, req.body?.setupToken))
    return res.status(403).json({
      error: config.setupToken
        ? 'Invalid setup token.'
        : 'For security, first-time setup must be done from your local network (or set SETUP_TOKEN).',
    });
  try {
    await setCredentials({ username: req.body?.username, password: req.body?.password });
    setSessionCookie(res, await issueToken());
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (throttled(ip))
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (!(await isPasswordSet()))
    return res.status(409).json({ error: 'No account set up', needsSetup: true });
  const result = await verifyLogin(req.body?.username, req.body?.password);
  if (result.ok) {
    attempts.delete(ip);
    setSessionCookie(res, await issueToken());
    return res.json({ ok: true, needsUsername: !!result.needsUsername });
  }
  recordFail(ip);
  res.status(401).json({ error: 'Invalid username or password' });
});

// Pre-2.0 installs: after signing in with the password, choose a username.
// Only allowed while no username exists.
router.post('/username', requireSessionApi, async (req, res) => {
  if (await getUsername()) return res.status(409).json({ error: 'Username already set' });
  try {
    await setCredentials({ username: req.body?.username }, { keepSessions: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Passkey sign-in (no username needed; discoverable credentials) ----------
router.post('/passkey/options', async (req, res) => {
  try {
    if (!(await isPasswordSet())) return res.status(409).json({ error: 'No account set up' });
    res.json(await passkeys.authenticationOptions(req));
  } catch (err) {
    res.status(400).json({ error: 'Could not start passkey sign-in' });
  }
});

router.post('/passkey/verify', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  let ok = false;
  try { ok = await passkeys.verifyAuthentication(req, req.body?.response); } catch { ok = false; }
  if (!ok) {
    recordFail(ip);
    return res.status(401).json({ error: 'That passkey wasn’t accepted. Try again, or use your password.' });
  }
  attempts.delete(ip);
  setSessionCookie(res, await issueToken());
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---- Account management (App Settings → Account) — session only -------------
export const accountRouter = Router();
accountRouter.use(requireSessionApi);

accountRouter.get('/', async (req, res) => {
  const c = await getAppConfig();
  res.json({ username: c.username || '', passwordChangedAt: c.passwordChangedAt || null, minPassword: MIN_PASSWORD });
});

accountRouter.put('/username', async (req, res) => {
  try {
    if (!(await verifyPassword(req.body?.currentPassword)))
      return res.status(400).json({ error: 'Current password is incorrect' });
    await setCredentials({ username: validateUsername(req.body?.username) }, { keepSessions: true });
    res.json({ ok: true, username: await getUsername() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

accountRouter.put('/password', async (req, res) => {
  try {
    if (!(await verifyPassword(req.body?.currentPassword)))
      return res.status(400).json({ error: 'Current password is incorrect' });
    await setCredentials({ password: req.body?.newPassword }); // logs out other sessions
    setSessionCookie(res, await issueToken()); // keep this browser signed in
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Passkeys (Account tab)
accountRouter.get('/passkeys', async (req, res) => {
  res.json({ passkeys: await passkeys.listPasskeys(), currentHost: passkeys.relyingParty(req).rpID });
});

accountRouter.post('/passkeys/options', async (req, res) => {
  try { res.json(await passkeys.registrationOptions(req)); }
  catch (err) { res.status(400).json({ error: err.message || 'Could not start adding a passkey' }); }
});

accountRouter.post('/passkeys/verify', async (req, res) => {
  try { res.json({ ok: true, passkey: await passkeys.verifyRegistration(req, req.body?.response, req.body?.name) }); }
  catch (err) { res.status(400).json({ error: 'Passkey could not be added: ' + (err.message || 'verification failed') }); }
});

accountRouter.patch('/passkeys/:id', async (req, res) => {
  try {
    if (!(await passkeys.renamePasskey(req.params.id, req.body?.name))) return res.status(404).json({ error: 'Passkey not found' });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

accountRouter.delete('/passkeys/:id', async (req, res) => {
  if (!(await passkeys.removePasskey(req.params.id))) return res.status(404).json({ error: 'Passkey not found' });
  res.json({ ok: true });
});

accountRouter.post('/logout-all', async (req, res) => {
  await bumpSessionVersion();
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
