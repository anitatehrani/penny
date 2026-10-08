/**
 * Make a person an admin, or take it away:   node scripts/make-admin.mjs you@example.com        node scripts/make-admin.mjs you@example.com --remove
 * (Docker: `.\penny make-admin you@example.com`.)
 *
 * This is the ONLY way to become an admin: no page or request of the website can do it (docs/DESIGN.md section 33). The person must already
 * have an account, and their e-mail address must be confirmed (or the command says so and does nothing, unless --force is given), so that
 * an account made with somebody else's address cannot be made an admin by mistake.
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const force = args.includes('--force');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
if (!email) {
  console.error('Say whose: node scripts/make-admin.mjs you@example.com   (add --remove to take it away)');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget' });
try {
  await db.connect();
  const { rows } = await db.query('SELECT id, name, username, is_admin, email_verified_at FROM users WHERE lower(email) = $1', [email]);
  const user = rows[0];
  if (!user) {
    console.error(`There is no account with the e-mail address ${email}. Sign up first, then run this again.`);
    process.exit(1);
  }
  if (!remove && !user.email_verified_at && !force) {
    console.error(`${email} has not confirmed their e-mail address. Confirm it in Settings, or add --force if you are sure this account is yours.`);
    process.exit(1);
  }
  if (user.is_admin === !remove) {
    console.log(`${user.name} (@${user.username}) ${remove ? 'is not an admin' : 'is already an admin'}. Nothing changed.`);
  } else {
    await db.query('UPDATE users SET is_admin = $2 WHERE id = $1', [user.id, !remove]);
    await db.query('INSERT INTO audit_events (kind, user_id, detail) VALUES ($1, $2, $3)', [remove ? 'admin_revoke' : 'admin_grant', user.id, 'from the command line']);
    console.log(`${user.name} (@${user.username}) ${remove ? 'is no longer an admin' : 'is now an admin. The Admin page appears in the menu after they reload.'}`);
  }
} catch (e) {
  console.error('Could not do that:', e.message);
  process.exit(1);
} finally {
  await db.end().catch(() => {});
}
