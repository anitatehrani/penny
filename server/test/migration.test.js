import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, ok, PW, shutdown, startServer, uid } from './helpers.js';

/**
 * Upgrade paths. The server is started on an empty database, we then put the database into the shape
 * older versions of the app left it in, and restart the server (which re-runs the migration on startup).
 */
let srv;
before(async () => {
  srv = await startServer('migration');
});
after(async () => {
  await shutdown(srv);
});

const q = (sql, params) => srv.db.query(sql, params);
const restart = async () => {
  // the schema is idempotent and runs on every start; run it again against the same database
  await import('node:fs').then(async (fs) => {
    const sql = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
    await q(sql);
  });
};

describe('upgrading from the first versions', () => {
  it('re-running the schema on a populated database changes nothing', async () => {
    const c = new Client(srv.base);
    const n = uid();
    ok(await c.post('/auth/signup', { name: 'Stay', email: `${n}@example.com`, username: `s${n}`, password: PW }), 201);
    const before = (await q('SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM workspaces) w, (SELECT count(*) FROM categories) c, (SELECT count(*) FROM workspace_settings) s')).rows[0];
    await restart();
    await restart();
    const after = (await q('SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM workspaces) w, (SELECT count(*) FROM categories) c, (SELECT count(*) FROM workspace_settings) s')).rows[0];
    assert.deepEqual(after, before);
  });

  it('users that predate usernames and workspaces get both, keeping all their data', async () => {
    // an old-style user (no username), with data that has an owner but no workspace, and old per-user settings
    const u1 = (await q(`INSERT INTO users (email, name, password_hash, username) VALUES ('Old.Timer@example.com', 'Old Timer', 'x', 'tmp1') RETURNING id`)).rows[0].id;
    const u2 = (await q(`INSERT INTO users (email, name, password_hash, username) VALUES ('old.timer@other.org', 'Old Two', 'x', 'tmp2') RETURNING id`)).rows[0].id;
    const u3 = (await q(`INSERT INTO users (email, name, password_hash, username) VALUES ('a@b.co', 'Tiny', 'x', 'tmp3') RETURNING id`)).rows[0].id;
    await q('ALTER TABLE users ALTER COLUMN username DROP NOT NULL');
    await q('UPDATE users SET username = NULL WHERE id = ANY($1)', [[u1, u2, u3]]);
    await q('DELETE FROM workspaces WHERE owner_id = ANY($1)', [[u1, u2, u3]]);
    await q(`INSERT INTO user_settings (user_id, opening_balance, currency) VALUES ($1, 250, 'GBP') ON CONFLICT (user_id) DO UPDATE SET opening_balance = 250, currency = 'GBP'`, [u1]);
    await q(`INSERT INTO categories (user_id, name, kind, workspace_id) VALUES ($1, 'Legacy cat', 'expense', NULL)`, [u1]);
    await q(`INSERT INTO transactions (user_id, type, description, amount, date, status, workspace_id, member_id) VALUES ($1, 'expense', 'Legacy payment', 10, '2026-01-01', 'paid', NULL, NULL)`, [u1]);
    const ruleId = (await q(`INSERT INTO recurring_rules (user_id, type, description, amount, frequency, start_date, workspace_id, member_id) VALUES ($1, 'expense', 'Legacy rule', 5, 'monthly', '2026-01-05', NULL, NULL) RETURNING id`, [u1])).rows[0].id;
    // a payment the old version generated for that rule: it did not record which schedule slot it was for
    await q(`INSERT INTO transactions (user_id, type, description, amount, date, status, source, recurring_id, workspace_id, member_id, occurrence_date) VALUES ($1, 'expense', 'Legacy rule', 5, '2026-02-05', 'paid', 'recurring', $2, NULL, NULL, NULL)`, [u1, ruleId]);

    await restart();

    const users = (await q('SELECT id, username FROM users WHERE id = ANY($1) ORDER BY id', [[u1, u2, u3]])).rows;
    assert.deepEqual(users.map((x) => x.username), ['old.timer', 'old.timer1', 'usera'.slice(0, 0) + users[2].username], 'derived from the e-mail, de-duplicated');
    assert.match(users[2].username, /^[a-z0-9][a-z0-9._]{2,23}$/, 'too-short names are padded into a valid one');
    const ws = (await q(`SELECT w.id, w.owner_id FROM workspaces w WHERE w.kind = 'personal' AND w.owner_id = ANY($1)`, [[u1, u2, u3]])).rows;
    assert.equal(ws.length, 3, 'a personal workspace each');
    const w1 = ws.find((w) => w.owner_id === u1).id;
    const owned = async (t) => (await q(`SELECT count(*)::int n FROM ${t} WHERE workspace_id = $1`, [w1])).rows[0].n;
    assert.equal(await owned('categories'), 1);
    assert.equal(await owned('transactions'), 2, 'the old payment and the one its recurring rule had generated');
    assert.equal((await owned('recurring_rules')) , 1);
    assert.equal((await q(`SELECT member_id FROM transactions WHERE description = 'Legacy payment'`)).rows[0].member_id, u1, 'member backfilled');
    const settings = (await q('SELECT opening_balance, currency FROM workspace_settings WHERE workspace_id = $1', [w1])).rows[0];
    assert.deepEqual(settings, { opening_balance: 250, currency: 'GBP' });
    // what later versions added reaches old data without changing its meaning
    const legacy = (await q(`SELECT pay_method, charged_on, debt_id FROM transactions WHERE description = 'Legacy payment'`)).rows[0];
    assert.deepEqual(legacy, { pay_method: 'cash', charged_on: null, debt_id: null }, 'an old payment is a plain cash payment');
    assert.equal((await q('SELECT card_pay_day FROM workspace_settings WHERE workspace_id = $1', [w1])).rows[0].card_pay_day, 10, 'the card pay day starts at the 10th');
    const slot = (await q(`SELECT date::text AS date, occurrence_date::text AS slot FROM transactions WHERE recurring_id = $1`, [ruleId])).rows[0];
    assert.deepEqual(slot, { date: '2026-02-05', slot: '2026-02-05' }, 'the old payment now knows which schedule slot it belongs to');
    assert.equal((await q(`SELECT count(*)::int AS n FROM transactions WHERE recurring_id IS NOT NULL AND occurrence_date IS NULL`)).rows[0].n, 0, 'none left without one');
    assert.equal((await q('SELECT count(*)::int AS n FROM debts WHERE workspace_id = $1', [w1])).rows[0].n, 0, 'the debts table is there, and empty');
    assert.equal((await q('SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', ['users', 'username'])).rows[0].is_nullable, 'NO', 'username is mandatory again');
  });

  it('the first account created on a database with unowned (pre-accounts) data adopts it', async () => {
    const solo = await startServer('migration2');
    try {
      await solo.db.query(`INSERT INTO categories (name, kind) VALUES ('Groceries', 'expense'), ('Salary', 'income')`);
      await solo.db.query(`INSERT INTO transactions (type, description, amount, date, status) VALUES ('expense', 'Before accounts', 12.5, '2026-01-01', 'paid')`);
      await solo.db.query(`INSERT INTO recurring_rules (type, description, amount, frequency, start_date) VALUES ('expense', 'Old rule', 5, 'monthly', '2026-01-05')`);
      await solo.db.query(`UPDATE settings SET opening_balance = 99, currency = 'EUR' WHERE id = 1`);
      const first = new Client(solo.base);
      const a = uid();
      ok(await first.post('/auth/signup', { name: 'First', email: `${a}@example.com`, username: `f${a}`, password: PW }), 201);
      const cats = ok(await first.get('/categories'));
      assert.equal(cats.length, 2, 'adopted the existing categories instead of seeding duplicates');
      assert.equal(ok(await first.get('/transactions?status=')).length, 1);
      assert.equal(ok(await first.get('/transactions?status=')).filter((t) => t.description === 'Before accounts')[0].member_username, `f${a}`);
      assert.deepEqual(ok(await first.get('/settings')), { opening_balance: 99, currency: 'EUR', card_pay_day: 10, carry_over: true });
      // the second account starts clean
      const second = new Client(solo.base);
      const b = uid();
      ok(await second.post('/auth/signup', { name: 'Second', email: `${b}@example.com`, username: `s${b}`, password: PW }), 201);
      assert.equal(ok(await second.get('/categories')).length, 14);
      assert.equal(ok(await second.get('/transactions?status=')).length, 0);
      assert.deepEqual(ok(await second.get('/settings')), { opening_balance: 0, currency: 'USD', card_pay_day: 10, carry_over: true });
    } finally {
      await shutdown(solo);
    }
  });

  it('a brand-new database gets every table, index and constraint it needs', async () => {
    const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
    for (const t of ['users', 'sessions', 'workspaces', 'workspace_members', 'workspace_invites', 'workspace_settings', 'connections', 'categories', 'recurring_rules', 'installment_plans', 'transactions', 'transaction_participants', 'debts']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
    const idx = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).rows.map((r) => r.indexname);
    for (const i of ['users_email_uq', 'users_username_uq', 'users_phone_uq', 'workspaces_personal_uq', 'connections_pair_uq', 'transactions_recurring_slot_uq', 'transactions_installment_uq', 'categories_ws_name_kind_uq', 'workspace_invites_pending_uq', 'debts_workspace_idx', 'transactions_debt_idx']) {
      assert.ok(idx.includes(i), `missing index ${i}`);
    }
    const checks = (await q(`SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname IN ('transactions_card_consistent', 'debts_plan_consistent', 'transactions_source_check')`)).rows.map((r) => r.conname).sort();
    assert.deepEqual(checks, ['debts_plan_consistent', 'transactions_card_consistent', 'transactions_source_check'], 'the card and debt consistency checks exist');
  });
});

describe('database-level safety nets', () => {
  const fresh = async () => {
    const c = new Client(srv.base);
    const n = uid();
    const r = ok(await c.post('/auth/signup', { name: 'DB', email: `${n}@example.com`, username: `d${n}`, password: PW }), 201);
    const ws = (await q(`SELECT id FROM workspaces WHERE owner_id = $1`, [r.user.id])).rows[0].id;
    return { c, user: r.user, ws };
  };

  it('refuses invalid rows even if the application were bypassed', async () => {
    const { user, ws } = await fresh();
    const insert = (over) => q(`INSERT INTO transactions (user_id, workspace_id, type, description, amount, date, status) VALUES ($1, $2, $3, 'x', $4, '2026-01-01', $5)`, [user.id, ws, over.type ?? 'expense', over.amount ?? 1, over.status ?? 'paid']);
    await insert({});
    await assert.rejects(insert({ amount: 0 }), /check/i);
    await assert.rejects(insert({ amount: -5 }), /check/i);
    await assert.rejects(insert({ type: 'transfer' }), /check/i);
    await assert.rejects(insert({ status: 'weird' }), /check/i);
    await assert.rejects(insert({ amount: 1e12 }), /numeric|range|overflow/i);
  });

  it('one personal workspace per user, one connection row per pair, one pending invite per person', async () => {
    const a = await fresh();
    const b = await fresh();
    await assert.rejects(q(`INSERT INTO workspaces (name, kind, owner_id) VALUES ('Again', 'personal', $1)`, [a.user.id]), /unique|duplicate/i);
    await q(`INSERT INTO connections (requester_id, addressee_id) VALUES ($1, $2)`, [a.user.id, b.user.id]);
    await assert.rejects(q(`INSERT INTO connections (requester_id, addressee_id) VALUES ($1, $2)`, [b.user.id, a.user.id]), /unique|duplicate/i);
    await assert.rejects(q(`INSERT INTO connections (requester_id, addressee_id) VALUES ($1, $1)`, [a.user.id]), /check/i);
    const g = (await q(`INSERT INTO workspaces (name, kind, owner_id) VALUES ('G', 'group', $1) RETURNING id`, [a.user.id])).rows[0].id;
    await q(`INSERT INTO workspace_invites (workspace_id, inviter_id, invitee_id) VALUES ($1, $2, $3)`, [g, a.user.id, b.user.id]);
    await assert.rejects(q(`INSERT INTO workspace_invites (workspace_id, inviter_id, invitee_id) VALUES ($1, $2, $3)`, [g, a.user.id, b.user.id]), /unique|duplicate/i);
  });

  it('deleting an account removes everything that belonged to it', async () => {
    const solo = await fresh();
    const other = await fresh();
    const g = (await q(`INSERT INTO workspaces (name, kind, owner_id) VALUES ('G', 'group', $1) RETURNING id`, [solo.user.id])).rows[0].id;
    await q(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [g, solo.user.id]);
    await q(`INSERT INTO connections (requester_id, addressee_id) VALUES ($1, $2)`, [solo.user.id, other.user.id]);
    const t = (await q(`INSERT INTO transactions (user_id, workspace_id, type, description, amount, date, status) VALUES ($1, $2, 'expense', 'x', 1, '2026-01-01', 'paid') RETURNING id`, [solo.user.id, solo.ws])).rows[0].id;
    await q(`INSERT INTO transaction_participants (transaction_id, user_id, share) VALUES ($1, $2, 1)`, [t, other.user.id]);
    await q('DELETE FROM users WHERE id = $1', [solo.user.id]);
    const left = (await q(`SELECT (SELECT count(*) FROM workspaces WHERE owner_id = $1) w, (SELECT count(*) FROM transactions WHERE user_id = $1) t,
      (SELECT count(*) FROM sessions WHERE user_id = $1) s, (SELECT count(*) FROM connections WHERE requester_id = $1) c,
      (SELECT count(*) FROM transaction_participants WHERE transaction_id = $2) p, (SELECT count(*) FROM categories WHERE workspace_id = $3) cat`, [solo.user.id, t, solo.ws])).rows[0];
    assert.deepEqual(Object.values(left).map(Number), [0, 0, 0, 0, 0, 0]);
    assert.ok((await q('SELECT 1 FROM users WHERE id = $1', [other.user.id])).rowCount === 1, 'other users untouched');
  });
});
