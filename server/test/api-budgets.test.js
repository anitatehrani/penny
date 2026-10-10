import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, connect, fails, ok, shutdown, signup, startServer, thisMonth, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('budgets');
});
after(async () => {
  await shutdown(srv);
});

const M = thisMonth();
const m = (back) => addMonthsYM(M, -back);
const view = async (p, month = M) => ok(await p.client.get(`/budgets?month=${month}`));
const line = (v, name) => v.lines.find((l) => l.name === name);
const budgetOf = async (p, name, month) => line(await view(p, month), name).budget;
const put = async (p, cat, body) => ok(await p.client.put(`/budgets/${cat}`, body));
/** A person with a few payments this month and last month, in some categories. */
async function person() {
  const p = await signup(srv);
  const id = { food: await categoryId(p.client, 'Groceries'), dining: await categoryId(p.client, 'Dining & leisure'), rent: await categoryId(p.client, 'Rent / Mortgage'), salary: await categoryId(p.client, 'Salary') };
  return { p, id };
}
const pay = (p, cat, amount, over = {}) => tx(p.client, { description: 'Payment', amount, category_id: cat, status: 'paid', date: `${M}-01`, ...over });

describe('a budget per category', () => {
  it('starts empty, then holds what is set, and the view counts the ledger', async () => {
    const { p, id } = await person();
    let v = await view(p);
    assert.equal(v.budgetedCount, 0);
    assert.equal(v.month, M);
    assert.equal(v.currency, 'USD');
    ok(await pay(p, id.food, 40), 201);
    ok(await pay(p, id.food, 25.5), 201);
    ok(await pay(p, id.food, 30, { status: 'pending', date: `${M}-28` }), 201);
    const skipped = ok(await pay(p, id.food, 99, { status: 'pending' }), 201);
    await srv.db.query(`UPDATE transactions SET status = 'skipped' WHERE id = $1`, [skipped.id]);
    ok(await pay(p, id.dining, 10, { source: 'manual' }), 201);
    v = await put(p, id.food, { month: M, amount: 200 });
    const g = line(v, 'Groceries');
    assert.deepEqual([g.budget, g.spent, g.planned, g.left, g.leftAfterPlanned], [200, 65.5, 30, 134.5, 104.5]);
    assert.equal(v.totals.budget, 200);
    assert.equal(v.totals.unbudgetedSpent, 10, 'dining has spending but no budget');
    assert.equal(line(v, 'Dining & leisure').status, 'none');
    assert.equal(v.budgetedCount, 1);
    assert.ok(v.findings.length > 0 && v.findings.every((f) => f.text && f.severity));
  });

  it('keeps income, balance adjustments and loans out of what is spent', async () => {
    const { p, id } = await person();
    ok(await tx(p.client, { type: 'income', description: 'Pay', amount: 1000, category_id: id.salary, status: 'paid', date: `${M}-01` }), 201);
    ok(await pay(p, id.food, 12), 201);
    await put(p, id.food, { month: M, amount: 100 });
    const v = await view(p);
    assert.equal(line(v, 'Groceries').spent, 12);
    assert.equal(v.totals.income, 1000);
    assert.equal(v.totals.unallocated, 900);
  });

  it('a budget set "from this month on" carries forward and leaves the past alone', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 300 });
    assert.equal(await budgetOf(p, 'Groceries', M), 300);
    assert.equal(await budgetOf(p, 'Groceries', addMonthsYM(M, 1)), 300);
    assert.equal(await budgetOf(p, 'Groceries', addMonthsYM(M, 7)), 300);
    assert.equal(await budgetOf(p, 'Groceries', m(1)), null, 'the month before had none');
    // changing it later does not rewrite the months between
    await put(p, id.food, { month: addMonthsYM(M, 2), amount: 350 });
    assert.deepEqual([await budgetOf(p, 'Groceries', addMonthsYM(M, 1)), await budgetOf(p, 'Groceries', addMonthsYM(M, 2)), await budgetOf(p, 'Groceries', addMonthsYM(M, 5))], [300, 350, 350]);
  });

  it('"from now on" replaces whatever later months had; "this month only" goes back afterwards', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 300 });
    await put(p, id.food, { month: addMonthsYM(M, 2), amount: 500 });
    await put(p, id.food, { month: M, amount: 320, scope: 'onward' });
    assert.equal(await budgetOf(p, 'Groceries', addMonthsYM(M, 2)), 320, 'the later override is gone');
    // only this month
    const next = addMonthsYM(M, 1);
    await put(p, id.food, { month: next, amount: 100, scope: 'month' });
    assert.deepEqual([await budgetOf(p, 'Groceries', next), await budgetOf(p, 'Groceries', addMonthsYM(M, 2)), await budgetOf(p, 'Groceries', M)], [100, 320, 320]);
    // only this month, in a month that had nothing yet: the month after stays empty
    await put(p, id.dining, { month: M, amount: 80, scope: 'month' });
    assert.equal(await budgetOf(p, 'Dining & leisure', M), 80);
    assert.equal(await budgetOf(p, 'Dining & leisure', next), null);
    // only this month with the same amount changes nothing around it
    await put(p, id.food, { month: M, amount: 320, scope: 'month' });
    assert.equal(await budgetOf(p, 'Groceries', next), 100);
  });

  it('takes a budget away from a month on (null), and zero is a real budget', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: m(1), amount: 250 });
    await put(p, id.food, { month: addMonthsYM(M, 1), amount: null });
    assert.equal(await budgetOf(p, 'Groceries', M), 250);
    assert.equal(await budgetOf(p, 'Groceries', addMonthsYM(M, 1)), null);
    assert.equal((await view(p, addMonthsYM(M, 1))).budgetedCount, 0);
    await put(p, id.dining, { month: M, amount: 0 });
    assert.equal(await budgetOf(p, 'Dining & leisure'), 0);
    ok(await pay(p, id.dining, 5), 201);
    assert.equal(line(await view(p), 'Dining & leisure').status, 'over');
  });

  it('refuses what is not a budget', async () => {
    const { p, id } = await person();
    for (const body of [
      { month: M, amount: -1 },
      { month: M, amount: 'lots' },
      { month: M, amount: 1e12 },
      { month: M },
      { amount: 10 },
      { month: '2026-13', amount: 10 },
      { month: 'October', amount: 10 },
      { month: M, amount: 10, scope: 'forever' },
      { month: M, amount: 10, extra: true },
    ]) fails(await p.client.put(`/budgets/${id.food}`, body), 400);
    fails(await p.client.put('/budgets/abc', { month: M, amount: 10 }), 400);
    fails(await p.client.put(`/budgets/${id.salary}`, { month: M, amount: 10 }), 400); // an income category
    fails(await p.client.get('/budgets?month=2026-99'), 400);
    assert.equal((await view(p)).budgetedCount, 0);
  });

  it('rounds to cents', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 10.456 });
    assert.equal(await budgetOf(p, 'Groceries'), 10.46);
  });
});

describe('filling in budgets for all categories', () => {
  it('suggests from what is typically spent and fills only the empty ones', async () => {
    const { p, id } = await person();
    for (const back of [1, 2, 3]) ok(await pay(p, id.food, 100 + back * 10, { date: `${m(back)}-05` }), 201); // 110, 120, 130: typical 120
    ok(await pay(p, id.dining, 50, { date: `${m(1)}-05` }), 201);
    await put(p, id.dining, { month: M, amount: 70 });
    const v = await view(p);
    assert.equal(line(v, 'Groceries').typical, 120);
    assert.equal(line(v, 'Groceries').suggested, 120);
    assert.equal(line(v, 'Groceries').lastMonth, 110);
    const filled = ok(await p.client.post('/budgets/fill', { month: M, source: 'typical' }));
    assert.equal(filled.filled, 1, 'only Groceries had none and some history');
    assert.equal(line(filled, 'Groceries').budget, 120);
    assert.equal(line(filled, 'Dining & leisure').budget, 70, 'what was set is kept');
    const again = ok(await p.client.post('/budgets/fill', { month: M, source: 'last_month', only_empty: false }));
    assert.equal(line(again, 'Groceries').budget, 110);
    assert.equal(line(again, 'Dining & leisure').budget, 50);
    assert.equal(await budgetOf(p, 'Groceries', addMonthsYM(M, 1)), 110, 'from this month on');
  });

  it('does nothing when there is no history, and refuses a wrong request', async () => {
    const { p } = await person();
    const r = ok(await p.client.post('/budgets/fill', { month: M, source: 'typical' }));
    assert.equal(r.filled, 0);
    fails(await p.client.post('/budgets/fill', { month: M, source: 'guess' }), 400);
    fails(await p.client.post('/budgets/fill', { source: 'typical' }), 400);
  });
});

describe('whose budget it is', () => {
  it('each budget has its own, and nobody else can set or read one through a category id', async () => {
    const a = await person();
    const b = await person();
    await put(a.p, a.id.food, { month: M, amount: 111 });
    assert.equal(await budgetOf(b.p, 'Groceries'), null);
    fails(await b.p.client.put(`/budgets/${a.id.food}`, { month: M, amount: 5 }), 400); // somebody else's category
    assert.equal(await budgetOf(a.p, 'Groceries'), 111);
  });

  it('in a shared budget every member sees and may change it, and it is separate from their own', async () => {
    const a = await person();
    const b = await person();
    await connect(a.p, b.p);
    const g = ok(await a.p.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await a.p.client.post(`/workspaces/${g.id}/invites`, { username: b.p.user.username }), 201);
    ok(await b.p.client.post(`/workspace-invites/${ok(await b.p.client.get('/inbox')).group_invites[0].id}/accept`));
    a.p.client.ws = g.id;
    b.p.client.ws = g.id;
    const food = await categoryId(a.p.client, 'Groceries');
    await put(a.p, food, { month: M, amount: 400 });
    assert.equal(await budgetOf(b.p, 'Groceries'), 400);
    await put(b.p, food, { month: M, amount: 450 });
    assert.equal(await budgetOf(a.p, 'Groceries'), 450);
    a.p.client.ws = null;
    assert.equal(await budgetOf(a.p, 'Groceries'), null, 'their own budget has none');
  });

  it('is removed with its category', async () => {
    const { p } = await person();
    const c = ok(await p.client.post('/categories', { name: 'Hobby', kind: 'expense', color: '#123456' }), 201);
    await put(p, c.id, { month: M, amount: 60 });
    assert.equal(await budgetOf(p, 'Hobby'), 60);
    assert.equal((await p.client.del(`/categories/${c.id}`)).status, 204);
    assert.equal(line(await view(p), 'Hobby'), undefined);
    assert.equal((await srv.db.query('SELECT count(*)::int AS n FROM category_budgets WHERE category_id = $1', [c.id])).rows[0].n, 0);
  });
});

describe('budget alerts', () => {
  const scan = async (p) => ok(await p.client.post('/notifications/refresh'));
  const alerts = async (p) => ok(await p.client.get('/notifications')).items.filter((n) => n.kind === 'budget_alert');

  it('tells a person once at 80% and once when a category is over, never twice for the same', async () => {
    const { p, id } = await person();
    await put(p, id.dining, { month: M, amount: 100 });
    await scan(p);
    assert.equal((await alerts(p)).length, 0, 'nothing is spent yet');
    ok(await pay(p, id.dining, 85), 201);
    await scan(p);
    await scan(p);
    let list = await alerts(p);
    assert.equal(list.length, 1);
    assert.match(list[0].title, /^Dining & leisure has used 85% of its budget$/);
    assert.match(list[0].body, /\$15(\.00)? left of \$100/);
    assert.equal(list[0].link, '/budget');
    ok(await pay(p, id.dining, 20), 201);
    await scan(p);
    await scan(p);
    list = await alerts(p);
    assert.equal(list.length, 2);
    assert.ok(list.some((n) => n.title === 'Dining & leisure is over its budget' && /\$105(\.00)? spent of \$100/.test(n.body)));
  });

  it('says only "over" when one payment goes straight past the budget', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 50 });
    ok(await pay(p, id.food, 80), 201);
    await scan(p);
    assert.deepEqual((await alerts(p)).map((n) => n.title), ['Groceries is over its budget']);
  });

  it('does nothing for categories with no budget, planned payments not yet paid, or when the person turned them off', async () => {
    const { p, id } = await person();
    ok(await pay(p, id.rent, 900), 201);
    ok(await pay(p, id.food, 90, { status: 'pending', date: `${M}-28` }), 201);
    await put(p, id.food, { month: M, amount: 100 });
    await scan(p);
    assert.equal((await alerts(p)).length, 0);
    ok(await p.client.put('/notifications/settings', { budget_alerts: false }));
    await put(p, id.rent, { month: M, amount: 100 });
    await scan(p);
    assert.equal((await alerts(p)).length, 0, 'switched off');
    assert.equal(ok(await p.client.get('/notifications/settings')).budget_alerts, false);
  });

  it('in a shared budget every member who has them on is told', async () => {
    const a = await person();
    const b = await person();
    await connect(a.p, b.p);
    const g = ok(await a.p.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await a.p.client.post(`/workspaces/${g.id}/invites`, { username: b.p.user.username }), 201);
    ok(await b.p.client.post(`/workspace-invites/${ok(await b.p.client.get('/inbox')).group_invites[0].id}/accept`));
    a.p.client.ws = g.id;
    b.p.client.ws = g.id;
    const food = await categoryId(a.p.client, 'Groceries');
    await put(a.p, food, { month: M, amount: 100 });
    ok(await tx(b.p.client, { description: 'Big shop', amount: 120, category_id: food, status: 'paid', date: `${M}-01` }), 201);
    await scan(a.p);
    await scan(b.p);
    for (const who of [a, b]) {
      const list = await alerts(who.p);
      assert.equal(list.length, 1);
      assert.match(list[0].body, /· Home$/);
    }
  });
});

describe('the assistant and the budget', () => {
  const ask = async (p, question) => ok(await p.client.post('/assistant/ask', { question, chip: true }));

  it('says there is no budget yet, and where to make one', async () => {
    const { p, id } = await person();
    ok(await pay(p, id.food, 10), 201);
    const a = await ask(p, 'How is my budget?');
    assert.equal(a.intent, 'budget');
    assert.match(a.answer, /not set a monthly budget yet/);
    assert.equal(a.link.to, '/budget');
  });

  it('answers for the whole budget, naming what is over, and for one category', async () => {
    const { p, id } = await person();
    await put(p, id.dining, { month: M, amount: 100 });
    await put(p, id.food, { month: M, amount: 400 });
    ok(await pay(p, id.dining, 130), 201);
    ok(await pay(p, id.food, 50), 201);
    const all = await ask(p, 'How is my budget?');
    assert.equal(all.intent, 'budget');
    assert.match(all.answer, /you have spent \$180 of the \$500 you budgeted, so \$320 is left/);
    assert.match(all.answer, /Dining & leisure is over its budget by \$30/);
    assert.ok(all.blocks[0].rows.some((r) => r.label === 'Dining & leisure' && r.sub === 'over budget'));
    const one = await ask(p, 'how much is left for groceries?');
    assert.equal(one.intent, 'budget');
    assert.match(one.answer, /^Groceries: \$50 spent of its \$400 budget/);
    const over = await ask(p, 'am I over budget on dining?');
    assert.match(over.answer, /Dining & leisure: \$130 spent of its \$100 budget.*That is \$30 over\./);
  });

  it('leaves the spending questions alone', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 400 });
    ok(await pay(p, id.food, 50), 201);
    assert.equal((await ask(p, 'how much did I spend on groceries?')).intent, 'category');
    assert.equal((await ask(p, 'Where does my money go?')).intent, 'categories');
  });
});

describe('the data export', () => {
  it('holds the monthly budgets, by category name', async () => {
    const { p, id } = await person();
    await put(p, id.food, { month: M, amount: 250 });
    await put(p, id.food, { month: addMonthsYM(M, 2), amount: null });
    const data = ok(await p.client.get('/auth/account/export'));
    const mine = data.budgets.find((x) => x.kind === 'personal');
    assert.deepEqual(mine.monthly_budget.map((b) => [b.category, b.from_month, b.amount]), [['Groceries', M, 250], ['Groceries', addMonthsYM(M, 2), null]]);
    assert.ok(!JSON.stringify(mine.monthly_budget).includes('workspace_id'));
  });
});
