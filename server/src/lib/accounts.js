import { withTransaction } from '../db.js';
import { HttpError } from './http.js';
import { generateUsername } from './profile.js';
import { SIGNUPS_CLOSED, signupsOpen } from './signups.js';

const DEFAULT_CATEGORIES = [
  ['Salary', 'income', '#1baf7a'],
  ['Freelance', 'income', '#2a78d6'],
  ['Gifts received', 'income', '#e87ba4'],
  ['Other income', 'income', '#6b7280'],
  ['Rent / Mortgage', 'expense', '#4a3aa7'],
  ['Utilities', 'expense', '#eda100'],
  ['Groceries', 'expense', '#008300'],
  ['Transport', 'expense', '#2a78d6'],
  ['Subscriptions', 'expense', '#e87ba4'],
  ['Installments & loans', 'expense', '#e34948'],
  ['Birthdays & gifts', 'expense', '#eb6834'],
  ['Health', 'expense', '#1baf7a'],
  ['Dining & leisure', 'expense', '#9085e9'],
  ['Other', 'expense', '#6b7280'],
];

const OWNED_TABLES = ['categories', 'recurring_rules', 'installment_plans', 'transactions'];

export async function seedCategories(client, workspaceId, userId) {
  for (const [name, kind, color] of DEFAULT_CATEGORIES) {
    await client.query(
      'INSERT INTO categories (workspace_id, user_id, name, kind, color) VALUES ($1, $2, $3, $4, $5)',
      [workspaceId, userId, name, kind, color],
    );
  }
}

/**
 * Give a brand-new account its personal workspace and starting data. If budget data from before
 * accounts existed is sitting unowned in the database, the very first account adopts it;
 * everyone else gets the default categories.
 */
export async function provisionAccount(client, userId, name = 'Personal') {
  const ws = (
    await client.query(
      `INSERT INTO workspaces (name, kind, owner_id) VALUES ($1, 'personal', $2) RETURNING id`,
      [name, userId],
    )
  ).rows[0];
  await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws.id, userId]);

  const { rows: users } = await client.query('SELECT count(*)::int AS n FROM users');
  let legacy = 0;
  for (const table of OWNED_TABLES) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id IS NULL AND workspace_id IS NULL`);
    legacy += rows[0].n;
  }

  if (users[0].n === 1 && legacy > 0) {
    for (const table of OWNED_TABLES) {
      await client.query(`UPDATE ${table} SET user_id = $1, workspace_id = $2 WHERE user_id IS NULL AND workspace_id IS NULL`, [userId, ws.id]);
    }
    for (const table of ['recurring_rules', 'installment_plans', 'transactions']) {
      await client.query(`UPDATE ${table} SET member_id = $1 WHERE workspace_id = $2 AND member_id IS NULL`, [userId, ws.id]);
    }
    await client.query(
      `INSERT INTO workspace_settings (workspace_id, opening_balance, currency)
       SELECT $1, opening_balance, currency FROM settings WHERE id = 1
       ON CONFLICT DO NOTHING`,
      [ws.id],
    );
  } else {
    await seedCategories(client, ws.id, userId);
  }
  await client.query('INSERT INTO workspace_settings (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [ws.id]);
  return ws;
}

/** Insert a user and provision their personal workspace atomically. Serialised so "first account" is well defined. */
export function createUser({ email, name, username, phone = null, passwordHash = null, googleId = null, avatarUrl = null, emailVerified = false }) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7001)');
    const { rows } = await client.query(
      `INSERT INTO users (email, name, username, phone, password_hash, google_id, avatar_url, google_picture, email_verified_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, CASE WHEN $8 THEN now() END, now()) RETURNING *`,
      [email, name, username, phone, passwordHash, googleId, avatarUrl, emailVerified],
    );
    await provisionAccount(client, rows[0].id);
    return rows[0];
  });
}

/**
 * Sign in (or sign up) with a verified Google profile: { sub, email, email_verified, name, picture }.
 * An existing password account is never silently taken over by a Google login.
 */
export async function signInWithGoogleProfile(profile, { query }) {
  if (!profile?.sub || !profile.email) throw new HttpError(400, 'Google did not return an email address.');
  if (!profile.email_verified) throw new HttpError(400, 'Your Google email address is not verified.');
  const email = profile.email.trim().toLowerCase();

  const byGoogle = await query('SELECT * FROM users WHERE google_id = $1', [profile.sub]);
  if (byGoogle.rows[0]) {
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [byGoogle.rows[0].id]);
    return { user: byGoogle.rows[0], created: false };
  }

  const byEmail = await query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (byEmail.rows[0]) {
    throw new HttpError(
      409,
      'An account with this email already exists. Sign in with your password, then connect Google from Settings.',
    );
  }

  if (!signupsOpen()) throw new HttpError(403, SIGNUPS_CLOSED); // signing in is fine, a new account is not
  const user = await createUser({
    email,
    name: (profile.name || email.split('@')[0]).slice(0, 80),
    username: await generateUsername(query, email.split('@')[0]),
    googleId: profile.sub,
    avatarUrl: profile.picture ?? null,
    emailVerified: true, // Google only returns verified addresses here (checked above)
  });
  return { user, created: true };
}

/** Create a shared group workspace owned by `userId`, with default categories. */
export function createGroup(userId, name, currency = 'USD') {
  return withTransaction(async (client) => {
    const ws = (
      await client.query(`INSERT INTO workspaces (name, kind, owner_id) VALUES ($1, 'group', $2) RETURNING *`, [name, userId])
    ).rows[0];
    await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws.id, userId]);
    await client.query('INSERT INTO workspace_settings (workspace_id, currency) VALUES ($1, $2)', [ws.id, currency]);
    await seedCategories(client, ws.id, userId);
    return ws;
  });
}
