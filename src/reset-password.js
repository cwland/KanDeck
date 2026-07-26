/**
 * Reset the KanDeck application password (single-user, flat-file).
 *
 *   node src/reset-password.js               → clears the password. On the next
 *                                              load the app shows the first-run
 *                                              "create password" screen.
 *   node src/reset-password.js "newpass"     → sets a new password immediately
 *                                              (must be at least 6 characters).
 *
 * Or via npm:  npm run reset-password   ·   npm run reset-password -- "newpass"
 *
 * Honors DATA_DIR, so pointing at the right data directory is all that matters
 * (in Docker, run it inside the container — see the README). Only config.json
 * is touched; boards, settings, inbox and backups are left alone.
 */
import config from './config.js';
import { setPassword, clearPassword } from './auth.js';

const arg = (process.argv[2] || '').trim();

try {
  if (arg) {
    await setPassword(arg);
    console.log(`✓ Password updated.  (data dir: ${config.dataDir})`);
    console.log('  Log in with the new password.');
  } else {
    await clearPassword();
    console.log(`✓ Password cleared.  (data dir: ${config.dataDir})`);
    console.log('  Open the app — it will ask you to create a new password.');
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
