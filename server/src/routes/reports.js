import { Router } from 'express';
import { query } from '../db.js';
import { addDays, isValidYM, monthEnd, monthOf, monthStart, todayYMD } from '../lib/dates.js';
import { forecastForWorkspace, workspaceSettings } from '../lib/forecastService.js';
import { HttpError, wrap } from '../lib/http.js';

const router = Router();

const ITEM_SELECT = `
  SELECT t.id, t.type, t.description, t.amount, t.date, t.status, t.source, t.category_id,
         c.name AS category_name, c.color AS category_color,
         t.member_id, mu.name AS member_name, mu.username AS member_username, mu.avatar_url AS member_avatar
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN users mu ON mu.id = t.member_id`;

const flag = (v, dflt) => (v === undefined ? dflt : v === '1' || v === 'true');
const intIn = (v, dflt, min, max) =>
  Math.min(max, Math.max(min, Number.isFinite(Number(v)) && v !== undefined ? Math.trunc(Number(v)) : dflt));

router.get(
  '/summary',
  wrap(async (req, res) => {
    const uid = req.workspace.id;
    const today = todayYMD();
    const month = req.query.month ?? monthOf(today);
    if (!isValidYM(month)) throw new HttpError(400, 'month must be YYYY-MM');
    const [start, end] = [monthStart(month), monthEnd(month)];

    const [settings, totals, balanceRow, projectedRow, overdue, upcoming, byCategory] = await Promise.all([
      workspaceSettings(uid),
      query(
        `SELECT type, status, COALESCE(sum(amount), 0)::float8 AS total, count(*)::int AS n
         FROM transactions WHERE workspace_id = $1 AND date BETWEEN $2 AND $3 AND status <> 'skipped' GROUP BY type, status`,
        [uid, start, end],
      ),
      query(
        `SELECT COALESCE(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)::float8 AS net
         FROM transactions WHERE workspace_id = $1 AND status = 'paid'`,
        [uid],
      ),
      query(
        `SELECT COALESCE(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)::float8 AS net
         FROM transactions WHERE workspace_id = $1 AND status = 'pending' AND date <= $2`,
        [uid, end],
      ),
      query(`${ITEM_SELECT} WHERE t.workspace_id = $1 AND t.status = 'pending' AND t.date < $2 ORDER BY t.date LIMIT 50`, [uid, today]),
      query(
        `${ITEM_SELECT} WHERE t.workspace_id = $1 AND t.status = 'pending' AND t.date BETWEEN $2 AND $3
         ORDER BY t.date, t.id LIMIT 50`,
        [uid, today, addDays(today, 14)],
      ),
      query(
        `SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.color, '#6b7280') AS color,
                sum(t.amount)::float8 AS total,
                COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::float8 AS paid
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.status <> 'skipped' AND t.date BETWEEN $2 AND $3
         GROUP BY t.category_id, c.name, c.color ORDER BY total DESC`,
        [uid, start, end],
      ),
    ]);

    const t = { incomePaid: 0, incomePending: 0, expensePaid: 0, expensePending: 0 };
    for (const r of totals.rows) {
      t[`${r.type}${r.status === 'paid' ? 'Paid' : 'Pending'}`] = r.total;
    }
    const cents = (v) => Math.round(v * 100);
    const opening = cents(settings.opening_balance);
    const balance = (opening + cents(balanceRow.rows[0].net)) / 100;
    const sum = (rows, type) => rows.filter((r) => r.type === type).reduce((s, r) => s + cents(r.amount), 0) / 100;

    // Shared budgets: what each member brings in and pays this month.
    let byMember = [];
    if (req.workspace.kind === 'group') {
      byMember = (
        await query(
          `SELECT u.username, u.name, u.avatar_url,
                  COALESCE(sum(t.amount) FILTER (WHERE t.type = 'income'), 0)::float8 AS income,
                  COALESCE(sum(t.amount) FILTER (WHERE t.type = 'income' AND t.status = 'paid'), 0)::float8 AS income_paid,
                  COALESCE(sum(t.amount) FILTER (WHERE t.type = 'expense'), 0)::float8 AS expenses,
                  COALESCE(sum(t.amount) FILTER (WHERE t.type = 'expense' AND t.status = 'paid'), 0)::float8 AS expenses_paid
           FROM workspace_members m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN transactions t ON t.member_id = u.id AND t.workspace_id = m.workspace_id
             AND t.status <> 'skipped' AND t.date BETWEEN $2 AND $3
           WHERE m.workspace_id = $1
           GROUP BY u.id, m.role ORDER BY (m.role = 'owner') DESC, lower(u.name)`,
          [uid, start, end],
        )
      ).rows;
    }

    res.json({
      month,
      currency: settings.currency,
      balance,
      projectedMonthEnd: (cents(balance) + cents(projectedRow.rows[0].net)) / 100,
      totals: {
        ...t,
        net: (cents(t.incomePaid) + cents(t.incomePending) - cents(t.expensePaid) - cents(t.expensePending)) / 100,
      },
      overdue: {
        count: overdue.rows.length,
        expenseTotal: sum(overdue.rows, 'expense'),
        incomeTotal: sum(overdue.rows, 'income'),
        items: overdue.rows,
      },
      upcoming: upcoming.rows,
      byCategory: byCategory.rows,
      byMember,
    });
  }),
);

router.get(
  '/forecast',
  wrap(async (req, res) => {
    const result = await forecastForWorkspace(req.workspace.id, {
      past: intIn(req.query.past, 3, 0, 12),
      months: intIn(req.query.months, 12, 1, 24),
      estimateExpenses: flag(req.query.estimateExpenses, true),
      estimateIncome: flag(req.query.estimateIncome, false),
    });
    const { currency, ...forecast } = result; // the dashboard already knows the currency
    res.json(forecast);
  }),
);

export default router;
