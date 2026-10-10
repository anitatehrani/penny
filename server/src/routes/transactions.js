import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { isValidYM, monthEnd, monthStart, todayYMD } from '../lib/dates.js';
import { categoryId, cents, HttpError, idParam, money, note, strictNumber, text, txType, wrap, ymd } from '../lib/http.js';
import { assertOwnCategory } from '../lib/ownership.js';
import { attachAlerts } from '../lib/alerts.js';
import { formatMoney } from '../lib/emailTemplates.js';
import { notify, notifyMany } from '../lib/notifications.js';
import { briefUser, usernameField } from '../lib/profile.js';

const router = Router();

const participantSchema = z.object({
  username: usernameField,
  share: strictNumber.refine((v) => v >= 0 && v <= 9_999_999_999, 'must be between 0 and the amount').transform(cents),
});

const baseSchema = z.object({
  type: txType,
  description: text(200),
  amount: money,
  date: ymd,
  category_id: categoryId,
  note,
  status: z.enum(['pending', 'paid']).optional(),
  pay_method: z.enum(['cash', 'credit_card']).optional(),
  charged_on: ymd.nullable().optional(), // credit card: the day it was bought (`date` is the day the card bill is paid)
  paid_by: usernameField.nullable().optional(), // group budgets: which member paid / received
  participants: z.array(participantSchema).max(20).optional(),
});

export const SELECT = `
  SELECT t.id, t.type, t.description, t.amount, t.date, t.status, t.note, t.source, t.pay_method, t.charged_on, t.debt_id, t.import_batch_id,
         t.category_id, t.recurring_id, t.installment_plan_id, t.installment_no,
         pl.purchase_amount AS plan_purchase_amount, pl.installment_count AS plan_installment_count,
         c.name AS category_name, c.color AS category_color,
         t.member_id, mu.name AS member_name, mu.username AS member_username, mu.avatar_url AS member_avatar,
         (SELECT count(*)::int FROM receipts rc WHERE rc.transaction_id = t.id) AS receipt_count,
         COALESCE((SELECT json_agg(json_build_object('username', pu.username, 'name', pu.name,
                                                      'avatar_url', pu.avatar_url, 'share', p.share)
                                   ORDER BY lower(pu.name))
                   FROM transaction_participants p JOIN users pu ON pu.id = p.user_id
                   WHERE p.transaction_id = t.id), '[]'::json) AS participants
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN users mu ON mu.id = t.member_id
  LEFT JOIN installment_plans pl ON pl.id = t.installment_plan_id`;

const findOne = async (workspaceId, id) =>
  (await query(`${SELECT} WHERE t.id = $1 AND t.workspace_id = $2`, [id, workspaceId])).rows[0];

/**
 * How a payment was paid. `date` is always the day the money leaves the account; a credit card payment also remembers the day it was
 * bought (`charged_on`). `current` is the stored row when editing, so leaving a field out keeps what is there.
 */
function cardFields(t, current) {
  const method = t.pay_method ?? current?.pay_method ?? 'cash';
  if (method === 'cash') {
    if (t.charged_on) throw new HttpError(400, 'A purchase date only applies to credit card payments.');
    return { pay_method: 'cash', charged_on: null };
  }
  if (t.type !== 'expense') throw new HttpError(400, 'Only expenses can be paid with a credit card.');
  const chargedOn = t.charged_on ?? current?.charged_on ?? t.date;
  if (chargedOn > t.date) throw new HttpError(400, 'The purchase date cannot be after the day the card bill is paid.');
  return { pay_method: 'credit_card', charged_on: chargedOn };
}

/** Which member of this budget paid/received (defaults to the current user). */
async function resolveMember(workspaceId, defaultUserId, username) {
  if (!username) return defaultUserId;
  const { rows } = await query(
    `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1
     WHERE lower(u.username) = $2`,
    [workspaceId, username],
  );
  if (!rows[0]) throw new HttpError(400, `@${username} is not a member of this budget.`);
  return rows[0].id;
}

/**
 * People can only be added to a payment if they are a connection of whoever created it (or a member
 * of this budget). Their shares may not add up to more than the payment itself.
 */
async function resolveParticipants(creatorId, workspaceId, participants, amount) {
  const seen = new Set();
  const wanted = participants.filter((p) => !seen.has(p.username) && seen.add(p.username));
  if (!wanted.length) return [];
  const { rows } = await query(
    `SELECT u.id, lower(u.username) AS username FROM users u
     WHERE lower(u.username) = ANY($1) AND u.id <> $2 AND (
       EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted'
                 AND ((c.requester_id = $2 AND c.addressee_id = u.id) OR (c.addressee_id = $2 AND c.requester_id = u.id)))
       OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = $3 AND m.user_id = u.id))`,
    [wanted.map((p) => p.username), creatorId, workspaceId],
  );
  const byName = new Map(rows.map((r) => [r.username, r.id]));
  const missing = wanted.find((p) => !byName.has(p.username));
  if (missing) throw new HttpError(400, `@${missing.username} is not one of your connections. Add them under People first.`);
  const total = wanted.reduce((s, p) => s + Math.round(p.share * 100), 0);
  if (total > Math.round(amount * 100)) throw new HttpError(400, 'The shares add up to more than the payment amount.');
  return wanted.map((p) => ({ id: byName.get(p.username), share: p.share }));
}

async function saveParticipants(client, transactionId, people) {
  const before = new Set((await client.query('SELECT user_id FROM transaction_participants WHERE transaction_id = $1', [transactionId])).rows.map((r) => r.user_id));
  const ids = people.map((p) => p.id);
  await client.query('DELETE FROM transaction_participants WHERE transaction_id = $1 AND user_id <> ALL($2::int[])', [transactionId, ids]);
  for (const p of people) {
    await client.query(
      `INSERT INTO transaction_participants (transaction_id, user_id, share) VALUES ($1, $2, $3)
       ON CONFLICT (transaction_id, user_id) DO UPDATE SET share = EXCLUDED.share`,
      [transactionId, p.id, p.share],
    );
  }
  return people.filter((p) => !before.has(p.id)); // the people who were just added
}

/** Tell people they were added to a payment, and (optionally) tell the rest of a shared budget about a new payment. */
async function announce(req, id, t, newcomers, { created }) {
  const currency = (await query('SELECT currency FROM workspace_settings WHERE workspace_id = $1', [req.workspace.id])).rows[0]?.currency ?? 'USD';
  for (const p of newcomers) {
    await notify(p.id, {
      kind: 'payment_shared',
      title: `${req.user.name} added you to "${t.description}"`,
      body: `Your share: ${formatMoney(p.share, currency)} of ${formatMoney(t.amount, currency)}`,
      link: '/people?tab=shared',
      data: { transaction_id: id, share: p.share, from: briefUser(req.user) },
      dedupeKey: `shared:${id}`,
    });
  }
  if (created && req.workspace.kind === 'group') {
    const others = (await query('SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id <> $2', [req.workspace.id, req.user.id])).rows.map((r) => r.user_id);
    await notifyMany(others, {
      kind: 'group_activity',
      title: `${req.user.name} added "${t.description}"`,
      body: `${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount, currency)} in ${req.workspace.name}`,
      link: '/payments',
      data: { transaction_id: id, workspace_id: req.workspace.id },
      dedupeKey: `act:${id}`,
    });
  }
}

/** Build WHERE clause from query-string filters (shared by list + CSV export). Always scoped to the budget. */
function filters(q, workspaceId) {
  const params = [workspaceId];
  const where = ['t.workspace_id = $1'];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (q.month) {
    if (!isValidYM(q.month)) throw new HttpError(400, 'month must be YYYY-MM');
    if (q.bought === '1') {
      // also the credit card payments that were bought this month and are paid (counted) in another one
      params.push(monthStart(q.month), monthEnd(q.month));
      const a = `$${params.length - 1}`;
      const b = `$${params.length}`;
      where.push(`((t.date >= ${a} AND t.date <= ${b}) OR (t.pay_method = 'credit_card' AND t.charged_on >= ${a} AND t.charged_on <= ${b} AND (t.installment_no IS NULL OR t.installment_no = 1)))`);
    } else {
      add('t.date >= ?', monthStart(q.month));
      add('t.date <= ?', monthEnd(q.month));
    }
  }
  if (q.from) add('t.date >= ?', ymd.parse(q.from));
  if (q.to) add('t.date <= ?', ymd.parse(q.to));
  if (q.type) add('t.type = ?', txType.parse(q.type));
  if (q.member) add('lower(mu.username) = ?', usernameField.parse(q.member));
  if (q.pay) {
    if (!['credit_card', 'cash'].includes(q.pay)) throw new HttpError(400, 'pay must be credit_card or cash');
    add('t.pay_method = ?', q.pay);
  }
  if (q.category_id === 'none') where.push('t.category_id IS NULL');
  else if (q.category_id) add('t.category_id = ?', z.coerce.number().int().parse(q.category_id));
  if (q.q) {
    params.push(`%${String(q.q).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(t.description ILIKE $${params.length} OR t.note ILIKE $${params.length})`);
  }
  switch (q.status) {
    case 'pending':
    case 'paid':
    case 'skipped':
      add('t.status = ?', q.status);
      break;
    case 'overdue':
      where.push(`t.status = 'pending'`);
      add('t.date < ?', todayYMD());
      break;
    default:
      where.push(`t.status <> 'skipped'`);
  }
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

router.get(
  '/transactions',
  wrap(async (req, res) => {
    const { sql, params } = filters(req.query, req.workspace.id);
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const { rows } = await query(`${SELECT} ${sql} ORDER BY t.date, t.id LIMIT ${limit}`, params);
    let out = rows;
    if (req.query.month && req.query.bought === '1') {
      // a row listed only because it was bought this month is flagged, so the page can show it without counting it here
      const first = monthStart(req.query.month);
      const last = monthEnd(req.query.month);
      out = rows.map((r) => ({ ...r, purchase_only: r.date < first || r.date > last }));
    }
    res.json(await attachAlerts(req.user.id, out));
  }),
);

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection in user-entered text.
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

router.get(
  '/transactions/export.csv',
  wrap(async (req, res) => {
    const { sql, params } = filters(req.query, req.workspace.id);
    const { rows } = await query(`${SELECT} ${sql} ORDER BY t.date, t.id`, params);
    const group = req.workspace.kind === 'group';
    const head = ['date', 'type', 'description', 'category', 'amount', 'status', 'paid_with', 'bought_on', ...(group ? ['member'] : []), 'with', 'receipts', 'note'];
    const lines = rows.map((r) =>
      [
        r.date, r.type, r.description, r.category_name, r.amount.toFixed(2), r.status, r.pay_method === 'credit_card' ? 'credit card' : 'cash', r.charged_on,
        ...(group ? [r.member_name] : []),
        r.participants.map((p) => p.name).join('; '),
        r.receipt_count,
        r.note,
      ].map(csvCell).join(','),
    );
    res.type('text/csv').attachment('penny-payments.csv').send([head.join(','), ...lines].join('\n'));
  }),
);

router.post(
  '/transactions',
  wrap(async (req, res) => {
    const t = baseSchema.parse(req.body);
    const ws = req.workspace.id;
    await assertOwnCategory(ws, t.category_id);
    const memberId = await resolveMember(ws, req.user.id, t.paid_by);
    const people = await resolveParticipants(req.user.id, ws, t.participants ?? [], t.amount);
    const card = cardFields(t, null);
    const status = t.status ?? (t.date <= todayYMD() ? 'paid' : 'pending');
    const { id, newcomers } = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, pay_method, charged_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [req.user.id, ws, memberId, t.type, t.description, t.amount, t.category_id ?? null, t.date, status, t.note || null, card.pay_method, card.charged_on],
      );
      const added = people.length ? await saveParticipants(client, rows[0].id, people) : [];
      return { id: rows[0].id, newcomers: added };
    });
    await announce(req, id, t, newcomers, { created: true });
    res.status(201).json(await findOne(ws, id));
  }),
);

router.put(
  '/transactions/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const t = baseSchema.parse(req.body);
    const ws = req.workspace.id;
    const existing = (await query('SELECT user_id, member_id, pay_method, charged_on FROM transactions WHERE id = $1 AND workspace_id = $2', [id, ws])).rows[0];
    if (!existing) throw new HttpError(404, 'Transaction not found');
    await assertOwnCategory(ws, t.category_id);
    const card = cardFields(t, existing);
    const memberId = t.paid_by === undefined ? existing.member_id : await resolveMember(ws, req.user.id, t.paid_by);
    const people = t.participants === undefined ? null : await resolveParticipants(existing.user_id ?? req.user.id, ws, t.participants, t.amount);
    if (people === null) {
      // Participants are left as they are, so the new amount must still cover their shares.
      const { rows } = await query('SELECT COALESCE(sum(share), 0)::float8 AS total FROM transaction_participants WHERE transaction_id = $1', [id]);
      if (Math.round(rows[0].total * 100) > Math.round(t.amount * 100)) {
        throw new HttpError(400, 'The amount is lower than the shares already given to the people on this payment. Adjust their shares too.');
      }
    }
    let newcomers = [];
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE transactions
         SET type = $1, description = $2, amount = $3, category_id = $4, date = $5,
             status = COALESCE($6, status), note = $7, member_id = $8, pay_method = $9, charged_on = $10, updated_at = now()
         WHERE id = $11 AND workspace_id = $12`,
        [t.type, t.description, t.amount, t.category_id ?? null, t.date, t.status ?? null, t.note || null, memberId, card.pay_method, card.charged_on, id, ws],
      );
      if (people) newcomers = await saveParticipants(client, id, people);
    });
    await announce(req, id, t, newcomers, { created: false });
    res.json(await findOne(ws, id));
  }),
);

router.patch(
  '/transactions/:id/status',
  wrap(async (req, res) => {
    const id = idParam(req);
    const { status } = z.object({ status: z.enum(['pending', 'paid', 'skipped']) }).parse(req.body);
    const { rowCount } = await query(
      'UPDATE transactions SET status = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3',
      [status, id, req.workspace.id],
    );
    if (!rowCount) throw new HttpError(404, 'Transaction not found');
    res.json(await findOne(req.workspace.id, id));
  }),
);

// Deleting a recurring occurrence "skips" it, so it is not regenerated. ?hard=1 forces a delete.
router.delete(
  '/transactions/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await query('SELECT recurring_id, status FROM transactions WHERE id = $1 AND workspace_id = $2', [
      id,
      req.workspace.id,
    ]);
    const tx = rows[0];
    if (!tx) throw new HttpError(404, 'Transaction not found');
    if (tx.recurring_id && tx.status !== 'skipped' && req.query.hard !== '1') {
      await query(`UPDATE transactions SET status = 'skipped', updated_at = now() WHERE id = $1`, [id]);
      return res.json({ skipped: true });
    }
    await query('DELETE FROM transactions WHERE id = $1', [id]);
    res.json({ deleted: true });
  }),
);

export default router;
