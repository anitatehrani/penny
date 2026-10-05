import { query } from '../db.js';
import { monthOf, todayYMD } from './dates.js';
import { buildForecast } from './forecast.js';

export async function workspaceSettings(workspaceId) {
  await query('INSERT INTO workspace_settings (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [workspaceId]);
  return (await query('SELECT opening_balance, currency, min_balance FROM workspace_settings WHERE workspace_id = $1', [workspaceId])).rows[0];
}

/** The forecast for one budget (used by the API and by the balance-warning alerts). */
export async function forecastForWorkspace(workspaceId, { past = 3, months = 12, estimateExpenses = true, estimateIncome = false } = {}) {
  const monthly = (extra = '') =>
    query(
      `SELECT to_char(date, 'YYYY-MM') AS month, type, status, (sum(amount * 100))::bigint AS cents
       FROM transactions WHERE workspace_id = $1 AND status IN ('paid', 'pending') ${extra} GROUP BY 1, 2, 3`,
      [workspaceId],
    );
  const [settings, all, manual] = await Promise.all([
    workspaceSettings(workspaceId),
    monthly(),
    // Variable-spending baseline: one-off paid items, minus categories that recurring items or
    // open installment plans already cover (e.g. a manually entered past "Rent" would
    // otherwise be counted again on top of the recurring rent).
    monthly(
      `AND source = 'manual' AND status = 'paid'
       AND (category_id IS NULL OR category_id NOT IN (
         SELECT category_id FROM recurring_rules WHERE workspace_id = $1 AND active AND category_id IS NOT NULL
         UNION
         SELECT p.category_id FROM installment_plans p
           WHERE p.workspace_id = $1 AND p.category_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM transactions t WHERE t.installment_plan_id = p.id AND t.status = 'pending')
       ))`,
    ),
  ]);
  const toRows = (r) => r.rows.map((x) => ({ ...x, cents: Number(x.cents) }));
  const forecast = buildForecast({
    rows: toRows(all),
    manualPaidRows: toRows(manual),
    openingCents: Math.round(settings.opening_balance * 100),
    minCents: Math.round((settings.min_balance ?? 0) * 100),
    currentMonth: monthOf(todayYMD()),
    past,
    months,
    estimateExpenses,
    estimateIncome,
  });
  return { ...forecast, currency: settings.currency };
}
