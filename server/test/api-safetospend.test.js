import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { safeToSpend } from '../src/lib/safeToSpend.js';
import { daysFromToday, fails, ok, shutdown, signup, startServer, tx } from './helpers.js';

const bill = (date, cents, description = 'Bill') => ({ type: 'expense', date, cents, description });
const pay = (date, cents, description = 'Salary') => ({ type: 'income', date, cents, description });

describe('the safe-to-spend rule', () => {
  const T = '2031-03-10';

  it('runs to the day before the next income, counting the bills in between', () => {
    const r = safeToSpend({ today: T, balanceCents: 100000, pending: [bill('2031-03-15', 20000), pay('2031-03-21', 150000), bill('2031-03-25', 99999)] });
    assert.equal(r.until, '2031-03-20');
    assert.equal(r.until_kind, 'income');
    assert.equal(r.days, 11, '10th to the 20th, both included');
    assert.deepEqual([r.bills, r.bills_count, r.available], [200, 1, 800]);
    assert.equal(r.per_day, 72.72, '800 over 11 days, rounded down');
    assert.deepEqual(r.next_income, { date: '2031-03-21', description: 'Salary', amount: 1500 });
    assert.equal(r.short, 0);
  });

  it('keeps the safety buffer out of what can be spent', () => {
    const r = safeToSpend({ today: T, balanceCents: 100000, bufferCents: 30000, pending: [pay('2031-03-21', 1)] });
    assert.deepEqual([r.buffer, r.available, r.per_day], [300, 700, 63.63]);
  });

  it('counts overdue bills, since they still have to be paid', () => {
    const r = safeToSpend({ today: T, balanceCents: 50000, pending: [bill('2031-03-01', 12000, 'Late rent'), pay('2031-03-20', 1)] });
    assert.deepEqual([r.bills, r.available], [120, 380]);
  });

  it('says how much is short, and offers no allowance, when the bills are more than the money', () => {
    const r = safeToSpend({ today: T, balanceCents: 10000, pending: [bill('2031-03-12', 25000), pay('2031-03-20', 1)] });
    assert.deepEqual([r.per_day, r.short, r.available], [0, 150, -150]);
  });

  it('is nothing to spend, and nothing short, when it comes out exactly even', () => {
    const r = safeToSpend({ today: T, balanceCents: 25000, pending: [bill('2031-03-12', 25000), pay('2031-03-20', 1)] });
    assert.deepEqual([r.per_day, r.short, r.available], [0, 0, 0]);
  });

  it('does not count an income that is still pending today or earlier as money you have, nor as the next income', () => {
    const r = safeToSpend({ today: T, balanceCents: 50000, pending: [pay('2031-03-10', 100000, 'Late salary'), pay('2031-03-05', 100000), pay('2031-03-20', 1, 'Next')] });
    assert.equal(r.next_income.description, 'Next');
    assert.equal(r.balance, 500);
    assert.equal(r.available, 500, 'the late income adds nothing');
  });

  it('takes the earliest of several incomes', () => {
    const r = safeToSpend({ today: T, balanceCents: 1, pending: [pay('2031-03-30', 1, 'Later'), pay('2031-03-18', 1, 'Sooner')] });
    assert.equal(r.next_income.description, 'Sooner');
    assert.equal(r.until, '2031-03-17');
  });

  it('is one day when the next income is tomorrow, and still one day when it is today the last day of the month', () => {
    assert.equal(safeToSpend({ today: T, balanceCents: 1000, pending: [pay('2031-03-11', 1)] }).days, 1);
    const last = safeToSpend({ today: '2031-03-31', balanceCents: 3100, pending: [] });
    assert.deepEqual([last.until, last.days, last.per_day], ['2031-03-31', 1, 31]);
  });

  it('runs to the end of the month when no income is due in the next 62 days', () => {
    const r = safeToSpend({ today: T, balanceCents: 31000, pending: [pay('2031-06-01', 1), bill('2031-03-20', 1000)] });
    assert.deepEqual([r.until_kind, r.until, r.days, r.next_income], ['month-end', '2031-03-31', 22, null]);
    assert.equal(r.per_day, 13.63, '300 over 22 days');
    assert.equal(safeToSpend({ today: T, balanceCents: 1, pending: [pay('2031-05-11', 1)] }).until_kind, 'income', '62 days is still the next income');
    assert.equal(safeToSpend({ today: T, balanceCents: 1, pending: [pay('2031-05-12', 1)] }).until_kind, 'month-end', '63 is not');
  });

  it('ignores bills after the day it runs to, and bills that are not expenses', () => {
    const r = safeToSpend({ today: T, balanceCents: 100000, pending: [pay('2031-03-20', 1), bill('2031-03-20', 5000), bill('2031-03-19', 7000)] });
    assert.deepEqual([r.bills, r.bills_count], [70, 1], 'the bill on the income day is after "until"');
  });

  it('works with a negative balance, and rounds down so the days never add up to more than there is', () => {
    const neg = safeToSpend({ today: T, balanceCents: -5000, pending: [pay('2031-03-20', 1)] });
    assert.deepEqual([neg.per_day, neg.short], [0, 50]);
    const r = safeToSpend({ today: T, balanceCents: 1000, pending: [pay('2031-03-13', 1)] });
    assert.equal(r.days, 3);
    assert.ok(r.per_day * 3 <= 10, '3.33 a day would be 9.99 or less');
    assert.equal(r.per_day, 3.33);
  });
});

let srv;
before(async () => {
  srv = await startServer('safetospend');
});
after(async () => {
  await shutdown(srv);
});
const fresh = async () => (await signup(srv)).client;
const get = async (c) => ok(await c.get('/safe-to-spend'));

describe('GET /api/safe-to-spend', () => {
  it('works out the allowance from the balance, the bills before the next income, and the buffer', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR', min_balance: 100 }));
    await tx(c, { description: 'Rent', amount: 300, date: daysFromToday(5), status: 'pending' });
    await tx(c, { type: 'income', description: 'Salary', amount: 2000, date: daysFromToday(11), status: 'pending' });
    await tx(c, { description: 'After pay', amount: 999, date: daysFromToday(12), status: 'pending' });
    const r = await get(c);
    assert.deepEqual([r.balance, r.bills, r.bills_count, r.buffer, r.available], [1000, 300, 1, 100, 600]);
    assert.equal(r.days, 11);
    assert.equal(r.per_day, 54.54);
    assert.equal(r.until_kind, 'income');
    assert.equal(r.next_income.description, 'Salary');
    assert.equal(r.next_income.amount, 2000);
  });

  it('counts only what is marked paid in the balance, like everywhere else', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 100, currency: 'EUR' }));
    await tx(c, { type: 'income', description: 'Received', amount: 400, date: daysFromToday(-2), status: 'paid' });
    await tx(c, { description: 'Paid', amount: 50, date: daysFromToday(-1), status: 'paid' });
    await tx(c, { type: 'income', description: 'Not yet', amount: 5000, date: daysFromToday(-1), status: 'pending' });
    const r = await get(c);
    assert.equal(r.balance, 450);
    assert.equal(ok(await c.get('/summary')).balance, 450, 'the same figure as the balance card');
  });

  it('counts an overdue bill, and says how much is short when there is not enough', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 50, currency: 'EUR' }));
    await tx(c, { description: 'Late', amount: 120, date: daysFromToday(-3), status: 'pending' });
    const r = await get(c);
    assert.deepEqual([r.bills, r.per_day, r.short], [120, 0, 70]);
  });

  it('is a plain end-of-month allowance with nothing planned', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 300, currency: 'EUR' }));
    const r = await get(c);
    assert.equal(r.until_kind, 'month-end');
    assert.equal(r.next_income, null);
    assert.ok(r.days >= 1 && r.days <= 31);
    assert.equal(r.bills, 0);
    assert.ok(r.per_day * r.days <= 300 + 0.001);
  });

  it('keeps budgets apart, and needs a signed-in person', async () => {
    const a = await fresh();
    const b = await fresh();
    ok(await a.put('/settings', { opening_balance: 900, currency: 'EUR' }));
    assert.equal((await get(b)).balance, 0);
    const anon = new (a.constructor)(a.root);
    fails(await anon.get('/safe-to-spend'), 401);
  });
});
