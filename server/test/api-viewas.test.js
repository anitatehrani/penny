import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, fails, ok, PW, shutdown, signup, startServer, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('viewas');
});
after(async () => {
  await shutdown(srv);
});

const q = (sql, params) => srv.db.query(sql, params);
const fresh = (over) => signup(srv, over);
async function admin() {
  const p = await fresh();
  await q('UPDATE users SET is_admin = true WHERE id = $1', [p.user.id]);
  return p;
}
const viewAs = (a, person, over = {}) => a.client.post(`/admin/users/${person.user.id}/view-as`, { reason: 'helping with a missing payment', password: PW, ...over });
/** A person with a payment, and an admin who is now looking at their account. */
async function setup(over = {}) {
  const a = await admin();
  const person = await fresh();
  ok(await tx(person.client, { description: 'Secret rent Via Roma', amount: 1234.56 }), 201);
  ok(await viewAs(a, person, over));
  return { a, person };
}
const eventsFor = async (userId, kind) => (await q(`SELECT kind, actor_id, user_id, detail FROM audit_events WHERE user_id = $1 AND kind = $2 ORDER BY id`, [userId, kind])).rows;

describe('starting to view as someone', () => {
  it('is for admins only, and never for yourself, another admin or someone who does not exist', async () => {
    const person = await fresh();
    const other = await fresh();
    assert.equal((await viewAs(person, other)).status, 404, 'an ordinary person gets "not found"');
    const a = await admin();
    const b = await admin();
    fails(await viewAs(a, a), 400);
    fails(await viewAs(a, b), 400);
    fails(await a.client.post('/admin/users/999999999/view-as', { reason: 'testing it all', password: PW }), 404);
  });

  it('needs a reason, in a few words', async () => {
    const a = await admin();
    const p = await fresh();
    for (const reason of [undefined, '', '   ', 'abc']) fails(await viewAs(a, p, { reason }), 400);
    fails(await viewAs(a, p, { reason: 'x'.repeat(201) }), 400);
    assert.equal((await a.client.get('/auth/me')).json.impersonating, undefined, 'nothing started');
  });

  it('needs the admin’s own password again, and a wrong one does not sign the admin out', async () => {
    const a = await admin();
    const p = await fresh();
    const none = await viewAs(a, p, { password: undefined });
    assert.equal(none.status, 403);
    const wrong = fails(await viewAs(a, p, { password: 'Not-The-Password-1!' }), 403);
    assert.equal(wrong.error, 'That password is not correct.');
    assert.equal((await a.client.get('/auth/me')).status, 200, 'still signed in as themselves');
    assert.equal((await a.client.get('/auth/me')).json.impersonating, undefined);
    assert.equal((await q('SELECT 1 FROM audit_events WHERE kind = $1 AND user_id = $2', ['admin_impersonate_start', p.user.id])).rowCount, 0);
  });

  it('too many wrong tries are turned away', async () => {
    const a = await admin();
    const p = await fresh();
    let last;
    for (let i = 0; i < 12; i++) last = await viewAs(a, p, { password: `wrong-${i}-Pass!A` });
    assert.equal(last.status, 429);
  });
});

describe('what the admin sees while viewing', () => {
  it('is the person’s own account: who they are, and their budget, as the person sees it', async () => {
    const { a, person } = await setup();
    const me = ok(await a.client.get('/auth/me'));
    assert.equal(me.user.id, person.user.id);
    assert.equal(me.user.username, person.user.username);
    assert.equal(me.user.is_admin, false, 'the viewed account is not an admin, whatever the viewer is');
    assert.deepEqual([me.impersonating.read_only, me.impersonating.reason], [true, 'helping with a missing payment']);
    assert.ok(me.impersonating.admin_name && me.impersonating.expires_at);
    const minutes = (new Date(me.impersonating.expires_at) - Date.now()) / 60000;
    assert.ok(minutes > 28 && minutes <= 30, `it lasts 30 minutes: ${minutes}`);
    const list = ok(await a.client.get('/transactions'));
    assert.deepEqual(list.map((t) => [t.description, t.amount]), [['Secret rent Via Roma', 1234.56]]);
  });

  it('the admin tools are not available while viewing (it is a different, ordinary account now)', async () => {
    const { a } = await setup();
    assert.equal((await a.client.get('/admin/overview')).status, 404);
    assert.equal((await a.client.get('/admin/users')).status, 404);
  });

  it('the person is not shown as active, and their own session is untouched', async () => {
    const a = await admin();
    const person = await fresh();
    await q('UPDATE users SET last_seen_at = NULL WHERE id = $1', [person.user.id]);
    ok(await viewAs(a, person));
    ok(await a.client.get('/transactions'));
    ok(await a.client.get('/summary'));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await q('SELECT last_seen_at FROM users WHERE id = $1', [person.user.id])).rows[0].last_seen_at, null, 'viewing does not make them "active now"');
    assert.equal((await person.client.get('/auth/me')).json.impersonating, undefined, 'the person themself is just themself');
  });

  it('a suspended person can be viewed (that is when you need to look)', async () => {
    const a = await admin();
    const p = await fresh();
    ok(await a.client.post(`/admin/users/${p.user.id}/suspend`, {}));
    ok(await viewAs(a, p));
    assert.equal(ok(await a.client.get('/auth/me')).user.id, p.user.id);
  });
});

describe('read-only, enforced on the server', () => {
  it('nothing can be changed: not a payment, a setting, a delete, an account detail, a friend or a budget', async () => {
    const { a, person } = await setup();
    const t = ok(await a.client.get('/transactions'))[0];
    const attempts = [
      ['post', '/transactions', { type: 'expense', description: 'x', amount: 5, date: '2031-01-01' }],
      ['put', `/transactions/${t.id}`, { type: 'expense', description: 'changed', amount: 1, date: t.date }],
      ['del', `/transactions/${t.id}`],
      ['patch', `/transactions/${t.id}/status`, { status: 'paid' }],
      ['put', '/settings', { opening_balance: 5, currency: 'EUR' }],
      ['post', '/debts', { name: 'D', total_amount: 10, plan: 'none' }],
      ['post', '/recurring', { type: 'expense', description: 'r', amount: 5, frequency: 'monthly', start_date: '2031-01-01' }],
      ['put', '/profile', { name: 'Hacked', username: 'hacked', discoverable: true, find_by_email: true, find_by_phone: true }],
      ['put', '/auth/password', { current_password: PW, new_password: 'Brand-New-Passw0rd!x' }],
      ['post', '/connections', { username: 'someone' }],
      ['post', '/workspaces', { name: 'Mine now' }],
      ['post', '/notifications/read-all'],
      ['put', '/budgets/1', { month: '2026-10', amount: 100 }],
      ['post', '/budgets/fill', { month: '2026-10', source: 'typical' }],
      ['put', '/assistant/ai', { on: true }],
      ['put', '/notifications/settings', { budget_alerts: false }],
    ];
    for (const [method, url, body] of attempts) {
      const r = method === 'del' ? await a.client.del(url) : await a.client[method](url, body);
      assert.equal(r.status, 403, `${method} ${url} must be refused: ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
      assert.match(r.json.error, /read-only/i);
    }
    assert.equal((await q('SELECT count(*)::int AS n FROM category_budgets')).rows[0].n, 0, 'no budget was written');
    // and nothing of it happened
    const row = (await q('SELECT description, amount FROM transactions WHERE user_id = $1', [person.user.id])).rows;
    assert.deepEqual(row.map((r) => [r.description, Number(r.amount)]), [['Secret rent Via Roma', 1234.56]]);
    assert.equal((await q('SELECT name FROM users WHERE id = $1', [person.user.id])).rows[0].name !== 'Hacked', true);
  });

  it('looking is allowed, and so is asking the assistant a question', async () => {
    const { a } = await setup();
    for (const url of ['/summary', '/transactions', '/recurring', '/debts', '/forecast?months=3', '/insights', '/categories', '/notifications', '/budgets', '/assistant/ai']) {
      assert.equal((await a.client.get(url)).status, 200, url);
    }
    assert.equal((await a.client.post('/assistant/ask', { question: 'How much did I spend?' })).status, 200);
  });
});

describe('when changes are allowed', () => {
  it('only the person’s budget data can change, and each change is written down with who really made it', async () => {
    const { a, person } = await setup({ read_only: false });
    ok(await a.client.post('/transactions', { type: 'expense', description: 'Added by support', amount: 7, date: '2031-01-01' }), 201);
    ok(await a.client.put('/settings', { opening_balance: 50, currency: 'EUR' }));
    const mine = await eventsFor(person.user.id, 'admin_acted_as');
    assert.deepEqual(mine.map((e) => e.detail), ['POST /api/transactions', 'PUT /api/settings']);
    assert.ok(mine.every((e) => e.actor_id === a.user.id), 'recorded against the admin, not the person');
    assert.ok((await q('SELECT 1 FROM transactions WHERE user_id = $1 AND description = $2', [person.user.id, 'Added by support'])).rowCount === 1);
  });

  it('never who they are, how they sign in, their friends, their budgets’ members or what they are told: that would be taking over the account', async () => {
    const { a, person } = await setup({ read_only: false });
    const blocked = [
      ['put', '/profile', { name: 'Hacked', username: 'hacked', discoverable: true, find_by_email: true, find_by_phone: true }],
      ['put', '/auth/password', { current_password: PW, new_password: 'Brand-New-Passw0rd!x' }],
      ['post', '/auth/google/link', { credential: 'x'.repeat(30) }],
      ['post', '/auth/email/send-verification'],
      ['post', '/connections', { username: 'someone' }],
      ['post', '/workspaces', { name: 'Mine now' }],
      ['put', '/preferences', { density: 'compact' }],
      ['post', '/notifications/read-all'],
      ['post', '/notifications/test-email'],
    ];
    for (const [method, url, body] of blocked) {
      const r = await a.client[method](url, body);
      assert.equal(r.status, 403, `${method} ${url} must be refused even with changes allowed: ${r.status}`);
    }
    assert.equal((await a.client.del('/auth/google')).status, 403);
    const u = (await q('SELECT name, username, password_hash FROM users WHERE id = $1', [person.user.id])).rows[0];
    assert.notEqual(u.name, 'Hacked');
    assert.equal((await new Client(srv.base).post('/auth/login', { identifier: person.body.email, password: PW })).status, 200, 'their password is unchanged');
  });
});

describe('the person, the log and the end', () => {
  it('the person is told in the app, with the reason', async () => {
    const { person } = await setup({ reason: 'checking the card bill' });
    const list = ok(await person.client.get('/notifications'));
    const items = list.items ?? list;
    const n = items.find((x) => x.title === 'An admin viewed your account');
    assert.ok(n, JSON.stringify(items).slice(0, 300));
    assert.match(n.body, /checking the card bill/);
    assert.match(n.body, /read-only/);
  });

  it('the start is in the activity log with who, whom and why', async () => {
    const { a, person } = await setup({ reason: 'checking the card bill' });
    const e = (await eventsFor(person.user.id, 'admin_impersonate_start'))[0];
    assert.equal(e.actor_id, a.user.id);
    assert.equal(e.detail, 'read-only: checking the card bill');
  });

  it('stopping returns the admin to their own account, and is logged', async () => {
    const { a, person } = await setup();
    const r = ok(await a.client.post('/auth/impersonation/stop'));
    assert.equal(r.user.id, a.user.id);
    assert.equal(r.user.is_admin, true);
    const me = ok(await a.client.get('/auth/me'));
    assert.equal(me.user.id, a.user.id);
    assert.equal(me.impersonating, undefined);
    assert.equal((await a.client.get('/admin/overview')).status, 200, 'the admin tools are back');
    assert.equal((await eventsFor(person.user.id, 'admin_impersonate_stop')).length, 1);
    fails(await a.client.post('/auth/impersonation/stop'), 400);
  });

  it('"sign out" while viewing only stops viewing: the admin stays signed in as themselves', async () => {
    const { a } = await setup();
    assert.equal((await a.client.post('/auth/logout')).status, 204);
    const me = ok(await a.client.get('/auth/me'));
    assert.equal(me.user.id, a.user.id);
    assert.equal(me.impersonating, undefined);
  });

  it('ends by itself after 30 minutes', async () => {
    const { a, person } = await setup();
    assert.equal(ok(await a.client.get('/auth/me')).user.id, person.user.id);
    await q(`UPDATE sessions SET acting_started_at = now() - interval '31 minutes' WHERE acting_as = $1`, [person.user.id]);
    const me = ok(await a.client.get('/auth/me'));
    assert.equal(me.user.id, a.user.id, 'back to the admin');
    assert.equal(me.impersonating, undefined);
    assert.equal((await q('SELECT count(*)::int AS n FROM sessions WHERE acting_as IS NOT NULL')).rows[0].n >= 0, true);
    assert.equal((await q('SELECT acting_as FROM sessions WHERE user_id = $1', [a.user.id])).rows[0].acting_as, null, 'the session was cleaned up');
  });

  it('ends when the person looking stops being an admin', async () => {
    const { a } = await setup();
    await q('UPDATE users SET is_admin = false WHERE id = $1', [a.user.id]);
    const me = ok(await a.client.get('/auth/me'));
    assert.equal(me.user.id, a.user.id);
    assert.equal(me.impersonating, undefined);
    assert.equal(me.user.is_admin, false);
  });

  it('another admin, and the person on their own device, are not affected', async () => {
    const { person } = await setup();
    const second = await admin();
    assert.equal(ok(await second.client.get('/auth/me')).user.id, second.user.id);
    assert.equal(ok(await person.client.get('/auth/me')).user.id, person.user.id);
    assert.equal(ok(await person.client.get('/transactions')).length, 1);
  });

  it('the viewing is shown in the activity tab with plain words', async () => {
    const { a, person } = await setup();
    await a.client.post('/auth/impersonation/stop');
    const log = ok(await a.client.get(`/admin/events?user_id=${person.user.id}`)).events;
    const labels = log.map((e) => e.label);
    assert.ok(labels.includes('An admin viewed their account') && labels.includes('An admin stopped viewing their account'), labels.join());
  });
});
