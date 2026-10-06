import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { daysFromToday, fails, ok, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('lent');
});
after(async () => {
  await shutdown(srv);
});

const NEXT = addMonthsYM(thisMonth(), 1);
const fresh = async () => (await signup(srv)).client;
const lent = (c, over = {}) => c.post('/debts', { name: 'Sam', total_amount: 300, plan: 'none', direction: 'lent', ...over });
const owe = (c, over = {}) => c.post('/debts', { name: 'Faeze', total_amount: 100, plan: 'none', ...over });
const monthly = (c, count = 3, over = {}) => lent(c, { plan: 'monthly', first_due_date: `${NEXT}-10`, installment_count: count, ...over });
const all = async (c) => ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status='));
const mine = async (c, id) => (await all(c)).filter((t) => t.debt_id === id);
const balance = async (c) => ok(await c.get('/summary')).balance;

describe('adding money someone owes you', () => {
  it('is a debt with the direction "lent", and "owe" is what everything was before', async () => {
    const c = await fresh();
    const a = ok(await lent(c), 201);
    const b = ok(await owe(c), 201);
    assert.deepEqual([a.direction, a.total_amount, a.remaining, a.status], ['lent', 300, 300, 'active']);
    assert.equal(b.direction, 'owe');
    assert.deepEqual((await all(c)).length, 0, 'nothing planned, nothing created');
  });

  it('refuses a direction that is not one of the two', async () => {
    const c = await fresh();
    fails(await lent(c, { direction: 'gift' }), 400);
  });

  it('the two kinds are never added together: totals is what you owe, lent_totals is what is owed to you', async () => {
    const c = await fresh();
    ok(await owe(c, { total_amount: 100 }), 201);
    ok(await lent(c, { total_amount: 300 }), 201);
    ok(await lent(c, { name: 'Lia', total_amount: 50, count_in_budget: false }), 201);
    const r = ok(await c.get('/debts'));
    assert.deepEqual(r.totals, { owed: 100, counted: 100, scheduled: 0, paid: 0 });
    assert.deepEqual(r.lent_totals, { owed_to_me: 350, counted: 300, expected: 0, received: 0 });
  });
});

describe('planned repayments to you', () => {
  it('are pending INCOME dated in the plan, named after who pays', async () => {
    const c = await fresh();
    const d = ok(await monthly(c), 201);
    const p = (await mine(c, d.id)).sort((x, y) => x.date.localeCompare(y.date));
    assert.deepEqual(p.map((t) => [t.type, t.amount, t.status, t.source, t.description]), [
      ['income', 100, 'pending', 'debt', 'Repayment from Sam (1/3)'],
      ['income', 100, 'pending', 'debt', 'Repayment from Sam (2/3)'],
      ['income', 100, 'pending', 'debt', 'Repayment from Sam (3/3)'],
    ]);
    assert.deepEqual([d.scheduled_count, d.scheduled_total, d.next_due], [3, 300, `${NEXT}-10`]);
  });

  it('one payment of everything when it is all in one month, and a single one is not numbered', async () => {
    const c = await fresh();
    const d = ok(await lent(c, { plan: 'once', first_due_date: `${NEXT}-10` }), 201);
    const p = await mine(c, d.id);
    assert.deepEqual(p.map((t) => [t.type, t.amount, t.description]), [['income', 300, 'Repayment from Sam']]);
  });

  it('add to the forecast as money coming in, in the month they fall', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await monthly(c), 201);
    const f = ok(await c.get('/forecast?past=0&months=4&estimateExpenses=0'));
    const end = Object.fromEntries(f.months.map((m) => [m.month, m.endBalance]));
    assert.equal(end[NEXT], 1100);
    assert.equal(end[addMonthsYM(NEXT, 2)], 1300);
  });

  it('are left out when it is not counted in the budget, and appear when it is turned on', async () => {
    const c = await fresh();
    const d = ok(await monthly(c, 3, { count_in_budget: false }), 201);
    assert.equal((await mine(c, d.id)).length, 0);
    const on = ok(await c.put(`/debts/${d.id}`, { name: 'Sam', total_amount: 300, plan: 'monthly', first_due_date: `${NEXT}-10`, installment_count: 3, count_in_budget: true, direction: 'lent' }));
    assert.equal(on.scheduled_count, 3);
    assert.ok((await mine(c, d.id)).every((t) => t.type === 'income'));
  });

  it('marking one received adds it to the balance and lowers what is owed to you', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 500, currency: 'EUR' }));
    const d = ok(await monthly(c), 201);
    const [a] = (await mine(c, d.id)).sort((x, y) => x.date.localeCompare(y.date));
    ok(await c.patch(`/transactions/${a.id}/status`, { status: 'paid' }));
    assert.equal(await balance(c), 600);
    const now = ok(await c.get('/debts'));
    assert.deepEqual([now.debts[0].paid, now.debts[0].remaining], [100, 200]);
    assert.deepEqual(now.lent_totals, { owed_to_me: 200, counted: 200, expected: 200, received: 100 });
  });
});

describe('receiving a repayment by hand', () => {
  it('records paid income, and the planned ones shrink to match', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 500, currency: 'EUR' }));
    const d = ok(await monthly(c), 201);
    const r = ok(await c.post(`/debts/${d.id}/payments`, { amount: 60 }), 201);
    assert.deepEqual([r.payment.description, r.payment.amount, r.payment.date, r.payment.status], ['Payment from Sam', 60, today(), 'paid']);
    assert.deepEqual([r.debt.paid, r.debt.remaining, r.debt.scheduled_total], [60, 240, 240]);
    const paid = (await mine(c, d.id)).find((t) => t.status === 'paid');
    assert.deepEqual([paid.type, paid.source], ['income', 'debt']);
    assert.equal(await balance(c), 560, 'money in, not out');
  });

  it('cannot be more than what is still owed to you, and the last bit settles it', async () => {
    const c = await fresh();
    const d = ok(await lent(c, { total_amount: 100 }), 201);
    const over = fails(await c.post(`/debts/${d.id}/payments`, { amount: 100.01 }), 400);
    assert.match(over.error ?? over.message ?? JSON.stringify(over), /more than what is still owed to you/);
    ok(await c.post(`/debts/${d.id}/payments`, { amount: 100 }), 201);
    const now = ok(await c.get('/debts')).debts[0];
    assert.deepEqual([now.status, now.remaining], ['settled', 0]);
    fails(await c.post(`/debts/${d.id}/payments`, { amount: 1 }), 400);
  });

  it('two at the same moment cannot both fit', async () => {
    const c = await fresh();
    const d = ok(await lent(c, { total_amount: 100 }), 201);
    const rs = await Promise.all([1, 2, 3].map(() => c.post(`/debts/${d.id}/payments`, { amount: 60 })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal(ok(await c.get('/debts')).debts[0].paid, 60);
  });

  it('settling by hand removes what was planned and keeps what was received', async () => {
    const c = await fresh();
    const d = ok(await monthly(c), 201);
    ok(await c.post(`/debts/${d.id}/payments`, { amount: 40 }), 201);
    const s = ok(await c.post(`/debts/${d.id}/settle`));
    assert.deepEqual([s.status, s.paid, s.scheduled_count], ['settled', 40, 0]);
    assert.equal((await mine(c, d.id)).length, 1);
    const back = ok(await c.post(`/debts/${d.id}/reopen`));
    assert.deepEqual([back.status, back.remaining, back.scheduled_count], ['active', 260, 3]);
  });

  it('deleting it removes the unpaid repayments and keeps the ones already received', async () => {
    const c = await fresh();
    const d = ok(await monthly(c), 201);
    ok(await c.post(`/debts/${d.id}/payments`, { amount: 40 }), 201);
    assert.equal((await c.del(`/debts/${d.id}`)).status, 204);
    const left = await all(c);
    assert.deepEqual(left.map((t) => [t.type, t.amount, t.status]), [['income', 40, 'paid']]);
  });
});

describe('the direction is fixed once it is chosen', () => {
  it('editing keeps it, and trying to turn it round is refused', async () => {
    const c = await fresh();
    const d = ok(await lent(c), 201);
    const body = { name: 'Samuel', total_amount: 350, plan: 'none' };
    const same = ok(await c.put(`/debts/${d.id}`, { ...body, direction: 'lent' }));
    assert.deepEqual([same.name, same.total_amount, same.direction], ['Samuel', 350, 'lent']);
    const without = ok(await c.put(`/debts/${d.id}`, body));
    assert.equal(without.direction, 'lent', 'an edit that does not say keeps it');
    fails(await c.put(`/debts/${d.id}`, { ...body, direction: 'owe' }), 400);
    assert.equal(ok(await c.get('/debts')).debts[0].direction, 'lent');
  });
});

describe('the money handed over', () => {
  it('is not recorded unless asked, because an old loan is already in the balance', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await lent(c), 201);
    assert.equal(await balance(c), 1000);
    assert.equal((await all(c)).length, 0);
  });

  it('adds one paid expense on the day, source "loan", not linked to the debt', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const d = ok(await lent(c, { record_loan: true, lent_on: daysFromToday(-3) }), 201);
    const rows = await all(c);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].type, rows[0].description, rows[0].amount, rows[0].date, rows[0].status, rows[0].source, rows[0].debt_id], ['expense', 'Lent to Sam', 300, daysFromToday(-3), 'paid', 'loan', null]);
    assert.equal(await balance(c), 700);
    assert.deepEqual([d.paid, d.remaining], [0, 300], 'it does not count as a repayment');
  });

  it('defaults to today', async () => {
    const c = await fresh();
    ok(await lent(c, { record_loan: true }), 201);
    assert.equal((await all(c))[0].date, today());
  });

  it('only makes sense for money you lent, and only when adding', async () => {
    const c = await fresh();
    fails(await owe(c, { record_loan: true }), 400);
    fails(await lent(c, { lent_on: today() }), 400);
    const d = ok(await lent(c), 201);
    fails(await c.put(`/debts/${d.id}`, { name: 'Sam', total_amount: 300, plan: 'none', record_loan: true }), 400);
    assert.equal((await all(c)).length, 0, 'nothing was added by the refused requests');
  });

  it('deleting the debt leaves it as history, like any payment made', async () => {
    const c = await fresh();
    const d = ok(await lent(c, { record_loan: true }), 201);
    assert.equal((await c.del(`/debts/${d.id}`)).status, 204);
    assert.deepEqual((await all(c)).map((t) => t.source), ['loan']);
  });
});

describe('what is money in the balance but not earnings or spending', () => {
  it('a repayment received counts in the balance and the month, but not in the income insights or the assistant', async () => {
    const c = await fresh();
    ok(await tx(c, { type: 'income', description: 'Salary', amount: 1000 }), 201);
    const d = ok(await lent(c, { total_amount: 400 }), 201);
    ok(await c.post(`/debts/${d.id}/payments`, { amount: 400 }), 201);
    assert.equal(ok(await c.get('/summary')).totals.incomePaid, 1400, 'in the month figures: it is money in');
    const a = ok(await c.post('/assistant/ask', { question: 'How much income do I have this month?' }));
    assert.match(a.answer, /expect \D1,000 in income, \D1,000 of it already received/, a.answer);
    assert.doesNotMatch(a.answer, /1,400|1400/, 'the friend paying back is not income');
  });

  it('the money you handed over is not spending: not in the categories, the estimate or the assistant', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await lent(c, { record_loan: true }), 201);
    const s = ok(await c.get('/summary'));
    assert.equal(s.totals.expensePaid, 300, 'it is money out this month');
    assert.deepEqual(s.byCategory, []);
    const f = ok(await c.get('/forecast?past=0&months=3&estimateExpenses=1'));
    assert.equal(f.estimates.expenses, 0);
    const a = ok(await c.post('/assistant/ask', { question: 'How much did I spend on Lent to Sam?' }));
    assert.doesNotMatch(a.answer, /300/);
  });

  it('an expected repayment is not "the next income" for safe to spend, and is not counted on', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await lent(c, { plan: 'once', first_due_date: daysFromToday(5), total_amount: 500 }), 201);
    const s = ok(await c.get('/safe-to-spend'));
    assert.equal(s.next_income, null, 'the friend is not a salary');
    assert.equal(s.until_kind, 'month-end');
    ok(await tx(c, { type: 'income', description: 'Salary', amount: 2000, date: daysFromToday(9), status: 'pending' }), 201);
    const t = ok(await c.get('/safe-to-spend'));
    assert.equal(t.next_income.description, 'Salary');
  });

  it('a debt you owe still behaves exactly as before: money out, in the spending figures', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const d = ok(await owe(c, { total_amount: 100 }), 201);
    const r = ok(await c.post(`/debts/${d.id}/payments`, { amount: 30 }), 201);
    assert.deepEqual([r.payment.description, await balance(c)], ['Payment to Faeze', 970]);
    assert.equal(ok(await c.get('/summary')).totals.expensePaid, 30);
  });
});

describe('budgets with both kinds', () => {
  it('keeps each person budget apart: nobody sees or changes another budget’s lent debt', async () => {
    const a = await fresh();
    const b = await fresh();
    const d = ok(await lent(a), 201);
    assert.deepEqual(ok(await b.get('/debts')).debts, []);
    fails(await b.post(`/debts/${d.id}/payments`, { amount: 10 }), 404);
    fails(await b.put(`/debts/${d.id}`, { name: 'x', total_amount: 5, plan: 'none' }), 404);
  });
});
