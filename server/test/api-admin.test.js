import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pruneAuditEvents } from '../src/lib/audit.js';
import { Client, daysFromToday, fails, ok, PW, sessionFor, shutdown, signup, startServer, tx } from './helpers.js';

const execFileP = promisify(execFile);
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let srv;
before(async () => {
  srv = await startServer('admin');
});
after(async () => {
  await shutdown(srv);
});

const q = (sql, params) => srv.db.query(sql, params);
const fresh = (over) => signup(srv, over);
/** A signed-up person made an admin directly in the database (the website itself has no way to do it). */
async function admin() {
  const p = await fresh();
  await q('UPDATE users SET is_admin = true WHERE id = $1', [p.user.id]);
  return p;
}
const events = async (a, params = '') => ok(await a.client.get(`/admin/events${params}`));
const kindsOf = async (a, params = '') => (await events(a, params)).events.map((e) => e.kind);
const delUser = (a, id, confirm) => a.client.raw('DELETE', `/admin/users/${id}`, confirm === undefined ? {} : { body: { confirm } });
const login = (p, password = PW) => new Client(srv.base).post('/auth/login', { identifier: p.body.email, password });

describe('only admins get in', () => {
  const routes = [
    ['get', '/admin/overview'],
    ['get', '/admin/users'],
    ['get', '/admin/users/1'],
    ['get', '/admin/events'],
    ['get', '/admin/system'],
    ['post', '/admin/users/1/suspend'],
    ['post', '/admin/users/1/unsuspend'],
    ['post', '/admin/users/1/sign-out'],
    ['del', '/admin/users/1'],
  ];

  it('a signed-out visitor is asked to sign in, and an ordinary person is told "not found", on every route', async () => {
    const person = await fresh();
    const visitor = new Client(srv.base);
    for (const [method, url] of routes) {
      assert.equal((await visitor[method](url)).status, 401, `${method} ${url} signed out`);
      const r = await person.client[method](url);
      assert.equal(r.status, 404, `${method} ${url} for an ordinary person`);
      assert.equal(r.json.error, 'Not found', 'it does not even say that there is an admin area');
    }
  });

  it('an admin gets in', async () => {
    const a = await admin();
    for (const url of ['/admin/overview', '/admin/users', '/admin/events', '/admin/system']) assert.equal((await a.client.get(url)).status, 200, url);
  });

  it('nobody can make themselves an admin through the website', async () => {
    const p = await fresh();
    const r = await new Client(srv.base).post('/auth/signup', { accept_terms: true, name: 'Sneaky', email: 'sneaky@example.com', username: 'sneaky', password: PW, is_admin: true });
    ok(r, 201);
    assert.equal(r.json.user.is_admin, false, 'not from signing up');
    const me = ok(await p.client.get('/auth/me')).user;
    const saved = await p.client.put('/profile', { name: me.name, username: me.username, phone: me.phone ?? null, discoverable: true, find_by_email: true, find_by_phone: true, is_admin: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(ok(await p.client.get('/auth/me')).user.is_admin, false, 'not from editing the profile');
    assert.equal((await q('SELECT is_admin FROM users WHERE email = $1', ['sneaky@example.com'])).rows[0].is_admin, false);
    assert.equal((await p.client.get('/admin/overview')).status, 404);
  });

  it('the person sees whether they are an admin in their own account', async () => {
    const a = await admin();
    const p = await fresh();
    assert.equal(ok(await a.client.get('/auth/me')).user.is_admin, true);
    assert.equal(ok(await p.client.get('/auth/me')).user.is_admin, false);
  });
});

describe('an admin never sees anyone’s money', () => {
  it('nothing about payments, amounts, debts, notes, categories or budget names is in any admin answer, and no password hash either', async () => {
    const a = await admin();
    const victim = await fresh({ name: 'Private Person' });
    ok(await tx(victim.client, { description: 'Secret rent Via Roma', amount: 1234.56, note: 'private note xyz' }), 201);
    ok(await victim.client.post('/debts', { name: 'Secret debt to Mario', total_amount: 777.77, plan: 'none' }), 201);
    ok(await victim.client.post('/workspaces', { name: 'Secret Family Budget' }), 201);
    const id = victim.user.id;
    const answers = [
      await a.client.get('/admin/overview'),
      await a.client.get('/admin/users'),
      await a.client.get(`/admin/users/${id}`),
      await a.client.get('/admin/events'),
      await a.client.get('/admin/system'),
    ];
    const text = JSON.stringify(answers.map((r) => r.json));
    for (const secret of ['Secret rent', '1234.56', 'private note', 'Secret debt', '777.77', 'Secret Family', 'password_hash', 'scrypt$']) {
      assert.ok(!text.includes(secret), `"${secret}" must not appear in an admin answer`);
    }
    const row = ok(await a.client.get(`/admin/users/${id}`)).user;
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'email', 'email_verified', 'google_linked', 'has_password', 'id', 'is_admin', 'last_login_at', 'last_seen_at', 'name', 'payments', 'shared_budgets', 'suspended', 'suspended_at', 'suspended_reason', 'username']);
    assert.equal(row.payments, 1, 'only how many payments, never which');
  });
});

describe('the overview', () => {
  it('counts people, activity and content, and has a sign-up chart for 30 days', async () => {
    const a = await admin();
    const before = ok(await a.client.get('/admin/overview'));
    const p1 = await fresh();
    await fresh();
    ok(await tx(p1.client, { description: 'x', amount: 5 }), 201);
    await q('UPDATE users SET suspended_at = now() WHERE id = $1', [p1.user.id]);
    const o = ok(await a.client.get('/admin/overview'));
    assert.equal(o.people.total, before.people.total + 2);
    assert.equal(o.people.new_24h, before.people.new_24h + 2);
    assert.equal(o.people.suspended, before.people.suspended + 1);
    assert.equal(o.people.admins >= 1, true);
    assert.equal(o.people.password, o.people.total, 'everyone here signs in with a password');
    assert.equal(o.people.google, 0);
    assert.equal(o.content.payments, before.content.payments + 1);
    assert.equal(o.content.personal_budgets, o.people.total, 'one personal budget each');
    assert.equal(o.signups_by_day.length, 30);
    assert.equal(o.signups_by_day.at(-1).day, (await q("SELECT to_char(current_date, 'YYYY-MM-DD') AS d")).rows[0].d, 'the last day is today');
    assert.ok(o.signups_by_day.at(-1).count >= 3, 'today has the new people');
    assert.ok(o.signups_by_day.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day) && Number.isInteger(d.count)));
    assert.equal(o.last_24h.sign_ups >= 2, true);
    assert.ok(Array.isArray(o.recent) && o.recent.length <= 8);
  });

  it('active people are counted from when they were last seen', async () => {
    const a = await admin();
    ok(await a.client.get('/auth/me')); // the admin's own first request marks them as seen; let that settle before measuring
    await new Promise((r) => setTimeout(r, 300));
    const old = await fresh();
    await q(`UPDATE users SET last_seen_at = now() - interval '10 days' WHERE id = $1`, [old.user.id]);
    const before = ok(await a.client.get('/admin/overview')).people;
    await q(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [old.user.id]);
    const after = ok(await a.client.get('/admin/overview')).people;
    assert.equal(after.active_24h, before.active_24h + 1);
    assert.equal(after.active_7d, before.active_7d + 1);
    assert.equal(after.active_30d, before.active_30d, 'it was already active in 30 days');
  });

  it('has a going-public checklist read from the real settings', async () => {
    const a = await admin();
    const o = ok(await a.client.get('/admin/overview'));
    assert.deepEqual(o.checks.map((c) => c.id), ['cookie', 'url', 'mail', 'legal', 'backups', 'proxy']);
    const by = Object.fromEntries(o.checks.map((c) => [c.id, c]));
    assert.equal(by.cookie.ok, false, 'tests run without COOKIE_SECURE');
    assert.equal(by.url.ok, false, 'the address is localhost');
    assert.equal(by.mail.ok, false, 'preview mode');
    assert.equal(by.legal.ok, false, 'nobody has said who runs the site');
    assert.equal(by.backups.ok, false, 'backups are off in tests');
    assert.equal(by.proxy.ok, false);
    assert.ok(o.checks.every((c) => typeof c.text === 'string' && typeof c.hint === 'string'));
  });
});

describe('the list of people', () => {
  it('finds by name, username or e-mail, in any case and part of a word', async () => {
    const a = await admin();
    const p = await fresh({ name: 'Zelda Findable', username: 'zeldaf', email: 'zelda.find@example.com' });
    for (const term of ['zelda', 'FINDABLE', 'zeldaf', 'ZELDA.FIND', 'da find']) {
      const r = ok(await a.client.get(`/admin/users?q=${encodeURIComponent(term)}`));
      assert.ok(r.users.some((u) => u.id === p.user.id), `"${term}" finds her`);
    }
    assert.equal(ok(await a.client.get('/admin/users?q=nobodywiththisname')).total, 0);
  });

  it('treats % and _ as plain characters, not as wildcards', async () => {
    const a = await admin();
    await fresh({ name: 'Plain Person' });
    assert.equal(ok(await a.client.get('/admin/users?q=%25')).total, 0, 'a lone % matches nothing');
    assert.equal(ok(await a.client.get('/admin/users?q=_')).total, 0, 'a lone _ matches nothing');
    const odd = await fresh({ name: '100% Real_Name' });
    const r = ok(await a.client.get(`/admin/users?q=${encodeURIComponent('100% real_')}`));
    assert.deepEqual(r.users.map((u) => u.id), [odd.user.id]);
  });

  it('filters: active, suspended, e-mail not confirmed, admins', async () => {
    const a = await admin();
    const s = await fresh();
    await q('UPDATE users SET suspended_at = now() WHERE id = $1', [s.user.id]);
    const c = await fresh();
    await q('UPDATE users SET email_verified_at = now() WHERE id = $1', [c.user.id]);
    const ids = async (status) => ok(await a.client.get(`/admin/users?status=${status}&page=1`)).users.map((u) => u.id);
    assert.ok((await ids('suspended')).includes(s.user.id) && !(await ids('active')).includes(s.user.id));
    assert.ok((await ids('active')).includes(c.user.id));
    assert.ok(!(await ids('unconfirmed')).includes(c.user.id), 'a confirmed e-mail is not in "not confirmed"');
    assert.ok((await ids('unconfirmed')).includes(s.user.id));
    const admins = ok(await a.client.get('/admin/users?status=admins')).users;
    assert.ok(admins.length >= 1 && admins.every((u) => u.is_admin));
  });

  it('sorts by newest, last seen and name', async () => {
    const a = await admin();
    const x = await fresh({ name: 'AAA First Alphabet' });
    const y = await fresh({ name: 'ZZZ Last Alphabet' });
    await q(`UPDATE users SET last_seen_at = now() + interval '1 hour' WHERE id = $1`, [x.user.id]);
    const first = async (sort, term) => ok(await a.client.get(`/admin/users?sort=${sort}&q=${term}`)).users.map((u) => u.id);
    assert.deepEqual(await first('newest', 'alphabet'), [y.user.id, x.user.id]);
    assert.deepEqual(await first('name', 'alphabet'), [x.user.id, y.user.id]);
    assert.deepEqual((await first('seen', 'alphabet'))[0], x.user.id, 'the one seen last is first');
  });

  it('pages 25 at a time, and says how many there are', async () => {
    const a = await admin();
    const term = `pagetest${Date.now().toString(36)}`;
    for (let i = 0; i < 27; i++) await fresh({ name: `${term} person ${String(i).padStart(2, '0')}` });
    const p1 = ok(await a.client.get(`/admin/users?q=${term}&sort=name&page=1`));
    const p2 = ok(await a.client.get(`/admin/users?q=${term}&sort=name&page=2`));
    assert.deepEqual([p1.total, p1.pages, p1.users.length, p2.users.length, p1.page_size], [27, 2, 25, 2, 25]);
    assert.equal(new Set([...p1.users, ...p2.users].map((u) => u.id)).size, 27, 'no one twice, no one missing');
    assert.equal(ok(await a.client.get(`/admin/users?q=${term}&page=9`)).users.length, 0, 'a page past the end is just empty');
  });

  it('refuses nonsense in the question', async () => {
    const a = await admin();
    for (const bad of ['status=banana', 'sort=password_hash', 'page=0', 'page=abc', 'page=-1']) fails(await a.client.get(`/admin/users?${bad}`), 400);
  });

  it('a person’s details say how many devices are signed in, their recent events, and whether they can be deleted', async () => {
    const a = await admin();
    const p = await fresh();
    await login(p);
    const d = ok(await a.client.get(`/admin/users/${p.user.id}`));
    assert.equal(d.devices, 2, 'the sign-up and one more sign-in');
    assert.equal(d.can_delete, true);
    assert.equal(d.shared_with_others, 0);
    assert.ok(d.events.map((e) => e.kind).includes('signup') && d.events.map((e) => e.kind).includes('login'));
    fails(await a.client.get('/admin/users/999999999'), 404);
    fails(await a.client.get('/admin/users/abc'), 400);
  });
});

describe('suspending and reinstating', () => {
  it('stops the person at once: they are signed out, and cannot sign in again', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await p.client.get('/auth/me'));
    const r = ok(await a.client.post(`/admin/users/${p.user.id}/suspend`, { reason: 'spam sign-ups' }));
    assert.equal(r.user.suspended, true);
    assert.equal(r.user.suspended_reason, 'spam sign-ups');
    assert.equal((await p.client.get('/auth/me')).status, 401, 'their open session is gone');
    assert.equal((await p.client.get('/transactions')).status, 401);
    const blocked = await login(p);
    assert.equal(blocked.status, 403);
    assert.match(blocked.json.error, /suspended/i);
  });

  it('even a session that somehow still exists for a suspended person is refused', async () => {
    const p = await fresh();
    await q('UPDATE users SET suspended_at = now() WHERE id = $1', [p.user.id]);
    const stray = await sessionFor(srv, p.user.id);
    assert.equal((await stray.get('/auth/me')).status, 401);
    assert.equal((await stray.get('/transactions')).status, 401);
  });

  it('says it only after the right password: a wrong one gets the usual answer, so it tells a guesser nothing', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await a.client.post(`/admin/users/${p.user.id}/suspend`, {}));
    const wrong = await login(p, 'Wrong-Password-123!');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error, 'Invalid email, username or password.');
  });

  it('reinstating lets them in again, with their data as it was', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await tx(p.client, { description: 'kept', amount: 9 }), 201);
    ok(await a.client.post(`/admin/users/${p.user.id}/suspend`, {}));
    const r = ok(await a.client.post(`/admin/users/${p.user.id}/unsuspend`));
    assert.equal(r.user.suspended, false);
    assert.equal(r.user.suspended_reason, null);
    const again = new Client(srv.base);
    ok(await again.post('/auth/login', { identifier: p.body.email, password: PW }));
    assert.equal(ok(await again.get('/transactions')).length, 1, 'their payment is still there');
  });

  it('is recorded: who suspended whom, and why; doing it twice records it once', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await a.client.post(`/admin/users/${p.user.id}/suspend`, { reason: 'abuse' }));
    ok(await a.client.post(`/admin/users/${p.user.id}/suspend`, { reason: 'abuse' }));
    const ev = (await events(a, `?kind=admin_suspend&user_id=${p.user.id}`)).events;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].actor_id, a.user.id);
    assert.equal(ev[0].detail, 'reason: abuse');
    ok(await a.client.post(`/admin/users/${p.user.id}/unsuspend`));
    assert.deepEqual(await kindsOf(a, `?user_id=${p.user.id}&kind=admin_unsuspend`), ['admin_unsuspend']);
  });

  it('cannot be done to yourself, to another admin, or to someone who does not exist', async () => {
    const a = await admin();
    const b = await admin();
    for (const action of ['suspend', 'unsuspend', 'sign-out']) {
      fails(await a.client.post(`/admin/users/${a.user.id}/${action}`, {}), 400);
      fails(await a.client.post(`/admin/users/${b.user.id}/${action}`, {}), 400);
      fails(await a.client.post(`/admin/users/999999999/${action}`, {}), 404);
    }
    fails(await delUser(a, a.user.id, a.user.username), 400);
    fails(await delUser(a, b.user.id, b.user.username), 400);
    ok(await b.client.get('/auth/me'));
  });

  it('a very long reason is refused', async () => {
    const a = await admin();
    const p = await fresh();
    fails(await a.client.post(`/admin/users/${p.user.id}/suspend`, { reason: 'x'.repeat(201) }), 400);
  });
});

describe('signing someone out everywhere', () => {
  it('ends every device and says how many', async () => {
    const a = await admin();
    const p = await fresh();
    const phone = new Client(srv.base);
    ok(await phone.post('/auth/login', { identifier: p.body.email, password: PW }));
    const r = ok(await a.client.post(`/admin/users/${p.user.id}/sign-out`));
    assert.equal(r.signed_out, 2);
    assert.equal((await p.client.get('/auth/me')).status, 401);
    assert.equal((await phone.get('/auth/me')).status, 401);
    assert.equal(ok(await new Client(srv.base).post('/auth/login', { identifier: p.body.email, password: PW })).user.email, p.body.email, 'they can sign in again');
    assert.equal((await events(a, `?kind=admin_signout&user_id=${p.user.id}`)).events[0].detail, '2 devices signed out');
  });
});

describe('deleting an account', () => {
  it('needs their username typed, then removes the person and what only they owned', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await tx(p.client, { description: 'gone soon', amount: 5 }), 201);
    fails(await delUser(a, p.user.id, 'not-their-name'), 400);
    fails(await delUser(a, p.user.id), 400);
    assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [p.user.id])).rowCount, 1, 'nothing deleted yet');
    assert.equal((await delUser(a, p.user.id, p.user.username.toUpperCase())).status, 204, 'any case is fine');
    assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [p.user.id])).rowCount, 0);
    assert.equal((await q('SELECT 1 FROM transactions WHERE user_id = $1', [p.user.id])).rowCount, 0);
    assert.equal((await q('SELECT 1 FROM workspaces WHERE owner_id = $1', [p.user.id])).rowCount, 0);
    assert.equal((await p.client.get('/auth/me')).status, 401);
    fails(await a.client.get(`/admin/users/${p.user.id}`), 404);
  });

  it('works for someone with debts (deleting the person and a budget with debts at once used to fail)', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await p.client.post('/debts', { name: 'D', total_amount: 100, plan: 'monthly', first_due_date: daysFromToday(30), installment_count: 3 }), 201);
    ok(await p.client.post('/debts', { name: 'Lent', total_amount: 50, plan: 'none', direction: 'lent' }), 201);
    assert.equal((await delUser(a, p.user.id, p.user.username)).status, 204);
    assert.equal((await q('SELECT count(*)::int AS n FROM debts d WHERE d.user_id = $1 OR d.member_id = $1', [p.user.id])).rows[0].n, 0);
  });

  it('is refused for someone who shares a budget with other people, whoever owns it, and says why', async () => {
    const a = await admin();
    const owner = await fresh();
    const member = await fresh();
    const g = ok(await owner.client.post('/workspaces', { name: 'Shared' }), 201);
    await q(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, [g.id, member.user.id]);
    for (const p of [owner, member]) {
      const r = fails(await delUser(a, p.user.id, p.user.username), 409);
      assert.match(r.error, /shared budget/);
      assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [p.user.id])).rowCount, 1);
    }
    assert.equal(ok(await a.client.get(`/admin/users/${owner.user.id}`)).can_delete, false);
    // when the other person has left, the budget is only theirs and goes with them
    await q('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [g.id, member.user.id]);
    assert.equal((await delUser(a, owner.user.id, owner.user.username)).status, 204);
    assert.equal((await q('SELECT 1 FROM workspaces WHERE id = $1', [g.id])).rowCount, 0);
    assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [member.user.id])).rowCount, 1, 'the other person is untouched');
  });

  it('is recorded, with no name or address, and the earlier events about the person stay without them', async () => {
    const a = await admin();
    const p = await fresh();
    await delUser(a, p.user.id, p.user.username);
    const ev = (await events(a, '?kind=admin_delete')).events[0];
    assert.equal(ev.actor_id, a.user.id);
    assert.equal(ev.detail, `deleted account #${p.user.id}`);
    assert.ok(!JSON.stringify(ev).includes(p.body.email) && !JSON.stringify(ev).includes(p.user.username));
    const signup = (await q(`SELECT user_id FROM audit_events WHERE kind = 'signup' AND detail IS NULL ORDER BY id DESC`)).rows;
    assert.ok(signup.some((r) => r.user_id === null), 'the sign-up event of the deleted person is kept, with no person');
  });
});

describe('what is recorded', () => {
  it('sign-ups, sign-ins and failures, each once, and never what was typed', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await login(p));
    const bad = await login(p, 'My-Secret-Guess-999!');
    assert.equal(bad.status, 401);
    await new Client(srv.base).post('/auth/login', { identifier: 'nobody.at.all@example.com', password: 'Another-Secret-Guess-1!' });
    const mine = (await events(a, `?user_id=${p.user.id}`)).events;
    assert.deepEqual(mine.map((e) => e.kind).sort(), ['login', 'login_failed', 'signup']);
    const all = JSON.stringify((await events(a)).events);
    assert.ok(!all.includes('My-Secret-Guess') && !all.includes('Another-Secret-Guess') && !all.includes('nobody.at.all'), 'no password and no typed address in the log');
    assert.ok((await events(a, '?kind=login_failed')).events.some((e) => e.user_id === null && e.detail === 'tried with an e-mail address'), 'an unknown account is a failure without a person');
  });

  it('a password change and an e-mail confirmation are recorded', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await p.client.put('/auth/password', { current_password: PW, new_password: 'Brand-New-Passw0rd!x' }));
    const sent = ok(await p.client.post('/auth/email/send-verification'));
    const token = new URL(sent.dev_link).searchParams.get('token');
    ok(await new Client(srv.base).post('/auth/email/verify', { token }));
    const kinds = await kindsOf(a, `?user_id=${p.user.id}`);
    assert.ok(kinds.includes('password_changed') && kinds.includes('email_verified'), kinds.join());
  });

  it('keeps where an event came from only as a short hash, the same for the same place', async () => {
    const a = await admin();
    const p = await fresh();
    await login(p, 'wrong-one-1!A');
    await login(p, 'wrong-two-2!B');
    const ev = (await events(a, `?kind=login_failed&user_id=${p.user.id}`)).events;
    assert.equal(ev.length, 2);
    assert.match(ev[0].source, /^[0-9a-f]{10}$/);
    assert.equal(ev[0].source, ev[1].source, 'the same place gives the same tag');
    assert.ok(!['127.0.0.1', '::1', '::ffff:127.0.0.1'].some((ip) => String(ev[0].source).includes(ip)), 'it is not the address');
  });

  it('turning people away for too many tries is recorded once, not once per refusal', async () => {
    const a = await admin();
    const p = await fresh();
    let last;
    for (let i = 0; i < 18; i++) last = await login(p, `wrong-${i}-Pass!A`);
    assert.equal(last.status, 429);
    const limited = (await events(a, `?kind=rate_limited`)).events.filter((e) => e.detail !== null);
    const ours = (await q(`SELECT count(*)::int AS n FROM audit_events WHERE kind = 'rate_limited' AND at > now() - interval '1 minute'`)).rows[0].n;
    assert.ok(limited.length >= 1);
    assert.ok(ours >= 1 && ours <= 2, `one for the sign-in tries (and at most one for the account): ${ours}`);
  });

  it('can be filtered by kind and by person, and the kinds list is there for the dropdown', async () => {
    const a = await admin();
    const p = await fresh();
    const r = await events(a, '?kind=signup');
    assert.ok(r.events.every((e) => e.kind === 'signup'));
    assert.ok(r.kinds.some((k) => k.kind === 'admin_suspend' && k.label === 'Suspended by an admin'));
    assert.deepEqual(await kindsOf(a, `?user_id=${p.user.id}`), ['signup']);
    fails(await a.client.get('/admin/events?kind=drop_table'), 400);
    assert.ok((await events(a)).events.every((e) => typeof e.label === 'string' && e.label.length > 0));
  });

  it('old events are removed after 90 days and recent ones kept', async () => {
    await q(`INSERT INTO audit_events (kind, at, detail) VALUES ('login', now() - interval '91 days', 'old one'), ('login', now() - interval '89 days', 'recent one')`);
    await pruneAuditEvents(srv.db);
    const left = (await q(`SELECT detail FROM audit_events WHERE detail IN ('old one', 'recent one')`)).rows.map((r) => r.detail);
    assert.deepEqual(left, ['recent one']);
  });
});

describe('the system tab', () => {
  it('reports the database, the app, backups and mail', async () => {
    const a = await admin();
    const s = ok(await a.client.get('/admin/system'));
    assert.equal(s.database.ok, true);
    assert.ok(s.database.bytes > 0 && s.database.connections >= 1);
    assert.ok(s.database.tables.length > 0 && s.database.tables.every((t) => typeof t.name === 'string'));
    assert.ok(s.app.uptime_seconds >= 0 && s.app.memory_bytes > 0 && /^v\d+/.test(s.app.node));
    assert.equal(s.backups.enabled, false, 'tests run with backups off');
    assert.equal(s.mail.mode, 'preview');
    assert.deepEqual([s.mail.failed_24h, s.mail.recent_failures.length], [0, 0]);
  });

  it('shows the latest e-mail failures with their error', async () => {
    const a = await admin();
    const p = await fresh();
    await q(`INSERT INTO email_log (user_id, to_email, subject, kind, status, error) VALUES ($1, 'x@example.com', 's', 'verify', 'failed', 'connection refused')`, [p.user.id]);
    const s = ok(await a.client.get('/admin/system'));
    assert.equal(s.mail.failed_24h, 1);
    assert.equal(s.mail.recent_failures[0].error, 'connection refused');
  });
});

describe('making someone an admin from the command line', () => {
  // Not a synchronous spawn: that would freeze this process for seconds, long enough for the server to close the connection the next request
  // would reuse ("fetch failed"), which made this block flaky.
  const run = async (...args) => {
    try {
      const r = await execFileP(process.execPath, ['scripts/make-admin.mjs', ...args], { cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, DATABASE_URL: srv.dbUrl } });
      return { status: 0, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      return { status: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  it('needs an existing account, and says so', async () => {
    const r = await run('nobody@example.com');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no account with the e-mail/);
    assert.equal((await run()).status, 1);
  });

  it('wants the e-mail confirmed first, unless --force, so an account made with someone else’s address cannot be made an admin by mistake', async () => {
    const p = await fresh();
    const r = await run(p.body.email);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not confirmed/);
    assert.equal((await q('SELECT is_admin FROM users WHERE id = $1', [p.user.id])).rows[0].is_admin, false);
    assert.equal((await run(p.body.email, '--force')).status, 0);
    assert.equal((await q('SELECT is_admin FROM users WHERE id = $1', [p.user.id])).rows[0].is_admin, true);
  });

  it('makes an admin, who then gets in, and says when it is already so; --remove takes it away; both are recorded', async () => {
    const p = await fresh();
    await q('UPDATE users SET email_verified_at = now() WHERE id = $1', [p.user.id]);
    assert.equal((await p.client.get('/admin/overview')).status, 404);
    const on = await run(p.body.email.toUpperCase());
    assert.equal(on.status, 0, on.stderr);
    assert.match(on.stdout, /is now an admin/);
    assert.equal((await p.client.get('/admin/overview')).status, 200, 'no new sign-in needed: the next request already sees it');
    assert.match((await run(p.body.email)).stdout, /already an admin/);
    const off = await run(p.body.email, '--remove');
    assert.match(off.stdout, /no longer an admin/);
    assert.equal((await p.client.get('/admin/overview')).status, 404);
    assert.match((await run(p.body.email, '--remove')).stdout, /is not an admin/);
    const kinds = (await q(`SELECT kind FROM audit_events WHERE user_id = $1 AND kind LIKE 'admin_%' ORDER BY id`, [p.user.id])).rows.map((r) => r.kind);
    assert.deepEqual(kinds, ['admin_grant', 'admin_revoke']);
  });
});

describe('behind a proxy', () => {
  it('with TRUST_PROXY the real visitor address is used: different visitors get different tags and their own rate limit', async () => {
    const proxied = await startServer('adminproxy', { TRUST_PROXY: '1' });
    try {
      const a = await signup(proxied);
      await proxied.db.query('UPDATE users SET is_admin = true WHERE id = $1', [a.user.id]);
      const victim = await signup(proxied);
      const from = (ip) => new Client(proxied.base).raw('POST', '/auth/login', { body: { identifier: victim.body.email, password: 'wrong-Pass-1!A' }, headers: { 'x-forwarded-for': ip } });
      for (let i = 0; i < 16; i++) await from('203.0.113.7'); // one visitor tries too often
      assert.equal((await from('203.0.113.7')).status, 429);
      assert.equal((await from('198.51.100.20')).status, 401, 'another visitor is not affected');
      const tags = (await proxied.db.query(`SELECT DISTINCT source FROM audit_events WHERE kind = 'login_failed'`)).rows.map((r) => r.source);
      assert.equal(tags.length, 2, 'two different places');
    } finally {
      await shutdown(proxied);
    }
  });

  it('without TRUST_PROXY a forged forwarding header changes nothing', async () => {
    const victim = await fresh();
    const from = (ip) => new Client(srv.base).raw('POST', '/auth/login', { body: { identifier: victim.body.email, password: 'wrong-Pass-1!A' }, headers: { 'x-forwarded-for': ip } });
    await from('203.0.113.1');
    await from('203.0.113.2');
    const tags = (await q(`SELECT DISTINCT source FROM audit_events WHERE kind = 'login_failed' AND user_id = $1`, [victim.user.id])).rows;
    assert.equal(tags.length, 1, 'both came from the same connection, whatever they claimed');
  });
});
