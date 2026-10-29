/**
 * Emergency sign-in override — use when your identity provider is down or
 * passkeys stop working and you're locked out.
 *
 *   npm run auth:reset
 *       → turns password sign-in back on (mode ALL_ENABLED). OAuth and
 *         passkeys stay as they were.
 *   npm run auth:reset -- --disable-oauth-passkeys
 *       → password only: mode PASSWORDS_AND_OAUTH with OAuth and passkeys off.
 *
 * Docker: docker compose exec kandeck npm run auth:reset
 * Startup alternative: start the server with --disable-oauth-passkeys or the
 * env var AUTH_RESET=1 (remove it again afterwards).
 *
 * Takes effect immediately (no restart). Honors DATA_DIR. Only the `auth`
 * section of config.json changes; passkeys, the OAuth configuration, boards
 * and settings are kept. Forgot the password too? Run `npm run reset-password`.
 */
import { pathToFileURL } from 'node:url';
import config from './config.js';
import { emergencyReset } from './services/auth-settings.js';

export async function runEmergencyReset({ strict = false, log = console.log } = {}) {
  const r = await emergencyReset({ strict });
  log('');
  log('  ⚠️  KanDeck emergency sign-in reset');
  log(`     data dir:   ${config.dataDir}`);
  log(`     auth mode:  ${r.before.mode}  →  ${r.after.mode}`);
  log(`     password:   ON${r.passwordSet ? '' : '  (but no password is set!)'}`);
  log(`     passkeys:   ${r.after.passkeysEnabled ? 'on' : 'OFF'}`);
  log(`     OAuth:      ${r.after.oauth.enabled ? 'on' : 'OFF'}`);
  if (r.passwordSet) log(`  ✓ Sign in with your username${r.username ? ` (“${r.username}”)` : ''} and password.`);
  else log('  ✗ No password is set — run:  npm run reset-password -- <username> <password>');
  log('');
  return r;
}

const isCli = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  try {
    await runEmergencyReset({ strict: process.argv.includes('--disable-oauth-passkeys') });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
