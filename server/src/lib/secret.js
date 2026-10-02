import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';

let cached;

/** The server's signing secret: APP_SECRET if set, otherwise a random one created once and kept in the database. */
export async function getSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (cached) return cached;
  await pool.query(`INSERT INTO app_config (key, value) VALUES ('secret', $1) ON CONFLICT DO NOTHING`, [randomBytes(32).toString('base64url')]);
  cached = (await pool.query(`SELECT value FROM app_config WHERE key = 'secret'`)).rows[0].value;
  return cached;
}

const b64 = (s) => Buffer.from(s).toString('base64url');

/** Compact signed token, e.g. for one-click unsubscribe links. Not encrypted: do not put secrets inside. */
export async function signToken(payload) {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', await getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export async function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', await getSecret()).update(body).digest();
  let given;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
