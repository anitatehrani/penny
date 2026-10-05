import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { Client, connect, daysFromToday, fails, ok, PW, shutdown, signup, startServer, thisMonth, tx } from './helpers.js';

// Edges where the newer features meet the older ones: alerts, shared budgets, saved preferences, and a race.
let srv;
before(async () => {
  srv = await startServer('featureedges');
});
after(async () => {
  await shutdown(srv);
});

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const NEXT = addMonthsYM(thisMonth(), 1);
/** A fresh account whose "today" matches the server's, with the other alert kinds off so only due and overdue payments show. */
const person = async () => {
  const p = await signup(srv);
  ok(await p.client.put('/notifications/settings', { timezone: LOCAL_TZ, balance_warning: false, forecast_warning: false, ai_insights: false }));
  return p;
};
const scan = async (p) => ok(await p.client.post('/notifications/refresh'));
const alerts = async (p) => ok(await p.client.get('/notifications')).items.filter((n) => n.kind === 'payment_due' || n.kind === 'payment_overdue');
const debtBody = (over = {}) => ({ name: 'Faeze', total_amount: 300, plan: 'none', ...over });
const household = async () => {
  const owner = await person();
  const member = await person();
  await connect(owner, member);
  const g = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
  ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: member.user.username }), 201);
  ok(await member.client.post(`/workspace-invites/${ok(await member.client.get('/inbox')).group_invites.at(-1).id}/accept`));
  owner.client.ws = g.id;
  member.client.ws = g.id;
  return { owner, member, g };
};

describe('credit card payments raise the usual alerts, on the day the bill is due', () => {
  it('a bill due soon is a "due" alert, even though the purchase was weeks ago', async () => {
    const p = await person();
    const t = ok(await tx(p.client, { description: 'Sofa', date: daysFromToday(2), pay_method: 'credit_card', charged_on: daysFromToday(-25), status: 'pending' }), 201);
    await scan(p);
    const [n] = await alerts(p);
    assert.deepEqual([n.kind, n.data.transaction_id], ['payment_due', t.id]);
  });

  it('a bill that is still far off, or already paid, does not alert; one that is late does', async () => {
    const p = await person();
    ok(await tx(p.client, { description: 'Far', date: daysFromToday(20), pay_method: 'credit_card', charged_on: daysFromToday(-1), status: 'pending' }), 201);
    ok(await tx(p.client, { description: 'Paid', date: daysFromToday(1), pay_method: 'credit_card', charged_on: daysFromToday(-9), status: 'paid' }), 201);
    const late = ok(await tx(p.client, { description: 'Late', date: daysFromToday(-3), pay_method: 'credit_card', charged_on: daysFromToday(-30), status: 'pending' }), 201);
    await scan(p);
    const found = await alerts(p);
    assert.deepEqual(found.map((n) => [n.kind, n.data.transaction_id]), [['payment_overdue', late.id]]);
  });
});

describe('debt repayments raise the usual alerts', () => {
  it('a counted repayment due tomorrow is a "due" alert', async () => {
    const p = await person();
    const d = ok(await p.client.post('/debts', debtBody({ plan: 'once', first_due_date: daysFromToday(1) })), 201);
    await scan(p);
    const [n] = await alerts(p);
    assert.equal(n.kind, 'payment_due');
    const repayment = ok(await p.client.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).find((t) => t.debt_id === d.id);
    assert.equal(n.data.transaction_id, repayment.id);
  });

  it('a debt that is not counted, or is settled, or has no plan, alerts nothing', async () => {
    const p = await person();
    ok(await p.client.post('/debts', debtBody({ name: 'Off', plan: 'once', first_due_date: daysFromToday(1), count_in_budget: false })), 201);
    ok(await p.client.post('/debts', debtBody({ name: 'None' })), 201);
    const settled = ok(await p.client.post('/debts', debtBody({ name: 'Settled', plan: 'once', first_due_date: daysFromToday(1) })), 201);
    ok(await p.client.post(`/debts/${settled.id}/settle`));
    assert.equal((await scan(p)).created, 0);
    assert.deepEqual(await alerts(p), []);
  });

  it('a monthly plan alerts only for the payment that is close, and a late one is overdue', async () => {
    const p = await person();
    ok(await p.client.post('/debts', debtBody({ total_amount: 90, plan: 'monthly', installment_count: 3, first_due_date: daysFromToday(-2) })), 201);
    await scan(p);
    const found = await alerts(p);
    assert.deepEqual(found.map((n) => n.kind), ['payment_overdue'], 'the first is two days late; the next ones are a month away');
  });
});

describe('two debt payments at the same moment', () => {
  it('cannot together pay more than is owed', async () => {
    const p = await signup(srv);
    const d = ok(await p.client.post('/debts', debtBody({ total_amount: 300 })), 201);
    const results = await Promise.all([p.client.post(`/debts/${d.id}/payments`, { amount: 200 }), p.client.post(`/debts/${d.id}/payments`, { amount: 200 })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400], 'one goes through, the other is told there is not enough owed');
    const now = ok(await p.client.get('/debts')).debts[0];
    assert.deepEqual([now.paid, now.remaining], [200, 100]);
    const paidRows = ok(await p.client.get('/transactions?from=2000-01-01&to=2100-01-01&status=paid')).filter((t) => t.debt_id === d.id);
    assert.equal(paidRows.length, 1);
  });

  it('many at once still never go past the total', async () => {
    const p = await signup(srv);
    const d = ok(await p.client.post('/debts', debtBody({ total_amount: 100 })), 201);
    const results = await Promise.all(Array.from({ length: 8 }, () => p.client.post(`/debts/${d.id}/payments`, { amount: 30 })));
    const accepted = results.filter((r) => r.status === 201).length;
    assert.equal(accepted, 3, 'three of 30 fit in 100');
    const now = ok(await p.client.get('/debts')).debts[0];
    assert.deepEqual([now.paid, now.remaining], [90, 10]);
  });
});

describe('shared budgets', () => {
  it('a debt can be handed to another member, and its payments follow', async () => {
    const { owner, member } = await household();
    const d = ok(await owner.client.post('/debts', debtBody({ plan: 'once', first_due_date: `${NEXT}-10`, paid_by: owner.user.username })), 201);
    const changed = ok(await owner.client.put(`/debts/${d.id}`, debtBody({ plan: 'once', first_due_date: `${NEXT}-10`, paid_by: member.user.username })));
    assert.equal(changed.member_username, member.user.username);
    const [t] = ok(await owner.client.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((x) => x.debt_id === d.id);
    assert.equal(t.member_username, member.user.username);
    const left = ok(await owner.client.put(`/debts/${d.id}`, debtBody({ plan: 'once', first_due_date: `${NEXT}-10` })));
    assert.equal(left.member_username, member.user.username, 'leaving it out keeps the member');
  });

  it('deleting the shared budget takes its debts, card payments and repayments with it, and nothing else', async () => {
    const { owner, g } = await household();
    ok(await owner.client.post('/debts', debtBody({ plan: 'monthly', installment_count: 3, first_due_date: `${NEXT}-10` })), 201);
    ok(await tx(owner.client, { description: 'Card sofa', date: `${NEXT}-10`, pay_method: 'credit_card', charged_on: `${thisMonth()}-01` }), 201);
    const personal = { ...owner.client, ws: null };
    owner.client.ws = null;
    const mine = ok(await tx(owner.client, { description: 'Personal item' }), 201);
    owner.client.ws = g.id;
    assert.equal((await owner.client.del(`/workspaces/${g.id}`)).status, 204);
    const left = await srv.db.query('SELECT (SELECT count(*)::int FROM debts WHERE workspace_id = $1) AS debts, (SELECT count(*)::int FROM transactions WHERE workspace_id = $1) AS tx', [g.id]);
    assert.deepEqual(left.rows[0], { debts: 0, tx: 0 });
    owner.client.ws = null;
    assert.ok(ok(await owner.client.get('/transactions?status=')).some((t) => t.id === mine.id), 'the personal budget is untouched');
    assert.ok(personal);
  });

  it('a credit card payment can be shared with a connection, and keeps its card details', async () => {
    const a = await person();
    const b = await person();
    await connect(a, b);
    const t = ok(await tx(a.client, { description: 'Dinner', amount: 80, date: `${NEXT}-10`, pay_method: 'credit_card', charged_on: `${thisMonth()}-02`, participants: [{ username: b.user.username, share: 40 }] }), 201);
    assert.deepEqual([t.pay_method, t.charged_on, t.participants.map((p) => [p.username, p.share])], ['credit_card', `${thisMonth()}-02`, [[b.user.username, 40]]]);
    const edited = ok(await a.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'Dinner', amount: 90, date: `${NEXT}-10`, category_id: null }));
    assert.deepEqual([edited.pay_method, edited.charged_on, edited.participants.length], ['credit_card', `${thisMonth()}-02`, 1], 'an edit that does not mention them keeps both');
  });
});

describe('saved preferences know about the Debts page', () => {
  it('lets it be a favourite, and still refuses pages that do not exist', async () => {
    const p = await signup(srv);
    assert.deepEqual(ok(await p.client.put('/preferences', { favorites: ['debts', 'forecast'] })).favorites, ['debts', 'forecast']);
    assert.deepEqual(ok(await p.client.get('/preferences')).favorites, ['debts', 'forecast']);
    fails(await p.client.put('/preferences', { favorites: ['loans'] }), 400);
    fails(await p.client.put('/preferences', { favorites: ['debts', 'debts'] }), 400);
  });
});

describe('recurring endings meet the rest of the schedule', () => {
  const rule = (c, over = {}) => c.post('/recurring', { type: 'expense', description: 'Gym', amount: 30, frequency: 'monthly', start_date: `${NEXT}-10`, ...over });

  it('an ending that is already in the past creates nothing to come, and does not fail', async () => {
    const c = (await signup(srv)).client;
    const r = ok(await rule(c, { start_date: '2020-01-15', ends_after: 3 }), 201);
    assert.equal(r.end_date, '2020-03-15');
    assert.equal(ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === r.id).length, 0);
  });

  it('a paused item still gets its end date worked out, and keeps it when resumed', async () => {
    const c = (await signup(srv)).client;
    const r = ok(await rule(c, { ends_after: 2, active: false }), 201);
    assert.equal(r.end_date, `${addMonthsYM(NEXT, 1)}-10`);
    assert.equal(ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === r.id).length, 0, 'paused: nothing created');
    ok(await c.put(`/recurring/${r.id}`, { type: 'expense', description: 'Gym', amount: 30, frequency: 'monthly', start_date: `${NEXT}-10`, end_date: r.end_date, active: true }));
    assert.equal(ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === r.id).length, 2);
  });

  it('in a shared budget it records whose it is, and the ending still applies', async () => {
    const { owner, member } = await household();
    const r = ok(await rule(owner.client, { type: 'income', description: 'Mo salary', amount: 1500, ends_after: 3, paid_by: member.user.username }), 201);
    assert.equal(r.member_username, member.user.username);
    const rows = ok(await owner.client.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === r.id);
    assert.deepEqual([rows.length, rows[0].member_username], [3, member.user.username]);
  });
});

describe('signing in: odd things people type', () => {
  const login = (body) => new Client(srv.base.replace(/\/api$/, '')).post('/auth/login', body);

  it('a lone @, emoji, very long text and an SQL-looking name are just names that do not exist', async () => {
    for (const identifier of ['@', '😀', 'ß', 'a'.repeat(254), "x'; --", '日本語']) {
      const r = await login({ identifier, password: PW });
      assert.equal(r.status, 401, identifier.slice(0, 20));
    }
  });

  it('when both fields are sent, the new one wins, so the old one cannot be used to get around it', async () => {
    const p = await signup(srv);
    const wrongFirst = await login({ identifier: `nobody${Date.now()}`, email: p.body.email, password: PW });
    assert.equal(wrongFirst.status, 401);
    const rightFirst = await login({ identifier: p.user.username, email: `nobody${Date.now()}@example.com`, password: PW });
    assert.equal(rightFirst.status, 200);
  });
});
