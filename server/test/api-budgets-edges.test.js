import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, Client, connect, fails, ok, shutdown, signup, startServer, thisMonth, tx } from './helpers.js';

// Edge cases of the monthly budget (docs/DESIGN.md section 43): calendar turns, races, who may reach what, the database's own rules.
let srv;
before(async () => {
  srv = await startServer('budgets_edges');
});
after(async () => {
  await shutdown(srv);
});

const M = thisMonth();
const m = (back) => addMonthsYM(M, -back);
const view = async (p, month = M) => ok(await p.client.get(`/budgets?month=${month}`));
const line = (v, name) => v.lines.find((l) => l.name === name);
const budgetOf = async (p, name, month) => line(await view(p, month), name)?.budget;
const put = async (p, cat, body) => ok(await p.client.put(`/budgets/${cat}`, body));
const scan = async (p) => ok(await p.client.post('/notifications/refresh'));
const alerts = async (p) => ok(await p.client.get('/notifications')).items.filter((n) => n.kind === 'budget_alert');
const ask = async (p, question) => ok(await p.client.post('/assistant/ask', { question, chip: true }));
async function person() {
  const p = await signup(srv);
  const id = { food: await categoryId(p.client, 'Groceries'), dining: await categoryId(p.client, 'Dining & leisure'), rent: await categoryId(p.client, 'Rent / Mortgage') };
  return { p, id };
}
const pay = (p, cat, amount, over = {}) => tx(p.client, { description: 'Payment', amount, category_id: cat, status: 'paid', date: `${M}-01`, ...over });
async function household() {
  const a = await person();
  const b = await person();
  await connect(a.p, b.p);
  const g = ok(await a.p.client.post('/workspaces', { name: 'Flat' }), 201);
  ok(await a.p.client.post(`/workspaces/${g.id}/invites`, { username: b.p.user.username }), 201);
  ok(await b.p.client.post(`/workspace-invites/${ok(await b.p.client.get('/inbox')).group_invites[0].id}/accept`));
  a.p.client.ws = g.id;
  b.p.client.ws = g.id;
  return { a, b, group: g };
}

describe('months and carrying', () => {
  it('carries a budget across the turn of a year, and "only this month" in December goes back in January', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: '2026-11', amount: 200 });
    await put(p, id.food, { month: '2026-12', amount: 450, scope: 'month' });
    assert.deepEqual(
      [await budgetOf(p, 'Groceries', '2026-11'), await budgetOf(p, 'Groceries', '2026-12'), await budgetOf(p, 'Groceries', '2027-01'), await budgetOf(p, 'Groceries', '2027-06')],
      [200, 450, 200, 200],
    );
    await put(p, id.food, { month: '2027-01', amount: 260 });
    assert.equal(await budgetOf(p, 'Groceries', '2026-12'), 450, 'December is not rewritten');
    assert.equal(await budgetOf(p, 'Groceries', '2027-03'), 260);
  });

  it('fill can be limited to one month, and fills nothing for categories with no history', async () => {
    const { p, id } = await person();
    ok(await pay(p, id.food, 90, { date: `${m(1)}-05` }), 201);
    const r = ok(await p.client.post('/budgets/fill', { month: M, source: 'last_month', scope: 'month' }));
    assert.equal(r.filled, 1);
    assert.equal(await budgetOf(p, 'Groceries', M), 90);
    assert.equal(await budgetOf(p, 'Groceries', addMonthsYM(M, 1)), null, 'only this month');
    assert.equal(await budgetOf(p, 'Dining & leisure', M), null, 'no history, no budget');
  });

  it('a very large budget is stored exactly, and the view copes', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 9_999_999_999 });
    assert.equal(await budgetOf(p, 'Groceries'), 9_999_999_999);
    const v = await view(p);
    assert.equal(v.totals.percent, 0);
    assert.ok(Number.isFinite(v.totals.left));
  });
});

describe('two things at once', () => {
  it('saves made at the same moment all succeed and leave one row', async () => {
    const { p, id } = await person();
    const results = await Promise.all([
      p.client.put(`/budgets/${id.food}`, { month: M, amount: 100 }),
      p.client.put(`/budgets/${id.food}`, { month: M, amount: 200 }),
      p.client.put(`/budgets/${id.food}`, { month: M, amount: 300, scope: 'month' }),
      p.client.put(`/budgets/${id.dining}`, { month: M, amount: 50 }),
    ]);
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok([100, 200, 300].includes(await budgetOf(p, 'Groceries')));
    assert.equal(await budgetOf(p, 'Dining & leisure'), 50);
    const rows = await srv.db.query('SELECT count(*)::int AS n FROM category_budgets WHERE category_id = $1 AND month = $2', [id.food, M]);
    assert.equal(rows.rows[0].n, 1);
  });

  it('fills made at the same moment do not fail', async () => {
    const { p, id } = await person();
    ok(await pay(p, id.food, 100, { date: `${m(1)}-05` }), 201);
    const results = await Promise.all([1, 2, 3].map(() => p.client.post('/budgets/fill', { month: M, source: 'typical' })));
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await budgetOf(p, 'Groceries'), 35, 'a third of 100 (33.33), rounded up to the next 5');
  });
});

describe('which categories can have one', () => {
  it('a category that becomes an income category leaves the view, and comes back with its budget', async () => {
    const { p } = await person();
    const c = ok(await p.client.post('/categories', { name: 'Side hustle', kind: 'expense', color: '#123456' }), 201);
    await put(p, c.id, { month: M, amount: 75 });
    ok(await p.client.put(`/categories/${c.id}`, { name: 'Side hustle', kind: 'income', color: '#123456' }));
    assert.equal(line(await view(p), 'Side hustle'), undefined);
    fails(await p.client.put(`/budgets/${c.id}`, { month: M, amount: 10 }), 400);
    ok(await p.client.put(`/categories/${c.id}`, { name: 'Side hustle', kind: 'expense', color: '#123456' }));
    assert.equal(await budgetOf(p, 'Side hustle'), 75);
  });

  it('amounts typed as text are refused (the page sends numbers)', async () => {
    const { p, id } = await person();
    for (const amount of ['50', [50], true, {}]) fails(await p.client.put(`/budgets/${id.food}`, { month: M, amount }), 400);
  });
});

describe('who can reach it', () => {
  it('nobody reaches a budget they are not a member of by naming it in the request', async () => {
    const a = await person();
    const b = await person();
    b.p.client.ws = ok(await a.p.client.get('/workspaces')).find((w) => w.kind === 'personal').id;
    fails(await b.p.client.get(`/budgets?month=${M}`), 403);
    fails(await b.p.client.put(`/budgets/${a.id.food}`, { month: M, amount: 5 }), 403);
    fails(await b.p.client.post('/budgets/fill', { month: M, source: 'typical' }), 403);
  });

  it('only a signed-in person can use it', async () => {
    const anon = new Client(srv.base.replace(/\/api$/, ''));
    assert.equal((await anon.get(`/budgets?month=${M}`)).status, 401);
    assert.equal((await anon.put('/budgets/1', { month: M, amount: 5 })).status, 401);
    assert.equal((await anon.post('/budgets/fill', { month: M, source: 'typical' })).status, 401);
  });

  it('a person who left a shared budget no longer reaches its budgets', async () => {
    const { a, b, group } = await household();
    const food = await categoryId(a.p.client, 'Groceries');
    await put(a.p, food, { month: M, amount: 300 });
    assert.equal(await budgetOf(b.p, 'Groceries'), 300);
    assert.equal((await b.p.client.post(`/workspaces/${group.id}/leave`, {})).status, 204);
    fails(await b.p.client.get(`/budgets?month=${M}`), 403);
  });
});

describe('the database keeps its own rules', () => {
  it('refuses a month that is not a month, a negative amount and the same month twice', async () => {
    const { id } = await person();
    const ws = (await srv.db.query('SELECT workspace_id FROM categories WHERE id = $1', [id.food])).rows[0].workspace_id;
    const insert = (month, amount) => srv.db.query('INSERT INTO category_budgets (workspace_id, category_id, month, amount) VALUES ($1, $2, $3, $4)', [ws, id.food, month, amount]);
    await assert.rejects(() => insert('2026-13', 10));
    await assert.rejects(() => insert('October', 10));
    await assert.rejects(() => insert('2026-10-01', 10));
    await assert.rejects(() => insert(M, -1));
    await insert(M, null); // "no budget from here on" is allowed
    await assert.rejects(() => insert(M, 5), /duplicate|unique/i);
  });

  it('a budget goes with its budget and with its category', async () => {
    const { p, id } = await person();
    const ws = (await srv.db.query('SELECT workspace_id FROM categories WHERE id = $1', [id.food])).rows[0].workspace_id;
    await put(p, id.food, { month: M, amount: 10 });
    assert.equal((await srv.db.query('SELECT count(*)::int AS n FROM category_budgets WHERE workspace_id = $1', [ws])).rows[0].n, 1);
    await srv.db.query('DELETE FROM categories WHERE id = $1', [id.food]);
    assert.equal((await srv.db.query('SELECT count(*)::int AS n FROM category_budgets WHERE workspace_id = $1', [ws])).rows[0].n, 0);
  });
});

describe('alerts, more closely', () => {
  it('a budget of zero is "over" at the first payment', async () => {
    const { p, id } = await person();
    await put(p, id.dining, { month: M, amount: 0 });
    await scan(p);
    assert.equal((await alerts(p)).length, 0, 'nothing spent');
    ok(await pay(p, id.dining, 3), 201);
    await scan(p);
    assert.deepEqual((await alerts(p)).map((n) => n.title), ['Dining & leisure is over its budget']);
  });

  it('are on by default, and paused alerts stay quiet', async () => {
    const { p, id } = await person();
    assert.equal(ok(await p.client.get('/notifications/settings')).budget_alerts, true);
    await put(p, id.food, { month: M, amount: 10 });
    ok(await pay(p, id.food, 50), 201);
    const later = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    ok(await p.client.put('/notifications/settings', { paused_until: later }));
    await scan(p);
    assert.equal((await alerts(p)).length, 0, 'paused');
    ok(await p.client.put('/notifications/settings', { paused_until: null }));
    await scan(p);
    assert.equal((await alerts(p)).length, 1);
  });

  it('a budget raised after the alert is not told again for the same level', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 50 });
    ok(await pay(p, id.food, 60), 201);
    await scan(p);
    await put(p, id.food, { month: M, amount: 500 });
    await scan(p);
    assert.equal((await alerts(p)).length, 1, 'still the one from before');
    ok(await pay(p, id.food, 600), 201);
    await scan(p);
    assert.equal((await alerts(p)).length, 1, 'that level was already told this month');
  });

  it('a member with alerts off is not told, the others are', async () => {
    const { a, b } = await household();
    ok(await b.p.client.put('/notifications/settings', { budget_alerts: false }));
    const food = await categoryId(a.p.client, 'Groceries');
    await put(a.p, food, { month: M, amount: 10 });
    ok(await tx(a.p.client, { description: 'Shop', amount: 40, category_id: food, status: 'paid', date: `${M}-01` }), 201);
    await scan(a.p);
    await scan(b.p);
    assert.equal((await alerts(a.p)).length, 1);
    assert.equal((await alerts(b.p)).length, 0);
  });

  it('skipped payments and planned payments do not count towards an alert', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 100 });
    const skipped = ok(await pay(p, id.food, 500, { status: 'pending' }), 201);
    await srv.db.query(`UPDATE transactions SET status = 'skipped' WHERE id = $1`, [skipped.id]);
    ok(await pay(p, id.food, 500, { status: 'pending', date: `${M}-28` }), 201);
    await scan(p);
    assert.equal((await alerts(p)).length, 0);
  });
});

describe('the assistant, more closely', () => {
  it('a category with no budget gets the general answer, not an invented one', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 400 });
    ok(await pay(p, id.food, 50), 201);
    ok(await pay(p, id.dining, 20), 201);
    const a = await ask(p, 'how much is left for dining in my budget?');
    assert.equal(a.intent, 'budget');
    assert.match(a.answer, /you have spent \$50 of the \$400 you budgeted/);
  });

  it('a month is not asked for by name: it answers for the current one', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 100 });
    ok(await pay(p, id.food, 150), 201);
    assert.match((await ask(p, 'budget status')).answer, /Groceries is over its budget by \$50/);
  });

  it('a shared budget is answered from the shared budgets, not the personal one', async () => {
    const { a, b } = await household();
    const food = await categoryId(a.p.client, 'Groceries');
    await put(a.p, food, { month: M, amount: 80 });
    ok(await tx(b.p.client, { description: 'Shop', amount: 100, category_id: food, status: 'paid', date: `${M}-01` }), 201);
    assert.match((await ask(a.p, 'how is my budget?')).answer, /Groceries is over its budget by \$20/);
    a.p.client.ws = null;
    ok(await pay(a.p, a.id.food, 5), 201); // something in the personal budget, which has no limits
    assert.match((await ask(a.p, 'how is my budget?')).answer, /not set a monthly budget yet/);
  });
});

describe('preferences and the menu', () => {
  it('the dashboard accepts the budget widget in a layout and the menu item as a favourite, and still refuses strangers', async () => {
    const { p } = await person();
    const layout = { order: ['hero', 'budget', 'spending'], hidden: ['budget'], sizes: { budget: 'l' } };
    ok(await p.client.put('/preferences', { layout, favorites: ['budget', 'payments'], collapsed: ['budget'] }));
    const got = ok(await p.client.get('/preferences'));
    assert.deepEqual(got.layout, layout);
    assert.deepEqual(got.favorites, ['budget', 'payments']);
    fails(await p.client.put('/preferences', { layout: { order: ['hero', 'budgets'] } }), 400);
    fails(await p.client.put('/preferences', { favorites: ['monthly-budget'] }), 400);
  });
});
