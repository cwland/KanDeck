/**
 * Reset the KanDeck login (single account, flat-file).
 *
 *   node src/reset-password.js <username> <password>
 *        → sets the username and password immediately (password ≥ 12 chars)
 *          and signs out every existing session.
 *   node src/reset-password.js
 *        → clears the account. The app then shows first-run setup, which is
 *          only allowed from your local network (or with SETUP_TOKEN).
 *
 * Or via npm:  npm run reset-password -- <username> <password>
 * Docker:      docker compose exec kandeck npm run reset-password -- <username> <password>
 *
 * Honors DATA_DIR. Only config.json is touched; boards, settings, inbox,
 * backups and the API key are left alone.
 */
import config from './config.js';
import { setCredentials, clearCredentials, MIN_PASSWORD } from './auth.js';

const [username, password] = process.argv.slice(2).map((s) => String(s || '').trim());

try {
  if (username && password) {
    await setCredentials({ username, password });
    console.log(`✓ Login updated for "${username}".  (data dir: ${config.dataDir})`);
    console.log('  All existing sessions were signed out.');
  } else if (username && !password) {
    console.error(`✗ Usage: npm run reset-password -- <username> <password>   (password ≥ ${MIN_PASSWORD} chars)`);
    process.exit(1);
  } else {
    await clearCredentials();
    console.log(`✓ Account cleared.  (data dir: ${config.dataDir})`);
    console.log('  Open the app from your local network to create a new login');
    console.log('  (or set SETUP_TOKEN and enter it on the setup screen).');
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
