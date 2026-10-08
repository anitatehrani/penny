import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { Client, fails, ok, PNG, PW, sessionFor, shutdown, signup, startServer, uid, upload } from './helpers.js';

let srv;
let secureSrv;
let googleSrv;
let accounts;
before(async () => {
  srv = await startServer('auth');
  secureSrv = await startServer('authsecure', { COOKIE_SECURE: 'true' });
  googleSrv = await startServer('authgoogle', { GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com' });
  // Use the real account logic against the same database the server uses.
  process.env.DATABASE_URL = srv.dbUrl;
  accounts = await import(pathToFileURL(new URL('../src/lib/accounts.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);
});
after(async () => {
  await (await import(pathToFileURL(new URL('../src/db.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href)).pool.end();
  await shutdown(srv, secureSrv, googleSrv);
});

const sha = (t) => createHash('sha256').update(t).digest('hex');

describe('signup', () => {
  it('creates an account, signs in, and never leaks the password hash', async () => {
    const { client, user, body } = await signup(srv, { name: '  Alice  ', email: 'Alice.Case@Example.COM' });
    assert.equal(user.email, 'alice.case@example.com', 'email is normalised');
    assert.equal(user.name, 'Alice', 'name is trimmed');
    assert.equal(user.has_password, true);
    assert.equal(user.google_linked, false);
    assert.ok(!JSON.stringify(user).includes('password_hash'));
    assert.ok(!JSON.stringify(user).includes(body.password));
    assert.equal(ok(await client.get('/auth/me')).user.id, user.id);
  });

  it('stores only a salted scrypt hash and a hashed session token', async () => {
    const { client, user } = await signup(srv);
    const row = (await srv.db.query('SELECT password_hash FROM users WHERE id = $1', [user.id])).rows[0];
    assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!row.password_hash.includes(PW));
    const s = await srv.db.query('SELECT token_hash FROM sessions WHERE user_id = $1', [user.id]);
    assert.equal(s.rowCount, 1);
    assert.equal(s.rows[0].token_hash, sha(client.jar.sid), 'only the hash is stored');
    assert.notEqual(s.rows[0].token_hash, client.jar.sid);
  });

  it('two accounts with the same password get different hashes', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const rows = (await srv.db.query('SELECT password_hash FROM users WHERE id = ANY($1)', [[a.user.id, b.user.id]])).rows;
    assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  });

  it('sets a hardened session cookie', async () => {
    const c = new Client(srv.base.replace(/\/api$/, ''));
    const n = uid();
    const r = await c.post('/auth/signup', { name: 'C', email: `${n}@example.com`, username: `c${n}`, password: PW });
    assert.equal(r.status, 201);
    const cookie = c.lastSetCookie.find((x) => x.startsWith('sid='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=2592000/);
    assert.ok(!/Secure/.test(cookie), 'not Secure on plain http by default');
    assert.ok(cookie.split(';')[0].length > 40, 'long random token');
  });

  it('marks the cookie Secure when COOKIE_SECURE=true', async () => {
    const c = new Client(secureSrv.base.replace(/\/api$/, ''));
    const n = uid();
    ok(await c.post('/auth/signup', { name: 'S', email: `${n}@example.com`, username: `s${n}`, password: PW }), 201);
    assert.match(c.lastSetCookie.find((x) => x.startsWith('sid=')), /; Secure/);
  });

  it('rejects duplicates by email (any case), username (any case) and phone', async () => {
    const a = await signup(srv, { phone: '+44 7700 900123' });
    const n = uid();
    const other = (o) => new Client(srv.base.replace(/\/api$/, '')).post('/auth/signup', { name: 'D', email: `${n}@example.com`, username: `d${n}`, password: PW, ...o });
    fails(await other({ email: a.body.email.toUpperCase() }), 409);
    fails(await other({ username: a.body.username.toUpperCase() }), 409);
    fails(await other({ phone: '0044 7700-900-123' }), 409);
    ok(await other({}), 201);
  });

  it('validates every field', async () => {
    const root = srv.base.replace(/\/api$/, '');
    const n = uid();
    const base = { name: 'Valid', email: `${n}@example.com`, username: `v${n}`, password: PW };
    const bad = [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: undefined },
      { email: 'not-an-email' },
      { email: 'a@b' },
      { email: `${'x'.repeat(250)}@example.com` },
      { email: undefined },
      { username: '' },
      { username: 'ab' },
      { username: 'Has Space' },
      { username: 'admin' },
      { username: undefined },
      { phone: '12345' },
      { phone: '0170 1234567' },
      { password: 'short1!A' },
      { password: undefined },
      { password: 12345678901 },
    ];
    for (const b of bad) {
      const r = await new Client(root).post('/auth/signup', { ...base, ...b });
      assert.equal(r.status, 400, `${JSON.stringify(b).slice(0, 60)} → ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    }
    assert.equal((await srv.db.query('SELECT 1 FROM users WHERE lower(email) = $1', [base.email])).rowCount, 0, 'nothing was created');
  });

  it('accepts unusual but valid names and optional phone formats', async () => {
    await signup(srv, { name: 'Zoë 日本語 O\'Brien-Smith 🎉' });
    const r = await signup(srv, { phone: '  +1 (415) 555-2671 ' });
    assert.equal(r.user.phone, '+14155552671');
    const none = await signup(srv, { phone: '' });
    assert.equal(none.user.phone, null);
  });

  it('every new account starts with a personal budget and default categories', async () => {
    const { client } = await signup(srv);
    const ws = ok(await client.get('/workspaces'));
    assert.equal(ws.length, 1);
    assert.equal(ws[0].kind, 'personal');
    assert.equal(ok(await client.get('/categories')).length, 14);
  });
});

describe('password rules (server)', () => {
  const tryPw = async (password, extra = {}) => {
    const n = uid();
    return new Client(srv.base.replace(/\/api$/, '')).post('/auth/signup', { name: 'Pat', email: `${n}@example.com`, username: `p${n}`, password, ...extra });
  };

  it('accepts a strong password with spaces and unicode', async () => {
    assert.equal((await tryPw('Correct Horse 7! Battery')).status, 201);
    assert.equal((await tryPw('Ünïcode-Pässwörd-9#')).status, 201);
    assert.equal((await tryPw('A1!' + 'a'.repeat(125))).status, 201, '128 chars is the maximum');
  });

  it('lists exactly what is wrong', async () => {
    const r = await tryPw('abc');
    assert.equal(r.status, 400);
    const text = r.json.problems.join(' | ');
    for (const part of ['at least 10', 'uppercase', 'number', 'special']) assert.match(text, new RegExp(part));
    assert.ok(!/lowercase/.test(text), 'lowercase is present');
    assert.ok((await tryPw('A1!' + 'a'.repeat(126))).json.problems.some((p) => /at most 128/.test(p)));
  });

  it('refuses common passwords and passwords containing your name or email', async () => {
    assert.ok((await tryPw('Password123')).json.problems.some((p) => /common/.test(p)));
    assert.ok((await tryPw('P@ssw0rd')).json.problems.length > 0);
    const n = uid();
    const email = `sunshine${n}@example.com`;
    assert.ok((await tryPw(`Xx-sunshine${n}-9!`, { email })).json.problems.some((p) => /email name/.test(p)));
    assert.ok((await tryPw('Roberta-Loves-Pizza1!', { name: 'Roberta Rossi' })).json.problems.some((p) => /your name/.test(p)));
  });
});

describe('login and logout', () => {
  it('logs in with any email casing and gives the same generic error for every failure', async () => {
    const { user, body } = await signup(srv);
    const c = new Client(srv.base.replace(/\/api$/, ''));
    const wrongPw = await c.post('/auth/login', { email: body.email, password: 'Wrong-Password1!' });
    const noUser = await c.post('/auth/login', { email: `nobody${uid()}@example.com`, password: 'Wrong-Password1!' });
    assert.equal(wrongPw.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPw.json.error, noUser.json.error);
    const r = ok(await c.post('/auth/login', { email: body.email.toUpperCase(), password: PW }));
    assert.equal(r.user.id, user.id);
    assert.equal(ok(await c.get('/auth/me')).user.id, user.id);
    assert.ok((await srv.db.query('SELECT last_login_at FROM users WHERE id = $1', [user.id])).rows[0].last_login_at);
  });

  it('is case-sensitive for the password and refuses empty/oversized input', async () => {
    const { body } = await signup(srv);
    const c = new Client(srv.base.replace(/\/api$/, ''));
    fails(await c.post('/auth/login', { email: body.email, password: PW.toLowerCase() }), 401);
    fails(await c.post('/auth/login', { email: body.email, password: '' }), 400);
    fails(await c.post('/auth/login', { email: body.email }), 400);
    fails(await c.post('/auth/login', { password: PW }), 400);
    fails(await c.post('/auth/login', { email: 'nope', password: PW }), 401); // looks like a username, and there is no such person
    fails(await c.post('/auth/login', { email: 'not@valid', password: PW }), 400); // has an @, so it must be a real email address
    fails(await c.post('/auth/login', { email: body.email, password: 'x'.repeat(1001) }), 400);
    fails(await c.post('/auth/login', { email: body.email, password: ['array'] }), 400);
  });

  it('a Google-only account cannot sign in with a password', async () => {
    const g = await accounts.signInWithGoogleProfile({ sub: `g-${uid()}`, email: `g${uid()}@example.com`, email_verified: true, name: 'Gina' }, { query: (...a) => srv.db.query(...a) });
    const r = await new Client(srv.base.replace(/\/api$/, '')).post('/auth/login', { email: g.user.email, password: PW });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'Invalid email, username or password.');
  });

  it('logout ends only that session and the token is dead server-side', async () => {
    const { user, body } = await signup(srv);
    const a = new Client(srv.base.replace(/\/api$/, ''));
    const b = new Client(srv.base.replace(/\/api$/, ''));
    ok(await a.post('/auth/login', { email: body.email, password: PW }));
    ok(await b.post('/auth/login', { email: body.email, password: PW }));
    const token = a.jar.sid;
    assert.equal((await a.post('/auth/logout')).status, 204);
    assert.equal((await a.get('/auth/me')).status, 401);
    const replay = new Client(srv.base.replace(/\/api$/, ''));
    replay.jar.sid = token;
    assert.equal((await replay.get('/transactions')).status, 401);
    assert.equal((await b.get('/auth/me')).status, 200, 'other device stays signed in');
    assert.equal((await srv.db.query('SELECT 1 FROM sessions WHERE token_hash = $1', [sha(token)])).rowCount, 0);
    assert.ok(user);
  });

  it('logout without a session is harmless', async () => {
    assert.equal((await new Client(srv.base.replace(/\/api$/, '')).post('/auth/logout')).status, 204);
  });
});

describe('sessions', () => {
  it('expired sessions are refused', async () => {
    const { client, user } = await signup(srv);
    await srv.db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [user.id]);
    fails(await client.get('/auth/me'), 401);
    fails(await client.get('/transactions'), 401);
  });

  it('sessions are renewed (and the cookie re-sent) once a day while in use', async () => {
    const { client, user } = await signup(srv);
    await srv.db.query(`UPDATE sessions SET expires_at = now() + interval '10 days' WHERE user_id = $1`, [user.id]);
    client.lastSetCookie = [];
    ok(await client.get('/auth/me'));
    assert.ok(client.lastSetCookie.some((c) => c.startsWith('sid=')), 'cookie refreshed');
    const days = (await srv.db.query(`SELECT extract(epoch FROM (expires_at - now())) / 86400 AS d FROM sessions WHERE user_id = $1`, [user.id])).rows[0].d;
    assert.ok(days > 29, `renewed to ~30 days, got ${days}`);
    client.lastSetCookie = [];
    ok(await client.get('/auth/me'));
    assert.ok(!client.lastSetCookie.some((c) => c.startsWith('sid=')), 'not re-sent on every request');
  });

  it('forged, empty and malformed cookies are ignored — never an error', async () => {
    const root = srv.base.replace(/\/api$/, '');
    for (const cookie of ['sid=forged', 'sid=', 'sid', 'sid=%', 'sid=%E0%A4%A', 'sid=%zz', '=;;;', 'sid=' + 'x'.repeat(4000), 'other=1', 'sid=a=b=c', 'sid="quoted"', ';;sid=1;;']) {
      const r = await new Client(root).get('/auth/me', { cookie });
      assert.equal(r.status, 401, `cookie ${JSON.stringify(cookie).slice(0, 40)} → ${r.status}`);
    }
  });

  it('everything needs a session', async () => {
    const c = new Client(srv.base.replace(/\/api$/, ''));
    const routes = [
      ['GET', '/settings'], ['PUT', '/settings'], ['GET', '/categories'], ['POST', '/categories'], ['PUT', '/categories/1'], ['DELETE', '/categories/1'],
      ['GET', '/transactions'], ['POST', '/transactions'], ['PUT', '/transactions/1'], ['PATCH', '/transactions/1/status'], ['DELETE', '/transactions/1'], ['GET', '/transactions/export.csv'],
      ['GET', '/recurring'], ['POST', '/recurring'], ['PUT', '/recurring/1'], ['DELETE', '/recurring/1'],
      ['GET', '/installments'], ['POST', '/installments'], ['PUT', '/installments/1'], ['DELETE', '/installments/1'],
      ['GET', '/summary'], ['GET', '/forecast'], ['GET', '/shared'], ['POST', '/shared/1/import'],
      ['PUT', '/profile'], ['GET', '/people/lookup?q=x'], ['GET', '/people/someone'], ['GET', '/connections'], ['POST', '/connections'], ['POST', '/connections/1/accept'],
      ['POST', '/connections/1/decline'], ['PUT', '/connections/1'], ['DELETE', '/connections/1'], ['GET', '/inbox'],
      ['GET', '/workspaces'], ['POST', '/workspaces'], ['PUT', '/workspaces/1'], ['DELETE', '/workspaces/1'], ['GET', '/workspaces/1/invites'], ['POST', '/workspaces/1/invites'],
      ['DELETE', '/workspace-invites/1'], ['POST', '/workspace-invites/1/accept'], ['POST', '/workspace-invites/1/decline'],
      ['DELETE', '/workspaces/1/members/x'], ['POST', '/workspaces/1/leave'], ['POST', '/workspaces/1/transfer'],
      ['PUT', '/auth/password'], ['POST', '/auth/google/link'], ['DELETE', '/auth/google'],
    ];
    for (const [m, p] of routes) {
      const r = await c.call(m, p, m === 'GET' || m === 'DELETE' ? undefined : {});
      assert.equal(r.status, 401, `${m} ${p} should need a session but returned ${r.status}`);
    }
  });

  it('public endpoints stay public', async () => {
    const c = new Client(srv.base.replace(/\/api$/, ''));
    assert.equal((await c.get('/health')).status, 200);
    assert.deepEqual(ok(await c.get('/auth/config')), { googleClientId: null, signupsOpen: true });
    assert.equal((await c.get('/auth/username-available?u=freeone')).json.available, true);
    assert.equal((await c.get('/auth/me')).status, 401);
  });
});

describe('changing the password', () => {
  it('needs the current password, enforces the rules, and signs out other devices', async () => {
    const { client: phone, user, body } = await signup(srv);
    const laptop = new Client(srv.base.replace(/\/api$/, ''));
    ok(await laptop.post('/auth/login', { email: body.email, password: PW }));
    fails(await phone.put('/auth/password', { current_password: 'Nope-Nope-1!', new_password: 'Another-Strong#1' }), 401);
    fails(await phone.put('/auth/password', { new_password: 'Another-Strong#1' }), 401);
    const weak = fails(await phone.put('/auth/password', { current_password: PW, new_password: 'weak' }), 400);
    assert.ok(weak.problems.length > 0);
    fails(await phone.put('/auth/password', { current_password: PW, new_password: `${user.username}-Secret-1!` }), 400);
    ok(await phone.put('/auth/password', { current_password: PW, new_password: 'Another-Strong#1' }));
    assert.equal((await laptop.get('/auth/me')).status, 401, 'other device was signed out');
    assert.equal((await phone.get('/auth/me')).status, 200, 'this one stays signed in');
    const fresh = new Client(srv.base.replace(/\/api$/, ''));
    fails(await fresh.post('/auth/login', { email: body.email, password: PW }), 401);
    ok(await fresh.post('/auth/login', { email: body.email, password: 'Another-Strong#1' }));
  });
});

describe('Google sign-in', () => {
  const q = { query: (...a) => srv.db.query(...a) };
  const profile = (over = {}) => ({ sub: `g-${uid()}`, email: `g${uid()}@example.com`, email_verified: true, name: 'Gina Green', picture: 'https://lh3.googleusercontent.com/a/x', ...over });

  it('is hidden/unavailable when not configured', async () => {
    const c = new Client(srv.base.replace(/\/api$/, ''));
    assert.deepEqual(ok(await c.get('/auth/config')), { googleClientId: null, signupsOpen: true });
    fails(await c.post('/auth/google', { credential: 'x'.repeat(40) }), 503);
  });

  it('advertises the client id when configured and rejects tokens that are not valid', async () => {
    const c = new Client(googleSrv.base.replace(/\/api$/, ''));
    assert.equal(ok(await c.get('/auth/config')).googleClientId, '1234567890-abc.apps.googleusercontent.com');
    for (const credential of ['x'.repeat(40), 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc',`${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`]) {
      fails(await c.post('/auth/google', { credential }), 401);
    }
    fails(await c.post('/auth/google', { credential: 'short' }), 400);
    fails(await c.post('/auth/google', {}), 400);
    assert.equal((await c.get('/auth/me')).status, 401, 'no session was created');
  });

  it('first sign-in creates a full account; the next one signs into it', async () => {
    const p = profile();
    const first = await accounts.signInWithGoogleProfile(p, q);
    assert.equal(first.created, true);
    assert.equal(first.user.email, p.email);
    assert.equal(first.user.password_hash, null);
    assert.ok(first.user.email_verified_at, 'Google already verified this address');
    assert.equal(first.user.avatar_url, p.picture);
    assert.equal(first.user.google_picture, p.picture);
    assert.match(first.user.username, /^[a-z0-9][a-z0-9._]{2,23}$/);
    const cats = (await srv.db.query('SELECT count(*)::int n FROM categories WHERE user_id = $1', [first.user.id])).rows[0].n;
    assert.equal(cats, 14);
    assert.equal((await srv.db.query(`SELECT count(*)::int n FROM workspaces WHERE owner_id = $1 AND kind = 'personal'`, [first.user.id])).rows[0].n, 1);
    const again = await accounts.signInWithGoogleProfile({ ...p, name: 'Changed Name' }, q);
    assert.equal(again.created, false);
    assert.equal(again.user.id, first.user.id);
  });

  it('refuses unverified emails and incomplete profiles', async () => {
    await assert.rejects(accounts.signInWithGoogleProfile(profile({ email_verified: false }), q), /not verified/);
    await assert.rejects(accounts.signInWithGoogleProfile(profile({ email: undefined }), q), /email/);
    await assert.rejects(accounts.signInWithGoogleProfile(profile({ sub: undefined }), q), /email/);
    await assert.rejects(accounts.signInWithGoogleProfile(null, q));
  });

  it('never takes over an existing password account, whatever the email casing', async () => {
    const { user } = await signup(srv);
    await assert.rejects(accounts.signInWithGoogleProfile(profile({ email: user.email.toUpperCase() }), q), /already exists/);
    assert.equal((await srv.db.query('SELECT google_id FROM users WHERE id = $1', [user.id])).rows[0].google_id, null);
  });

  it('generates distinct usernames for look-alike emails', async () => {
    const a = await accounts.signInWithGoogleProfile(profile({ email: `same${uid()}@gmail.com` }), q);
    const base = a.user.email.split('@')[0];
    const b = await accounts.signInWithGoogleProfile(profile({ email: `${base}@example.org` }), q);
    assert.notEqual(a.user.username, b.user.username);
  });

  it('a Google-only account can set a password, then disconnect Google', async () => {
    const g = await accounts.signInWithGoogleProfile(profile(), q);
    const c = await sessionFor(srv, g.user.id);
    assert.equal(ok(await c.get('/auth/me')).user.has_password, false);
    fails(await c.del('/auth/google'), 400); // would lock the user out
    fails(await c.put('/auth/password', { new_password: 'weak' }), 400);
    const set = ok(await c.put('/auth/password', { new_password: 'Brand-New#Pass1' }));
    assert.equal(set.user.has_password, true);
    const unlinked = ok(await c.del('/auth/google'));
    assert.equal(unlinked.user.google_linked, false);
    const login = new Client(srv.base.replace(/\/api$/, ''));
    ok(await login.post('/auth/login', { email: g.user.email, password: 'Brand-New#Pass1' }));
  });

  it('linking needs a session and a valid Google token', async () => {
    const root = googleSrv.base.replace(/\/api$/, '');
    fails(await new Client(root).post('/auth/google/link', { credential: 'x'.repeat(40) }), 401);
    const { client } = await signup(googleSrv);
    fails(await client.post('/auth/google/link', { credential: 'x'.repeat(40) }), 401);
  });
});

describe('request hygiene', () => {
  const root = () => srv.base.replace(/\/api$/, '');

  it('malformed JSON is a clean 400', async () => {
    const r = await new Client(root()).raw('POST', '/auth/login', { rawBody: '{"email": ', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /JSON/i);
  });

  it('oversized bodies are refused with 413, not a crash', async () => {
    const r = await new Client(root()).raw('POST', '/auth/login', { rawBody: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }), headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 413, `got ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  });

  it('non-JSON and odd bodies never cause a 500', async () => {
    const c = new Client(root());
    for (const rawBody of ['plain text', '[]', 'null', '"string"', '123', '']) {
      for (const ct of ['application/json', 'text/plain', 'application/x-www-form-urlencoded']) {
        const r = await c.raw('POST', '/auth/login', { rawBody, headers: { 'content-type': ct } });
        assert.ok(r.status >= 400 && r.status < 500, `${JSON.stringify(rawBody)} as ${ct} → ${r.status}`);
      }
    }
  });
});

describe('cross-site request protection', () => {
  it('blocks state-changing requests from another origin, even with a valid session', async () => {
    const { client } = await signup(srv);
    const host = new URL(client.root).host;
    for (const [m, p, body] of [['POST', '/transactions', { type: 'expense', description: 'csrf', amount: 1, date: '2025-01-01' }], ['PUT', '/settings', { opening_balance: 1, currency: 'USD' }], ['POST', '/auth/logout', {}], ['DELETE', '/categories/1'], ['PUT', '/auth/password', { new_password: 'Zzz-Zzz-Zzz-1' }]]) {
      const r = await client.call(m, p, body, { origin: 'https://evil.example' });
      assert.equal(r.status, 403, `${m} ${p} from evil origin → ${r.status}`);
    }
    fails(await client.call('POST', '/transactions', { type: 'expense', description: 'x', amount: 1, date: '2025-01-01' }, { origin: 'null' }), 403);
    fails(await client.call('POST', '/transactions', { type: 'expense', description: 'x', amount: 1, date: '2025-01-01' }, { origin: 'not a url' }), 403);
    fails(await client.call('POST', '/transactions', { type: 'expense', description: 'x', amount: 1, date: '2025-01-01' }, { 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(ok(await client.get('/transactions?status=')).length, 0, 'none of those got through');
    // same-origin still works
    ok(await client.call('POST', '/transactions', { type: 'expense', description: 'ok', amount: 1, date: '2025-01-01' }, { origin: `http://${host}` }), 201);
    ok(await client.call('POST', '/transactions', { type: 'expense', description: 'ok2', amount: 1, date: '2025-01-01' }, { 'sec-fetch-site': 'same-origin' }), 201);
  });

  it('blocks cross-site uploads, notification changes and alert rules too, and lets same-origin ones through', async () => {
    const { client } = await signup(srv);
    const host = new URL(client.root).host;
    const t = ok(await client.post('/transactions', { type: 'expense', description: 'mine', amount: 5, date: '2025-01-01', status: 'pending' }), 201);
    const evil = { origin: 'https://evil.example' };
    const attacks = [
      ['PUT', '/profile/avatar', () => upload(client, 'PUT', '/profile/avatar', PNG, 'image/png', evil)],
      ['DELETE', '/profile/avatar', () => client.call('DELETE', '/profile/avatar', undefined, evil)],
      ['POST', '/transactions/:id/receipts', () => upload(client, 'POST', `/transactions/${t.id}/receipts`, PNG, 'image/png', evil)],
      ['PUT', '/notifications/settings', () => client.call('PUT', '/notifications/settings', { email_enabled: false, lead_days: 30 }, evil)],
      ['POST', '/notifications/read-all', () => client.call('POST', '/notifications/read-all', {}, evil)],
      ['DELETE', '/notifications', () => client.call('DELETE', '/notifications', undefined, evil)],
      ['POST', '/notifications/test-email', () => client.call('POST', '/notifications/test-email', {}, evil)],
      ['PUT', '/alerts/transaction/:id', () => client.call('PUT', `/alerts/transaction/${t.id}`, { mode: 'off' }, evil)],
      ['POST', '/auth/email/send-verification', () => client.call('POST', '/auth/email/send-verification', {}, evil)],
    ];
    for (const [m, p, run] of attacks) assert.equal((await run()).status, 403, `${m} ${p} from an evil origin`);
    assert.equal(ok(await client.get('/notifications/settings')).lead_days, 3, 'settings untouched');
    assert.equal(ok(await client.get(`/transactions/${t.id}/receipts`)).length, 0, 'no receipt got in');
    assert.equal(ok(await client.get('/auth/me')).user.avatar_url, null, 'no picture got in');
    assert.equal(ok(await client.get('/alerts/overrides')).length, 0, 'no rule got in');
    const same = { origin: `http://${host}` };
    ok(await upload(client, 'PUT', '/profile/avatar', PNG, 'image/png', same));
    ok(await upload(client, 'POST', `/transactions/${t.id}/receipts`, PNG, 'image/png', same), 201);
    ok(await client.call('PUT', '/notifications/settings', { lead_days: 5 }, same));
  });

  it('login itself is protected too', async () => {
    const { body } = await signup(srv);
    fails(await new Client(srv.base.replace(/\/api$/, '')).post('/auth/login', { email: body.email, password: PW }, { origin: 'https://evil.example' }), 403);
  });
});

describe('rate limiting', () => {
  it('slows down password guessing per email, and other emails are unaffected', async () => {
    const { body } = await signup(srv);
    const c = new Client(srv.base.replace(/\/api$/, ''));
    let last;
    for (let i = 0; i < 16; i++) last = await c.post('/auth/login', { email: body.email, password: 'Wrong-Password1!' });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    fails(await c.post('/auth/login', { email: body.email, password: PW }), 429); // even the right password is held
    const other = await signup(srv);
    ok(await new Client(srv.base.replace(/\/api$/, '')).post('/auth/login', { email: other.body.email, password: PW }));
  });

  it('limits repeated sign-up attempts for one email', async () => {
    const root = srv.base.replace(/\/api$/, '');
    const email = `flood${uid()}@example.com`;
    let last;
    for (let i = 0; i < 17; i++) last = await new Client(root).post('/auth/signup', { name: 'F', email, username: 'ab', password: 'x' });
    assert.equal(last.status, 429);
  });
});

describe('username availability', () => {
  it('reports taken, free and invalid names', async () => {
    const { user } = await signup(srv);
    const c = new Client(srv.base.replace(/\/api$/, ''));
    assert.equal(ok(await c.get(`/auth/username-available?u=${user.username}`)).available, false);
    assert.equal(ok(await c.get(`/auth/username-available?u=${user.username.toUpperCase()}`)).available, false);
    assert.equal(ok(await c.get(`/auth/username-available?u=@${user.username}`)).available, false);
    assert.equal(ok(await c.get(`/auth/username-available?u=free${uid()}`)).available, true);
    const bad = ok(await c.get('/auth/username-available?u=ab'));
    assert.equal(bad.available, false);
    assert.ok(bad.reason);
    assert.equal(ok(await c.get('/auth/username-available?u=admin')).available, false);
    assert.equal(ok(await c.get('/auth/username-available')).available, false);
  });
});
