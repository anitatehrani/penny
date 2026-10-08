import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../src/lib/password.js';
import { signupsOpen } from '../src/lib/signups.js';
import { Client, fails, ok, PW, shutdown, startServer, uid } from './helpers.js';

let closed;
let accounts;
const fileUrl = (rel) => pathToFileURL(new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
before(async () => {
  closed = await startServer('signupsclosed', { SIGNUPS: 'closed' });
  // the real account logic, against the same database the server uses (as the auth tests do)
  process.env.DATABASE_URL = closed.dbUrl;
  accounts = await import(fileUrl('../src/lib/accounts.js'));
});
after(async () => {
  await (await import(fileUrl('../src/db.js'))).pool.end();
  await shutdown(closed);
});

const body = (over = {}) => {
  const n = uid();
  return { name: `Test ${n}`, email: `t${n}@example.com`, username: `u${n}`, password: PW, accept_terms: true, ...over };
};

describe('the setting', () => {
  it('is open unless it says closed, in any case and with spaces around it', () => {
    const was = process.env.SIGNUPS;
    try {
      for (const [value, expected] of [[undefined, true], ['', true], ['open', true], ['OPEN', true], ['anything else', true], ['closed', false], ['CLOSED', false], ['  Closed ', false]]) {
        if (value === undefined) delete process.env.SIGNUPS;
        else process.env.SIGNUPS = value;
        assert.equal(signupsOpen(), expected, JSON.stringify(value));
      }
    } finally {
      if (was === undefined) delete process.env.SIGNUPS;
      else process.env.SIGNUPS = was;
    }
  });
});

describe('with sign-ups closed', () => {
  it('the page is told, so it can hide the sign-up link', async () => {
    const c = new Client(closed.base);
    assert.equal(ok(await c.get('/auth/config')).signupsOpen, false);
  });

  it('a new account cannot be made, and nothing is created', async () => {
    const c = new Client(closed.base);
    const b = body();
    const r = fails(await c.post('/auth/signup', b), 403);
    assert.equal(r.error, 'Sign-ups are closed for now.');
    assert.equal((await closed.db.query('SELECT 1 FROM users WHERE email = $1', [b.email])).rowCount, 0);
    assert.equal((await c.get('/auth/me')).status, 401, 'no session either');
  });

  it('refuses before checking anything else, so it also tells a guesser nothing about who has an account', async () => {
    const c = new Client(closed.base);
    const first = fails(await c.post('/auth/signup', body()), 403);
    const dup = fails(await c.post('/auth/signup', { accept_terms: true, name: '', email: 'not an email', username: 'x', password: 'short' }), 403);
    assert.equal(first.error, dup.error);
  });

  it('people who already have an account can still sign in', async () => {
    const email = `old${uid()}@example.com`;
    await closed.db.query('INSERT INTO users (email, name, username, password_hash) VALUES ($1, $2, $3, $4)', [email, 'Old Friend', `old${uid()}`, await hashPassword(PW)]);
    const c = new Client(closed.base);
    const r = ok(await c.post('/auth/login', { identifier: email, password: PW }));
    assert.equal(r.user.email, email);
    assert.equal(ok(await c.get('/auth/me')).user.email, email);
  });

  it('an admin sees on the System tab that sign-ups are closed', async () => {
    const email = `adm${uid()}@example.com`;
    const { rows } = await closed.db.query('INSERT INTO users (email, name, username, password_hash, is_admin) VALUES ($1, $2, $3, $4, true) RETURNING id', [email, 'Boss', `boss${uid()}`, await hashPassword(PW)]);
    assert.ok(rows[0].id);
    const c = new Client(closed.base);
    ok(await c.post('/auth/login', { identifier: email, password: PW }));
    assert.equal(ok(await c.get('/admin/system')).app.signups_open, false);
  });
});

describe('Google when sign-ups are closed', () => {
  const q = { query: (...a) => closed.db.query(...a), acceptTerms: true };
  const profile = (over = {}) => ({ sub: `g-${uid()}`, email: `g${uid()}@example.com`, email_verified: true, name: 'Gina Green', picture: null, ...over });

  it('a new Google account is refused, one that exists still signs in', async () => {
    const was = process.env.SIGNUPS;
    try {
      delete process.env.SIGNUPS; // open: make the account
      const p = profile();
      const made = await accounts.signInWithGoogleProfile(p, q);
      assert.equal(made.created, true);
      process.env.SIGNUPS = 'closed';
      const again = await accounts.signInWithGoogleProfile(p, q);
      assert.equal(again.created, false, 'the same person signs in');
      await assert.rejects(accounts.signInWithGoogleProfile(profile(), q), (e) => e.status === 403 && /closed/i.test(e.message));
    } finally {
      if (was === undefined) delete process.env.SIGNUPS;
      else process.env.SIGNUPS = was;
    }
  });
});
