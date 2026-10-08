/**
 * Is the database in DATABASE_URL (server/.env) reachable with that user? Exit 0 if yes, 1 if not, within a few seconds:  node scripts/check-db.mjs
 * Used by `.\penny import-local` to say "the old database is not running" instead of waiting.
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget', connectionTimeoutMillis: 4000 });
try {
  await client.connect();
  await client.query('SELECT 1');
  await client.end();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
