import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { planRollover } from '../src/lib/rollover.js';
import { connect, fails, ok, shutdown, signup, startServer } from './helpers.js';

describe('choosing which purchases roll over', () => {
  const items = [
    { id: 1, cents: 8000 }, // newest purchase first
    { id: 2, cents: 8900 },
    { id: 3, cents: 5000 },
  ];
  it('moves whole purchases that fit, newest first', () => {
    assert.deepEqual(planRollover(items, 16900), { steps: [{ id: 1, action: 'move', cents: 8000 }, { id: 2, action: 'move', cents: 8900 }], short: 0 });
  });
  it('splits the purchase that straddles the line, keeping the part that is paid now', () => {
    assert.deepEqual(planRollover(items, 10000), { steps: [{ id: 1, action: 'move', cents: 8000 }, { id: 2, action: 'split', cents: 2000 }], short: 0 });
    assert.deepEqual(planRollover(items, 100), { steps: [{ id: 1, action: 'split', cents: 100 }], short: 0 });
  });
  it('moves everything when the whole bill rolls', () => {
    assert.deepEqual(planRollover(items, 21900).steps.map((s) => s.action), ['move', 'move', 'move']);
  });
  it('says how much could not be placed when too little can move, and does nothing for nothing', () => {
    assert.equal(planRollover(items, 30000).short, 8100);
    assert.deepEqual(planRollover(items, 0), { steps: [], short: 0 });
    assert.deepEqual(planRollover([], 500), { steps: [], short: 500 });
  });
  it('always accounts for every cent of the rest', () => {
    for (const rest of [1, 99, 8000, 8001, 16899, 16900, 16901, 21899, 21900]) {
      const { steps, short } = planRollover(items, rest);
      assert.equal(steps.reduce((s, x) => s + x.cents, 0) + short, rest, 'rest ' + rest);
    }
  });
});

let srv;
before(async () => {
  srv = await startServer('cardbills');
});
after(async () => {
  await shutdown(srv);
});

const fresh = async () => (await signup(srv)).client;
// a December 2031 bill, paid on the 10th: three purchases made in November and December
const buy = (c, description, amount, charged_on, over = {}) =>
  c.post('/transactions', { type: 'expense', description, amount, date: '2031-12-10', charged_on, pay_method: 'credit_card', status: 'pending', category_id: null, ...over });
const all = async (c) => ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status='));
const bill = async (c, month = '2031-12') => ok(await c.get(`/card-bills?month=${month}`));
const roll = (c, over = {}) => c.post('/card-bills/rollover', { bill_month: '2031-12', to_month: '2032-01', pay_now: 100, interest: 0, ...over });
const sumOn = (rows, date) => Math.round(rows.filter((t) => t.date === date && t.status !== 'skipped').reduce((s, t) => s + t.amount * 100, 0)) / 100;

async function threePurchases(c) {
  ok(await buy(c, 'Klarna', 8, '2031-12-01'), 201);
  ok(await buy(c, 'IKEA', 89, '2031-11-20'), 201);
  ok(await buy(c, 'Shoes', 138, '2031-11-02'), 201);
}

describe('GET /api/card-bills', () => {
  it('lists the unpaid card payments on the bill, newest purchase first, with the totals and the bill day', async () => {
    const c = await fresh();
    await threePurchases(c);
    ok(await c.post('/transactions', { type: 'expense', description: 'Cash thing', amount: 5, date: '2031-12-10', category_id: null }), 201);
    const b = await bill(c);
    assert.deepEqual(b.items.map((i) => i.description), ['Klarna', 'IKEA', 'Shoes']);
    assert.deepEqual([b.total, b.movable, b.fixed, b.bill_date], [235, 235, 0, '2031-12-10']);
    assert.ok(b.items.every((i) => i.movable === true));
  });

  it('leaves out what is already paid or skipped, and other months', async () => {
    const c = await fresh();
    await threePurchases(c);
    const paid = ok(await buy(c, 'Paid one', 20, '2031-12-02', { status: 'paid' }), 201);
    const skipped = ok(await buy(c, 'Skipped one', 30, '2031-12-03'), 201);
    ok(await c.patch(`/transactions/${skipped.id}/status`, { status: 'skipped' }));
    ok(await buy(c, 'Next month', 40, '2031-12-04', { date: '2032-01-10' }), 201);
    const b = await bill(c);
    assert.equal(b.total, 235);
    assert.ok(!b.items.some((i) => i.id === paid.id));
    assert.deepEqual((await bill(c, '2032-01')).items.map((i) => i.description), ['Next month']);
  });

  it('marks fixed installments, debt payments and shared payments as not movable, but counts them in the statement', async () => {
    const c = await fresh();
    await threePurchases(c);
    ok(await c.post('/installments', { description: 'Sofa', installment_amount: 100, installment_count: 3, first_due_date: '2031-12-10', charged_on: '2031-12-02', purchase_amount: 290, category_id: null }), 201);
    const b = await bill(c);
    assert.equal(b.total, 335);
    assert.deepEqual([b.movable, b.fixed], [235, 100]);
    assert.equal(b.items.find((i) => /Sofa/.test(i.description)).movable, false);
  });

  it('wants a valid month and a signed-in person, and is private to the budget', async () => {
    const c = await fresh();
    fails(await c.get('/card-bills?month=2031'), 400);
    fails(await c.get('/card-bills'), 400);
    const other = await fresh();
    await threePurchases(c);
    assert.equal((await bill(other)).total, 0);
  });
});

describe('POST /api/card-bills/rollover', () => {
  it('moves whole purchases, newest first, and the bill keeps exactly what is paid now', async () => {
    const c = await fresh();
    await threePurchases(c);
    const r = ok(await roll(c, { pay_now: 138 }));
    assert.deepEqual([r.moved, r.split, r.rolled, r.to_date], [2, 0, 97, '2032-01-10']);
    const rows = await all(c);
    assert.equal(sumOn(rows, '2031-12-10'), 138, 'this bill is what you pay now');
    assert.equal(sumOn(rows, '2032-01-10'), 97, 'the rest is on the next bill');
    assert.deepEqual(rows.filter((t) => t.date === '2032-01-10').map((t) => t.description).sort(), ['IKEA', 'Klarna']);
    assert.ok(rows.every((t) => t.status === 'pending'));
  });

  it('splits the purchase that straddles the line and loses no cent', async () => {
    const c = await fresh();
    await threePurchases(c);
    const r = ok(await roll(c, { pay_now: 100 }));
    // newest first: Klarna 8 and IKEA 89 move whole (97), then 38 of the 138 shoes move
    assert.deepEqual([r.moved, r.split, r.rolled], [2, 1, 135]);
    const rows = await all(c);
    assert.equal(sumOn(rows, '2031-12-10'), 100);
    assert.equal(sumOn(rows, '2032-01-10'), 135);
    assert.equal(sumOn(rows, '2031-12-10') + sumOn(rows, '2032-01-10'), 235, 'the total is unchanged');
    const rest = rows.find((t) => t.description === 'Shoes (rest)');
    assert.deepEqual([rest.amount, rest.date, rest.charged_on, rest.pay_method, rest.status], [38, '2032-01-10', '2031-11-02', 'credit_card', 'pending']);
    assert.equal(rows.find((t) => t.description === 'Shoes').amount, 100, 'the original keeps what is paid now');
  });

  it('keeps the category, note and person of a split purchase', async () => {
    const owner = await signup(srv);
    const mate = await signup(srv);
    await connect(owner, mate);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: mate.user.username }), 201);
    const inv = ok(await mate.client.get('/inbox')).group_invites[0];
    ok(await mate.client.post(`/workspace-invites/${inv.id}/accept`));
    owner.client.ws = group.id;
    const cat = ok(await owner.client.get('/categories')).find((x) => x.kind === 'expense').id;
    ok(await buy(owner.client, 'Big buy', 200, '2031-12-01', { category_id: cat, note: 'for the flat', paid_by: mate.user.username }), 201);
    ok(await roll(owner.client, { pay_now: 50 }));
    const rows = await all(owner.client);
    const rest = rows.find((t) => t.description === 'Big buy (rest)');
    assert.deepEqual([rest.amount, rest.category_id, rest.note, rest.member_username], [150, cat, 'for the flat', mate.user.username]);
  });

  it('adds the interest as its own card payment on the later bill', async () => {
    const c = await fresh();
    await threePurchases(c);
    const r = ok(await roll(c, { pay_now: 100, interest: 6.5 }));
    assert.ok(r.interest_id);
    const rows = await all(c);
    const i = rows.find((t) => t.id === r.interest_id);
    assert.deepEqual([i.description, i.amount, i.date, i.charged_on, i.pay_method, i.status, i.type], ['Card interest (rest of the December 2031 bill)', 6.5, '2032-01-10', '2031-12-10', 'credit_card', 'pending', 'expense']);
    assert.equal(sumOn(rows, '2032-01-10'), 141.5, 'the rest and the interest');
    assert.equal(sumOn(rows, '2031-12-10'), 100);
  });

  it('can roll the whole bill, paying nothing now', async () => {
    const c = await fresh();
    await threePurchases(c);
    const r = ok(await roll(c, { pay_now: 0 }));
    assert.deepEqual([r.moved, r.split, r.rolled], [3, 0, 235]);
    const rows = await all(c);
    assert.equal(sumOn(rows, '2031-12-10'), 0);
    assert.equal(sumOn(rows, '2032-01-10'), 235);
  });

  it('uses the budget\'s card pay day, and can move the rest several months ahead', async () => {
    const c = await fresh();
    const s = ok(await c.get('/settings'));
    ok(await c.put('/settings', { opening_balance: s.opening_balance, currency: s.currency, card_pay_day: 25 }));
    ok(await buy(c, 'Thing', 80, '2031-12-01', { date: '2031-12-25' }), 201);
    const r = ok(await roll(c, { pay_now: 30, to_month: '2032-03' }));
    assert.equal(r.to_date, '2032-03-25');
  });

  it('leaves fixed installments on their bill and only rolls what can move', async () => {
    const c = await fresh();
    await threePurchases(c);
    ok(await c.post('/installments', { description: 'Sofa', installment_amount: 100, installment_count: 3, first_due_date: '2031-12-10', charged_on: '2031-12-02', purchase_amount: 290, category_id: null }), 201);
    ok(await roll(c, { pay_now: 150 })); // statement 335, rest 185, all of it movable (235)
    const rows = await all(c);
    assert.equal(sumOn(rows, '2031-12-10'), 150, 'the installment stays, the rest of the bill is what you pay');
    assert.ok(rows.filter((t) => /Sofa/.test(t.description)).every((t) => t.date.endsWith('-10')), 'installment dates untouched');
    assert.equal(rows.find((t) => /^Sofa \(1\/3\)$/.test(t.description)).date, '2031-12-10');
  });

  it('refuses to roll more than can move, and says how much to pay at least', async () => {
    const c = await fresh();
    await threePurchases(c);
    ok(await c.post('/installments', { description: 'Sofa', installment_amount: 100, installment_count: 3, first_due_date: '2031-12-10', charged_on: '2031-12-02', purchase_amount: 290, category_id: null }), 201);
    const err = fails(await roll(c, { pay_now: 50 }), 400); // rest 285 > movable 235
    assert.match(err.error, /Only 235\.00 of this bill can move/);
    assert.match(err.error, /Pay at least 100\.00/);
    const later = (await all(c)).filter((t) => t.date === '2032-01-10');
    assert.deepEqual(later.map((t) => t.description), ['Sofa (2/3)'], 'nothing moved: only the installment that was already due then');
  });

  it('refuses to pay the whole bill (nothing to roll), a negative amount, and a bill with nothing on it', async () => {
    const c = await fresh();
    await threePurchases(c);
    fails(await roll(c, { pay_now: 235 }), 400);
    fails(await roll(c, { pay_now: 300 }), 400);
    fails(await roll(c, { pay_now: -1 }), 400);
    fails(await roll(c, { interest: -1 }), 400);
    fails(await roll(c, { bill_month: '2031-05', to_month: '2031-06' }), 400);
  });

  it('refuses a later bill that is not later, or more than a year ahead, or not a month', async () => {
    const c = await fresh();
    await threePurchases(c);
    fails(await roll(c, { to_month: '2031-12' }), 400);
    fails(await roll(c, { to_month: '2031-11' }), 400);
    fails(await roll(c, { to_month: '2033-01' }), 400);
    fails(await roll(c, { to_month: 'soon' }), 400);
    fails(await roll(c, { bill_month: '2031-13' }), 400);
    assert.equal(sumOn(await all(c), '2032-01-10'), 0, 'nothing moved by any refused request');
  });

  it('does not touch paid payments, another month, or another budget', async () => {
    const c = await fresh();
    const other = await fresh();
    await threePurchases(c);
    await threePurchases(other);
    ok(await buy(c, 'Paid one', 20, '2031-12-02', { status: 'paid' }), 201);
    ok(await buy(c, 'Later bill', 60, '2031-12-04', { date: '2032-02-10' }), 201);
    ok(await roll(c, { pay_now: 100 }));
    const mine = await all(c);
    assert.equal(mine.find((t) => t.description === 'Paid one').date, '2031-12-10');
    assert.equal(mine.find((t) => t.description === 'Paid one').status, 'paid');
    assert.equal(mine.find((t) => t.description === 'Later bill').date, '2032-02-10');
    assert.equal(sumOn(await all(other), '2031-12-10'), 235, "the other budget's bill is as it was");
  });

  it('changes the forecast: money leaves the bill month and arrives in the later one', async () => {
    const c = await fresh();
    await threePurchases(c);
    const before = ok(await c.get('/summary?month=2031-12')).totals.expensePending;
    const laterBefore = ok(await c.get('/summary?month=2032-01')).totals.expensePending;
    ok(await roll(c, { pay_now: 100, interest: 5 }));
    assert.equal(ok(await c.get('/summary?month=2031-12')).totals.expensePending, 100);
    assert.equal(ok(await c.get('/summary?month=2032-01')).totals.expensePending, 140);
    assert.equal(before, 235);
    assert.equal(laterBefore, 0);
  });

  it('needs a signed-in person', async () => {
    const c = await fresh();
    const anon = new (c.constructor)(c.root);
    fails(await anon.post('/card-bills/rollover', { bill_month: '2031-12', to_month: '2032-01', pay_now: 1 }), 401);
    fails(await anon.get('/card-bills?month=2031-12'), 401);
  });
});
