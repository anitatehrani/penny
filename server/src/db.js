import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// numeric -> number, date -> 'YYYY-MM-DD' string (avoids JS Date timezone shifts)
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget',
});

export const query = (text, params) => pool.query(text, params);

/** Run `fn(client)` inside a transaction. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initDb() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
}
