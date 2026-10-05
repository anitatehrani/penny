import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { carriedInto } from '../src/lib/carryover.js';
import { Client, connect, fails, ok, shutdown, signup, startServer } from './helpers.js';

describe('the carry-over rule', () => {
  it('is nothing before the first month with payments, and in it', () => {
    assert.equal(carriedInto({}, '2031-03'), 0);
    assert.equal(carriedInto({ '2031-03': 50000 }, '2031-02'), 0);
    assert.equal(carriedInto({ '2031-03': 50000 }, '2031-03'), 0);
  });
  it("carries a month's leftover into the next", () => {
    assert.equal(carriedInto({ '2031-03': 64500 }, '2031-04'), 64500);
  });
  it('keeps carrying through months with no payments', () => {
    assert.equal(carriedInto({ '2031-03': 64500 }, '2031-09'), 64500);
  });
  it('adds up leftovers from several months', () => {
    assert.equal(carriedInto({ '2031-03': 10000, '2031-04': 20000, '2031-05': 5000 }, '2031-06'), 35000);
  });
  it('lets a shortfall eat into what was carried, but never carries a negative', () => {
    assert.equal(carriedInto({ '2031-03': 10000, '2031-04': -4000 }, '2031-05'), 6000);
    assert.equal(carriedInto({ '2031-03': 10000, '2031-04': -30000 }, '2031-05'), 0);
    assert.equal(carriedInto({ '2031-03': -5000 }, '2031-04'), 0);
    assert.equal(carriedInto({ '2031-03': -5000, '2031-04': 8000 }, '2031-05'), 8000, 'a shortfall before it is not paid back out of later money');
  });
  it('is exact however long ago the first payment was, and ignores the empty months in between', () => {
    assert.equal(carriedInto({ '1900-01': 12345 }, '2031-03'), 12345);
    assert.equal(carriedInto({ '1900-01': 12345, '2030-12': -2345 }, '2031-03'), 10000);
  });
  it('counts only months before the one asked for', () => {
    assert.equal(carriedInto({ '2031-03': 10000, '2031-05': 99999 }, '2031-05'), 10000);
  });
});

let srv;
before(async () => {
  srv = await startServer('carryover');
});
after(async () => {
  await shutdown(srv);
});

const fresh = async () => (await signup(srv)).client;
const pay = (c, type, amount, date, over = {}) => c.post('/transactions', { type, description: `${type} ${amount}`, amount, date, status: 'pending', category_id: null, ...over });
const carry = async (c, month) => ok(await c.get(`/carryover?month=${month}`));

describe('GET /api/carryover', () => {
  it('is on by default and nothing before there are payments', async () => {
    const c = await fresh();
    assert.equal(ok(await c.get('/settings')).carry_over, true);
    assert.deepEqual(await carry(c, '2031-04'), { enabled: true, month: '2031-04', from_month: '2031-03', amount: 0 });
  });

  it('carries the leftover of the month before, as in December +645 into January', async () => {
    const c = await fresh();
    ok(await pay(c, 'income', 2500, '2031-12-05'), 201);
    ok(await pay(c, 'expense', 1855, '2031-12-20'), 201);
    assert.equal((await carry(c, '2032-01')).amount, 645);
    assert.equal((await carry(c, '2031-12')).amount, 0, 'December itself starts from nothing');
  });

  it("chains: January's own result is carried into February", async () => {
    const c = await fresh();
    ok(await pay(c, 'income', 1000, '2031-12-05'), 201);
    ok(await pay(c, 'income', 500, '2032-01-05'), 201);
    ok(await pay(c, 'expense', 300, '2032-01-10'), 201);
    assert.equal((await carry(c, '2032-01')).amount, 1000);
    assert.equal((await carry(c, '2032-02')).amount, 1200);
    assert.equal((await carry(c, '2032-08')).amount, 1200, 'and on through empty months');
  });

  it('never carries a shortfall, and a later shortfall eats into earlier leftover', async () => {
    const c = await fresh();
    ok(await pay(c, 'income', 100, '2031-10-05'), 201);
    ok(await pay(c, 'expense', 300, '2031-10-06'), 201);
    assert.equal((await carry(c, '2031-11')).amount, 0);
    ok(await pay(c, 'income', 1000, '2031-11-05'), 201);
    ok(await pay(c, 'expense', 400, '2031-11-06'), 201);
    assert.equal((await carry(c, '2031-12')).amount, 600);
    ok(await pay(c, 'expense', 900, '2031-12-06'), 201);
    assert.equal((await carry(c, '2032-01')).amount, 0);
  });

  it('leaves skipped payments out, counts paid and still-to-pay alike, and counts a card purchase in the month its bill is paid', async () => {
    const c = await fresh();
    ok(await pay(c, 'income', 1000, '2031-12-05', { status: 'paid' }), 201);
    const skipped = ok(await pay(c, 'expense', 400, '2031-12-06'), 201);
    ok(await c.patch(`/transactions/${skipped.id}/status`, { status: 'skipped' }));
    ok(await pay(c, 'expense', 100, '2031-12-07', { status: 'paid' }), 201);
    assert.equal((await carry(c, '2032-01')).amount, 900);
    // bought on 2 December with the card; the bill is paid on 10 January
    const card = ok(await c.post('/transactions', { type: 'expense', description: 'sofa', amount: 200, date: '2032-01-10', charged_on: '2031-12-02', pay_method: 'credit_card', status: 'pending', category_id: null }), 201);
    assert.equal(card.date, '2032-01-10');
    assert.equal((await carry(c, '2032-01')).amount, 900, 'the card purchase does not reduce December');
    assert.equal((await carry(c, '2032-02')).amount, 700, 'it reduces what January passes on');
  });

  it('is switched off with the setting, and back on', async () => {
    const c = await fresh();
    ok(await pay(c, 'income', 500, '2031-12-05'), 201);
    const s = ok(await c.get('/settings'));
    const off = ok(await c.put('/settings', { opening_balance: s.opening_balance, currency: s.currency, carry_over: false }));
    assert.equal(off.carry_over, false);
    assert.deepEqual(await carry(c, '2032-01'), { enabled: false, month: '2032-01', from_month: '2031-12', amount: 0 });
    const back = ok(await c.put('/settings', { opening_balance: s.opening_balance, currency: s.currency, carry_over: true }));
    assert.equal(back.carry_over, true);
    assert.equal((await carry(c, '2032-01')).amount, 500);
  });

  it('is left as it was when a settings save does not mention it', async () => {
    const c = await fresh();
    const s = ok(await c.get('/settings'));
    ok(await c.put('/settings', { opening_balance: s.opening_balance, currency: s.currency, carry_over: false }));
    const kept = ok(await c.put('/settings', { opening_balance: 7, currency: 'EUR' }));
    assert.equal(kept.carry_over, false);
  });

  it('does not count the starting balance, and keeps budgets apart', async () => {
    const a = await fresh();
    const b = await fresh();
    ok(await a.put('/settings', { opening_balance: 5000, currency: 'EUR' }));
    ok(await pay(a, 'income', 300, '2031-12-05'), 201);
    ok(await pay(b, 'income', 999, '2031-12-05'), 201);
    assert.equal((await carry(a, '2032-01')).amount, 300);
    assert.equal((await carry(b, '2032-01')).amount, 999);
  });

  it('wants a valid month', async () => {
    const c = await fresh();
    for (const bad of ['', '2031', '2031-13', '2031-1', 'abc']) fails(await c.get(`/carryover?month=${bad}`), 400);
    fails(await c.get('/carryover'), 400);
  });

  it('needs a signed-in person', async () => {
    const c = await fresh();
    const anon = new Client(c.root);
    fails(await anon.get('/carryover?month=2032-01'), 401);
  });

  it('rejects a carry_over that is not true or false', async () => {
    const c = await fresh();
    fails(await c.put('/settings', { opening_balance: 0, currency: 'EUR', carry_over: 'yes' }), 400);
  });
});

describe('carry-over in a shared budget', () => {
  it('is one setting for the whole budget, separate from each person\'s own budget', async () => {
    const owner = await signup(srv);
    const mate = await signup(srv);
    await connect(owner, mate);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: mate.user.username }), 201);
    const inv = ok(await mate.client.get('/inbox')).group_invites[0];
    ok(await mate.client.post(`/workspace-invites/${inv.id}/accept`));
    owner.client.ws = group.id;
    mate.client.ws = group.id;

    // each person's own payment in the shared budget counts toward the same leftover
    ok(await pay(owner.client, 'income', 1500, '2031-12-05'), 201);
    ok(await pay(mate.client, 'expense', 400, '2031-12-06', { paid_by: mate.user.username }), 201);
    assert.equal((await carry(owner.client, '2032-01')).amount, 1100);
    assert.equal((await carry(mate.client, '2032-01')).amount, 1100, 'the other member sees the same figure');

    // switching it off in the shared budget switches it off for both, and leaves their personal budgets alone
    const s = ok(await owner.client.get('/settings'));
    ok(await owner.client.put('/settings', { opening_balance: s.opening_balance, currency: s.currency, carry_over: false }));
    assert.equal((await carry(mate.client, '2032-01')).enabled, false);
    const ownPersonal = new Client(owner.client.root);
    ownPersonal.jar = owner.client.jar;
    assert.equal((await carry(ownPersonal, '2032-01')).enabled, true, 'their personal budget is still on');
    assert.equal((await carry(ownPersonal, '2032-01')).amount, 0, 'and has none of the shared payments');
  });
});
