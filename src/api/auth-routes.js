/** Auth endpoints: first-run setup, login, logout, status. */
import { Router } from 'express';
import {
  isPasswordSet,
  setPassword,
  verifyPassword,
  issueToken,
  setSessionCookie,
  clearSessionCookie,
} from '../auth.js';
import config from '../config.js';

const router = Router();

// ---- Simple in-memory login throttle (per client IP) -----------------------
// Blocks online brute-force: after MAX failures within WINDOW, further attempts
// are refused with 429 until the window rolls off. Successful login clears it.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const attempts = new Map(); // ip -> { count, first }

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}
function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(ip); return false; }
  return rec.count >= MAX_FAILS;
}
function recordFail(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
}

router.get('/status', async (req, res) => {
  res.json({ passwordSet: await isPasswordSet(), version: config.version });
});

// First-run: set the application password (only allowed if none set yet).
router.post('/setup', async (req, res) => {
  if (await isPasswordSet())
    return res.status(409).json({ error: 'Password already set' });
  try {
    await setPassword(req.body?.password);
    const token = issueToken();
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const ip = clientIp(req);
  if (throttled(ip))
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (!(await isPasswordSet()))
    return res.status(409).json({ error: 'No password set', needsSetup: true });
  if (await verifyPassword(req.body?.password)) {
    attempts.delete(ip); // clear on success
    setSessionCookie(res, issueToken());
    return res.json({ ok: true });
  }
  recordFail(ip);
  res.status(401).json({ error: 'Incorrect password' });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
