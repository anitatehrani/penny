import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { categoryId, HttpError, idParam, money, note, text, wrap, ymd } from '../lib/http.js';
import { assertOwnCategory } from '../lib/ownership.js';
import { usernameField } from '../lib/profile.js';
import { installmentDates, splitInstallments } from '../lib/schedule.js';

const router = Router();

const createSchema = z
  .object({
    description: text(150),
    // Provide either the total or the per-installment amount.
    total_amount: money.optional(),
    installment_amount: money.optional(),
    installment_count: z.coerce.number().int().min(1).max(360),
    first_due_date: ymd,
    category_id: categoryId,
    note,
    paid_count: z.coerce.number().int().min(0).default(0),
    paid_by: usernameField.nullable().optional(), // group budgets: who pays
    // A credit card purchase paid in installments: the day it was bought, and the price before interest (default: no interest).
    charged_on: ymd.optional(),
    purchase_amount: money.optional(),
  })
  .refine((p) => p.charged_on || !p.purchase_amount, {
    path: ['purchase_amount'],
    message: 'only applies to a credit card purchase',
  })
  .refine((p) => !p.charged_on || p.charged_on <= p.first_due_date, {
    path: ['charged_on'],
    message: 'cannot be after the first card bill',
  })
  .refine((p) => !p.charged_on || (p.installment_count >= 2 && p.installment_count <= 36), {
    path: ['installment_count'],
    message: 'a card purchase can be paid in 2 to 36 installments',
  })
  .refine((p) => p.total_amount || p.installment_amount, {
    path: ['total_amount'],
    message: 'provide a total amount or an amount per installment',
  })
  .refine((p) => p.paid_count <= p.installment_count, {
    path: ['paid_count'],
    message: 'cannot exceed the number of installments',
  });

const updateSchema = z.object({ description: text(150), category_id: categoryId, note });

const SELECT = `
  SELECT p.id, p.description, p.total_amount, p.installment_count, p.first_due_date, p.category_id, p.note, p.purchase_amount, p.charged_on,
    c.name AS category_name, c.color AS category_color,
    p.member_id, mu.name AS member_name, mu.username AS member_username, mu.avatar_url AS member_avatar,
    COALESCE(s.paid_count, 0)::int AS paid_count,
    COALESCE(s.paid_total, 0)::float8 AS paid_total,
    p.installment_count - COALESCE(s.paid_count, 0)::int AS remaining_count,
    p.total_amount - COALESCE(s.paid_total, 0) AS remaining_total,
    s.next_due
  FROM installment_plans p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN users mu ON mu.id = p.member_id
  LEFT JOIN (
    SELECT installment_plan_id,
      count(*) FILTER (WHERE status = 'paid') AS paid_count,
      sum(amount) FILTER (WHERE status = 'paid') AS paid_total,
      min(date) FILTER (WHERE status = 'pending') AS next_due
    FROM transactions WHERE installment_plan_id IS NOT NULL GROUP BY installment_plan_id
  ) s ON s.installment_plan_id = p.id`;

const findOne = async (workspaceId, id) =>
  (await query(`${SELECT} WHERE p.id = $1 AND p.workspace_id = $2`, [id, workspaceId])).rows[0];

router.get(
  '/installments',
  wrap(async (req, res) => {
    const { rows } = await query(
      `${SELECT} WHERE p.workspace_id = $1 ORDER BY (s.next_due IS NULL), s.next_due, p.description`,
      [req.workspace.id],
    );
    res.json(rows);
  }),
);

router.post(
  '/installments',
  wrap(async (req, res) => {
    const p = createSchema.parse(req.body);
    const ws = req.workspace.id;
    await assertOwnCategory(ws, p.category_id);
    let memberId = req.user.id;
    if (p.paid_by) {
      const { rows } = await query(
        `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1 WHERE lower(u.username) = $2`,
        [ws, p.paid_by],
      );
      if (!rows[0]) throw new HttpError(400, `@${p.paid_by} is not a member of this budget.`);
      memberId = rows[0].id;
    }
    const totalCents = p.total_amount
      ? Math.round(p.total_amount * 100)
      : Math.round(p.installment_amount * 100) * p.installment_count;
    if (p.charged_on && p.purchase_amount && Math.round(p.purchase_amount * 100) > totalCents) {
      throw new HttpError(400, 'The installments add up to less than the price. Interest can only add to it.');
    }
    const amounts = splitInstallments(totalCents, p.installment_count);
    const dates = installmentDates(p.first_due_date, p.installment_count);

    const planId = await withTransaction(async (client) => {
      const plan = (
        await client.query(
          `INSERT INTO installment_plans (user_id, workspace_id, member_id, description, total_amount, installment_count, first_due_date, category_id, note, purchase_amount, charged_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [req.user.id, ws, memberId, p.description, totalCents / 100, p.installment_count, p.first_due_date, p.category_id ?? null, p.note || null, p.charged_on ? (p.purchase_amount ?? totalCents / 100) : null, p.charged_on ?? null],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO transactions
           (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, source, installment_plan_id, installment_no, pay_method, charged_on)
         SELECT $9::int, $10::int, $11::int, 'expense', $1::text || ' (' || n || '/' || $2::int || ')', a / 100.0, $3::int, d,
                CASE WHEN n <= $4::int THEN 'paid' ELSE 'pending' END, $5::text, 'installment', $6::int, n,
                CASE WHEN $12::date IS NULL THEN 'cash' ELSE 'credit_card' END, $12::date
         FROM unnest($7::int[], $8::date[]) WITH ORDINALITY AS u(a, d, n)`,
        [p.description, p.installment_count, p.category_id ?? null, p.paid_count, p.note || null, plan.id, amounts, dates, req.user.id, ws, memberId, p.charged_on ?? null],
      );
      return plan.id;
    });
    res.status(201).json(await findOne(ws, planId));
  }),
);

// Only descriptive fields can be edited; to change amounts/dates, delete and recreate the plan.
router.put(
  '/installments/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const p = updateSchema.parse(req.body);
    await assertOwnCategory(req.workspace.id, p.category_id);
    const { rows } = await query(
      `UPDATE installment_plans SET description = $1, category_id = $2, note = $3
       WHERE id = $4 AND workspace_id = $5 RETURNING installment_count`,
      [p.description, p.category_id ?? null, p.note || null, id, req.workspace.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Installment plan not found');
    await query(
      `UPDATE transactions
       SET description = $1 || ' (' || installment_no || '/' || $2::int || ')', category_id = $3, note = $4, updated_at = now()
       WHERE installment_plan_id = $5`,
      [p.description, rows[0].installment_count, p.category_id ?? null, p.note || null, id],
    );
    res.json(await findOne(req.workspace.id, id));
  }),
);

router.delete(
  '/installments/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    await withTransaction(async (client) => {
      const owned = await client.query('SELECT 1 FROM installment_plans WHERE id = $1 AND workspace_id = $2', [id, req.workspace.id]);
      if (!owned.rowCount) throw new HttpError(404, 'Installment plan not found');
      // Unpaid installments disappear with the plan; paid ones remain as history.
      await client.query(
        `DELETE FROM transactions WHERE installment_plan_id = $1 AND status IN ('pending', 'skipped')`,
        [id],
      );
      await client.query('DELETE FROM installment_plans WHERE id = $1', [id]);
    });
    res.status(204).end();
  }),
);

export default router;
