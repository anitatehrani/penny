import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { addMonthsYM, isValidYM, monthOf, todayYMD } from '../lib/dates.js';
import { budgetForMonth, effectiveBudgets, gatherSpending, niceBudget } from '../lib/budget.js';
import { cents, HttpError, wrap } from '../lib/http.js';

/** Budget-scoped: a monthly budget for each expense category, and how the month stands against it (docs/DESIGN.md section 43). */
const router = Router();

const monthSchema = z.string().refine(isValidYM, 'must be a month (YYYY-MM)');
const amountSchema = z
  .number({ invalid_type_error: 'must be a number' })
  .finite('must be a number')
  .min(0, 'cannot be negative')
  .max(9_999_999_999, 'is too large')
  .transform(cents)
  .nullable(); // null = no budget
const setSchema = z.object({ month: monthSchema, amount: amountSchema, scope: z.enum(['month', 'onward']).default('onward') }).strict();
const fillSchema = z
  .object({ month: monthSchema, source: z.enum(['typical', 'last_month']), only_empty: z.boolean().default(true), scope: z.enum(['month', 'onward']).default('onward') })
  .strict();

const monthParam = (req) => {
  const month = req.query.month ?? monthOf(todayYMD());
  if (!isValidYM(month)) throw new HttpError(400, 'month must be YYYY-MM');
  return month;
};

async function expenseCategory(workspaceId, id) {
  const { rows } = await query(`SELECT id FROM categories WHERE id = $1 AND workspace_id = $2 AND kind = 'expense'`, [id, workspaceId]);
  if (!rows[0]) throw new HttpError(400, 'Budgets are for expense categories of this budget.');
}

/**
 * Set one category's budget from a month on ("onward": the later months follow it, whatever they had) or for that month only (the month after
 * goes back to what it had). Months before are never touched, so the past keeps the budget it had.
 */
async function setBudget(client, workspaceId, userId, categoryId, month, amount, scope) {
  if (scope === 'onward') {
    await client.query('DELETE FROM category_budgets WHERE workspace_id = $1 AND category_id = $2 AND month > $3', [workspaceId, categoryId, month]);
  } else {
    const next = addMonthsYM(month, 1);
    const had = await client.query('SELECT 1 FROM category_budgets WHERE workspace_id = $1 AND category_id = $2 AND month = $3', [workspaceId, categoryId, next]);
    if (!had.rowCount) {
      const before = (await effectiveBudgets(workspaceId, next, client)).get(categoryId) ?? null;
      if (before !== amount) {
        await client.query('INSERT INTO category_budgets (workspace_id, category_id, month, amount, updated_by) VALUES ($1, $2, $3, $4, $5)', [workspaceId, categoryId, next, before, userId]);
      }
    }
  }
  await client.query(
    `INSERT INTO category_budgets (workspace_id, category_id, month, amount, updated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, category_id, month) DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [workspaceId, categoryId, month, amount, userId],
  );
}

router.get(
  '/budgets',
  wrap(async (req, res) => {
    res.json(await budgetForMonth(req.workspace.id, monthParam(req)));
  }),
);

router.put(
  '/budgets/:categoryId',
  wrap(async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) throw new HttpError(400, 'Invalid id');
    const { month, amount, scope } = setSchema.parse(req.body);
    await expenseCategory(req.workspace.id, categoryId);
    await withTransaction((client) => setBudget(client, req.workspace.id, req.user.id, categoryId, month, amount, scope));
    res.json(await budgetForMonth(req.workspace.id, month));
  }),
);

// Fill in budgets for all categories at once: from what is typically spent, or from what was spent last month.
router.post(
  '/budgets/fill',
  wrap(async (req, res) => {
    const { month, source, only_empty: onlyEmpty, scope } = fillSchema.parse(req.body);
    const ws = req.workspace.id;
    const [cats, budgets, spending] = await Promise.all([
      query(`SELECT id FROM categories WHERE workspace_id = $1 AND kind = 'expense'`, [ws]),
      effectiveBudgets(ws, month),
      gatherSpending(ws, month),
    ]);
    const todo = [];
    for (const c of cats.rows) {
      if (onlyEmpty && budgets.has(c.id)) continue;
      const h = spending.history.get(c.id);
      const value = source === 'typical' ? niceBudget(h?.avg3) : niceBudget(h?.prev);
      if (value) todo.push([c.id, value]);
    }
    await withTransaction(async (client) => {
      for (const [id, value] of todo) await setBudget(client, ws, req.user.id, id, month, value, scope);
    });
    res.json({ ...(await budgetForMonth(ws, month)), filled: todo.length });
  }),
);

export default router;
