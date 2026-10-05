import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connect, daysFromToday, fails, ok, shutdown, signup, startServer, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('reconcile');
});
after(async () => {
  await shutdown(srv);
});

const fresh = async () => (await signup(srv)).client;
const match = (c, balance) => c.post('/reconcile', { balance });
const balance = async (c) => ok(await c.get('/summary')).balance;
const all = async (c) => ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status='));

describe('matching the bank balance', () => {
  it('adds an income for the difference when the bank has more, and the balance becomes the bank figure', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 100, currency: 'EUR' }));
    const r = ok(await match(c, 150.5));
    assert.deepEqual([r.adjusted, r.difference, r.balance_before, r.balance_after], [true, 50.5, 100, 150.5]);
    assert.deepEqual([r.payment.type, r.payment.amount, r.payment.date, r.payment.status, r.payment.source, r.payment.category_id], ['income', 50.5, today(), 'paid', 'adjustment', null]);
    assert.equal(r.payment.description, 'Balance adjustment (matched to the bank)');
    assert.equal(await balance(c), 150.5);
  });

  it('adds an expense when the bank has less', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 100, currency: 'EUR' }));
    const r = ok(await match(c, 40));
    assert.deepEqual([r.adjusted, r.difference, r.payment.type, r.payment.amount], [true, -60, 'expense', 60]);
    assert.equal(await balance(c), 40);
  });

  it('adds nothing when they already match, and says so', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 100, currency: 'EUR' }));
    const r = ok(await match(c, 100));
    assert.deepEqual([r.adjusted, r.difference, r.payment], [false, 0, null]);
    assert.equal((await all(c)).length, 0);
  });

  it('matches again and again without piling up: the second time with the same figure changes nothing', async () => {
    const c = await fresh();
    ok(await match(c, 70));
    ok(await match(c, 70));
    assert.equal((await all(c)).length, 1);
    ok(await match(c, 90));
    assert.equal((await all(c)).length, 2);
    assert.equal(await balance(c), 90);
  });

  it('works to the cent, with a negative bank balance, and with a starting balance that is negative', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: -250.5, currency: 'EUR' }));
    const r = ok(await match(c, -300.05));
    assert.equal(r.difference, -49.55);
    assert.equal(await balance(c), -300.05);
    ok(await match(c, 0.01));
    assert.equal(await balance(c), 0.01);
  });

  it('uses only what is marked paid, like the balance card, and leaves pending payments alone', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 500, currency: 'EUR' }));
    await tx(c, { description: 'Still to pay', amount: 200, date: daysFromToday(5), status: 'pending' });
    await tx(c, { type: 'income', description: 'Expected', amount: 900, date: daysFromToday(3), status: 'pending' });
    const r = ok(await match(c, 450));
    assert.deepEqual([r.balance_before, r.difference], [500, -50]);
    const rows = await all(c);
    assert.equal(rows.filter((t) => t.status === 'pending').length, 2, 'the pending ones are untouched');
  });

  it('is undone by deleting the payment', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 100, currency: 'EUR' }));
    const r = ok(await match(c, 175));
    ok(await c.del(`/transactions/${r.payment.id}`));
    assert.equal(await balance(c), 100);
  });

  it('counts in the month figures like any payment, but is not spending: not in the categories, the estimate or the insights', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await match(c, 700)); // an expense of 300
    const s = ok(await c.get('/summary'));
    assert.equal(s.totals.expensePaid, 300, 'it is in the month totals');
    assert.deepEqual(s.byCategory, [], 'but not in "where the money goes"');
    const f = ok(await c.get('/forecast?past=0&months=3&estimateExpenses=1'));
    assert.equal(f.estimates.expenses, 0, 'and not in the estimate of everyday spending');
    const ins = ok(await c.get('/insights')).insights.map((i) => i.type);
    assert.ok(!ins.includes('category-spike'), ins.join());
  });

  it('keeps the list and its totals showing it, with the Adjustment source', async () => {
    const c = await fresh();
    ok(await match(c, 25));
    const rows = await all(c);
    assert.deepEqual(rows.map((t) => t.source), ['adjustment']);
  });

  it('many requests at the same moment add one payment, not one each', async () => {
    const c = await fresh();
    const results = await Promise.all(Array.from({ length: 8 }, () => match(c, 80)));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal((await all(c)).length, 1);
    assert.equal(await balance(c), 80);
    assert.equal(results.filter((r) => r.json.adjusted).length, 1);
  });

  it('refuses a missing, non-numeric or absurd balance', async () => {
    const c = await fresh();
    fails(await c.post('/reconcile', {}), 400);
    fails(await c.post('/reconcile', { balance: 'a lot' }), 400);
    fails(await c.post('/reconcile', { balance: null }), 400);
    fails(await c.post('/reconcile', { balance: 1e12 }), 400);
    fails(await c.post('/reconcile', { balance: Infinity }), 400);
    assert.equal((await all(c)).length, 0, 'nothing was added');
  });

  it('records who matched it in a shared budget, and belongs to that budget only', async () => {
    const owner = await signup(srv);
    const mate = await signup(srv);
    await connect(owner, mate);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: mate.user.username }), 201);
    const inv = ok(await mate.client.get('/inbox')).group_invites[0];
    ok(await mate.client.post(`/workspace-invites/${inv.id}/accept`));
    mate.client.ws = group.id;
    owner.client.ws = group.id;
    ok(await match(mate.client, 60));
    assert.equal(await balance(owner.client), 60, 'both see the same shared balance');
    const row = (await all(owner.client))[0];
    assert.equal(row.member_username, mate.user.username);
    owner.client.ws = null;
    assert.equal(await balance(owner.client), 0, "the owner's own budget is untouched");
  });

  it('needs a signed-in person', async () => {
    const c = await fresh();
    const anon = new c.constructor(c.root);
    fails(await anon.post('/reconcile', { balance: 5 }), 401);
  });
});
