import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { categoryId, HttpError, idParam, money, note, text, txType, wrap, ymd } from '../lib/http.js';
import { materializeRule, resetRule } from '../lib/materialize.js';
import { assertOwnCategory } from '../lib/ownership.js';
import { usernameField } from '../lib/profile.js';
import { nthOccurrence } from '../lib/schedule.js';
import { t } from '../lib/i18n.js';

const router = Router();

const schema = z
  .object({
    type: txType,
    description: text(200),
    amount: money,
    category_id: categoryId,
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    interval_count: z.coerce.number().int().min(1).max(60).default(1),
    start_date: ymd,
    end_date: ymd.nullable().optional(),
    ends_after: z.number().int('must be a whole number').min(1, 'must be at least 1').max(600, 'must be at most 600').nullable().optional(), // stop after this many payments (instead of end_date)
    note,
    active: z.boolean().default(true),
    paid_by: usernameField.nullable().optional(), // group budgets: whose income / who pays
  })
  .refine((r) => !r.end_date || r.end_date >= r.start_date, {
    path: ['end_date'],
    get message() { return t('must not be before the start date'); },
  })
  .refine((r) => !(r.end_date && r.ends_after), {
    path: ['ends_after'],
    get message() { return t('choose either an end date or a number of payments, not both'); },
  })
  .transform((r) => {
    if (!r.ends_after) return r;
    const last = nthOccurrence(r, r.ends_after);
    if (last > '2200-12-31') throw new HttpError(400, t('The last payment would be too far in the future.'));
    return { ...r, end_date: last };
  });

const SELECT = `
  SELECT r.id, r.type, r.description, r.amount, r.category_id, r.frequency, r.interval_count,
         r.start_date, r.end_date, r.note, r.active,
         c.name AS category_name, c.color AS category_color,
         r.member_id, mu.name AS member_name, mu.username AS member_username, mu.avatar_url AS member_avatar,
    (SELECT min(t.date) FROM transactions t
       WHERE t.recurring_id = r.id AND t.status = 'pending') AS next_date
  FROM recurring_rules r
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN users mu ON mu.id = r.member_id`;

const findOne = async (workspaceId, id) =>
  (await query(`${SELECT} WHERE r.id = $1 AND r.workspace_id = $2`, [id, workspaceId])).rows[0];

async function resolveMember(workspaceId, defaultUserId, username) {
  if (!username) return defaultUserId;
  const { rows } = await query(
    `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1 WHERE lower(u.username) = $2`,
    [workspaceId, username],
  );
  if (!rows[0]) throw new HttpError(400, t('@{username} is not a member of this budget.', { username }));
  return rows[0].id;
}

const values = (r, memberId) => [
  r.type,
  r.description,
  r.amount,
  r.category_id ?? null,
  r.frequency,
  r.interval_count,
  r.start_date,
  r.end_date ?? null,
  r.note || null,
  r.active,
  memberId,
];

router.get(
  '/recurring',
  wrap(async (req, res) => {
    const { rows } = await query(
      `${SELECT} WHERE r.workspace_id = $1 ORDER BY r.active DESC, next_date NULLS LAST, r.description`,
      [req.workspace.id],
    );
    res.json(rows);
  }),
);

router.post(
  '/recurring',
  wrap(async (req, res) => {
    const r = schema.parse(req.body);
    await assertOwnCategory(req.workspace.id, r.category_id);
    const memberId = await resolveMember(req.workspace.id, req.user.id, r.paid_by);
    const { rows } = await query(
      `INSERT INTO recurring_rules
         (type, description, amount, category_id, frequency, interval_count, start_date, end_date, note, active, member_id, user_id, workspace_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [...values(r, memberId), req.user.id, req.workspace.id],
    );
    await materializeRule(rows[0]);
    res.status(201).json(await findOne(req.workspace.id, rows[0].id));
  }),
);

router.put(
  '/recurring/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const r = schema.parse(req.body);
    await assertOwnCategory(req.workspace.id, r.category_id);
    const existing = (await query('SELECT member_id FROM recurring_rules WHERE id = $1 AND workspace_id = $2', [id, req.workspace.id])).rows[0];
    if (!existing) throw new HttpError(404, t('Recurring item not found'));
    const memberId = r.paid_by === undefined ? existing.member_id : await resolveMember(req.workspace.id, req.user.id, r.paid_by);
    const { rows } = await query(
      `UPDATE recurring_rules SET type=$1, description=$2, amount=$3, category_id=$4, frequency=$5,
         interval_count=$6, start_date=$7, end_date=$8, note=$9, active=$10, member_id=$11
       WHERE id = $12 AND workspace_id = $13 RETURNING *`,
      [...values(r, memberId), id, req.workspace.id],
    );
    await resetRule(rows[0]);
    res.json(await findOne(req.workspace.id, id));
  }),
);

router.delete(
  '/recurring/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    await withTransaction(async (client) => {
      const owned = await client.query('SELECT 1 FROM recurring_rules WHERE id = $1 AND workspace_id = $2', [id, req.workspace.id]);
      if (!owned.rowCount) throw new HttpError(404, t('Recurring item not found'));
      // Unpaid occurrences go away with the rule; paid history stays (rule link is nulled).
      await client.query(`DELETE FROM transactions WHERE recurring_id = $1 AND status IN ('pending', 'skipped')`, [id]);
      await client.query('DELETE FROM recurring_rules WHERE id = $1', [id]);
    });
    res.status(204).end();
  }),
);

export default router;
