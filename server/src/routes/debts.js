import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { todayYMD } from '../lib/dates.js';
import { categoryId, HttpError, idParam, money, note, text, wrap, ymd } from '../lib/http.js';
import { assertOwnCategory } from '../lib/ownership.js';
import { usernameField } from '../lib/profile.js';
import { installmentDates, splitInstallments } from '../lib/schedule.js';

const router = Router();

const debtSchema = z
  .object({
    name: text(100), // who or what it is owed to
    total_amount: money,
    note,
    category_id: categoryId,
    plan: z.enum(['none', 'once', 'monthly']).default('none'),
    first_due_date: ymd.nullable().optional(),
    installment_count: z.number().int('must be a whole number').min(2, 'must be at least 2').max(120, 'must be at most 120').nullable().optional(),
    count_in_budget: z.boolean().default(true),
    paid_by: usernameField.nullable().optional(), // group budgets: who the debt is in the name of
  })
  .superRefine((d, ctx) => {
    const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (d.plan === 'none') {
      if (d.first_due_date) bad('first_due_date', 'only applies when there is a repayment plan');
      if (d.installment_count) bad('installment_count', 'only applies when the debt is split over months');
    } else if (d.plan === 'once') {
      if (!d.first_due_date) bad('first_due_date', 'is required: the day you will pay it');
      if (d.installment_count) bad('installment_count', 'only applies when the debt is split over months');
    } else {
      if (!d.first_due_date) bad('first_due_date', 'is required: the day of the first payment');
      if (!d.installment_count) bad('installment_count', 'is required: the number of monthly payments (2 to 120)');
    }
  });

const paymentSchema = z.object({ amount: money, date: ymd.optional(), note });

const SELECT = `
  SELECT d.id, d.name, d.total_amount::float8 AS total_amount, d.note, d.category_id, d.plan, d.first_due_date, d.installment_count,
         d.count_in_budget, d.settled_at, d.created_at,
         c.name AS category_name, c.color AS category_color,
         d.member_id, mu.name AS member_name, mu.username AS member_username, mu.avatar_url AS member_avatar,
         COALESCE(s.paid_total, 0)::float8 AS paid,
         (CASE WHEN d.settled_at IS NOT NULL THEN 0 ELSE GREATEST(d.total_amount - COALESCE(s.paid_total, 0), 0) END)::float8 AS remaining,
         COALESCE(s.scheduled_total, 0)::float8 AS scheduled_total,
         COALESCE(s.scheduled_count, 0)::int AS scheduled_count,
         s.next_due,
         (SELECT t.amount::float8 FROM transactions t
            WHERE t.debt_id = d.id AND t.status = 'pending' AND t.installment_no IS NOT NULL ORDER BY t.date, t.id LIMIT 1) AS next_amount,
         CASE WHEN d.settled_at IS NOT NULL OR d.total_amount - COALESCE(s.paid_total, 0) <= 0 THEN 'settled' ELSE 'active' END AS status
  FROM debts d
  LEFT JOIN categories c ON c.id = d.category_id
  LEFT JOIN users mu ON mu.id = d.member_id
  LEFT JOIN (
    SELECT debt_id,
           sum(amount) FILTER (WHERE status = 'paid') AS paid_total,
           sum(amount) FILTER (WHERE status = 'pending' AND installment_no IS NOT NULL) AS scheduled_total,
           count(*) FILTER (WHERE status = 'pending' AND installment_no IS NOT NULL) AS scheduled_count,
           min(date) FILTER (WHERE status = 'pending' AND installment_no IS NOT NULL) AS next_due
    FROM transactions WHERE debt_id IS NOT NULL GROUP BY debt_id
  ) s ON s.debt_id = d.id`;

const findOne = async (workspaceId, id) => (await query(`${SELECT} WHERE d.id = $1 AND d.workspace_id = $2`, [id, workspaceId])).rows[0];

async function resolveMember(workspaceId, defaultUserId, username) {
  if (!username) return defaultUserId;
  const { rows } = await query(
    `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1 WHERE lower(u.username) = $2`,
    [workspaceId, username],
  );
  if (!rows[0]) throw new HttpError(400, `@${username} is not a member of this budget.`);
  return rows[0].id;
}

/**
 * Throw away the debt's unpaid scheduled payments and, if it should be in the budget, create them again from what is still owed:
 * one payment (plan 'once') or equal monthly payments (plan 'monthly'). Payments already made are never touched.
 * With "count in my budget" off, or no plan, or nothing owed, no payments are created.
 */
async function rebuildSchedule(client, debtId) {
  const d = (await client.query('SELECT * FROM debts WHERE id = $1', [debtId])).rows[0];
  await client.query(`DELETE FROM transactions WHERE debt_id = $1 AND installment_no IS NOT NULL AND status IN ('pending', 'skipped')`, [debtId]);
  if (!d.count_in_budget || d.plan === 'none' || d.settled_at) return;
  const paid = (await client.query(`SELECT COALESCE(sum(amount), 0)::float8 AS paid FROM transactions WHERE debt_id = $1 AND status = 'paid'`, [debtId])).rows[0].paid;
  const remainingCents = Math.round(d.total_amount * 100) - Math.round(paid * 100);
  if (remainingCents <= 0) return;
  const count = Math.min(d.plan === 'once' ? 1 : d.installment_count, remainingCents); // never a payment of zero
  const dates = d.plan === 'once' ? [d.first_due_date] : installmentDates(d.first_due_date, count);
  await client.query(
    `INSERT INTO transactions
       (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, source, debt_id, installment_no)
     SELECT $1::int, $2::int, $3::int, 'expense',
            CASE WHEN $4::int = 1 THEN 'Repay ' || $5::text ELSE 'Repay ' || $5::text || ' (' || n || '/' || $4::int || ')' END,
            a / 100.0, $6::int, dt, 'pending', $7::text, 'debt', $8::int, n
     FROM unnest($9::int[], $10::date[]) WITH ORDINALITY AS u(a, dt, n)`,
    [d.user_id ?? d.member_id, d.workspace_id, d.member_id ?? d.user_id, count, d.name, d.category_id, d.note, d.id, splitInstallments(remainingCents, count), dates],
  );
}

/** After an extra payment, the unpaid scheduled payments share what is still owed (and disappear when nothing is). */
async function resplitSchedule(client, debtId) {
  const d = (await client.query('SELECT total_amount FROM debts WHERE id = $1', [debtId])).rows[0];
  const paid = (await client.query(`SELECT COALESCE(sum(amount), 0)::float8 AS paid FROM transactions WHERE debt_id = $1 AND status = 'paid'`, [debtId])).rows[0].paid;
  const remainingCents = Math.max(0, Math.round(d.total_amount * 100) - Math.round(paid * 100));
  const pending = (await client.query(`SELECT id FROM transactions WHERE debt_id = $1 AND installment_no IS NOT NULL AND status = 'pending' ORDER BY date, id`, [debtId])).rows;
  if (!pending.length) return;
  const keep = Math.min(pending.length, remainingCents);
  const amounts = keep ? splitInstallments(remainingCents, keep) : [];
  for (let i = 0; i < pending.length; i++) {
    if (i < keep) await client.query('UPDATE transactions SET amount = $1, updated_at = now() WHERE id = $2', [amounts[i] / 100, pending[i].id]);
    else await client.query('DELETE FROM transactions WHERE id = $1', [pending[i].id]);
  }
}

const columns = (d) => [d.name, d.total_amount, d.note || null, d.category_id ?? null, d.plan, d.first_due_date ?? null, d.installment_count ?? null, d.count_in_budget];

router.get(
  '/debts',
  wrap(async (req, res) => {
    const { rows } = await query(
      `${SELECT} WHERE d.workspace_id = $1
       ORDER BY (CASE WHEN d.settled_at IS NOT NULL OR d.total_amount - COALESCE(s.paid_total, 0) <= 0 THEN 1 ELSE 0 END), s.next_due NULLS LAST, lower(d.name), d.id`,
      [req.workspace.id],
    );
    const active = rows.filter((r) => r.status === 'active');
    const sum = (list, key) => Math.round(list.reduce((t, r) => t + Math.round(r[key] * 100), 0)) / 100;
    res.json({
      debts: rows,
      totals: { owed: sum(active, 'remaining'), counted: sum(active.filter((r) => r.count_in_budget), 'remaining'), scheduled: sum(active, 'scheduled_total'), paid: sum(rows, 'paid') },
    });
  }),
);

router.post(
  '/debts',
  wrap(async (req, res) => {
    const d = debtSchema.parse(req.body);
    const ws = req.workspace.id;
    await assertOwnCategory(ws, d.category_id);
    const memberId = await resolveMember(ws, req.user.id, d.paid_by);
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO debts (workspace_id, user_id, member_id, name, total_amount, note, category_id, plan, first_due_date, installment_count, count_in_budget)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [ws, req.user.id, memberId, ...columns(d)],
      );
      await rebuildSchedule(client, rows[0].id);
      return rows[0].id;
    });
    res.status(201).json(await findOne(ws, id));
  }),
);

router.put(
  '/debts/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const d = debtSchema.parse(req.body);
    const ws = req.workspace.id;
    const existing = (await query('SELECT member_id FROM debts WHERE id = $1 AND workspace_id = $2', [id, ws])).rows[0];
    if (!existing) throw new HttpError(404, 'Debt not found');
    await assertOwnCategory(ws, d.category_id);
    const memberId = d.paid_by === undefined ? existing.member_id : await resolveMember(ws, req.user.id, d.paid_by);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE debts SET name = $1, total_amount = $2, note = $3, category_id = $4, plan = $5, first_due_date = $6, installment_count = $7,
                count_in_budget = $8, member_id = $9
         WHERE id = $10 AND workspace_id = $11`,
        [...columns(d), memberId, id, ws],
      );
      await rebuildSchedule(client, id);
    });
    res.json(await findOne(ws, id));
  }),
);

router.delete(
  '/debts/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    await withTransaction(async (client) => {
      const owned = await client.query('SELECT 1 FROM debts WHERE id = $1 AND workspace_id = $2', [id, req.workspace.id]);
      if (!owned.rowCount) throw new HttpError(404, 'Debt not found');
      // Unpaid payments disappear with the debt; payments already made stay as history.
      await client.query(`DELETE FROM transactions WHERE debt_id = $1 AND status IN ('pending', 'skipped')`, [id]);
      await client.query('DELETE FROM debts WHERE id = $1', [id]);
    });
    res.status(204).end();
  }),
);

router.post(
  '/debts/:id/payments',
  wrap(async (req, res) => {
    const id = idParam(req);
    const p = paymentSchema.parse(req.body);
    const ws = req.workspace.id;
    const when = p.date ?? todayYMD();
    const paymentId = await withTransaction(async (client) => {
      // Lock the debt while the payment is checked and recorded: two payments at the same moment must not both fit into what is owed.
      const debt = (await client.query('SELECT name, category_id, member_id, total_amount, settled_at FROM debts WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, ws])).rows[0];
      if (!debt) throw new HttpError(404, 'Debt not found');
      const paid = (await client.query(`SELECT COALESCE(sum(amount), 0)::float8 AS paid FROM transactions WHERE debt_id = $1 AND status = 'paid'`, [id])).rows[0].paid;
      const remainingCents = debt.settled_at ? 0 : Math.max(0, Math.round(debt.total_amount * 100) - Math.round(paid * 100));
      if (remainingCents <= 0) throw new HttpError(400, 'This debt is already settled.');
      if (Math.round(p.amount * 100) > remainingCents) throw new HttpError(400, `That is more than what is still owed (${(remainingCents / 100).toFixed(2)}).`);
      const { rows } = await client.query(
        `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, source, debt_id)
         VALUES ($1, $2, $3, 'expense', $4, $5, $6, $7, 'paid', $8, 'debt', $9) RETURNING id`,
        [req.user.id, ws, debt.member_id ?? req.user.id, `Payment to ${debt.name}`, p.amount, debt.category_id, when, p.note || null, id],
      );
      await resplitSchedule(client, id);
      return rows[0].id;
    });
    const payment = (await query('SELECT id, description, amount::float8 AS amount, date, status FROM transactions WHERE id = $1', [paymentId])).rows[0];
    res.status(201).json({ debt: await findOne(ws, id), payment });
  }),
);

router.post(
  '/debts/:id/settle',
  wrap(async (req, res) => {
    const id = idParam(req);
    const ws = req.workspace.id;
    if (!(await findOne(ws, id))) throw new HttpError(404, 'Debt not found');
    await withTransaction(async (client) => {
      await client.query('UPDATE debts SET settled_at = COALESCE(settled_at, now()) WHERE id = $1', [id]);
      await rebuildSchedule(client, id);
    });
    res.json(await findOne(ws, id));
  }),
);

router.post(
  '/debts/:id/reopen',
  wrap(async (req, res) => {
    const id = idParam(req);
    const ws = req.workspace.id;
    if (!(await findOne(ws, id))) throw new HttpError(404, 'Debt not found');
    await withTransaction(async (client) => {
      await client.query('UPDATE debts SET settled_at = NULL WHERE id = $1', [id]);
      await rebuildSchedule(client, id);
    });
    res.json(await findOne(ws, id));
  }),
);

export default router;
