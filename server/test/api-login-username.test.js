import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, fails, ok, PW, sessionFor, shutdown, signup, startServer, uid } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('loginusername');
});
after(async () => {
  await shutdown(srv);
});

const root = () => new Client(srv.base.replace(/\/api$/, ''));
const login = (body) => root().post('/auth/login', body);

describe('signing in with a username', () => {
  it('works with the username, with an @, in any casing, and with spaces around it', async () => {
    const { user } = await signup(srv);
    for (const typed of [user.username, `@${user.username}`, user.username.toUpperCase(), `@${user.username.toUpperCase()}`, `  ${user.username}  `, ` @${user.username} `]) {
      const c = root();
      const r = ok(await c.post('/auth/login', { identifier: typed, password: PW }));
      assert.equal(r.user.id, user.id, `"${typed}"`);
      assert.equal(ok(await c.get('/auth/me')).user.id, user.id, 'and the session works');
    }
  });

  it('still works with the email, in any casing, and with the old field name', async () => {
    const { user, body } = await signup(srv);
    assert.equal(ok(await login({ identifier: body.email, password: PW })).user.id, user.id);
    assert.equal(ok(await login({ identifier: body.email.toUpperCase(), password: PW })).user.id, user.id);
    assert.equal(ok(await login({ email: body.email, password: PW })).user.id, user.id, 'the old `email` field');
    assert.equal(ok(await login({ email: user.username, password: PW })).user.id, user.id, 'the old field may hold a username too');
  });

  it('records the sign-in', async () => {
    const { user } = await signup(srv);
    await srv.db.query('UPDATE users SET last_login_at = NULL WHERE id = $1', [user.id]);
    ok(await login({ identifier: user.username, password: PW }));
    assert.ok((await srv.db.query('SELECT last_login_at FROM users WHERE id = $1', [user.id])).rows[0].last_login_at);
  });

  it('is the same person whichever way they sign in, and each way is its own session', async () => {
    const { user, body } = await signup(srv);
    const a = root();
    const b = root();
    ok(await a.post('/auth/login', { identifier: user.username, password: PW }));
    ok(await b.post('/auth/login', { identifier: body.email, password: PW }));
    assert.equal(ok(await a.get('/auth/me')).user.id, ok(await b.get('/auth/me')).user.id);
    ok(await a.post('/auth/logout', {}), 204);
    assert.equal((await a.get('/auth/me')).status, 401, 'that one is signed out');
    assert.equal((await b.get('/auth/me')).status, 200, 'signing out of one does not sign out the other');
  });
});

describe('what is refused, and what is revealed', () => {
  it('gives the same answer for a wrong password, an unknown username and an unknown email', async () => {
    const { user, body } = await signup(srv);
    const answers = [
      await login({ identifier: user.username, password: 'Wrong-Password1!' }),
      await login({ identifier: body.email, password: 'Wrong-Password1!' }),
      await login({ identifier: `nobody${uid()}`, password: 'Wrong-Password1!' }),
      await login({ identifier: `@nobody${uid()}`, password: 'Wrong-Password1!' }),
      await login({ identifier: `nobody${uid()}@example.com`, password: 'Wrong-Password1!' }),
    ];
    for (const r of answers) {
      assert.equal(r.status, 401);
      assert.equal(r.json.error, 'Invalid email, username or password.');
    }
  });

  it('is case-sensitive for the password however you sign in', async () => {
    const { user } = await signup(srv);
    fails(await login({ identifier: user.username, password: PW.toLowerCase() }), 401);
  });

  it('refuses nothing typed, a malformed email, and input that is not text or is far too long', async () => {
    const { user } = await signup(srv);
    for (const bad of [
      { password: PW },
      { identifier: '', password: PW },
      { identifier: '   ', password: PW },
      { identifier: 'x'.repeat(255), password: PW },
      { identifier: 42, password: PW },
      { identifier: ['a'], password: PW },
      { identifier: { $ne: '' }, password: PW },
      { identifier: null, password: PW },
      { identifier: user.username },
      { identifier: user.username, password: '' },
      { identifier: user.username, password: ['array'] },
      { identifier: user.username, password: 'x'.repeat(1001) },
      { identifier: 'not@valid', password: PW },
      { identifier: 'two@@signs.com', password: PW },
    ]) {
      fails(await login(bad), 400);
    }
  });

  it('treats wildcard and injection-looking text as just another username that does not exist', async () => {
    const { user } = await signup(srv);
    for (const typed of ['%', '_', `${user.username.slice(0, 3)}%`, `${user.username.slice(0, -1)}_`, "' OR '1'='1", '"; DROP TABLE users; --', user.username.slice(0, -1), `${user.username}x`]) {
      fails(await login({ identifier: typed, password: PW }), 401);
    }
    ok(await login({ identifier: user.username, password: PW }));
  });

  it('only matches the username exactly: an email name or a part of one does not sign anyone in', async () => {
    const { body } = await signup(srv);
    fails(await login({ identifier: body.email.split('@')[0], password: PW }), 401); // the part before the @ is not a username
  });

  it('refuses a cross-site request to sign in, as before', async () => {
    const { user } = await signup(srv);
    fails(await root().post('/auth/login', { identifier: user.username, password: PW }, { origin: 'https://evil.example' }), 403);
  });
});

describe('accounts with no password', () => {
  it('a Google-only account cannot be signed in to with a password by username either', async () => {
    const n = uid();
    const { rows } = await srv.db.query(`INSERT INTO users (email, name, username, google_id) VALUES ($1, 'G Only', $2, $3) RETURNING id, username`, [`g${n}@example.com`, `gonly${n}`, `sub${n}`]);
    assert.ok(await sessionFor(srv, rows[0].id));
    fails(await login({ identifier: rows[0].username, password: PW }), 401);
    fails(await login({ identifier: `g${n}@example.com`, password: PW }), 401);
  });
});

describe('guessing passwords', () => {
  it('the attempts are counted per account, so switching between email and username does not give more', async () => {
    const { user, body } = await signup(srv);
    const c = root();
    let last;
    for (let i = 0; i < 16; i++) last = await c.post('/auth/login', { identifier: i % 2 ? user.username : body.email, password: 'Wrong-Password1!' });
    assert.equal(last.status, 429, 'blocked after 15 guesses in total');
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    fails(await c.post('/auth/login', { identifier: user.username, password: PW }), 429);
    fails(await c.post('/auth/login', { identifier: body.email, password: PW }), 429);
    fails(await c.post('/auth/login', { identifier: `@${user.username}`, password: PW }), 429);
  });

  it('guessing one username does not lock out other people', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    for (let i = 0; i < 16; i++) await login({ identifier: a.user.username, password: 'Wrong-Password1!' });
    fails(await login({ identifier: a.user.username, password: PW }), 429);
    ok(await login({ identifier: b.user.username, password: PW }));
  });

  it('the same username with and without the @ share one budget of attempts', async () => {
    const { user } = await signup(srv);
    let last;
    for (let i = 0; i < 16; i++) last = await login({ identifier: i % 2 ? user.username : `@${user.username}`, password: 'Wrong-Password1!' });
    assert.equal(last.status, 429);
  });

  it('spacing and capitals do not give a fresh set of attempts, even for a name that does not exist', async () => {
    const ghost = `ghost${uid()}`;
    const variants = [ghost, `  ${ghost}  `, ghost.toUpperCase(), `@${ghost}`, ` @${ghost.toUpperCase()} `];
    let last;
    for (let i = 0; i < 16; i++) last = await login({ identifier: variants[i % variants.length], password: 'Wrong-Password1!' });
    assert.equal(last.status, 429);
  });

  it('wrong guesses for a name that does not exist are limited too', async () => {
    const ghost = `ghost${uid()}`;
    let last;
    for (let i = 0; i < 16; i++) last = await login({ identifier: ghost, password: 'Wrong-Password1!' });
    assert.equal(last.status, 429);
  });
});
