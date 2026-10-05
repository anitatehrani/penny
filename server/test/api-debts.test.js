import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, connect, fails, ok, shutdown, signup, startServer, thisMonth, today } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('debts');
});
after(async () => {
  await shutdown(srv);
});

const M = thisMonth();
const NEXT = addMonthsYM(M, 1);
const fresh = async () => (await signup(srv)).client;
const debt = (c, over = {}) => c.post('/debts', { name: 'Faeze', total_amount: 300, plan: 'none', ...over });
const once = (c, over = {}) => debt(c, { plan: 'once', first_due_date: `${NEXT}-10`, ...over });
const monthly = (c, count = 3, over = {}) => debt(c, { plan: 'monthly', first_due_date: `${NEXT}-10`, installment_count: count, ...over });
const payments = async (c, id) => ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.debt_id === id);
const get = async (c, id) => ok(await c.get('/debts')).debts.find((d) => d.id === id);

describe('adding a debt that is not scheduled yet', () => {
  it('just sits on file: owed, nothing paid, no payments created', async () => {
    const c = await fresh();
    const d = ok(await debt(c, { note: 'for the flights' }), 201);
    assert.deepEqual([d.name, d.total_amount, d.plan, d.status, d.paid, d.remaining, d.scheduled_count, d.next_due, d.count_in_budget], ['Faeze', 300, 'none', 'active', 0, 300, 0, null, true]);
    assert.equal(d.note, 'for the flights');
    assert.deepEqual(await payments(c, d.id), []);
    assert.equal(ok(await c.get('/transactions?status=')).length, 0, 'the Payments list is untouched');
  });

  it('does not touch the balance or the forecast, whether counted or not', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await debt(c, { count_in_budget: true }), 201);
    ok(await debt(c, { name: 'Romena', total_amount: 520, count_in_budget: false }), 201);
    assert.equal(ok(await c.get('/summary')).balance, 1000);
    const f = ok(await c.get('/forecast?past=0&months=3&estimateExpenses=0'));
    assert.ok(f.months.every((m) => m.endBalance === 1000));
  });
});

describe('paying a debt completely in one month', () => {
  it('creates one pending payment for the whole amount on the chosen day', async () => {
    const c = await fresh();
    const d = ok(await once(c), 201);
    const p = await payments(c, d.id);
    assert.equal(p.length, 1);
    assert.deepEqual([p[0].description, p[0].amount, p[0].date, p[0].status, p[0].source, p[0].type], ['Repay Faeze', 300, `${NEXT}-10`, 'pending', 'debt', 'expense']);
    assert.deepEqual([d.scheduled_count, d.scheduled_total, d.next_due, d.next_amount], [1, 300, `${NEXT}-10`, 300]);
  });

  it('counts in the forecast in that month and not before', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await once(c), 201);
    const f = ok(await c.get('/forecast?past=0&months=3&estimateExpenses=0'));
    const by = Object.fromEntries(f.months.map((m) => [m.month, m.endBalance]));
    assert.equal(by[M], 1000);
    assert.equal(by[NEXT], 700);
    assert.equal(ok(await c.get(`/summary?month=${NEXT}`)).totals.expensePending, 300);
  });
});

describe('splitting a debt over months', () => {
  it('makes equal monthly payments on the same day, with the odd cents on the first ones', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3, { total_amount: 100 }), 201);
    const p = (await payments(c, d.id)).sort((a, b) => a.date.localeCompare(b.date));
    assert.deepEqual(p.map((x) => x.amount), [33.34, 33.33, 33.33]);
    assert.deepEqual(p.map((x) => x.date), [`${NEXT}-10`, `${addMonthsYM(NEXT, 1)}-10`, `${addMonthsYM(NEXT, 2)}-10`]);
    assert.deepEqual(p.map((x) => x.description), ['Repay Faeze (1/3)', 'Repay Faeze (2/3)', 'Repay Faeze (3/3)']);
    assert.equal(Math.round(p.reduce((t, x) => t + x.amount, 0) * 100), 10000);
    assert.deepEqual([d.scheduled_count, d.scheduled_total, d.next_due, d.next_amount], [3, 100, `${NEXT}-10`, 33.34]);
  });

  it('keeps the day of the month, and shortens it in short months', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3, { first_due_date: '2031-01-31' }), 201);
    const dates = (await payments(c, d.id)).map((x) => x.date).sort();
    assert.deepEqual(dates, ['2031-01-31', '2031-02-28', '2031-03-31']);
  });

  it('never makes a payment of nothing when very little is left', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 5, { total_amount: 0.03 }), 201);
    const p = await payments(c, d.id);
    assert.deepEqual(p.map((x) => x.amount).sort(), [0.01, 0.01, 0.01]);
  });

  it('supports the smallest and largest plans, and nothing outside them', async () => {
    const c = await fresh();
    assert.equal((await payments(c, ok(await monthly(c, 2), 201).id)).length, 2);
    assert.equal((await payments(c, ok(await monthly(c, 120, { total_amount: 1200 }), 201).id)).length, 120);
    for (const n of [1, 0, 121, -3, 2.5, '3', null, 'x']) fails(await monthly(c, n), 400);
  });
});

describe('counting a debt in the budget, or not', () => {
  it('"not counted" remembers the plan but creates no payments, so the forecast is unchanged', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const d = ok(await monthly(c, 3, { count_in_budget: false }), 201);
    assert.deepEqual([d.plan, d.installment_count, d.first_due_date, d.count_in_budget], ['monthly', 3, `${NEXT}-10`, false]);
    assert.deepEqual([d.scheduled_count, d.next_due], [0, null]);
    assert.deepEqual(await payments(c, d.id), []);
    const f = ok(await c.get('/forecast?past=0&months=4&estimateExpenses=0'));
    assert.ok(f.months.every((m) => m.endBalance === 1000));
  });

  it('turning it on creates the payments, turning it off removes the unpaid ones and keeps what was paid', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3, { count_in_budget: false }), 201);
    const body = { name: 'Faeze', total_amount: 300, plan: 'monthly', first_due_date: `${NEXT}-10`, installment_count: 3 };
    const on = ok(await c.put(`/debts/${d.id}`, { ...body, count_in_budget: true }));
    assert.equal(on.scheduled_count, 3);
    const first = (await payments(c, d.id)).sort((a, b) => a.date.localeCompare(b.date))[0];
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    const off = ok(await c.put(`/debts/${d.id}`, { ...body, count_in_budget: false }));
    assert.deepEqual([off.paid, off.remaining, off.scheduled_count, off.count_in_budget], [100, 200, 0, false]);
    assert.deepEqual((await payments(c, d.id)).map((x) => x.status), ['paid'], 'the paid one stays');
    const back = ok(await c.put(`/debts/${d.id}`, { ...body, count_in_budget: true }));
    assert.deepEqual([back.scheduled_count, back.scheduled_total], [3, 200], 'three payments again, now sharing the 200 that is left');
  });

  it('is on unless said otherwise', async () => {
    const c = await fresh();
    assert.equal(ok(await once(c), 201).count_in_budget, true);
  });

  it('the totals separate what is owed, what is counted and what is scheduled', async () => {
    const c = await fresh();
    ok(await once(c, { name: 'A', total_amount: 100 }), 201);
    ok(await debt(c, { name: 'B', total_amount: 200 }), 201);
    ok(await monthly(c, 2, { name: 'C', total_amount: 400, count_in_budget: false }), 201);
    const { totals } = ok(await c.get('/debts'));
    assert.deepEqual(totals, { owed: 700, counted: 300, scheduled: 100, paid: 0 });
  });
});

describe('what happens as payments are made', () => {
  it('marking a scheduled payment paid reduces what is owed, and the last one settles the debt', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 2, { total_amount: 200 }), 201);
    const [a, b] = (await payments(c, d.id)).sort((x, y) => x.date.localeCompare(y.date));
    ok(await c.patch(`/transactions/${a.id}/status`, { status: 'paid' }));
    let now = await get(c, d.id);
    assert.deepEqual([now.paid, now.remaining, now.status, now.scheduled_count], [100, 100, 'active', 1]);
    ok(await c.patch(`/transactions/${b.id}/status`, { status: 'paid' }));
    now = await get(c, d.id);
    assert.deepEqual([now.paid, now.remaining, now.status, now.next_due], [200, 0, 'settled', null]);
  });

  it('recording an extra payment: money out now, and the rest of the schedule shrinks to match', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const d = ok(await monthly(c, 3), 201);
    const r = ok(await c.post(`/debts/${d.id}/payments`, { amount: 60 }), 201);
    assert.deepEqual([r.payment.description, r.payment.amount, r.payment.date, r.payment.status], ['Payment to Faeze', 60, today(), 'paid']);
    assert.deepEqual([r.debt.paid, r.debt.remaining, r.debt.scheduled_count, r.debt.scheduled_total], [60, 240, 3, 240]);
    assert.deepEqual((await payments(c, d.id)).filter((t) => t.status === 'pending').map((t) => t.amount), [80, 80, 80]);
    assert.equal(ok(await c.get('/summary')).balance, 940, 'it is real money out');
  });

  it('a big extra payment drops the payments that are no longer needed, and the debt settles when nothing is left', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3), 201);
    const half = ok(await c.post(`/debts/${d.id}/payments`, { amount: 250 }), 201);
    assert.deepEqual([half.debt.remaining, half.debt.scheduled_count, half.debt.scheduled_total], [50, 3, 50]);
    const rest = ok(await c.post(`/debts/${d.id}/payments`, { amount: 50 }), 201);
    assert.deepEqual([rest.debt.status, rest.debt.remaining, rest.debt.scheduled_count], ['settled', 0, 0]);
    assert.deepEqual((await payments(c, d.id)).map((t) => t.status).sort(), ['paid', 'paid']);
  });

  it('on a debt with no plan it only records the payment', async () => {
    const c = await fresh();
    const d = ok(await debt(c), 201);
    const r = ok(await c.post(`/debts/${d.id}/payments`, { amount: 100, date: '2025-03-04', note: 'cash' }), 201);
    assert.deepEqual([r.debt.paid, r.debt.remaining, r.payment.date], [100, 200, '2025-03-04']);
  });

  it('refuses a payment that is more than what is owed, nothing, a bad date, or one on a settled debt', async () => {
    const c = await fresh();
    const d = ok(await debt(c), 201);
    assert.match(fails(await c.post(`/debts/${d.id}/payments`, { amount: 300.01 }), 400).error, /more than what is still owed/);
    for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: 'x' }, {}, { amount: 5, date: '2025-02-30' }, { amount: 5, date: 'soon' }]) fails(await c.post(`/debts/${d.id}/payments`, bad), 400);
    ok(await c.post(`/debts/${d.id}/payments`, { amount: 300 }), 201);
    assert.match(fails(await c.post(`/debts/${d.id}/payments`, { amount: 1 }), 400).error, /already settled/);
    assert.equal((await get(c, d.id)).paid, 300, 'none of the bad ones were recorded');
  });

  it('rounds an amount to cents', async () => {
    const c = await fresh();
    const d = ok(await debt(c), 201);
    assert.equal(ok(await c.post(`/debts/${d.id}/payments`, { amount: 10.126 }), 201).payment.amount, 10.13);
  });
});

describe('changing a debt', () => {
  it('editing the plan rebuilds the unpaid payments from what is still owed, and leaves the paid ones', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3), 201);
    const first = (await payments(c, d.id)).sort((a, b) => a.date.localeCompare(b.date))[0];
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    const changed = ok(await c.put(`/debts/${d.id}`, { name: 'Faeze', total_amount: 300, plan: 'once', first_due_date: `${addMonthsYM(NEXT, 4)}-20`, count_in_budget: true }));
    assert.deepEqual([changed.plan, changed.remaining, changed.scheduled_count, changed.scheduled_total, changed.next_due], ['once', 200, 1, 200, `${addMonthsYM(NEXT, 4)}-20`]);
    assert.deepEqual((await payments(c, d.id)).map((t) => [t.status, t.amount]).sort(), [['paid', 100], ['pending', 200]]);
  });

  it('can be renamed, re-amounted and recategorised, and the new payments carry the changes', async () => {
    const c = await fresh();
    const rent = await categoryId(c, 'Rent / Mortgage');
    const d = ok(await once(c), 201);
    const e = ok(await c.put(`/debts/${d.id}`, { name: 'Romena', total_amount: 520, plan: 'once', first_due_date: `${NEXT}-15`, category_id: rent, note: 'trip', count_in_budget: true }));
    assert.deepEqual([e.name, e.total_amount, e.category_id, e.note], ['Romena', 520, rent, 'trip']);
    const [p] = await payments(c, d.id);
    assert.deepEqual([p.description, p.amount, p.date, p.category_id], ['Repay Romena', 520, `${NEXT}-15`, rent]);
  });

  it('lowering the amount below what is paid settles it', async () => {
    const c = await fresh();
    const d = ok(await debt(c), 201);
    ok(await c.post(`/debts/${d.id}/payments`, { amount: 200 }), 201);
    const e = ok(await c.put(`/debts/${d.id}`, { name: 'Faeze', total_amount: 150, plan: 'none' }));
    assert.deepEqual([e.status, e.remaining, e.paid], ['settled', 0, 200]);
  });

  it('can settle by hand, which removes the unpaid payments, and be reopened to bring them back', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3), 201);
    const first = (await payments(c, d.id)).sort((a, b) => a.date.localeCompare(b.date))[0];
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    const settled = ok(await c.post(`/debts/${d.id}/settle`));
    assert.deepEqual([settled.status, settled.remaining, settled.scheduled_count, settled.paid], ['settled', 0, 0, 100]);
    assert.deepEqual((await payments(c, d.id)).map((t) => t.status), ['paid']);
    ok(await c.post(`/debts/${d.id}/settle`)); // twice is harmless
    const reopened = ok(await c.post(`/debts/${d.id}/reopen`));
    assert.deepEqual([reopened.status, reopened.remaining, reopened.scheduled_count, reopened.scheduled_total], ['active', 200, 3, 200]);
  });

  it('deleting removes the unpaid payments and keeps what was paid, now without a debt', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3), 201);
    const first = (await payments(c, d.id)).sort((a, b) => a.date.localeCompare(b.date))[0];
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    assert.equal((await c.del(`/debts/${d.id}`)).status, 204);
    const left = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status='));
    assert.deepEqual(left.map((t) => [t.id, t.status, t.debt_id]), [[first.id, 'paid', null]]);
    assert.equal(ok(await c.get('/debts')).debts.length, 0);
    fails(await c.del(`/debts/${d.id}`), 404);
  });

  it('removing one scheduled payment from the Payments page leaves the debt as it was', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3), 201);
    const [a] = await payments(c, d.id);
    assert.deepEqual(ok(await c.del(`/transactions/${a.id}`)), { deleted: true });
    const now = await get(c, d.id);
    assert.deepEqual([now.remaining, now.scheduled_count], [300, 2], 'still owed in full, one payment fewer');
  });
});

describe('what is accepted', () => {
  it('rejects a plan that does not match its details', async () => {
    const c = await fresh();
    for (const bad of [
      { plan: 'none', first_due_date: `${NEXT}-10` },
      { plan: 'none', installment_count: 3 },
      { plan: 'once' },
      { plan: 'once', first_due_date: `${NEXT}-10`, installment_count: 2 },
      { plan: 'monthly', first_due_date: `${NEXT}-10` },
      { plan: 'monthly', installment_count: 3 },
      { plan: 'weekly' },
      { plan: 'once', first_due_date: 'next month' },
    ]) {
      fails(await debt(c, bad), 400);
    }
    assert.equal(ok(await c.get('/debts')).debts.length, 0, 'none of them were saved');
  });

  it('rejects bad names, amounts and categories', async () => {
    const c = await fresh();
    const other = await fresh();
    const foreign = ok(await other.post('/categories', { name: 'Theirs', kind: 'expense', color: '#112233' }), 201);
    for (const bad of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, { name: 5 }, { total_amount: 0 }, { total_amount: -1 }, { total_amount: 'lots' }, { total_amount: 1e11 }, { total_amount: null }, { count_in_budget: 'yes' }, { category_id: 999999 }, { category_id: foreign.id }, { note: 'n'.repeat(1001) }]) {
      fails(await debt(c, bad), 400);
    }
    fails(await c.post('/debts', { total_amount: 5 }), 400);
  });

  it('trims the name and keeps the note optional', async () => {
    const c = await fresh();
    const d = ok(await debt(c, { name: '  Faeze  ' }), 201);
    assert.deepEqual([d.name, d.note], ['Faeze', null]);
  });
});

describe('the list', () => {
  it('shows active debts with the nearest payment first, and settled ones last', async () => {
    const c = await fresh();
    const later = ok(await once(c, { name: 'Later', first_due_date: `${addMonthsYM(NEXT, 3)}-10` }), 201);
    const soon = ok(await once(c, { name: 'Soon' }), 201);
    const none = ok(await debt(c, { name: 'Anytime' }), 201);
    const done = ok(await debt(c, { name: 'Done' }), 201);
    ok(await c.post(`/debts/${done.id}/settle`));
    assert.deepEqual(ok(await c.get('/debts')).debts.map((d) => d.id), [soon.id, later.id, none.id, done.id]);
  });

  it('is private to the budget: others cannot see, change or pay it', async () => {
    const a = await fresh();
    const b = await fresh();
    const d = ok(await once(a), 201);
    assert.deepEqual(ok(await b.get('/debts')).debts, []);
    const body = { name: 'x', total_amount: 5, plan: 'none' };
    fails(await b.put(`/debts/${d.id}`, body), 404);
    fails(await b.del(`/debts/${d.id}`), 404);
    fails(await b.post(`/debts/${d.id}/payments`, { amount: 1 }), 404);
    fails(await b.post(`/debts/${d.id}/settle`), 404);
    fails(await b.post(`/debts/${d.id}/reopen`), 404);
    assert.equal((await get(a, d.id)).name, 'Faeze');
    assert.equal((await payments(a, d.id)).length, 1, 'its payment is still there');
  });

  it('needs a sign-in', async () => {
    const anon = (await signup(srv)).client;
    anon.jar = {};
    fails(await anon.get('/debts'), 401);
  });
});

describe('in a shared budget', () => {
  /** Owner plus one member who has joined the budget. */
  async function household() {
    const owner = await signup(srv);
    const member = await signup(srv);
    const outsider = await signup(srv);
    await connect(owner, member);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: member.user.username }), 201);
    const inv = ok(await member.client.get('/inbox')).group_invites[0];
    ok(await member.client.post(`/workspace-invites/${inv.id}/accept`));
    owner.client.ws = group.id;
    member.client.ws = group.id;
    outsider.client.ws = group.id;
    return { owner, member, outsider };
  }

  it('both members see it, either can change it, and its payments record who they are for', async () => {
    const { owner, member } = await household();
    const d = ok(await once(owner.client, { paid_by: member.user.username }), 201);
    assert.equal(d.member_username, member.user.username);
    assert.equal(ok(await member.client.get('/debts')).debts.length, 1, 'the other member sees it');
    const [p] = await payments(member.client, d.id);
    assert.equal(p.member_username, member.user.username, 'the repayment is in their name');
    const paid = ok(await member.client.post(`/debts/${d.id}/payments`, { amount: 100 }), 201);
    assert.equal(paid.debt.paid, 100);
    assert.equal((await get(owner.client, d.id)).remaining, 200, 'and the owner sees the change');
  });

  it('only members can be named, and people outside the budget are refused', async () => {
    const { owner, outsider } = await household();
    fails(await once(owner.client, { paid_by: outsider.user.username }), 400);
    fails(await outsider.client.get('/debts'), 403);
    fails(await outsider.client.post('/debts', { name: 'x', total_amount: 5, plan: 'none' }), 403);
  });

  it('keeps the personal budget and the shared budget apart', async () => {
    const { owner } = await household();
    ok(await once(owner.client), 201);
    owner.client.ws = null; // back to the personal budget
    assert.deepEqual(ok(await owner.client.get('/debts')).debts, [], 'nothing leaked into the personal budget');
  });
});

describe('the database', () => {
  it('refuses a plan that does not match its details even if the API is bypassed', async () => {
    const c = await fresh();
    const ws = (await srv.db.query(`SELECT w.id FROM workspaces w JOIN users u ON u.id = w.owner_id ORDER BY w.id DESC LIMIT 1`)).rows[0].id;
    const insert = (plan, due, count) => srv.db.query(`INSERT INTO debts (workspace_id, name, total_amount, plan, first_due_date, installment_count) VALUES ($1, 'x', 5, $2, $3, $4)`, [ws, plan, due, count]);
    await assert.rejects(insert('none', '2031-01-01', null), /debts_plan_consistent/);
    await assert.rejects(insert('once', null, null), /debts_plan_consistent/);
    await assert.rejects(insert('monthly', '2031-01-01', 1), /debts_plan_consistent/);
    await assert.rejects(insert('monthly', '2031-01-01', 121), /debts_plan_consistent/);
    await assert.rejects(insert('weekly', null, null), /violates check constraint/);
    await insert('monthly', '2031-01-01', 2);
    assert.ok(c);
  });

  it('allows debt payments as a source, and running the start-up schema again changes nothing', async () => {
    const c = await fresh();
    const d = ok(await once(c), 201);
    const before = (await payments(c, d.id)).length;
    await srv.db.query(fs.readFileSync(fileURLToPath(new URL('../src/schema.sql', import.meta.url)), 'utf8'));
    await srv.db.query(fs.readFileSync(fileURLToPath(new URL('../src/schema.sql', import.meta.url)), 'utf8'));
    assert.equal((await payments(c, d.id)).length, before);
    const defs = (await srv.db.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'transactions'::regclass AND conname = 'transactions_source_check'`)).rows;
    assert.equal(defs.length, 1);
    assert.match(defs[0].def, /debt/);
  });
});
