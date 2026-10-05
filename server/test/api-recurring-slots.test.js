import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addMonthsYM } from '../src/lib/dates.js';
import { materializeRule } from '../src/lib/materialize.js';
import { fails, ok, shutdown, signup, startServer, thisMonth } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('recurringslots');
});
after(async () => {
  await shutdown(srv);
});

const M = thisMonth();
const NEXT = addMonthsYM(M, 1);
const LATER = addMonthsYM(M, 3);
const fresh = async () => (await signup(srv)).client;

const makeRule = async (c, over = {}) =>
  ok(await c.post('/recurring', { type: 'expense', description: 'Rent', amount: 900, frequency: 'monthly', start_date: `${NEXT}-10`, ...over }), 201);
const rowsOf = async (ruleId) =>
  (await srv.db.query(`SELECT id, date::text AS date, occurrence_date::text AS slot, status, amount::float8 AS amount FROM transactions WHERE recurring_id = $1 ORDER BY occurrence_date`, [ruleId])).rows;
/** What the app does at start-up and every six hours, for one rule. */
const topUp = async (ruleId) => materializeRule((await srv.db.query('SELECT * FROM recurring_rules WHERE id = $1', [ruleId])).rows[0], srv.db);
const move = (c, t, date) => c.put(`/transactions/${t.id}`, { type: t.type, description: t.description, amount: t.amount, date, category_id: null, note: null });

describe('each generated payment remembers its schedule slot', () => {
  it('is the day it was generated for, and only recurring payments have one', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    await c.post('/transactions', { type: 'expense', description: 'One-off', amount: 5, date: `${NEXT}-11` });
    const rows = await rowsOf(rule.id);
    assert.ok(rows.length >= 24);
    assert.ok(rows.every((r) => r.slot === r.date), 'slot equals the scheduled day at first');
    const manual = (await srv.db.query(`SELECT occurrence_date FROM transactions WHERE description = 'One-off' AND recurring_id IS NULL ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(manual.occurrence_date, null);
  });
});

describe('moving a recurring payment to another day', () => {
  it('keeps its slot, and the top-up does not create the original day again', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const first = (await rowsOf(rule.id))[0];
    const t = ok(await c.get(`/transactions?month=${NEXT}`)).find((x) => x.recurring_id === rule.id);
    ok(await move(c, t, `${NEXT}-14`));
    const before = await rowsOf(rule.id);
    const moved = before.find((r) => r.id === first.id);
    assert.deepEqual([moved.date, moved.slot], [`${NEXT}-14`, `${NEXT}-10`], 'rent is on the 14th but still belongs to the 10th slot');
    assert.equal(await topUp(rule.id), 0, 'nothing to add');
    assert.equal(await topUp(rule.id), 0, 'and still nothing the second time');
    const after = await rowsOf(rule.id);
    assert.equal(after.length, before.length);
    assert.ok(!after.some((r) => r.date === `${NEXT}-10`), 'no second rent on the 10th');
    const inMonth = ok(await c.get(`/transactions?month=${NEXT}`)).filter((x) => x.recurring_id === rule.id);
    assert.deepEqual(inMonth.map((x) => x.date), [`${NEXT}-14`], 'one rent that month, on the day it was moved to');
  });

  it('also holds for weekly items moved by a few days', async () => {
    const c = await fresh();
    const rule = await makeRule(c, { description: 'Cleaner', frequency: 'weekly', start_date: `${NEXT}-01` });
    const t = ok(await c.get(`/transactions?month=${NEXT}`)).find((x) => x.recurring_id === rule.id);
    const before = (await rowsOf(rule.id)).length;
    ok(await move(c, t, `${NEXT}-03`));
    assert.equal(await topUp(rule.id), 0);
    assert.equal((await rowsOf(rule.id)).length, before);
  });

  it('allows two payments to be moved onto the same day', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const list = ok(await c.get(`/transactions?from=${NEXT}-01&to=${LATER}-31`)).filter((x) => x.recurring_id === rule.id);
    ok(await move(c, list[0], `${LATER}-20`));
    ok(await move(c, list[1], `${LATER}-20`));
    assert.equal((await rowsOf(rule.id)).filter((r) => r.date === `${LATER}-20`).length, 2);
  });

  it('a payment that was marked paid before being moved is not duplicated either', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const t = ok(await c.get(`/transactions?month=${NEXT}`)).find((x) => x.recurring_id === rule.id);
    ok(await c.patch(`/transactions/${t.id}/status`, { status: 'paid' }));
    ok(await move(c, t, `${NEXT}-12`));
    assert.equal(await topUp(rule.id), 0);
  });
});

describe('the other ways of changing a recurring item are unchanged', () => {
  it('a skipped occurrence stays skipped', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const t = ok(await c.get(`/transactions?month=${NEXT}`)).find((x) => x.recurring_id === rule.id);
    assert.deepEqual(ok(await c.del(`/transactions/${t.id}`)), { skipped: true });
    assert.equal(await topUp(rule.id), 0);
    assert.equal((await rowsOf(rule.id))[0].status, 'skipped');
  });

  it('editing the item regenerates its unpaid payments once each, with the new amount', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const before = (await rowsOf(rule.id)).length;
    ok(await c.put(`/recurring/${rule.id}`, { type: 'expense', description: 'Rent', amount: 950, frequency: 'monthly', start_date: `${NEXT}-10` }));
    const rows = await rowsOf(rule.id);
    assert.equal(rows.length, before);
    assert.equal(new Set(rows.map((r) => r.slot)).size, rows.length, 'no slot twice');
    assert.ok(rows.every((r) => r.amount === 950));
  });

  it('deleting the item removes its unpaid payments and keeps what was paid', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const t = ok(await c.get(`/transactions?month=${NEXT}`)).find((x) => x.recurring_id === rule.id);
    ok(await c.patch(`/transactions/${t.id}/status`, { status: 'paid' }));
    assert.equal((await c.del(`/recurring/${rule.id}`)).status, 204);
    const left = (await srv.db.query('SELECT status FROM transactions WHERE id = $1', [t.id])).rows;
    assert.deepEqual(left.map((r) => r.status), ['paid']);
    fails(await c.get('/transactions/999999999/receipts'), 404);
  });
});

describe('the database change', () => {
  it('fills in the slot for recurring payments that existed before, and replaces the old unique index', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const user = (await srv.db.query('SELECT id FROM users ORDER BY id DESC LIMIT 1')).rows[0].id;
    const ws = (await srv.db.query('SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1', [user])).rows[0].workspace_id;
    await srv.db.query(
      `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, date, source, recurring_id, occurrence_date)
       VALUES ($1, $2, $1, 'expense', 'Old generated row', 5, '2031-05-09', 'recurring', $3, NULL)`,
      [user, ws, rule.id],
    );
    // an existing database still has the old unique index on the day (it can only exist if no two payments share a day,
    // so first clear what the other tests in this file left behind)
    await srv.db.query('DELETE FROM transactions WHERE recurring_id IS NOT NULL AND recurring_id <> $1', [rule.id]);
    await srv.db.query('CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_uq ON transactions (recurring_id, date) WHERE recurring_id IS NOT NULL');
    await srv.db.query(fs.readFileSync(fileURLToPath(new URL('../src/schema.sql', import.meta.url)), 'utf8')); // what a start-up does
    const row = (await srv.db.query(`SELECT date::text AS date, occurrence_date::text AS slot FROM transactions WHERE description = 'Old generated row'`)).rows[0];
    assert.equal(row.slot, row.date, 'the slot was filled in from its day');
    const idx = (await srv.db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'transactions' AND indexname LIKE 'transactions_recurring%'`)).rows.map((r) => r.indexname);
    assert.deepEqual(idx, ['transactions_recurring_slot_uq']);
  });

  it('still refuses two generated payments for the same slot', async () => {
    const c = await fresh();
    const rule = await makeRule(c);
    const user = (await srv.db.query('SELECT id FROM users ORDER BY id DESC LIMIT 1')).rows[0].id;
    const ws = (await srv.db.query('SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1', [user])).rows[0].workspace_id;
    const slot = (await rowsOf(rule.id))[0].slot;
    await assert.rejects(
      srv.db.query(`INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, date, source, recurring_id, occurrence_date) VALUES ($1, $2, $1, 'expense', 'dup', 1, '2031-01-01', 'recurring', $3, $4)`, [user, ws, rule.id, slot]),
      /transactions_recurring_slot_uq/,
    );
  });
});
