import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, daysFromToday, fails, ok, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('creditcard');
});
after(async () => {
  await shutdown(srv);
});

const fresh = async () => (await signup(srv)).client;
const M = thisMonth();
const NEXT = addMonthsYM(M, 1);
const billDay = `${NEXT}-10`; // the card bill is paid next month, on the 10th

/** A card purchase made today whose bill is paid next month. */
const card = (c, over = {}) => tx(c, { description: 'IKEA', amount: 89, date: billDay, pay_method: 'credit_card', charged_on: today(), ...over });

describe('the card pay day setting', () => {
  it('starts at the 10th, can be changed, and is kept when a save leaves it out', async () => {
    const c = await fresh();
    assert.equal(ok(await c.get('/settings')).card_pay_day, 10);
    assert.equal(ok(await c.put('/settings', { opening_balance: 0, currency: 'EUR', card_pay_day: 25 })).card_pay_day, 25);
    const kept = ok(await c.put('/settings', { opening_balance: 5, currency: 'EUR' }));
    assert.deepEqual(kept, { opening_balance: 5, currency: 'EUR', card_pay_day: 25, carry_over: true, min_balance: 0 }, 'saving the balance did not reset the day');
    assert.equal(ok(await c.get('/settings')).card_pay_day, 25);
  });

  it('accepts 1 to 28 only, so the day exists in every month', async () => {
    const c = await fresh();
    for (const day of [1, 28]) assert.equal(ok(await c.put('/settings', { opening_balance: 0, currency: 'USD', card_pay_day: day })).card_pay_day, day);
    for (const bad of [0, 29, 31, -1, 10.5, '10', null, [], true]) {
      fails(await c.put('/settings', { opening_balance: 0, currency: 'USD', card_pay_day: bad }), 400);
    }
    assert.equal(ok(await c.get('/settings')).card_pay_day, 28, 'bad values changed nothing');
  });

  it('belongs to each budget, so a shared budget has its own', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 0, currency: 'USD', card_pay_day: 3 }));
    const g = ok(await c.post('/workspaces', { name: 'Us' }), 201);
    c.ws = g.id;
    assert.equal(ok(await c.get('/settings')).card_pay_day, 10);
    ok(await c.put('/settings', { opening_balance: 0, currency: 'EUR', card_pay_day: 20 }));
    c.ws = null;
    assert.equal(ok(await c.get('/settings')).card_pay_day, 3, 'the personal budget is untouched');
  });
});

describe('adding a payment made with a credit card', () => {
  it('stores the purchase day and the day the bill is paid, and is still to pay until then', async () => {
    const c = await fresh();
    const t = ok(await card(c), 201);
    assert.equal(t.pay_method, 'credit_card');
    assert.equal(t.charged_on, today());
    assert.equal(t.date, billDay);
    assert.equal(t.status, 'pending', 'the bill is in the future');
  });

  it('defaults the purchase day to the bill day when it is left out', async () => {
    const c = await fresh();
    const t = ok(await tx(c, { date: billDay, pay_method: 'credit_card' }), 201);
    assert.equal(t.charged_on, billDay);
  });

  it('is cash unless said otherwise, with no purchase day', async () => {
    const c = await fresh();
    const t = ok(await tx(c), 201);
    assert.equal(t.pay_method, 'cash');
    assert.equal(t.charged_on, null);
  });

  it('a card payment whose bill day has already passed is recorded as paid', async () => {
    const c = await fresh();
    const t = ok(await tx(c, { date: '2025-06-10', charged_on: '2025-05-01', pay_method: 'credit_card' }), 201);
    assert.equal(t.status, 'paid');
    assert.equal(t.charged_on, '2025-05-01');
  });

  it('refuses what makes no sense, and says why', async () => {
    const c = await fresh();
    assert.match(fails(await tx(c, { type: 'income', pay_method: 'credit_card', date: billDay }), 400).error, /Only expenses/);
    assert.match(fails(await card(c, { charged_on: `${NEXT}-11` }), 400).error, /cannot be after/);
    assert.match(fails(await tx(c, { pay_method: 'cash', charged_on: today() }), 400).error, /only applies to credit card/);
    assert.match(fails(await tx(c, { charged_on: today() }), 400).error, /only applies to credit card/);
    fails(await tx(c, { pay_method: 'cheque' }), 400);
    fails(await tx(c, { pay_method: 'credit_card', charged_on: 'tomorrow' }), 400);
    fails(await tx(c, { pay_method: 'credit_card', charged_on: '2025-02-30' }), 400);
    assert.equal(ok(await c.get('/transactions?status=')).length, 0, 'nothing was saved');
  });

  it('may be bought on the very day the bill is paid', async () => {
    const c = await fresh();
    const t = ok(await card(c, { charged_on: billDay }), 201);
    assert.equal(t.charged_on, t.date);
  });
});

describe('counting in the month the bill is paid', () => {
  it('leaves the balance alone until then: nothing in this month, the full amount next month', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await card(c, { amount: 180 }), 201);
    const now = ok(await c.get(`/summary?month=${M}`));
    assert.deepEqual(now.totals, { incomePaid: 0, incomePending: 0, expensePaid: 0, expensePending: 0, net: 0 }, 'bought this month, but it does not count here');
    assert.equal(now.balance, 1000);
    const later = ok(await c.get(`/summary?month=${NEXT}`));
    assert.equal(later.totals.expensePending, 180, 'counts in the month the bill is paid');
    assert.equal(later.projectedMonthEnd, 820);
  });

  it('the forecast takes it out in the bill month, not the purchase month', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    ok(await card(c, { amount: 300 }), 201);
    const f = ok(await c.get('/forecast?past=0&months=3&estimateExpenses=0'));
    const by = Object.fromEntries(f.months.map((m) => [m.month, m]));
    assert.equal(by[M].endBalance, 1000);
    assert.equal(by[NEXT].endBalance, 700);
    assert.equal(by[addMonthsYM(M, 2)].endBalance, 700);
  });

  it('can be put in any later month, so the choice of month changes where it lands', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 500, currency: 'EUR' }));
    const t = ok(await card(c, { amount: 100, date: `${addMonthsYM(M, 3)}-10` }), 201);
    const f = ok(await c.get('/forecast?past=0&months=4&estimateExpenses=0'));
    const by = Object.fromEntries(f.months.map((m) => [m.month, m.endBalance]));
    assert.deepEqual([by[M], by[NEXT], by[addMonthsYM(M, 2)], by[addMonthsYM(M, 3)]], [500, 500, 500, 400]);
    // moving it to next month moves the cost with it
    ok(await c.put(`/transactions/${t.id}`, { ...t, date: billDay, category_id: null, note: null }));
    const g = Object.fromEntries(ok(await c.get('/forecast?past=0&months=4&estimateExpenses=0')).months.map((m) => [m.month, m.endBalance]));
    assert.deepEqual([g[M], g[NEXT], g[addMonthsYM(M, 2)], g[addMonthsYM(M, 3)]], [500, 400, 400, 400]);
  });

  it('reduces the balance once the bill is marked paid, and not before', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const t = ok(await card(c, { amount: 250 }), 201);
    assert.equal(ok(await c.get('/summary')).balance, 1000);
    ok(await c.patch(`/transactions/${t.id}/status`, { status: 'paid' }));
    assert.equal(ok(await c.get('/summary')).balance, 750);
    ok(await c.patch(`/transactions/${t.id}/status`, { status: 'pending' }));
    assert.equal(ok(await c.get('/summary')).balance, 1000);
  });

  it('is due, and then overdue, on the bill day', async () => {
    const c = await fresh();
    ok(await tx(c, { description: 'Soon', amount: 20, date: daysFromToday(5), pay_method: 'credit_card', charged_on: daysFromToday(-20) }), 201);
    ok(await tx(c, { description: 'Missed', amount: 30, date: daysFromToday(-3), pay_method: 'credit_card', charged_on: daysFromToday(-25), status: 'pending' }), 201);
    const s = ok(await c.get('/summary'));
    assert.deepEqual(s.upcoming.map((x) => x.description), ['Soon']);
    assert.deepEqual(s.overdue.items.map((x) => x.description), ['Missed']);
  });

  it('skipped card payments do not count, like any other', async () => {
    const c = await fresh();
    const t = ok(await card(c, { amount: 77 }), 201);
    ok(await c.patch(`/transactions/${t.id}/status`, { status: 'skipped' }));
    assert.equal(ok(await c.get(`/summary?month=${NEXT}`)).totals.expensePending, 0);
  });
});

describe('listing and exporting', () => {
  it('lists a card payment in the month the bill is paid, not the purchase month', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'On the card' }), 201);
    ok(await tx(c, { description: 'Cash now', date: today() }), 201);
    assert.deepEqual(ok(await c.get(`/transactions?month=${M}`)).map((t) => t.description), ['Cash now']);
    assert.deepEqual(ok(await c.get(`/transactions?month=${NEXT}`)).map((t) => t.description), ['On the card']);
  });

  it('can be filtered to credit card or cash payments', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'Card A' }), 201);
    ok(await card(c, { description: 'Card B', date: `${NEXT}-20` }), 201);
    ok(await tx(c, { description: 'Cash A', date: `${NEXT}-05` }), 201);
    const names = async (q) => ok(await c.get(`/transactions?month=${NEXT}${q}`)).map((t) => t.description);
    assert.deepEqual(await names('&pay=credit_card'), ['Card A', 'Card B']);
    assert.deepEqual(await names('&pay=cash'), ['Cash A']);
    assert.equal((await names('')).length, 3);
    fails(await c.get('/transactions?pay=bitcoin'), 400);
  });

  it('exports how it was paid and when it was bought', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'Sofa' }), 201);
    ok(await tx(c, { description: 'Bread', date: `${NEXT}-02` }), 201);
    const lines = (await c.get('/transactions/export.csv')).text.split('\n');
    assert.equal(lines[0], 'date,type,description,category,amount,status,paid_with,bought_on,with,receipts,note');
    assert.ok(lines.some((l) => l.startsWith(`${billDay},expense,Sofa,,89.00,pending,credit card,${today()},`)), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith(`${NEXT}-02,expense,Bread,,10.00,pending,cash,,`)));
  });
});

describe('editing', () => {
  it('can turn a cash payment into a card payment and back', async () => {
    const c = await fresh();
    const t = ok(await tx(c, { date: billDay }), 201);
    const asCard = ok(await c.put(`/transactions/${t.id}`, { ...t, category_id: null, pay_method: 'credit_card', charged_on: today() }));
    assert.deepEqual([asCard.pay_method, asCard.charged_on], ['credit_card', today()]);
    const back = ok(await c.put(`/transactions/${t.id}`, { ...asCard, category_id: null, pay_method: 'cash', charged_on: null }));
    assert.deepEqual([back.pay_method, back.charged_on], ['cash', null], 'the purchase day goes when it is no longer a card payment');
  });

  it('keeps the card details when an edit does not mention them', async () => {
    const c = await fresh();
    const t = ok(await card(c, { charged_on: `${M}-02` }), 201);
    const edited = ok(await c.put(`/transactions/${t.id}`, { type: 'expense', description: 'IKEA sofa', amount: 120, date: `${NEXT}-15`, category_id: null }));
    assert.deepEqual([edited.pay_method, edited.charged_on, edited.date, edited.amount], ['credit_card', `${M}-02`, `${NEXT}-15`, 120]);
  });

  it('will not move the bill before the purchase, nor turn a card payment into income', async () => {
    const c = await fresh();
    const t = ok(await card(c, { charged_on: `${M}-20` }), 201);
    assert.match(fails(await c.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 5, date: `${M}-10`, category_id: null }), 400).error, /cannot be after/);
    assert.match(fails(await c.put(`/transactions/${t.id}`, { type: 'income', description: 'x', amount: 5, date: billDay, category_id: null }), 400).error, /Only expenses/);
    assert.equal(ok(await c.get(`/transactions?month=${NEXT}`))[0].description, 'IKEA', 'unchanged');
  });

  it('moving a payment earlier is fine when the purchase day goes with it', async () => {
    const c = await fresh();
    const t = ok(await card(c), 201);
    const moved = ok(await c.put(`/transactions/${t.id}`, { type: 'expense', description: 'IKEA', amount: 89, date: '2025-03-10', charged_on: '2025-02-01', category_id: null }));
    assert.deepEqual([moved.date, moved.charged_on], ['2025-03-10', '2025-02-01']);
  });
});

describe('the database refuses inconsistent rows even if the API is bypassed', () => {
  it('rejects a card payment with no purchase day, one bought after its bill, income on a card, and a cash payment with a purchase day', async () => {
    const c = await fresh();
    const user = (await srv.db.query('SELECT id FROM users ORDER BY id DESC LIMIT 1')).rows[0].id;
    const ws = (await srv.db.query(`SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 LIMIT 1`, [user])).rows[0].id;
    const insert = (type, method, chargedOn, date = '2025-04-10') =>
      srv.db.query(`INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, date, pay_method, charged_on) VALUES ($1, $2, $1, $3, 'x', 1, $4, $5, $6)`, [user, ws, type, date, method, chargedOn]);
    await assert.rejects(insert('expense', 'credit_card', null), /transactions_card_consistent/);
    await assert.rejects(insert('expense', 'credit_card', '2025-04-11'), /transactions_card_consistent/);
    await assert.rejects(insert('income', 'credit_card', '2025-04-01'), /transactions_card_consistent/);
    await assert.rejects(insert('expense', 'cash', '2025-04-01'), /transactions_card_consistent/);
    await assert.rejects(insert('expense', 'wire', null), /violates check constraint/, 'an unknown way of paying');
    await insert('expense', 'credit_card', '2025-04-01'); // the valid one still works
    assert.ok(c);
  });

  it('keeps every payment that existed before the feature as cash', async () => {
    const c = await fresh();
    const user = (await srv.db.query('SELECT id FROM users ORDER BY id DESC LIMIT 1')).rows[0].id;
    const ws = (await srv.db.query(`SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 LIMIT 1`, [user])).rows[0].id;
    await srv.db.query(`INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, date) VALUES ($1, $2, $1, 'expense', 'old row', 5, '2025-01-01')`, [user, ws]);
    const old = ok(await c.get('/transactions?status=')).find((t) => t.description === 'old row');
    assert.deepEqual([old.pay_method, old.charged_on], ['cash', null]);
  });
});

describe('recurring items and installments stay cash', () => {
  it('their payments are cash payments', async () => {
    const c = await fresh();
    ok(await c.post('/recurring', { type: 'expense', description: 'Rent', amount: 900, frequency: 'monthly', start_date: `${M}-05` }), 201);
    ok(await c.post('/installments', { description: 'Laptop', total_amount: 300, installment_count: 3, first_due_date: `${NEXT}-01` }), 201);
    const all = ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01'));
    assert.ok(all.length > 3);
    assert.ok(all.every((t) => t.pay_method === 'cash' && t.charged_on === null));
  });
});

describe('in a shared budget', () => {
  it('records who paid, and the card details, and only members can see it', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const outsider = await signup(srv);
    const g = ok(await a.client.post('/workspaces', { name: 'Home' }), 201);
    a.client.ws = g.id;
    const t = ok(await card(a.client, { paid_by: a.user.username }), 201);
    assert.equal(t.member_username, a.user.username);
    assert.equal(t.pay_method, 'credit_card');
    outsider.client.ws = g.id;
    fails(await outsider.client.get('/transactions'), 403);
    fails(await outsider.client.put(`/transactions/${t.id}`, { ...t, category_id: null, pay_method: 'cash', charged_on: null }), 403);
    assert.ok(b);
  });

  it('cannot be reached through another budget by id', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const t = ok(await card(a.client), 201);
    fails(await b.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'hijack', amount: 1, date: billDay, category_id: null, pay_method: 'cash' }), 404);
    const still = ok(await a.client.get(`/transactions?month=${NEXT}`)).find((x) => x.id === t.id);
    assert.equal(still.pay_method, 'credit_card');
  });
});

describe('also listing a card purchase in the month it was bought', () => {
  const list = async (c, q) => ok(await c.get(`/transactions?${q}`));
  const names = (rows) => rows.map((t) => t.description).sort();

  it('lists it in the purchase month, marked as only a purchase, and in the bill month as usual', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'Klarna', amount: 71, charged_on: `${M}-01` }), 201);
    const bought = await list(c, `month=${M}&bought=1`);
    assert.deepEqual(bought.map((t) => [t.description, t.purchase_only, t.date, t.charged_on]), [['Klarna', true, billDay, `${M}-01`]]);
    const billed = await list(c, `month=${NEXT}&bought=1`);
    assert.deepEqual(billed.map((t) => [t.description, t.purchase_only]), [['Klarna', false]]);
  });

  it('changes nothing unless asked: without bought=1 the month is still by the day the bill is paid', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'Klarna', charged_on: `${M}-01` }), 201);
    assert.deepEqual(await list(c, `month=${M}`), []);
    assert.deepEqual(names(await list(c, `month=${NEXT}`)), ['Klarna']);
    assert.equal((await list(c, `month=${NEXT}`))[0].purchase_only, undefined, 'no flag at all without the option');
    for (const other of ['0', 'yes', 'true', '']) assert.deepEqual(await list(c, `month=${M}&bought=${other}`), [], `bought=${other}`);
  });

  it('is ignored without a month, and a month with neither the purchase nor the bill is empty', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'Klarna', charged_on: `${M}-01` }), 201);
    assert.equal((await list(c, 'status=&bought=1')).length, 1);
    assert.equal((await list(c, 'status=&bought=1'))[0].purchase_only, undefined);
    assert.deepEqual(await list(c, `month=${addMonthsYM(M, 5)}&bought=1`), []);
    assert.deepEqual(await list(c, `month=${addMonthsYM(M, -1)}&bought=1`), []);
  });

  it('lists a purchase once when it is bought and paid in the same month', async () => {
    const c = await fresh();
    ok(await tx(c, { description: 'Same month', date: `${NEXT}-20`, pay_method: 'credit_card', charged_on: `${NEXT}-03` }), 201);
    const rows = await list(c, `month=${NEXT}&bought=1`);
    assert.deepEqual(rows.map((t) => [t.description, t.purchase_only]), [['Same month', false]]);
  });

  it('handles the edges of a month: bought on the 1st and on the last day', async () => {
    const c = await fresh();
    const last = `${M}-${String(new Date(Number(M.slice(0, 4)), Number(M.slice(5)), 0).getDate()).padStart(2, '0')}`;
    ok(await card(c, { description: 'First', charged_on: `${M}-01` }), 201);
    ok(await card(c, { description: 'Last', charged_on: last }), 201);
    ok(await card(c, { description: 'Next first', charged_on: `${NEXT}-01`, date: `${addMonthsYM(NEXT, 1)}-10` }), 201);
    assert.deepEqual(names(await list(c, `month=${M}&bought=1`)), ['First', 'Last']);
    assert.deepEqual(names(await list(c, `month=${NEXT}&bought=1`)), ['First', 'Last', 'Next first'], 'the two bills for last month, and the one bought on the 1st');
  });

  it('shows purchases of several months together with their own bills', async () => {
    const c = await fresh();
    ok(await card(c, { description: 'Bought now, paid next month', charged_on: `${M}-02` }), 201);
    ok(await card(c, { description: 'Bought now, paid in 3 months', charged_on: `${M}-03`, date: `${addMonthsYM(M, 3)}-10` }), 201);
    ok(await tx(c, { description: 'Cash now', date: `${M}-04` }), 201);
    const rows = await list(c, `month=${M}&bought=1`);
    assert.deepEqual(rows.map((t) => [t.description, t.purchase_only]).sort(), [['Bought now, paid in 3 months', true], ['Bought now, paid next month', true], ['Cash now', false]]);
  });

  it('keeps the other filters working on the purchases too', async () => {
    const c = await fresh();
    const groceries = await categoryId(c, 'Groceries');
    ok(await card(c, { description: 'Food', category_id: groceries, charged_on: `${M}-02` }), 201);
    ok(await card(c, { description: 'Gadget', charged_on: `${M}-03` }), 201);
    ok(await tx(c, { description: 'Cash food', category_id: groceries, date: `${M}-04` }), 201);
    const base = `month=${M}&bought=1`;
    assert.deepEqual(names(await list(c, `${base}&category_id=${groceries}`)), ['Cash food', 'Food']);
    assert.deepEqual(names(await list(c, `${base}&q=gadg`)), ['Gadget']);
    assert.deepEqual(names(await list(c, `${base}&pay=credit_card`)), ['Food', 'Gadget']);
    assert.deepEqual(names(await list(c, `${base}&pay=cash`)), ['Cash food']);
    assert.deepEqual(names(await list(c, `${base}&type=income`)), []);
  });

  it('follows the status filter, and never lists skipped purchases', async () => {
    const c = await fresh();
    const a = ok(await card(c, { description: 'Pending one', charged_on: `${M}-02` }), 201);
    ok(await card(c, { description: 'Paid one', charged_on: `${M}-03`, status: 'paid' }), 201);
    const skipped = ok(await card(c, { description: 'Skipped one', charged_on: `${M}-04` }), 201);
    ok(await c.patch(`/transactions/${skipped.id}/status`, { status: 'skipped' }));
    const base = `month=${M}&bought=1`;
    assert.deepEqual(names(await list(c, base)), ['Paid one', 'Pending one'], 'skipped ones are left out by default');
    assert.deepEqual(names(await list(c, `${base}&status=paid`)), ['Paid one']);
    assert.deepEqual(names(await list(c, `${base}&status=pending`)), ['Pending one']);
    assert.deepEqual(names(await list(c, `${base}&status=skipped`)), ['Skipped one']);
    assert.ok(a);
  });

  it('does not change any count: the summary, forecast and CSV still go by the day the bill is paid', async () => {
    const c = await fresh();
    ok(await c.put('/settings', { opening_balance: 500, currency: 'EUR' }));
    ok(await card(c, { description: 'Klarna', amount: 120, charged_on: `${M}-01` }), 201);
    assert.deepEqual(ok(await c.get(`/summary?month=${M}`)).totals, { incomePaid: 0, incomePending: 0, expensePaid: 0, expensePending: 0, net: 0 });
    assert.equal(ok(await c.get(`/summary?month=${NEXT}`)).totals.expensePending, 120);
    assert.equal(ok(await c.get('/summary')).balance, 500);
    const csv = (await c.get(`/transactions/export.csv?month=${M}`)).text.split('\n');
    assert.equal(csv.length, 1, 'the export of the purchase month has only its header');
  });

  it('is private to the budget, and also lists purchases in a shared budget', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    ok(await card(a.client, { description: 'Mine', charged_on: `${M}-02` }), 201);
    assert.deepEqual(await list(b.client, `month=${M}&bought=1`), []);
    const g = ok(await a.client.post('/workspaces', { name: 'Us' }), 201);
    a.client.ws = g.id;
    ok(await card(a.client, { description: 'Ours', charged_on: `${M}-02`, paid_by: a.user.username }), 201);
    assert.deepEqual((await list(a.client, `month=${M}&bought=1`)).map((t) => [t.description, t.purchase_only, t.member_username]), [['Ours', true, a.user.username]]);
  });

  it('refuses a bad month as before', async () => {
    const c = await fresh();
    fails(await c.get('/transactions?month=2025-13&bought=1'), 400);
    fails(await c.get('/transactions?month=soon&bought=1'), 400);
  });
});
