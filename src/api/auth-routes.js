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
  if (!(await isPasswordSet()))
    return res.status(409).json({ error: 'No password set', needsSetup: true });
  if (await verifyPassword(req.body?.password)) {
    setSessionCookie(res, issueToken());
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
