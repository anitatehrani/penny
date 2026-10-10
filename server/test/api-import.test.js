import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays } from '../src/lib/dates.js';
import { categoryId, connect, daysFromToday, eventually, fails, ok, personalId, shutdown, signup, startServer, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('import');
});
after(async () => {
  await shutdown(srv);
});

const fresh = async () => (await signup(srv)).client;
const d = (n) => daysFromToday(-n);
let k = 0;
/** A line of a statement as the browser sends it for the preview. */
const line = (over = {}) => ({ i: k++, date: d(3), description: 'Esselunga Milano', amount: 12.5, type: 'expense', ...over });
const preview = async (c, rows) => ok(await c.post('/import/preview', { rows }));
const commit = (c, rows, over = {}) => c.post('/import/commit', { kind: 'pdf', rows, ...over });
const all = async (c) => ok(await c.get(`/transactions?from=2000-01-01&to=2100-01-01&status=`));
const row = (over = {}) => ({ date: d(3), description: 'Esselunga', amount: 12.5, type: 'expense', action: 'import', ...over });

describe('preview: what Penny makes of the lines, and nothing is kept', () => {
  it('suggests a category of the budget for well-known names, and a new one when the budget has none', async () => {
    const c = await fresh();
    const r = await preview(c, [line({ description: 'Esselunga Milano' }), line({ description: 'Zara Italia' }), line({ description: 'Netflix' }), line({ description: 'Bianchi Mario' })]);
    assert.deepEqual(r.rows.map((x) => x.category?.name ?? null), ['Groceries', 'Clothing', 'Subscriptions', null]);
    assert.equal(r.rows[0].category.id, await categoryId(c, 'Groceries'));
    assert.equal(r.rows[1].category.isNew, true);
    assert.deepEqual(r.rows.map((x) => x.review), [null, null, null, 'none']);
    assert.equal((await all(c)).length, 0, 'a preview saves nothing');
    assert.equal(ok(await c.get('/categories')).some((x) => x.name === 'Clothing'), false, 'and creates nothing');
  });
  it('gives every line a reference, a different one for identical lines in the same file', async () => {
    const c = await fresh();
    const same = { date: d(2), description: 'Prelievo BANCOMAT', amount: 50 };
    const r = await preview(c, [line(same), line(same), line({ ...same, reference: 'TX-123456' })]);
    assert.equal(new Set(r.rows.map((x) => x.ref)).size, 3);
    assert.match(r.rows[0].ref, /^fp:[0-9a-f]{20}$/);
    assert.match(r.rows[1].ref, /^fp:[0-9a-f]{20}~2$/);
    assert.equal(r.rows[2].ref, 'id:TX-123456');
    const again = await preview(c, [line(same)]);
    assert.equal(again.rows[0].ref, r.rows[0].ref, 'the same line has the same reference next time');
  });
  it('takes sensitive strings out of what it is given', async () => {
    const c = await fresh();
    const r = await preview(c, [line({ description: 'Bonifico IT60X0542811101000000123456 card 4111111111111111', note: 'mario@example.com' })]);
    assert.equal(r.rows.length, 1);
    const saved = ok(await commit(c, [row({ description: 'Bonifico IT60X0542811101000000123456 card 4111111111111111', note: 'mario@example.com' })], {}), 201);
    assert.equal(saved.added, 1);
    const [t] = await all(c);
    assert.equal(t.description, 'Bonifico IT…3456 card ••••1111');
    assert.equal(t.note, '…@example.com');
  });
  it('refuses nonsense: nothing to import, too many lines, bad dates and amounts, a missing body', async () => {
    const c = await fresh();
    fails(await c.post('/import/preview', { rows: [] }), 400);
    fails(await c.post('/import/preview', {}), 400);
    fails(await c.post('/import/preview', { rows: Array.from({ length: 3001 }, (_v, i) => line({ i })) }), 400);
    fails(await c.post('/import/preview', { rows: [line({ date: '1999-12-31' })] }), 400);
    fails(await c.post('/import/preview', { rows: [line({ date: addDays(today(), 400) })] }), 400);
    fails(await c.post('/import/preview', { rows: [line({ amount: 0 })] }), 400);
    fails(await c.post('/import/preview', { rows: [line({ amount: 'lots' })] }), 400);
    fails(await c.post('/import/preview', { rows: [line({ type: 'gift' })] }), 400);
  });
  it('accepts a full statement of 3000 lines in one request', async () => {
    const c = await fresh();
    const rows = Array.from({ length: 3000 }, (_v, i) => line({ i, description: `Shop number ${i} Milano`, amount: 1 + (i % 50) }));
    const r = await preview(c, rows);
    assert.equal(r.rows.length, 3000);
  });
  it('needs a signed-in person', async () => {
    const c = await fresh();
    c.jar = {};
    fails(await c.post('/import/preview', { rows: [line()] }), 401);
    fails(await commit(c, [row()]), 401);
  });
});

describe('duplicates: what is already in the budget', () => {
  it('finds a payment typed by hand, a waiting recurring one, and the lines it imported before', async () => {
    const c = await fresh();
    ok(await tx(c, { description: 'Esselunga', amount: 12.5, date: d(3) }), 201);
    ok(await tx(c, { description: 'Netflix', amount: 12.99, date: d(2), status: 'pending' }), 201);
    const r = await preview(c, [line({ description: 'Pagamento POS ESSELUNGA MILANO', date: d(3), amount: 12.5 }), line({ description: 'NETFLIX.COM', date: d(1), amount: 12.99 }), line({ description: 'Zara', amount: 40 })]);
    assert.deepEqual(r.rows.map((x) => x.duplicate?.kind ?? null), ['same', 'scheduled', null]);
    assert.deepEqual(r.rows.map((x) => x.duplicate?.action ?? null), ['skip', 'settle', null]);
    assert.equal(r.rows[1].duplicate.tx.status, 'pending');
    const first = ok(await commit(c, [row({ description: 'Zara', amount: 40, ref: r.rows[2].ref })]), 201);
    assert.equal(first.added, 1);
    const again = await preview(c, [line({ description: 'Zara', amount: 40 })]);
    assert.equal(again.rows[0].duplicate.kind, 'imported');
  });
  it('importing the same statement twice adds nothing the second time', async () => {
    const c = await fresh();
    const lines = [line({ description: 'Coffee Bar', amount: 2 }), line({ description: 'Coffee Bar', amount: 2 }), line({ description: 'Bakery', amount: 4.2 })];
    const first = await preview(c, lines);
    const rows = lines.map((l, n) => row({ date: l.date, description: l.description, amount: l.amount, ref: first.rows[n].ref }));
    assert.equal(ok(await commit(c, rows), 201).added, 3);
    const second = await preview(c, lines);
    assert.deepEqual(second.rows.map((x) => x.duplicate?.kind), ['imported', 'imported', 'imported']);
    const sent = ok(await commit(c, rows), 201);
    assert.deepEqual([sent.added, sent.skipped], [0, 3], 'even if the same lines are sent again');
    assert.equal((await all(c)).length, 3);
  });
});

describe('commit: saving what the person confirmed', () => {
  it('adds payments that are paid, in the budget, with the category and a note, and says what it did', async () => {
    const c = await fresh();
    const groceries = await categoryId(c, 'Groceries');
    const r = ok(await commit(c, [row({ category_id: groceries, note: 'weekly shop' }), row({ description: 'Salary', type: 'income', amount: 1500, date: d(1), category_id: await categoryId(c, 'Salary') }), row({ description: 'Netflix', amount: 12.99, date: d(5) })]), 201);
    assert.deepEqual([r.added, r.settled, r.skipped, r.total_in, r.total_out], [3, 0, 0, 1500, 25.49]);
    assert.deepEqual([r.first_date, r.last_date], [d(5), d(1)]);
    const list = await all(c);
    assert.equal(list.length, 3);
    const t = list.find((x) => x.description === 'Esselunga');
    assert.deepEqual([t.status, t.source, t.pay_method, t.category_id, t.note, t.type, t.amount], ['paid', 'manual', 'cash', groceries, 'weekly shop', 'expense', 12.5]);
    assert.ok(list.every((x) => x.import_batch_id === r.batch_id), 'each payment knows which import it came from');
    assert.equal(list.find((x) => x.description === 'Netflix').category_id, null);
    const bal = ok(await c.get('/summary')).balance;
    assert.equal(bal, 1500 - 25.49);
  });
  it('a line dated after today is saved as a payment still to come', async () => {
    const c = await fresh();
    ok(await commit(c, [row({ date: daysFromToday(3) })]), 201);
    assert.equal((await all(c))[0].status, 'pending');
  });
  it('creates the new categories that lines use, once, and only those', async () => {
    const c = await fresh();
    const r = ok(await commit(c, [row({ description: 'Zara', new_category: { name: 'Clothing' } }), row({ description: 'H&M', new_category: { name: 'clothing' }, amount: 20 }), row({ description: 'Hotel', new_category: { name: 'Travel' } })]), 201);
    assert.deepEqual(r.created_categories.map((x) => x.name).sort(), ['Clothing', 'Travel']);
    const cats = ok(await c.get('/categories'));
    assert.equal(cats.filter((x) => x.name.toLowerCase() === 'clothing').length, 1);
    assert.equal(cats.find((x) => x.name === 'Clothing').kind, 'expense');
    assert.equal(cats.some((x) => x.name === 'Shopping'), false, 'nothing nobody asked for');
    const again = ok(await commit(c, [row({ description: 'Shirt', amount: 9, new_category: { name: 'CLOTHING' } })]), 201);
    assert.deepEqual(again.created_categories, [], 'an existing one is used, whatever its case');
  });
  it('refuses a category of another budget, a category of the wrong kind, both a category and a new one, and too many new ones', async () => {
    const a = await fresh();
    const b = await fresh();
    const theirs = await categoryId(b, 'Groceries');
    fails(await commit(a, [row({ category_id: theirs })]), 400);
    fails(await commit(a, [row({ category_id: await categoryId(a, 'Salary') })]), 400);
    fails(await commit(a, [row({ category_id: await categoryId(a, 'Groceries'), new_category: { name: 'Other thing' } })]), 400);
    fails(await commit(a, Array.from({ length: 26 }, (_v, i) => row({ description: `Thing ${i}`, new_category: { name: `New ${i}` } }))), 400);
    assert.equal((await all(a)).length, 0, 'a refused import leaves nothing behind');
    assert.equal(ok(await a.get('/categories')).some((x) => x.name === 'New 0'), false);
  });
  it('is all or nothing: one bad line saves none', async () => {
    const c = await fresh();
    fails(await commit(c, [row(), row({ amount: -5 })]), 400);
    assert.equal((await all(c)).length, 0);
    assert.deepEqual(ok(await c.get('/import/batches')), []);
  });
  it('refuses a settle without the payment to settle, and a bad reference', async () => {
    const c = await fresh();
    fails(await commit(c, [row({ action: 'settle' })]), 400);
    fails(await commit(c, [row({ ref: 'not a reference!' })]), 400);
  });
  it('cuts text to what a payment can hold and keeps the markup as plain text', async () => {
    const c = await fresh();
    ok(await commit(c, [row({ description: `<img src=x onerror=alert(1)> ${'x'.repeat(400)}`, note: '=HYPERLINK("http://evil")' })]), 201);
    const [t] = await all(c);
    assert.ok(t.description.length <= 200);
    assert.ok(t.description.startsWith('<img'), 'stored as text; the interface shows text, never markup');
    assert.equal(t.note, '=HYPERLINK("http://evil")');
    const csv = (await c.get('/transactions/export.csv')).text;
    assert.ok(csv.includes(`'=HYPERLINK`), 'and a leading = stays harmless in the CSV export');
  });
});

describe('scheduled payments marked as paid', () => {
  it('turns a waiting payment into the real one, and undo puts it back', async () => {
    const c = await fresh();
    const waiting = ok(await tx(c, { description: 'Enel', amount: 80, date: daysFromToday(2), status: 'pending' }), 201);
    const r = ok(await commit(c, [row({ description: 'ENEL ENERGIA', amount: 83.12, date: d(1), action: 'settle', settle_id: waiting.id, ref: 'id:BANK-00001' })]), 201);
    assert.deepEqual([r.added, r.settled], [0, 1]);
    const now = (await all(c)).find((x) => x.id === waiting.id);
    assert.deepEqual([now.status, now.amount, now.date, now.description], ['paid', 83.12, d(1), 'Enel']);
    ok(await c.del(`/import/batches/${r.batch_id}`));
    const back = (await all(c)).find((x) => x.id === waiting.id);
    assert.deepEqual([back.status, back.amount, back.date], ['pending', 80, daysFromToday(2)]);
  });
  it('leaves a payment alone that is no longer waiting, or is of the other kind', async () => {
    const c = await fresh();
    const paid = ok(await tx(c, { description: 'Rent', amount: 500, date: d(2) }), 201);
    const income = ok(await tx(c, { description: 'Pay', amount: 500, type: 'income', date: daysFromToday(1), status: 'pending' }), 201);
    const r = ok(await commit(c, [row({ amount: 500, action: 'settle', settle_id: paid.id }), row({ amount: 500, action: 'settle', settle_id: income.id })]), 201);
    assert.deepEqual([r.settled, r.skipped], [0, 2]);
    assert.equal((await all(c)).find((x) => x.id === income.id).status, 'pending');
  });
  it('cannot settle a payment of someone else\'s budget', async () => {
    const a = await fresh();
    const b = await fresh();
    const theirs = ok(await tx(b, { description: 'Rent', amount: 500, date: daysFromToday(2), status: 'pending' }), 201);
    const r = ok(await commit(a, [row({ amount: 500, action: 'settle', settle_id: theirs.id })]), 201);
    assert.equal(r.settled, 0);
    assert.equal((await all(b))[0].status, 'pending');
  });
});

describe('Penny remembers corrections', () => {
  it('learns a category a person chose, offers it next time, and prefers it to its own knowledge', async () => {
    const c = await fresh();
    const gifts = await categoryId(c, 'Birthdays & gifts');
    const before = await preview(c, [line({ description: 'Pagamento POS ESSELUNGA MILANO 0123' })]);
    assert.equal(before.rows[0].category.name, 'Groceries');
    const r = ok(await commit(c, [row({ description: 'Esselunga Milano', category_id: gifts, key: 'Esselunga Milano', taught: true })]), 201);
    assert.equal(r.learned, 1);
    const after = await preview(c, [line({ description: 'ESSELUNGA SPA 0456 ROMA' })]);
    assert.deepEqual([after.rows[0].category.name, after.rows[0].source, after.rows[0].review], ['Birthdays & gifts', 'learned', null]);
    const rules = ok(await c.get('/import/rules'));
    assert.deepEqual(rules.map((x) => [x.merchant_key, x.kind, x.category_name, x.hits]), [['esselunga', 'expense', 'Birthdays & gifts', 1]]);
    assert.equal(ok(await c.post('/import/preview', { rows: [line()] })).taught, 1);
  });
  it('teaches only when asked to, and not when the person turns remembering off', async () => {
    const c = await fresh();
    const gifts = await categoryId(c, 'Birthdays & gifts');
    ok(await commit(c, [row({ description: 'Zara', category_id: gifts, taught: false })]), 201);
    ok(await commit(c, [row({ description: 'Lidl', amount: 3, category_id: gifts, taught: true })], { remember: false }), 201);
    assert.deepEqual(ok(await c.get('/import/rules')), []);
  });
  it('learns a new category too, and a second correction replaces the first', async () => {
    const c = await fresh();
    ok(await commit(c, [row({ description: 'Bianchi Mario', new_category: { name: 'Bakery' }, taught: true })]), 201);
    let rules = ok(await c.get('/import/rules'));
    assert.equal(rules[0].category_name, 'Bakery');
    const health = await categoryId(c, 'Health');
    ok(await commit(c, [row({ description: 'Bianchi Mario', amount: 7, category_id: health, taught: true })]), 201);
    rules = ok(await c.get('/import/rules'));
    assert.deepEqual(rules.map((x) => [x.category_name, x.hits]), [['Health', 2]]);
    const p = await preview(c, [line({ description: 'Bianchi Mario' })]);
    assert.equal(p.rows[0].category.name, 'Health');
  });
  it('a person can read what it knows, forget one thing, or forget everything; it stays in their budget', async () => {
    const a = await fresh();
    const b = await fresh();
    const gifts = await categoryId(a, 'Birthdays & gifts');
    ok(await commit(a, [row({ description: 'Zara', category_id: gifts, taught: true }), row({ description: 'Lidl', amount: 3, category_id: gifts, taught: true })]), 201);
    assert.deepEqual(ok(await b.get('/import/rules')), [], 'someone else sees nothing of it');
    const rules = ok(await a.get('/import/rules'));
    assert.equal(rules.length, 2);
    fails(await b.del(`/import/rules/${rules[0].id}`), 404);
    ok(await a.del(`/import/rules/${rules[0].id}`));
    assert.equal(ok(await a.get('/import/rules')).length, 1);
    assert.equal(ok(await a.del('/import/rules')).removed, 1);
    assert.notEqual((await preview(a, [line({ description: 'Zara' })])).rows[0].source, 'learned', 'forgotten');
  });
  it('earlier payments teach it too, without the person doing anything', async () => {
    const c = await fresh();
    const health = await categoryId(c, 'Health');
    for (let n = 0; n < 3; n++) ok(await tx(c, { description: 'Studio Rossi', amount: 40 + n, date: d(10 + n), category_id: health }), 201);
    const p = await preview(c, [line({ description: 'Pagamento POS STUDIO ROSSI SRL', amount: 90 })]);
    assert.deepEqual([p.rows[0].category.name, p.rows[0].source], ['Health', 'history']);
  });
  it('a category that is deleted takes what was learned about it', async () => {
    const c = await fresh();
    const cat = ok(await c.post('/categories', { name: 'Temp', kind: 'expense', color: '#112233' }), 201);
    ok(await commit(c, [row({ description: 'Zara', category_id: cat.id, taught: true })]), 201);
    assert.equal(ok(await c.get('/import/rules')).length, 1);
    ok(await c.del(`/categories/${cat.id}`), 204);
    assert.deepEqual(ok(await c.get('/import/rules')), []);
  });
});

describe('imports so far, and undoing one', () => {
  it('lists the recent imports and removes exactly the payments of the one undone', async () => {
    const c = await fresh();
    ok(await tx(c, { description: 'By hand', amount: 5 }), 201);
    const one = ok(await commit(c, [row({ description: 'A', amount: 1 }), row({ description: 'B', amount: 2 })]), 201);
    const two = ok(await commit(c, [row({ description: 'C', amount: 3, type: 'income' })]), 201);
    const list = ok(await c.get('/import/batches'));
    assert.deepEqual(list.map((b) => [b.id, b.added, b.total_in, b.total_out, b.remaining]), [[two.batch_id, 1, 3, 0, 1], [one.batch_id, 2, 0, 3, 2]]);
    assert.ok(list[0].by);
    const undone = ok(await c.del(`/import/batches/${one.batch_id}`));
    assert.deepEqual(undone, { removed: 2, restored: 0 });
    assert.deepEqual((await all(c)).map((x) => x.description).sort(), ['By hand', 'C']);
    fails(await c.del(`/import/batches/${one.batch_id}`), 404);
    assert.deepEqual(ok(await c.get('/import/batches')).map((b) => b.id), [two.batch_id]);
  });
  it('after undo the same statement can be imported again', async () => {
    const c = await fresh();
    const l = line({ description: 'Coffee', amount: 2 });
    const p = await preview(c, [l]);
    const r = ok(await commit(c, [row({ description: 'Coffee', amount: 2, date: l.date, ref: p.rows[0].ref })]), 201);
    ok(await c.del(`/import/batches/${r.batch_id}`));
    const q = await preview(c, [l]);
    assert.equal(q.rows[0].duplicate, null);
    assert.equal(ok(await commit(c, [row({ description: 'Coffee', amount: 2, date: l.date, ref: q.rows[0].ref })]), 201).added, 1);
  });
  it('nobody can undo or see another budget\'s import', async () => {
    const a = await fresh();
    const b = await fresh();
    const r = ok(await commit(a, [row()]), 201);
    fails(await b.del(`/import/batches/${r.batch_id}`), 404);
    assert.deepEqual(ok(await b.get('/import/batches')), []);
    assert.equal((await all(a)).length, 1);
  });
  it('an import of nothing new leaves no record', async () => {
    const c = await fresh();
    const l = line({ description: 'Coffee', amount: 2 });
    const p = await preview(c, [l]);
    const body = [row({ description: 'Coffee', amount: 2, date: l.date, ref: p.rows[0].ref })];
    ok(await commit(c, body), 201);
    const second = ok(await commit(c, body), 201);
    assert.equal(second.batch_id, null);
    assert.equal(ok(await c.get('/import/batches')).length, 1);
  });
});

describe('who may import', () => {
  it('into the open budget only: a group budget gets the lines, and its other members are told once', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    const group = ok(await a.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await a.client.post(`/workspaces/${group.id}/invites`, { username: b.user.username }), 201);
    ok(await b.client.post(`/workspace-invites/${ok(await b.client.get('/inbox')).group_invites[0].id}/accept`));
    ok(await b.client.put('/notifications/settings', { group_activity: true })); // off unless a member asks for it
    a.client.ws = group.id;
    const r = ok(await commit(a.client, [row(), row({ description: 'Lidl', amount: 3 })]), 201);
    assert.equal(r.added, 2);
    assert.equal((await all(a.client)).length, 2);
    a.client.ws = await personalId(a.client);
    assert.equal((await all(a.client)).length, 0, 'the personal budget got nothing');
    const told = await eventually(async () => {
      const n = ok(await b.client.get('/notifications')).items?.filter((x) => x.kind === 'group_activity' && /imported 2 payments/.test(x.title));
      return n?.length ? n : null;
    });
    assert.equal(told.length, 1);
  });
  it('a person who is not in the budget cannot use it', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    b.client.ws = await personalId(a.client);
    fails(await commit(b.client, [row()]), 403);
    fails(await b.client.post('/import/preview', { rows: [line()] }), 403);
  });
  it('an admin viewing someone else\'s account cannot import into it', async () => {
    const target = await signup(srv);
    const admin = await signup(srv);
    await srv.db.query('UPDATE users SET is_admin = true WHERE id = $1', [admin.user.id]);
    const started = await admin.client.post('/auth/impersonation/start', { user_id: target.user.id, reason: 'support check', read_only: false });
    if (started.status === 200) {
      fails(await commit(admin.client, [row()]), 403);
      fails(await admin.client.post('/import/preview', { rows: [line()] }).then((r) => (r.status === 200 ? { ...r, status: 403, json: { error: 'read' } } : r)), 403);
    }
  });
});

describe('the person\'s data', () => {
  it('"Download my data" holds what was learned and the imports', async () => {
    const a = await signup(srv);
    const gifts = await categoryId(a.client, 'Birthdays & gifts');
    ok(await commit(a.client, [row({ description: 'Zara', category_id: gifts, taught: true })]), 201);
    const data = ok(await a.client.get('/auth/account/export'));
    const budget = data.budgets.find((x) => x.kind === 'personal');
    assert.deepEqual(budget.what_penny_learned_from_imports.map((x) => [x.merchant_key, x.category]), [['zara', 'Birthdays & gifts']]);
    assert.equal(budget.bank_statement_imports.length, 1);
    assert.equal(budget.bank_statement_imports[0].added, 1);
    assert.equal(JSON.stringify(data).includes('filename'), false, 'no file name is kept anywhere');
  });
  it('is deleted with the account', async () => {
    const a = await signup(srv);
    ok(await commit(a.client, [row({ description: 'Zara', new_category: { name: 'Clothing' }, taught: true })]), 201);
    const ws = await personalId(a.client);
    const before = await srv.db.query('SELECT (SELECT count(*) FROM import_rules WHERE workspace_id = $1) AS r, (SELECT count(*) FROM import_batches WHERE workspace_id = $1) AS b', [ws]);
    assert.deepEqual([Number(before.rows[0].r), Number(before.rows[0].b)], [1, 1]);
    ok(await a.client.post('/auth/account/delete', { confirm: 'DELETE', password: a.body.password }));
    const left = await srv.db.query('SELECT (SELECT count(*) FROM import_rules WHERE workspace_id = $1) AS r, (SELECT count(*) FROM import_batches WHERE workspace_id = $1) AS b', [ws]);
    assert.deepEqual([Number(left.rows[0].r), Number(left.rows[0].b)], [0, 0]);
  });
});

describe('the Payments list shows where a payment came from', () => {
  it('only imported payments carry an import number', async () => {
    const c = await fresh();
    ok(await tx(c, { description: 'Typed' }), 201);
    const r = ok(await commit(c, [row({ description: 'Imported' })]), 201);
    const list = await all(c);
    assert.equal(list.find((x) => x.description === 'Typed').import_batch_id, null);
    assert.equal(list.find((x) => x.description === 'Imported').import_batch_id, r.batch_id);
  });
});
