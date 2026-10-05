import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { connect, fails, ok, shutdown, signup, startServer, thisMonth, today } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('cardinst');
});
after(async () => {
  await shutdown(srv);
});

const fresh = async () => (await signup(srv)).client;
// bought on 2 December 2031, first bill 10 January 2032, then on the 10th of each month
const plan = (c, over = {}) =>
  c.post('/installments', {
    description: 'Sofa',
    installment_amount: 190,
    installment_count: 6,
    first_due_date: '2032-01-10',
    charged_on: '2031-12-02',
    purchase_amount: 1000,
    category_id: null,
    ...over,
  });
const rows = async (c, month, extra = '') => ok(await c.get(`/transactions?month=${month}${extra}`));

describe('a credit card purchase paid in installments', () => {
  it('makes a plan whose payments are card payments, one per bill, bought on the purchase day', async () => {
    const c = await fresh();
    const p = ok(await plan(c), 201);
    assert.deepEqual([p.total_amount, p.purchase_amount, p.installment_count], [1140, 1000, 6]);
    assert.equal(p.charged_on.slice(0, 10), '2031-12-02');
    const all = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === p.id);
    assert.equal(all.length, 6);
    assert.deepEqual(all.map((t) => t.date), ['2032-01-10', '2032-02-10', '2032-03-10', '2032-04-10', '2032-05-10', '2032-06-10']);
    assert.ok(all.every((t) => t.pay_method === 'credit_card' && t.charged_on === '2031-12-02' && t.amount === 190 && t.source === 'installment'));
  });

  it('counts each installment, with its interest, in the month it is charged', async () => {
    const c = await fresh();
    ok(await plan(c), 201);
    assert.equal(ok(await c.get('/summary?month=2032-01')).totals.expensePending, 190);
    assert.equal(ok(await c.get('/summary?month=2032-04')).totals.expensePending, 190);
    assert.equal(ok(await c.get('/summary?month=2031-12')).totals.expensePending, 0, 'nothing in the purchase month');
  });

  it('lists the purchase once in the purchase month, with the price and the plan, and not the later installments', async () => {
    const c = await fresh();
    ok(await plan(c), 201);
    const dec = await rows(c, '2031-12', '&bought=1');
    assert.equal(dec.length, 1, 'one line, not six');
    assert.equal(dec[0].installment_no, 1);
    assert.equal(dec[0].purchase_only, true);
    assert.equal(dec[0].plan_purchase_amount, 1000);
    assert.equal(dec[0].plan_installment_count, 6);
    const feb = await rows(c, '2032-02', '&bought=1');
    assert.deepEqual(feb.map((t) => t.installment_no), [2]);
    assert.equal(feb[0].purchase_only, false);
  });

  it('a plan with no interest stores the price as the total, and an ordinary plan has no purchase data', async () => {
    const c = await fresh();
    const flat = ok(await plan(c, { installment_amount: undefined, total_amount: 600, installment_count: 3, purchase_amount: undefined }), 201);
    assert.deepEqual([flat.total_amount, flat.purchase_amount], [600, 600]);
    const cash = ok(await c.post('/installments', { description: 'Phone', installment_amount: 50, installment_count: 4, first_due_date: '2032-01-20', category_id: null }), 201);
    assert.deepEqual([cash.purchase_amount, cash.charged_on], [null, null]);
    const cashRows = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === cash.id);
    assert.ok(cashRows.every((t) => t.pay_method === 'cash' && t.charged_on === null));
  });

  it('marks as paid the installments the person says are already paid', async () => {
    const c = await fresh();
    const p = ok(await plan(c, { paid_count: 2 }), 201);
    assert.equal(p.paid_count, 2);
    assert.equal(p.next_due.slice(0, 10), '2032-03-10');
  });

  it('refuses a price above the total (that would be a discount), an installment count outside 2 to 36, and a purchase after its first bill', async () => {
    const c = await fresh();
    fails(await plan(c, { purchase_amount: 1500 }), 400);
    fails(await plan(c, { installment_count: 1 }), 400);
    fails(await plan(c, { installment_count: 37 }), 400);
    fails(await plan(c, { charged_on: '2032-01-11' }), 400);
  });

  it('refuses a purchase price without a card purchase day', async () => {
    const c = await fresh();
    fails(await plan(c, { charged_on: undefined }), 400);
  });

  it('deleting the plan removes the unpaid installments and keeps the paid ones, as any plan', async () => {
    const c = await fresh();
    const p = ok(await plan(c, { paid_count: 1 }), 201);
    assert.equal((await c.del(`/installments/${p.id}`)).status, 204);
    const left = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => /Sofa/.test(t.description));
    assert.deepEqual(left.map((t) => t.installment_no), [1]);
  });

  it('keeps budgets apart: the purchase data of one budget is not on another\'s rows', async () => {
    const a = await fresh();
    const b = await fresh();
    ok(await plan(a), 201);
    assert.deepEqual(await rows(b, '2032-01', '&bought=1'), []);
  });
});

describe('card installments in the balance and the forecast', () => {
  const M = thisMonth();
  const NEXT = addMonthsYM(M, 1);
  const upcoming = (c, over = {}) => plan(c, { installment_amount: 260, installment_count: 4, first_due_date: `${NEXT}-10`, charged_on: today(), purchase_amount: 1000, ...over });

  it('takes each installment off the forecast in the month of its bill, with the interest', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await upcoming(c), 201);
    const f = ok(await c.get('/forecast?past=0&months=5&estimateExpenses=0'));
    const by = Object.fromEntries(f.months.map((m) => [m.month, m.endBalance]));
    assert.deepEqual([by[M], by[NEXT], by[addMonthsYM(M, 2)], by[addMonthsYM(M, 3)], by[addMonthsYM(M, 4)]], [1000, 740, 480, 220, -40]);
  });

  it('lowers the balance only when an installment is marked paid, and puts it back when unmarked', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const p = ok(await upcoming(c), 201);
    const first = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).find((t) => t.installment_plan_id === p.id && t.installment_no === 1);
    assert.equal(ok(await c.get('/summary')).balance, 1000);
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    assert.equal(ok(await c.get('/summary')).balance, 740);
    assert.equal(ok((await c.get('/installments'))).find((x) => x.id === p.id).paid_count, 1);
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'pending' }));
    assert.equal(ok(await c.get('/summary')).balance, 1000);
  });

  it('marks the bills already behind us as paid when the purchase was a while ago', async () => {
    const c = await fresh();
    const p = ok(await plan(c, { installment_amount: 100, installment_count: 3, first_due_date: '2020-02-10', charged_on: '2020-01-15', purchase_amount: 280, paid_count: 3 }), 201);
    assert.equal(p.paid_count, 3);
    assert.equal(p.remaining_count, 0);
    assert.equal(p.next_due, null);
  });
});

describe('editing and validating a card installment plan', () => {
  it('renaming the plan keeps the card details of every installment', async () => {
    const c = await fresh();
    const p = ok(await plan(c), 201);
    ok(await c.put(`/installments/${p.id}`, { description: 'Corner sofa', category_id: null, note: 'from the shop' }));
    const all = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === p.id);
    assert.ok(all.every((t) => /^Corner sofa \(\d\/6\)$/.test(t.description) && t.pay_method === 'credit_card' && t.charged_on === '2031-12-02'));
    const again = ok(await c.get('/installments')).find((x) => x.id === p.id);
    assert.deepEqual([again.purchase_amount, again.total_amount], [1000, 1140], 'the price and total are not editable');
  });

  it('refuses a badly written purchase day or price, and more already-paid installments than there are', async () => {
    const c = await fresh();
    fails(await plan(c, { charged_on: '2/12/2031' }), 400);
    fails(await plan(c, { charged_on: '2031-02-30' }), 400);
    fails(await plan(c, { purchase_amount: 0 }), 400);
    fails(await plan(c, { purchase_amount: -5 }), 400);
    fails(await plan(c, { paid_count: 7 }), 400);
  });

  it('accepts a purchase with no interest at all (the installments add up to the price exactly)', async () => {
    const c = await fresh();
    const p = ok(await plan(c, { installment_amount: 250, installment_count: 4, purchase_amount: 1000 }), 201);
    assert.equal(p.total_amount, p.purchase_amount);
  });

  it('records who it is for in a shared budget', async () => {
    const owner = await signup(srv);
    const mate = await signup(srv);
    await connect(owner, mate);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: mate.user.username }), 201);
    const inv = ok(await mate.client.get('/inbox')).group_invites[0];
    ok(await mate.client.post(`/workspace-invites/${inv.id}/accept`));
    owner.client.ws = group.id;
    const p = ok(await plan(owner.client, { paid_by: mate.user.username }), 201);
    assert.equal(p.member_username, mate.user.username);
    const all = ok(await owner.client.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === p.id);
    assert.ok(all.every((t) => t.member_username === mate.user.username));
    fails(await plan(owner.client, { paid_by: 'nobody.here' }), 400);
  });
});

describe('installments that are not equal', () => {
  const unequal = (c, over = {}) => plan(c, { installment_amount: undefined, installment_count: 3, amounts: [30, 6, 6], purchase_amount: 42, ...over });

  it('makes one payment per listed amount, in order, and totals them', async () => {
    const c = await fresh();
    const p = ok(await unequal(c), 201);
    assert.deepEqual([p.total_amount, p.purchase_amount, p.installment_count], [42, 42, 3]);
    const rows = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === p.id);
    assert.deepEqual(rows.map((t) => [t.installment_no, t.amount, t.date]), [[1, 30, '2032-01-10'], [2, 6, '2032-02-10'], [3, 6, '2032-03-10']]);
    assert.ok(rows.every((t) => t.pay_method === 'credit_card' && t.charged_on === '2031-12-02'));
  });

  it('treats what the amounts add up to beyond the price as interest', async () => {
    const c = await fresh();
    const p = ok(await unequal(c, { amounts: [30, 8, 8] }), 201);
    assert.deepEqual([p.total_amount, p.purchase_amount], [46, 42]);
  });

  it('refuses amounts that add up to less than the price', async () => {
    const c = await fresh();
    fails(await unequal(c, { amounts: [20, 6, 6] }), 400);
  });

  it('refuses a list of the wrong length, a zero or negative amount, and giving both the list and a total', async () => {
    const c = await fresh();
    fails(await unequal(c, { amounts: [30, 6] }), 400);
    fails(await unequal(c, { amounts: [30, 6, 6, 6] }), 400);
    fails(await unequal(c, { amounts: [30, 0, 12] }), 400);
    fails(await unequal(c, { amounts: [30, -6, 18] }), 400);
    fails(await unequal(c, { total_amount: 42 }), 400);
    fails(await unequal(c, { installment_amount: 14 }), 400);
    fails(await unequal(c, { amounts: [42] }), 400);
  });

  it('keeps every cent of odd amounts, and counts each in its own month', async () => {
    const c = await fresh();
    const p = ok(await unequal(c, { amounts: [10.01, 0.02, 0.07], purchase_amount: 10.1 }), 201);
    assert.equal(p.total_amount, 10.1);
    assert.equal(ok(await c.get('/summary?month=2032-01')).totals.expensePending, 10.01);
    assert.equal(ok(await c.get('/summary?month=2032-02')).totals.expensePending, 0.02);
  });

  it('also works for an ordinary plan with no card', async () => {
    const c = await fresh();
    const p = ok(await c.post('/installments', { description: 'Course', amounts: [100, 50, 50], installment_count: 3, first_due_date: '2032-01-20', category_id: null }), 201);
    assert.equal(p.total_amount, 200);
    assert.equal(p.charged_on, null);
  });
});

describe('installments in months of your choice', () => {
  // bought 2 December 2031; bills on the 10th of January, February, and then May (a few months skipped)
  const picked = (c, over = {}) => plan(c, { installment_amount: 100, installment_count: 3, purchase_amount: 290, first_due_date: '2032-01-10', dates: ['2032-01-10', '2032-02-10', '2032-05-10'], ...over });

  it('puts each installment on the day it is given', async () => {
    const c = await fresh();
    const p = ok(await picked(c), 201);
    const rows = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === p.id);
    assert.deepEqual(rows.map((t) => [t.installment_no, t.date, t.amount]), [[1, '2032-01-10', 100], [2, '2032-02-10', 100], [3, '2032-05-10', 100]]);
    assert.ok(rows.every((t) => t.pay_method === 'credit_card' && t.charged_on === '2031-12-02'));
  });

  it('counts each in its own month, and nothing in the months skipped', async () => {
    const c = await fresh();
    ok(await picked(c), 201);
    assert.equal(ok(await c.get('/summary?month=2032-02')).totals.expensePending, 100);
    assert.equal(ok(await c.get('/summary?month=2032-03')).totals.expensePending, 0);
    assert.equal(ok(await c.get('/summary?month=2032-05')).totals.expensePending, 100);
  });

  it('reports the real last day of the plan', async () => {
    const c = await fresh();
    const p = ok(await picked(c), 201);
    assert.equal(p.last_due, '2032-05-10');
    const plain = ok(await plan(c, { description: 'Plain' }), 201);
    assert.equal(plain.last_due, '2032-06-10', 'a plan with consecutive months ends where it always did');
  });

  it('works together with different amounts', async () => {
    const c = await fresh();
    const p = ok(await picked(c, { installment_amount: undefined, amounts: [30, 6, 6], purchase_amount: 42 }), 201);
    const rows = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=')).filter((t) => t.installment_plan_id === p.id);
    assert.deepEqual(rows.map((t) => [t.date, t.amount]), [['2032-01-10', 30], ['2032-02-10', 6], ['2032-05-10', 6]]);
  });

  it('refuses dates that are the wrong number, not in order, repeated, or not starting at the first due date', async () => {
    const c = await fresh();
    fails(await picked(c, { dates: ['2032-01-10', '2032-02-10'] }), 400);
    fails(await picked(c, { dates: ['2032-01-10', '2032-03-10', '2032-02-10'] }), 400);
    fails(await picked(c, { dates: ['2032-01-10', '2032-02-10', '2032-02-10'] }), 400);
    fails(await picked(c, { dates: ['2032-01-11', '2032-02-10', '2032-05-10'] }), 400);
    fails(await picked(c, { dates: ['2032-01-10', '2032-02-10', 'May'] }), 400);
  });

  it('refuses a first bill before the purchase, as for any card plan', async () => {
    const c = await fresh();
    fails(await picked(c, { charged_on: '2032-01-11' }), 400);
  });
});
