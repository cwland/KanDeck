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
  listSessions,
  revokeSessions,
  sessionPayload,
  requireSessionApi,
  MIN_PASSWORD,
} from '../auth.js';
import config from '../config.js';
import * as passkeys from '../services/passkeys.js';
import * as oauth from '../services/oauth.js';
import {
  AUTH_MODES, getAuthSettings, saveAuthSettings, effective, oauthConfigured,
  oauthMatches, lockoutProblem, publicView,
} from '../services/auth-settings.js';
import { encrypt } from '../services/secrets.js';
import { getPasskeys } from '../auth.js';

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
  const auth = await getAuthSettings();
  const methods = effective(auth);
  // Passkeys usable on THIS hostname (the page passes location.hostname).
  const host = String(req.query.host || '').toLowerCase().replace(/[^a-z0-9.\-]/g, '');
  const rpHost = host || (await passkeys.relyingParty(req)).rpID;
  const ready = passwordSet && usernameSet;
  res.json({
    passwordSet,
    usernameSet,
    loggedIn,
    // Sign-in methods offered (password is always offered until set up).
    methods: ready ? methods : { password: true, passkey: false, oauth: false },
    oauthLabel: auth.oauth.providerName,
    passkeys: ready && methods.passkey ? await passkeys.countFor(rpHost) : 0,
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
    setSessionCookie(res, await issueToken(req, 'password'));
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
  if (!effective(await getAuthSettings()).password)
    return res.status(403).json({ error: 'Password sign-in is turned off. Use a passkey or OAuth, or run npm run auth:reset on the server.' });
  const result = await verifyLogin(req.body?.username, req.body?.password);
  if (result.ok) {
    attempts.delete(ip);
    setSessionCookie(res, await issueToken(req, 'password'));
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
    if (!effective(await getAuthSettings()).passkey) return res.status(403).json({ error: 'Passkey sign-in is turned off.' });
    res.json(await passkeys.authenticationOptions(req));
  } catch (err) {
    res.status(400).json({ error: 'Could not start passkey sign-in' });
  }
});

router.post('/passkey/verify', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (!effective(await getAuthSettings()).passkey) return res.status(403).json({ error: 'Passkey sign-in is turned off.' });
  let ok = false;
  try { ok = await passkeys.verifyAuthentication(req, req.body?.response); } catch { ok = false; }
  if (!ok) {
    recordFail(ip);
    return res.status(401).json({ error: 'That passkey wasn’t accepted. Try again, or use your password.' });
  }
  attempts.delete(ip);
  setSessionCookie(res, await issueToken(req, 'passkey'));
  res.json({ ok: true });
});

// ---- OAuth / OIDC -----------------------------------------------------------
// GET /oauth/start            → sign in (when OAuth is on)
// GET /oauth/start?link=1     → signed-in owner links their provider account
// GET /oauth/callback         → provider redirects back here
const OAUTH_COOKIE = 'kandeck_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/oauth';

router.get('/oauth/start', async (req, res) => {
  const link = req.query.link === '1';
  try {
    if (!(await isPasswordSet())) return res.redirect('/login');
    const a = await getAuthSettings();
    if (link) {
      if (!(await validCookie(req))) return res.redirect('/login');
      if (!oauthConfigured(a.oauth)) return res.redirect('/?oauth=error&msg=' + encodeURIComponent('Fill in and save the OAuth settings first.'));
    } else if (!effective(a).oauth) return res.redirect('/login?error=oauth_off');
    const { url, state } = await oauth.startUrl(req, link ? 'link' : 'login');
    res.cookie(OAUTH_COOKIE, state, {
      httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: OAUTH_COOKIE_PATH, maxAge: 10 * 60 * 1000,
    });
    res.redirect(url);
  } catch (err) {
    console.error('[oauth] start failed:', err.message);
    res.redirect(link ? '/?oauth=error&msg=' + encodeURIComponent(err.message.slice(0, 200)) : '/login?error=oauth_provider');
  }
});

router.get('/oauth/callback', async (req, res) => {
  const ip = req.ip || 'unknown';
  const state = String(req.query.state || '');
  const bound = req.cookies?.[OAUTH_COOKIE];
  res.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
  const p = state && bound === state ? oauth.takePending(state) : null;
  if (!p) return res.redirect('/login?error=oauth_state');
  const back = (code, msg) => (p.purpose === 'link'
    ? res.redirect('/?oauth=' + code + (msg ? '&msg=' + encodeURIComponent(String(msg).slice(0, 200)) : ''))
    : res.redirect('/login?error=' + code));
  if (req.query.error) return back('oauth_provider', 'The provider said: ' + (req.query.error_description || req.query.error));
  if (throttled(ip)) return back('oauth_throttled');
  try {
    const id = await oauth.finish(p, String(req.query.code || ''));
    if (p.purpose === 'link') {
      if (!(await validCookie(req))) return res.redirect('/login');
      await saveAuthSettings((a) => ({ ...a, oauth: { ...a.oauth,
        linkedSub: id.sub, linkedIssuer: p.key, linkedEmail: id.email, linkedName: id.name, linkedAt: new Date().toISOString() } }));
      return res.redirect('/?oauth=linked');
    }
    const a = await getAuthSettings();
    if (!effective(a).oauth) return back('oauth_off');
    if (!oauthMatches(a.oauth, id)) {
      recordFail(ip);
      console.warn(`[oauth] sign-in refused: ${id.email || id.sub} isn't linked or allowed`);
      return back('oauth_nomatch');
    }
    attempts.delete(ip);
    await saveAuthSettings((s) => ({ ...s, oauth: { ...s.oauth, lastLoginAt: new Date().toISOString() } }));
    setSessionCookie(res, await issueToken(req, 'oauth'));
    res.redirect('/');
  } catch (err) {
    console.error('[oauth] callback failed:', err.message);
    back('oauth_failed', err.message);
  }
});

router.post('/logout', async (req, res) => {
  const p = sessionPayload(req);
  if (p && p.sid) await revokeSessions({ id: p.sid }).catch(() => {});
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

// Username: no password needed (you're already signed in; the password and
// passkeys stay as they are).
accountRouter.put('/username', async (req, res) => {
  try {
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
    setSessionCookie(res, await issueToken(req, 'password')); // keep this browser signed in
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Passkeys (App Settings → Sign-in)
accountRouter.get('/passkeys', async (req, res) => {
  res.json({ passkeys: await passkeys.listPasskeys(), currentHost: (await passkeys.relyingParty(req)).rpID });
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
  const left = (await getPasskeys()).filter((p) => p.id !== req.params.id).length;
  const problem = lockoutProblem(await getAuthSettings(), left);
  if (problem) return res.status(409).json({ error: 'Can’t remove your last passkey while it’s your only way to sign in. Turn password sign-in back on first (Sign-in tab).' });
  if (!(await passkeys.removePasskey(req.params.id))) return res.status(404).json({ error: 'Passkey not found' });
  res.json({ ok: true });
});

// ---- Sign-in settings (App Settings → Sign-in) ------------------------------
async function signInView(req) {
  return { ...publicView(await getAuthSettings()), modes: AUTH_MODES, redirectUri: oauth.callbackUrl(req), passkeyCount: (await getPasskeys()).length };
}
const URL_FIELDS = ['issuer', 'authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri'];
function checkUrl(v, label) {
  if (!v) return;
  let u; try { u = new URL(v); } catch { throw new Error(`${label} isn’t a valid URL.`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${label} must start with https:// (or http:// on your LAN).`);
}

accountRouter.get('/auth-settings', async (req, res) => res.json(await signInView(req)));

accountRouter.put('/auth-settings', async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await getAuthSettings();
    const bo = b.oauth || {};
    if (b.mode !== undefined && !AUTH_MODES.includes(b.mode)) throw new Error('Unknown sign-in mode.');
    const labels = { issuer: 'Issuer URL', authorizationEndpoint: 'Authorization endpoint', tokenEndpoint: 'Token endpoint', userinfoEndpoint: 'Userinfo endpoint', jwksUri: 'JWKS URL' };
    URL_FIELDS.forEach((k) => checkUrl(String(bo[k] ?? cur.oauth[k] ?? '').trim(), labels[k]));
    const emails = bo.allowedEmails === undefined ? cur.oauth.allowedEmails
      : (Array.isArray(bo.allowedEmails) ? bo.allowedEmails : String(bo.allowedEmails).split(/[\s,;]+/));
    const next = {
      ...cur,
      mode: b.mode ?? cur.mode,
      passkeysEnabled: b.passkeysEnabled ?? cur.passkeysEnabled,
      oauth: {
        ...cur.oauth,
        ...Object.fromEntries(['enabled', 'providerName', 'issuer', 'clientId', 'scopes', ...URL_FIELDS.slice(1)]
          .filter((k) => bo[k] !== undefined).map((k) => [k, bo[k]])),
        allowedEmails: emails,
        clientSecret: bo.clearSecret ? '' : (bo.clientSecret ? encrypt(String(bo.clientSecret)) : cur.oauth.clientSecret),
      },
    };
    if (next.oauth.enabled && !oauthConfigured(next.oauth))
      throw new Error('To turn OAuth on, fill in the Client ID and the Issuer URL (or both endpoints).');
    const problem = lockoutProblem(next, (await getPasskeys()).length);
    if (problem) throw new Error(problem);
    await saveAuthSettings(() => next);
    res.json({ ok: true, ...(await signInView(req)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

accountRouter.post('/auth-settings/oauth/test', async (req, res) => {
  try {
    const m = await oauth.discover((await getAuthSettings()).oauth, { fresh: true });
    res.json({ ok: true, endpoints: m });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

accountRouter.delete('/auth-settings/oauth/link', async (req, res) => {
  const cur = await getAuthSettings();
  const next = { ...cur, oauth: { ...cur.oauth, linkedSub: '', linkedIssuer: '', linkedEmail: '', linkedName: '', linkedAt: null } };
  const problem = lockoutProblem(next, (await getPasskeys()).length);
  if (problem) return res.status(409).json({ error: 'Can’t unlink while OAuth is your only way to sign in. Turn password sign-in back on first.' });
  await saveAuthSettings(() => next);
  res.json({ ok: true, ...(await signInView(req)) });
});

// ---- Sessions (Account → Show sessions) ----
function describeUA(ua) {
  ua = String(ua || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|wget|node|python/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { browser, os };
}
accountRouter.get('/sessions', async (req, res) => {
  const cur = (sessionPayload(req) || {}).sid;
  const list = (await listSessions())
    .map((x) => ({ id: x.id, ip: x.ip || '', method: x.method || 'password', createdAt: x.createdAt, lastSeenAt: x.lastSeenAt || x.createdAt, current: x.id === cur, ...describeUA(x.ua) }))
    .sort((a, b) => (b.current - a.current) || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  res.json({ sessions: list });
});
accountRouter.delete('/sessions/:id', async (req, res) => {
  const cur = (sessionPayload(req) || {}).sid;
  const n = await revokeSessions({ id: req.params.id });
  if (!n) return res.status(404).json({ error: 'Session not found' });
  if (req.params.id === cur) clearSessionCookie(res);
  res.json({ ok: true, signedOutHere: req.params.id === cur });
});
accountRouter.post('/sessions/revoke-others', async (req, res) => {
  const cur = (sessionPayload(req) || {}).sid;
  res.json({ ok: true, removed: await revokeSessions({ exceptId: cur || '-' }) });
});

accountRouter.post('/logout-all', async (req, res) => {
  await bumpSessionVersion();
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
