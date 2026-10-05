import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM, monthEnd } from '../src/lib/dates.js';
import { categoryId, daysFromToday, fails, ok, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('budget');
});
after(async () => {
  await shutdown(srv);
});

/** A fresh user so every group of tests starts from an empty budget. */
const fresh = async () => (await signup(srv)).client;

describe('settings', () => {
  it('starts at zero in USD', async () => {
    const c = await fresh();
    assert.deepEqual(ok(await c.get('/settings')), { opening_balance: 0, currency: 'USD', card_pay_day: 10, carry_over: true });
  });

  it('accepts a negative starting balance and normalises the currency', async () => {
    const c = await fresh();
    const r = ok(await c.put('/settings', { opening_balance: -250.5, currency: 'eur' }));
    assert.deepEqual(r, { opening_balance: -250.5, currency: 'EUR', card_pay_day: 10, carry_over: true });
    assert.equal(ok(await c.get('/summary')).balance, -250.5, 'the balance really starts negative');
  });

  it('rejects bad values', async () => {
    const c = await fresh();
    for (const bad of [
      { opening_balance: 'abc', currency: 'USD' },
      { opening_balance: null, currency: 'USD' },
      { opening_balance: [], currency: 'USD' },
      { opening_balance: true, currency: 'USD' },
      { opening_balance: '', currency: 'USD' },
      { opening_balance: 1e11, currency: 'USD' },
      { opening_balance: -1e11, currency: 'USD' },
      { opening_balance: 0, currency: 'EURO' },
      { opening_balance: 0, currency: '12$' },
      { opening_balance: 0 },
      {},
    ]) {
      fails(await c.put('/settings', bad), 400);
    }
    assert.deepEqual(ok(await c.get('/settings')), { opening_balance: 0, currency: 'USD', card_pay_day: 10, carry_over: true }, 'nothing changed');
  });

  it('rounds the starting balance to cents', async () => {
    const c = await fresh();
    assert.equal(ok(await c.put('/settings', { opening_balance: 10.126, currency: 'USD' })).opening_balance, 10.13);
  });
});

describe('categories', () => {
  it('are seeded and carry usage counts', async () => {
    const c = await fresh();
    const cats = ok(await c.get('/categories'));
    assert.equal(cats.length, 14);
    assert.equal(cats.filter((x) => x.kind === 'income').length, 4);
    assert.ok(cats.every((x) => x.usage_count === 0));
    const groceries = cats.find((x) => x.name === 'Groceries');
    await tx(c, { category_id: groceries.id });
    assert.equal(ok(await c.get('/categories')).find((x) => x.name === 'Groceries').usage_count, 1);
  });

  it('can be created, renamed, recoloured and deleted', async () => {
    const c = await fresh();
    const made = ok(await c.post('/categories', { name: 'Pets', kind: 'expense', color: '#aabbcc' }), 201);
    assert.equal(made.name, 'Pets');
    const renamed = ok(await c.put(`/categories/${made.id}`, { name: 'Pet care', kind: 'expense', color: '#112233' }));
    assert.deepEqual([renamed.name, renamed.color], ['Pet care', '#112233']);
    assert.equal((await c.del(`/categories/${made.id}`)).status, 204);
    fails(await c.del(`/categories/${made.id}`), 404);
  });

  it('enforces uniqueness per kind, name length and colour format', async () => {
    const c = await fresh();
    fails(await c.post('/categories', { name: 'Groceries', kind: 'expense', color: '#000000' }), 409);
    ok(await c.post('/categories', { name: 'Groceries', kind: 'income', color: '#000000' }), 201); // same name, other kind
    for (const bad of [
      { name: '', kind: 'expense', color: '#000000' },
      { name: '   ', kind: 'expense', color: '#000000' },
      { name: 'x'.repeat(61), kind: 'expense', color: '#000000' },
      { name: 'ok', kind: 'both', color: '#000000' },
      { name: 'ok', kind: 'expense', color: 'red' },
      { name: 'ok', kind: 'expense', color: '#12345' },
      { name: 'ok', kind: 'expense', color: '#gggggg' },
    ]) {
      fails(await c.post('/categories', bad), 400);
    }
  });

  it('deleting a category un-categorises its payments, recurring items and plans', async () => {
    const c = await fresh();
    const cat = ok(await c.post('/categories', { name: 'Temp', kind: 'expense', color: '#123456' }), 201);
    const t = ok(await tx(c, { category_id: cat.id }), 201);
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'r', amount: 5, frequency: 'monthly', start_date: today(), category_id: cat.id }), 201);
    const plan = ok(await c.post('/installments', { description: 'p', total_amount: 30, installment_count: 3, first_due_date: today(), category_id: cat.id }), 201);
    assert.equal((await c.del(`/categories/${cat.id}`)).status, 204);
    assert.equal(ok(await c.get('/transactions?q=Test payment')).find((x) => x.id === t.id).category_id, null);
    assert.equal(ok(await c.get('/recurring')).find((x) => x.id === rule.id).category_id, null);
    assert.equal(ok(await c.get('/installments')).find((x) => x.id === plan.id).category_id, null);
  });
});

describe('payments: validation', () => {
  it('rejects every kind of bad input', async () => {
    const c = await fresh();
    const base = { type: 'expense', description: 'x', amount: 5, date: today() };
    const bad = [
      { ...base, description: '' },
      { ...base, description: '   ' },
      { ...base, description: 'x'.repeat(201) },
      { ...base, amount: 0 },
      { ...base, amount: -1 },
      { ...base, amount: 'abc' },
      { ...base, amount: 1e10 },
      { ...base, amount: null },
      { ...base, amount: true },
      { ...base, amount: [] },
      { ...base, amount: '' },
      { ...base, amount: '  ' },
      { ...base, amount: {} },
      { ...base, amount: Infinity },
      { ...base, date: '2026-02-30' },
      { ...base, date: '2026-2-3' },
      { ...base, date: '' },
      { ...base, date: 20261001 },
      { ...base, type: 'transfer' },
      { ...base, status: 'skipped' },
      { ...base, status: 'bogus' },
      { ...base, note: 'n'.repeat(1001) },
      { ...base, category_id: 'abc' },
      { ...base, category_id: 0 },
      { ...base, category_id: 1.5 },
      { ...base, participants: 'x' },
      {},
    ];
    for (const b of bad) fails(await c.post('/transactions', b), 400);
    assert.equal(ok(await c.get('/transactions?status=')).length, 0, 'nothing was saved');
  });

  it('rounds amounts to cents and trims descriptions', async () => {
    const c = await fresh();
    const t = ok(await tx(c, { description: '  Padded  ', amount: 10.126 }), 201);
    assert.equal(t.amount, 10.13);
    assert.equal(t.description, 'Padded');
  });

  it('accepts the extremes that are allowed', async () => {
    const c = await fresh();
    ok(await tx(c, { amount: 0.01 }), 201);
    ok(await tx(c, { amount: 9_999_999_999 }), 201);
    ok(await tx(c, { description: 'x'.repeat(200), note: 'n'.repeat(1000) }), 201);
    ok(await tx(c, { description: 'Ünïcödé 日本語 🎉 <b>bold</b> "quotes" \'single\'' }), 201);
  });

  it('refuses a category that does not exist', async () => {
    const c = await fresh();
    fails(await tx(c, { category_id: 999999 }), 400);
  });
});

describe('payments: status, edit, delete', () => {
  it('defaults status by date: past/today are paid, future is pending, and explicit wins', async () => {
    const c = await fresh();
    assert.equal(ok(await tx(c, { date: daysFromToday(-30) }), 201).status, 'paid');
    assert.equal(ok(await tx(c, { date: today() }), 201).status, 'paid');
    assert.equal(ok(await tx(c, { date: daysFromToday(1) }), 201).status, 'pending');
    assert.equal(ok(await tx(c, { date: daysFromToday(-30), status: 'pending' }), 201).status, 'pending');
    assert.equal(ok(await tx(c, { date: daysFromToday(30), status: 'paid' }), 201).status, 'paid');
  });

  it('can be edited, marked paid/pending/skipped and deleted', async () => {
    const c = await fresh();
    const t = ok(await tx(c, { description: 'Old', amount: 10 }), 201);
    const edited = ok(await c.put(`/transactions/${t.id}`, { type: 'income', description: 'New', amount: 99.5, date: daysFromToday(-3), note: 'hi' }));
    assert.deepEqual([edited.type, edited.description, edited.amount, edited.date, edited.note], ['income', 'New', 99.5, daysFromToday(-3), 'hi']);
    assert.equal(edited.status, 'paid', 'status is kept when not provided');
    assert.equal(ok(await c.patch(`/transactions/${t.id}/status`, { status: 'pending' })).status, 'pending');
    assert.equal(ok(await c.patch(`/transactions/${t.id}/status`, { status: 'paid' })).status, 'paid');
    assert.equal(ok(await c.patch(`/transactions/${t.id}/status`, { status: 'skipped' })).status, 'skipped');
    fails(await c.patch(`/transactions/${t.id}/status`, { status: 'weird' }), 400);
    assert.deepEqual(ok(await c.del(`/transactions/${t.id}`)), { deleted: true });
    fails(await c.del(`/transactions/${t.id}`), 404);
    fails(await c.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 1, date: today() }), 404);
    fails(await c.patch(`/transactions/${t.id}/status`, { status: 'paid' }), 404);
  });

  it('a failed edit leaves the payment unchanged', async () => {
    const c = await fresh();
    const t = ok(await tx(c, { description: 'Keep', amount: 10 }), 201);
    fails(await c.put(`/transactions/${t.id}`, { type: 'expense', description: 'Keep', amount: -5, date: today() }), 400);
    assert.equal(ok(await c.get('/transactions?q=Keep'))[0].amount, 10);
  });
});

describe('payments: listing and filters', () => {
  let c;
  let cat;
  before(async () => {
    c = await fresh();
    cat = await categoryId(c, 'Groceries');
    // Fixed historical months so these tests do not depend on the current date.
    await tx(c, { description: 'Oct first', date: '2025-10-01', amount: 1, category_id: cat });
    await tx(c, { description: 'Oct last', date: '2025-10-31', amount: 2, type: 'income' });
    await tx(c, { description: 'Nov first', date: '2025-11-01', amount: 3 });
    await tx(c, { description: '100% organic', date: '2025-10-15', amount: 4, note: 'Fresh_stuff' });
    await tx(c, { description: 'Pending thing', date: '2025-10-20', amount: 5, status: 'pending' });
    await tx(c, { description: 'MiXeD CaSe', date: '2025-12-05', amount: 6 });
  });

  it('filters by month including the first and last day', async () => {
    const oct = ok(await c.get('/transactions?month=2025-10')).map((t) => t.description);
    assert.deepEqual(oct, ['Oct first', '100% organic', 'Pending thing', 'Oct last'], 'sorted by date, boundaries included');
    assert.deepEqual(ok(await c.get('/transactions?month=2025-11')).map((t) => t.description), ['Nov first']);
    assert.deepEqual(ok(await c.get('/transactions?month=2025-09')), []);
  });

  it('filters by from/to, type, category, status', async () => {
    assert.equal(ok(await c.get('/transactions?from=2025-10-15&to=2025-11-01')).length, 4);
    assert.deepEqual(ok(await c.get('/transactions?month=2025-10&type=income')).map((t) => t.description), ['Oct last']);
    assert.deepEqual(ok(await c.get(`/transactions?category_id=${cat}`)).map((t) => t.description), ['Oct first']);
    assert.ok(ok(await c.get('/transactions?category_id=none')).every((t) => t.category_id === null));
    assert.deepEqual(ok(await c.get('/transactions?status=pending')).map((t) => t.description), ['Pending thing']);
    assert.equal(ok(await c.get('/transactions?status=paid')).length, 5);
    assert.deepEqual(ok(await c.get('/transactions?status=overdue')).map((t) => t.description), ['Pending thing'], 'old pending = overdue');
  });

  it('searches description and note, case-insensitively, treating % and _ literally', async () => {
    assert.deepEqual(ok(await c.get('/transactions?q=mixed case')).map((t) => t.description), ['MiXeD CaSe']);
    assert.deepEqual(ok(await c.get('/transactions?q=%25')).map((t) => t.description), ['100% organic'], '% is not a wildcard');
    assert.deepEqual(ok(await c.get('/transactions?q=_')).map((t) => t.description), ['100% organic'], '_ only matches the note with an underscore');
    assert.deepEqual(ok(await c.get('/transactions?q=fresh_')).map((t) => t.description), ['100% organic'], 'note is searched');
    assert.deepEqual(ok(await c.get('/transactions?q=zzzz')), []);
  });

  it('skipped items are hidden unless asked for', async () => {
    const t = ok(await tx(c, { description: 'Will skip', date: '2025-10-02' }), 201);
    ok(await c.patch(`/transactions/${t.id}/status`, { status: 'skipped' }));
    assert.ok(!ok(await c.get('/transactions?month=2025-10')).some((x) => x.id === t.id));
    assert.deepEqual(ok(await c.get('/transactions?status=skipped')).map((x) => x.id), [t.id]);
  });

  it('rejects malformed filters instead of failing', async () => {
    for (const q of ['month=2025-13', 'month=2025-1', 'month=abc', 'from=nope', 'to=2025-99-99', 'type=bogus', 'category_id=abc', 'category_id=1.5', 'member=Not%20Valid!']) {
      fails(await c.get(`/transactions?${q}`), 400);
    }
    ok(await c.get('/transactions?limit=abc'));
    assert.equal(ok(await c.get('/transactions?month=2025-10&limit=2')).length, 2);
    ok(await c.get('/transactions?status=nonsense')); // unknown status behaves like "all"
  });
});

describe('CSV export', () => {
  it('exports with headers, quoting and spreadsheet-formula protection', async () => {
    const c = await fresh();
    await tx(c, { description: 'Plain', amount: 1.5, date: '2025-05-01' });
    await tx(c, { description: 'Has, comma', amount: 2, date: '2025-05-02', note: 'He said "hi"\nsecond line' });
    await tx(c, { description: '=HYPERLINK("http://evil","x")', amount: 3, date: '2025-05-03' });
    await tx(c, { description: '@SUM(A1)', amount: 4, date: '2025-05-04' });
    await tx(c, { description: '-2+3', amount: 5, date: '2025-05-05' });
    await tx(c, { description: '+cmd', amount: 6, date: '2025-05-06' });
    const r = await c.get('/transactions/export.csv?month=2025-05');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    const lines = r.text.split('\n');
    assert.equal(lines[0], 'date,type,description,category,amount,status,paid_with,bought_on,with,receipts,note');
    assert.ok(r.text.includes('"Has, comma"'));
    assert.ok(r.text.includes('"He said ""hi""\nsecond line"'), 'quotes doubled, newline kept inside quotes');
    assert.ok(r.text.includes(`'=HYPERLINK`), 'formula neutralised');
    assert.ok(r.text.includes(`'@SUM(A1)`));
    assert.ok(r.text.includes(`'-2+3`));
    assert.ok(r.text.includes(`'+cmd`));
    assert.ok(r.text.includes('2025-05-01,expense,Plain,,1.50,paid'));
  });

  it('respects filters', async () => {
    const c = await fresh();
    await tx(c, { description: 'In', date: '2025-06-10' });
    await tx(c, { description: 'Out', date: '2025-07-10' });
    const r = await c.get('/transactions/export.csv?month=2025-06');
    assert.ok(r.text.includes('In') && !r.text.includes('Out'));
  });
});

describe('recurring items', () => {
  it('monthly: generates pending payments for the next two years from this month', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'Rent', amount: 900, frequency: 'monthly', start_date: `${thisMonth()}-05` }), 201);
    const all = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id);
    assert.ok(all.length >= 24 && all.length <= 26, `got ${all.length}`);
    assert.ok(all.every((t) => t.source === 'recurring' && t.amount === 900 && t.date.endsWith('-05')));
    assert.equal(new Set(all.map((t) => t.date)).size, all.length, 'no duplicates');
    assert.ok(rule.next_date);
  });

  it('a start date in the past only generates from the current month on', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'Old', amount: 5, frequency: 'monthly', start_date: '2020-01-15' }), 201);
    const dates = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id).map((t) => t.date);
    assert.ok(dates.every((d) => d >= `${thisMonth()}-01`), 'nothing in the past');
  });

  it('keeps the anchor day in short months (31st)', async () => {
    const c = await fresh();
    const start = `${addMonthsYM(thisMonth(), 1)}-31`;
    // pick a month that has 31 days as the anchor
    const anchorMonth = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => addMonthsYM(thisMonth(), n)).find((m) => monthEnd(m).endsWith('-31'));
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'End of month', amount: 1, frequency: 'monthly', start_date: `${anchorMonth}-31` }), 201);
    const dates = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id).map((t) => t.date);
    for (const d of dates) assert.equal(d, `${d.slice(0, 7)}-${String(Math.min(31, Number(monthEnd(d.slice(0, 7)).slice(8)))).padStart(2, '0')}`, `${d} should be the 31st or the last day`);
    assert.ok(dates.some((d) => d.endsWith('-28') || d.endsWith('-29') || d.endsWith('-30')), 'short months are clamped');
    assert.ok(start);
  });

  it('weekly, every-2-weeks and yearly intervals', async () => {
    const c = await fresh();
    const weekly = ok(await c.post('/recurring', { type: 'expense', description: 'W', amount: 1, frequency: 'weekly', start_date: today() }), 201);
    const biweekly = ok(await c.post('/recurring', { type: 'expense', description: 'B', amount: 1, frequency: 'weekly', interval_count: 2, start_date: today() }), 201);
    const yearly = ok(await c.post('/recurring', { type: 'expense', description: 'Y', amount: 1, frequency: 'yearly', start_date: today() }), 201);
    const quarterly = ok(await c.post('/recurring', { type: 'expense', description: 'Q', amount: 1, frequency: 'monthly', interval_count: 3, start_date: today() }), 201);
    const all = ok(await c.get('/transactions?status=pending&limit=5000'));
    const of = (r) => all.filter((t) => t.recurring_id === r.id).map((t) => t.date).sort();
    const w = of(weekly);
    assert.ok(w.length >= 100, `weekly over two years: ${w.length}`);
    for (let i = 1; i < w.length; i++) assert.equal((new Date(w[i]) - new Date(w[i - 1])) / 86_400_000, 7);
    const b = of(biweekly);
    for (let i = 1; i < b.length; i++) assert.equal((new Date(b[i]) - new Date(b[i - 1])) / 86_400_000, 14);
    assert.ok(of(yearly).length >= 2 && of(yearly).length <= 3);
    const q = of(quarterly);
    assert.ok(q.length >= 8 && q.length <= 9, `quarterly: ${q.length}`);
  });

  it('stops at the end date', async () => {
    const c = await fresh();
    const end = daysFromToday(75);
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'Ends', amount: 1, frequency: 'weekly', start_date: today(), end_date: end }), 201);
    const dates = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id).map((t) => t.date);
    assert.ok(dates.length >= 10 && dates.length <= 12);
    assert.ok(dates.every((d) => d <= end));
  });

  it('validates input', async () => {
    const c = await fresh();
    const base = { type: 'expense', description: 'x', amount: 1, frequency: 'monthly', start_date: today() };
    for (const bad of [
      { ...base, end_date: daysFromToday(-1) },
      { ...base, interval_count: 0 },
      { ...base, interval_count: 61 },
      { ...base, interval_count: 1.5 },
      { ...base, frequency: 'daily' },
      { ...base, amount: 0 },
      { ...base, start_date: 'soon' },
      { ...base, description: '' },
      { ...base, type: 'x' },
    ]) {
      fails(await c.post('/recurring', bad), 400);
    }
    assert.deepEqual(ok(await c.get('/recurring')), []);
  });

  it('editing updates unpaid occurrences but never paid ones, and skipped ones stay skipped', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'Gym', amount: 40, frequency: 'monthly', start_date: `${thisMonth()}-10` }), 201);
    const occ = () => ok(c.get('/transactions?status=&limit=500') && null) ?? null;
    const list = async (status) => ok(await c.get(`/transactions?status=${status}&limit=500`)).filter((t) => t.recurring_id === rule.id);
    const pendingBefore = await list('pending');
    const first = pendingBefore[0];
    const second = pendingBefore[1];
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    assert.equal(ok(await c.del(`/transactions/${second.id}`)).skipped, true, 'deleting an occurrence skips it');
    const updated = ok(await c.put(`/recurring/${rule.id}`, { type: 'expense', description: 'Gym+', amount: 55, frequency: 'monthly', start_date: `${thisMonth()}-10`, active: true }));
    assert.equal(updated.amount, 55);
    const paid = (await list('paid')).find((t) => t.id === first.id);
    assert.equal(paid.amount, 40, 'paid history is untouched');
    assert.ok((await list('pending')).every((t) => t.amount === 55 && t.description === 'Gym+'), 'unpaid ones follow the rule');
    assert.ok((await list('skipped')).some((t) => t.id === second.id), 'skip survived the edit');
    assert.ok(!(await list('pending')).some((t) => t.date === second.date), 'and was not regenerated');
    assert.ok(occ);
  });

  it('pausing removes unpaid occurrences and resuming brings them back', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'P', amount: 5, frequency: 'monthly', start_date: today() }), 201);
    const body = { type: 'expense', description: 'P', amount: 5, frequency: 'monthly', start_date: today() };
    const count = async () => ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id).length;
    assert.ok((await count()) > 20);
    ok(await c.put(`/recurring/${rule.id}`, { ...body, active: false }));
    assert.equal(await count(), 0);
    assert.equal(ok(await c.get('/recurring'))[0].active, false);
    ok(await c.put(`/recurring/${rule.id}`, { ...body, active: true }));
    assert.ok((await count()) > 20);
  });

  it('changing income to expense (or the day) rewrites the future', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'income', description: 'Pay', amount: 100, frequency: 'monthly', start_date: `${thisMonth()}-05` }), 201);
    ok(await c.put(`/recurring/${rule.id}`, { type: 'expense', description: 'Pay', amount: 100, frequency: 'monthly', start_date: `${thisMonth()}-20`, active: true }));
    const items = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id);
    assert.ok(items.every((t) => t.type === 'expense' && t.date.endsWith('-20')));
  });

  it('deleting removes unpaid/skipped occurrences and keeps paid history', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'Del', amount: 5, frequency: 'monthly', start_date: today() }), 201);
    const pending = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id);
    ok(await c.patch(`/transactions/${pending[0].id}/status`, { status: 'paid' }));
    ok(await c.del(`/transactions/${pending[1].id}`)); // skipped
    assert.equal((await c.del(`/recurring/${rule.id}`)).status, 204);
    const left = ok(await c.get('/transactions?status=&limit=500'));
    assert.equal(left.length, 1);
    assert.equal(left[0].id, pending[0].id);
    assert.equal(left[0].recurring_id, null);
    assert.equal(ok(await c.get('/transactions?status=skipped')).length, 0);
    fails(await c.del(`/recurring/${rule.id}`), 404);
  });

  it('hard-deleting a skipped occurrence removes it for good', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'H', amount: 5, frequency: 'monthly', start_date: today() }), 201);
    const t = ok(await c.get('/transactions?status=pending&limit=500')).find((x) => x.recurring_id === rule.id);
    assert.equal(ok(await c.del(`/transactions/${t.id}`)).skipped, true);
    assert.equal(ok(await c.del(`/transactions/${t.id}`)).deleted, true, 'second delete removes the skipped row');
    ok(await c.put(`/recurring/${rule.id}`, { type: 'expense', description: 'H', amount: 5, frequency: 'monthly', start_date: today(), active: true }));
    assert.ok(ok(await c.get('/transactions?status=pending&limit=500')).some((x) => x.date === t.date), 'regenerated by the next rule edit');
  });

  it('a recurring occurrence can be moved onto a day another one already has (both are kept; see api-recurring-slots for why)', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', { type: 'expense', description: 'Clash', amount: 5, frequency: 'monthly', start_date: today() }), 201);
    const [a, b] = ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id);
    const moved = ok(await c.put(`/transactions/${b.id}`, { type: 'expense', description: 'Clash', amount: 5, date: a.date }));
    assert.equal(moved.date, a.date);
    assert.equal(ok(await c.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id && t.date === a.date).length, 2);
  });
});

describe('installments', () => {
  it('splits a total exactly, extra cents go to the first ones', async () => {
    const c = await fresh();
    const plan = ok(await c.post('/installments', { description: 'Laptop', total_amount: 1000, installment_count: 3, first_due_date: '2030-01-15' }), 201);
    const items = ok(await c.get('/transactions?q=Laptop')).sort((a, b) => a.installment_no - b.installment_no);
    assert.deepEqual(items.map((t) => t.amount), [333.34, 333.33, 333.33]);
    assert.deepEqual(items.map((t) => t.date), ['2030-01-15', '2030-02-15', '2030-03-15']);
    assert.deepEqual(items.map((t) => t.description), ['Laptop (1/3)', 'Laptop (2/3)', 'Laptop (3/3)']);
    assert.equal(Math.round(items.reduce((s, t) => s + t.amount, 0) * 100), 100000);
    assert.equal(plan.total_amount, 1000);
    assert.equal(plan.remaining_count, 3);
    assert.equal(plan.next_due, '2030-01-15');
  });

  it('per-installment amount multiplies out', async () => {
    const c = await fresh();
    const plan = ok(await c.post('/installments', { description: 'Phone', installment_amount: 99.99, installment_count: 12, first_due_date: '2030-01-01' }), 201);
    assert.equal(plan.total_amount, 1199.88);
    assert.equal(plan.installment_count, 12);
  });

  it('"already paid" marks the earliest ones as paid and tracks progress', async () => {
    const c = await fresh();
    const plan = ok(await c.post('/installments', { description: 'Sofa', total_amount: 600, installment_count: 6, first_due_date: '2030-01-10', paid_count: 2 }), 201);
    assert.equal(plan.paid_count, 2);
    assert.equal(plan.remaining_count, 4);
    assert.equal(plan.paid_total, 200);
    assert.equal(plan.remaining_total, 400);
    assert.equal(plan.next_due, '2030-03-10');
    const items = ok(await c.get('/transactions?q=Sofa&status=paid'));
    assert.deepEqual(items.map((t) => t.installment_no).sort(), [1, 2]);
    // paying the next one moves progress
    const next = ok(await c.get('/transactions?q=Sofa&status=pending')).sort((a, b) => a.installment_no - b.installment_no)[0];
    ok(await c.patch(`/transactions/${next.id}/status`, { status: 'paid' }));
    const after = ok(await c.get('/installments'))[0];
    assert.equal(after.paid_count, 3);
    assert.equal(after.next_due, '2030-04-10');
  });

  it('fully paid plans have no next due date', async () => {
    const c = await fresh();
    const plan = ok(await c.post('/installments', { description: 'Done', total_amount: 100, installment_count: 2, first_due_date: '2020-01-01', paid_count: 2 }), 201);
    assert.equal(plan.remaining_count, 0);
    assert.equal(plan.remaining_total, 0);
    assert.equal(plan.next_due, null);
  });

  it('keeps the anchor day across short months', async () => {
    const c = await fresh();
    ok(await c.post('/installments', { description: 'Thirty-first', total_amount: 40, installment_count: 4, first_due_date: '2031-01-31' }), 201);
    const dates = ok(await c.get('/transactions?q=Thirty-first')).map((t) => t.date).sort();
    assert.deepEqual(dates, ['2031-01-31', '2031-02-28', '2031-03-31', '2031-04-30']);
  });

  it('validates input', async () => {
    const c = await fresh();
    const base = { description: 'x', total_amount: 100, installment_count: 3, first_due_date: '2030-01-01' };
    for (const bad of [
      { ...base, total_amount: undefined },
      { ...base, installment_count: 0 },
      { ...base, installment_count: 361 },
      { ...base, installment_count: 2.5 },
      { ...base, paid_count: 4 },
      { ...base, paid_count: -1 },
      { ...base, total_amount: -5 },
      { ...base, total_amount: 'abc' },
      { ...base, first_due_date: '2030-13-01' },
      { ...base, description: '' },
    ]) {
      fails(await c.post('/installments', bad), 400);
    }
    assert.deepEqual(ok(await c.get('/installments')), []);
    assert.equal(ok(await c.get('/transactions?status=')).length, 0, 'a rejected plan creates no payments (atomic)');
  });

  it('supports the maximum of 360 installments', async () => {
    const c = await fresh();
    ok(await c.post('/installments', { description: 'Mortgage', installment_amount: 500, installment_count: 360, first_due_date: '2030-01-01' }), 201);
    assert.equal(ok(await c.get('/transactions?q=Mortgage&limit=5000')).length, 360);
  });

  it('editing renames the plan and its payments but not amounts', async () => {
    const c = await fresh();
    const plan = ok(await c.post('/installments', { description: 'Old', total_amount: 90, installment_count: 3, first_due_date: '2030-01-01' }), 201);
    const cat = await categoryId(c, 'Health');
    const upd = ok(await c.put(`/installments/${plan.id}`, { description: 'Dentist', category_id: cat, note: 'braces' }));
    assert.equal(upd.description, 'Dentist');
    const items = ok(await c.get('/transactions?q=Dentist'));
    assert.equal(items.length, 3);
    assert.ok(items.every((t) => t.category_id === cat && t.note === 'braces' && t.amount === 30));
    assert.deepEqual(items.map((t) => t.description).sort(), ['Dentist (1/3)', 'Dentist (2/3)', 'Dentist (3/3)']);
  });

  it('deleting removes unpaid installments and keeps the paid ones as history', async () => {
    const c = await fresh();
    const plan = ok(await c.post('/installments', { description: 'Gone', total_amount: 90, installment_count: 3, first_due_date: '2030-01-01', paid_count: 1 }), 201);
    assert.equal((await c.del(`/installments/${plan.id}`)).status, 204);
    const left = ok(await c.get('/transactions?q=Gone'));
    assert.equal(left.length, 1);
    assert.equal(left[0].status, 'paid');
    assert.equal(left[0].installment_plan_id, null);
    fails(await c.del(`/installments/${plan.id}`), 404);
  });
});

describe('dashboard summary', () => {
  it('adds up the month, the balance and the projection', async () => {
    const c = await fresh();
    const M = thisMonth();
    ok(await c.put('/settings', { opening_balance: 100, currency: 'USD' }));
    await tx(c, { type: 'income', amount: 1000, date: `${M}-01`, status: 'paid' });
    await tx(c, { amount: 200, date: `${M}-01`, status: 'paid' });
    await tx(c, { amount: 300, date: `${M}-28`, status: 'pending' });
    await tx(c, { type: 'income', amount: 500, date: `${M}-28`, status: 'pending' });
    const s = ok(await c.get(`/summary?month=${M}`));
    assert.deepEqual(s.totals, { incomePaid: 1000, incomePending: 500, expensePaid: 200, expensePending: 300, net: 1000 });
    assert.equal(s.balance, 100 + 1000 - 200);
    assert.equal(s.projectedMonthEnd, 900 + 500 - 300);
    assert.equal(s.currency, 'USD');
    assert.deepEqual(s.byMember, [], 'personal budgets have no member breakdown');
  });

  it('groups expenses by category incl. "Uncategorized" and ignores skipped', async () => {
    const c = await fresh();
    const M = thisMonth();
    const g = await categoryId(c, 'Groceries');
    await tx(c, { amount: 50, date: `${M}-02`, category_id: g });
    await tx(c, { amount: 25, date: `${M}-03`, category_id: g, status: 'pending' });
    await tx(c, { amount: 7, date: `${M}-04` });
    const skipped = ok(await tx(c, { amount: 999, date: `${M}-05`, category_id: g }), 201);
    ok(await c.patch(`/transactions/${skipped.id}/status`, { status: 'skipped' }));
    await tx(c, { type: 'income', amount: 1000, date: `${M}-05` });
    const s = ok(await c.get(`/summary?month=${M}`));
    const names = Object.fromEntries(s.byCategory.map((x) => [x.name, x]));
    assert.equal(names.Groceries.total, 75);
    assert.equal(names.Groceries.paid, 50);
    assert.equal(names.Uncategorized.total, 7);
    assert.equal(s.byCategory.length, 2, 'income and skipped items are not in the expense breakdown');
    assert.equal(s.byCategory[0].name, 'Groceries', 'largest first');
  });

  it('lists overdue items and what is due in the next 14 days', async () => {
    const c = await fresh();
    await tx(c, { description: 'Late', amount: 40, date: daysFromToday(-5), status: 'pending' });
    await tx(c, { description: 'Tomorrow', amount: 10, date: daysFromToday(1), status: 'pending' });
    await tx(c, { description: 'Today', amount: 11, date: today(), status: 'pending' });
    await tx(c, { description: 'Day 14', amount: 12, date: daysFromToday(14), status: 'pending' });
    await tx(c, { description: 'Day 15', amount: 13, date: daysFromToday(15), status: 'pending' });
    await tx(c, { description: 'Paid late', amount: 14, date: daysFromToday(-5), status: 'paid' });
    const s = ok(await c.get('/summary'));
    assert.deepEqual(s.overdue.items.map((t) => t.description), ['Late']);
    assert.equal(s.overdue.count, 1);
    assert.equal(s.overdue.expenseTotal, 40);
    assert.deepEqual(s.upcoming.map((t) => t.description), ['Today', 'Tomorrow', 'Day 14']);
  });

  it('works for other months and rejects bad ones', async () => {
    const c = await fresh();
    await tx(c, { amount: 5, date: '2025-01-10' });
    assert.equal(ok(await c.get('/summary?month=2025-01')).totals.expensePaid, 5);
    assert.equal(ok(await c.get('/summary?month=2025-02')).totals.expensePaid, 0);
    for (const m of ['2025-13', '2025-1', 'x', '2025-00', '25-01']) fails(await c.get(`/summary?month=${m}`), 400);
  });

  it('an empty account has an empty, sane dashboard', async () => {
    const c = await fresh();
    const s = ok(await c.get('/summary'));
    assert.equal(s.balance, 0);
    assert.equal(s.projectedMonthEnd, 0);
    assert.deepEqual([s.overdue.count, s.upcoming.length, s.byCategory.length], [0, 0, 0]);
  });
});

describe('forecast', () => {
  it('carries pending items forward month by month and charges overdue items to this month', async () => {
    const c = await fresh();
    const M = thisMonth();
    const M1 = addMonthsYM(M, 1);
    const M2 = addMonthsYM(M, 2);
    ok(await c.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    await tx(c, { type: 'income', amount: 500, date: today(), status: 'paid' });
    await tx(c, { amount: 100, date: today(), status: 'paid' });
    await tx(c, { amount: 40, date: daysFromToday(-40), status: 'pending' }); // overdue
    await tx(c, { amount: 300, date: `${M1}-01`, status: 'pending' });
    await tx(c, { type: 'income', amount: 50, date: `${M2}-01`, status: 'pending' });
    const f = ok(await c.get('/forecast?past=0&months=3&estimateExpenses=0'));
    assert.equal(f.currentBalance, 1400);
    assert.equal(f.overdueNet, -40);
    const by = Object.fromEntries(f.months.map((m) => [m.month, m]));
    assert.equal(f.months[0].month, M);
    assert.equal(f.months[0].kind, 'current');
    assert.equal(by[M].endBalance, 1360);
    assert.equal(by[M1].endBalance, 1060);
    assert.equal(by[M2].endBalance, 1110);
    assert.equal(by[M1].kind, 'forecast');
    assert.equal(f.insights.firstNegativeMonth, null);
    assert.equal(f.insights.lowest.balance, 1060);
  });

  it('can go negative and says when', async () => {
    const c = await fresh();
    const M3 = addMonthsYM(thisMonth(), 3);
    await tx(c, { type: 'income', amount: 100, date: today() });
    await tx(c, { amount: 5000, date: `${M3}-01`, status: 'pending' });
    const f = ok(await c.get('/forecast?past=0&months=6&estimateExpenses=0'));
    assert.equal(f.insights.firstNegativeMonth.month, M3);
    assert.equal(f.insights.firstNegativeMonth.balance, -4900);
    assert.equal(f.insights.negativeMonths, 4, 'M3..M6');
    assert.equal(f.insights.lowest.balance, -4900);
  });

  it('shows past months as actuals', async () => {
    const c = await fresh();
    const prev = addMonthsYM(thisMonth(), -1);
    await tx(c, { type: 'income', amount: 300, date: `${prev}-10`, status: 'paid' });
    await tx(c, { amount: 100, date: `${prev}-12`, status: 'paid' });
    const f = ok(await c.get('/forecast?past=2&months=1'));
    assert.deepEqual(f.months.map((m) => m.kind), ['actual', 'actual', 'current', 'forecast']);
    const p = f.months[1];
    assert.deepEqual([p.month, p.income, p.expenses, p.net, p.endBalance], [prev, 300, 100, 200, 200]);
  });

  it('estimates everyday spending only from one-off expenses and not from covered categories', async () => {
    const c = await fresh();
    const M = thisMonth();
    const groceries = await categoryId(c, 'Groceries');
    const rent = await categoryId(c, 'Rent / Mortgage');
    for (const n of [-3, -2, -1]) {
      const m = addMonthsYM(M, n);
      await tx(c, { amount: 300, date: `${m}-10`, category_id: groceries });
      await tx(c, { amount: 900, date: `${m}-01`, category_id: rent }); // typed-in rent history
    }
    // an active recurring rent covers the Rent category, so it is not estimated again
    ok(await c.post('/recurring', { type: 'expense', description: 'Rent', amount: 900, frequency: 'monthly', start_date: `${M}-01`, category_id: rent }), 201);
    const f = ok(await c.get('/forecast?past=0&months=2'));
    assert.equal(f.estimates.monthsUsed, 3);
    assert.equal(f.estimates.expenses, 300, 'groceries yes, rent no');
    const off = ok(await c.get('/forecast?past=0&months=2&estimateExpenses=0'));
    assert.equal(off.estimates.expenses, 0);
    const on = ok(await c.get('/forecast?past=0&months=2&estimateIncome=1'));
    assert.equal(on.estimates.income, 0, 'no one-off income to learn from');
  });

  it('clamps its parameters', async () => {
    const c = await fresh();
    assert.equal(ok(await c.get('/forecast?months=100&past=100')).months.length, 12 + 1 + 24);
    assert.equal(ok(await c.get('/forecast?months=0&past=-5')).months.length, 1 + 1);
    assert.equal(ok(await c.get('/forecast?months=abc&past=abc')).months.length, 3 + 12 + 1);
  });

  it('an empty account forecasts zeros', async () => {
    const c = await fresh();
    const f = ok(await c.get('/forecast'));
    assert.equal(f.currentBalance, 0);
    assert.ok(f.months.every((m) => m.endBalance === 0));
  });
});

describe('the balance can be negative everywhere', () => {
  it('shows a negative balance, projection and forecast', async () => {
    const c = await fresh();
    await tx(c, { amount: 80, date: today(), status: 'paid' });
    const s = ok(await c.get('/summary'));
    assert.equal(s.balance, -80);
    assert.equal(s.projectedMonthEnd, -80);
    const f = ok(await c.get('/forecast?estimateExpenses=0'));
    assert.equal(f.currentBalance, -80);
    assert.equal(f.insights.firstNegativeMonth.month, thisMonth());
    assert.equal(f.insights.negativeMonths, 13);
  });
});

describe('API hygiene', () => {
  it('unknown API routes return JSON 404', async () => {
    const c = await fresh();
    const r = await c.get('/does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'Not found');
    assert.equal((await c.del('/transactions')).status, 404);
  });

  it('JSON responses are never cached', async () => {
    const c = await fresh();
    const r = await c.get('/summary');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
});
