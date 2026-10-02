import { query } from '../db.js';
import { getSettings } from './notifications.js';

export const TARGET_TABLES = { transaction: 'transactions', recurring: 'recurring_rules', installment: 'installment_plans', category: 'categories' };

/**
 * Which alert rule applies to a payment for one person. First match wins, per setting:
 * the payment itself > its recurring item > its installment plan > its category > the default
 * (expenses alert; income only if the person asked for income alerts).
 */
export function resolveAlert(overrides, row, settings) {
  const chain = [
    ['transaction', row.id, 'payment'],
    ['recurring', row.recurring_id, 'recurring item'],
    ['installment', row.installment_plan_id, 'installment plan'],
    ['category', row.category_id, 'category'],
  ];
  let mode = null;
  let source = 'default';
  let days = null;
  for (const [type, id, label] of chain) {
    const o = id != null ? overrides.get(`${type}:${id}`) : null;
    if (!o) continue;
    if (mode === null) {
      mode = o.mode;
      source = label;
    }
    if (days === null && o.days != null) days = o.days;
  }
  mode ??= row.type === 'income' && !settings.include_income ? 'off' : 'on';
  return { mode, source, days: days ?? settings.lead_days, own: overrides.get(`transaction:${row.id}`) ?? null };
}

/** Add an `alert` field ({mode, source, days, own}) to each payment, for the signed-in person. */
export async function attachAlerts(userId, rows) {
  if (!rows.length) return rows;
  const settings = await getSettings(userId);
  const pick = (f) => [...new Set(rows.map((r) => r[f]).filter((v) => v != null))];
  const { rows: found } = await query(
    `SELECT target_type, target_id, mode, days FROM alert_overrides
     WHERE user_id = $1 AND (
       (target_type = 'transaction' AND target_id = ANY($2)) OR (target_type = 'recurring' AND target_id = ANY($3)) OR
       (target_type = 'installment' AND target_id = ANY($4)) OR (target_type = 'category' AND target_id = ANY($5)))`,
    [userId, rows.map((r) => r.id), pick('recurring_id'), pick('installment_plan_id'), pick('category_id')],
  );
  const overrides = new Map(found.map((o) => [`${o.target_type}:${o.target_id}`, { mode: o.mode, days: o.days }]));
  return rows.map((r) => ({ ...r, alert: resolveAlert(overrides, r, settings) }));
}

/** Is this payment / recurring item / plan / category in a budget the person belongs to? */
export async function canAccessTarget(userId, type, id) {
  const table = TARGET_TABLES[type];
  if (!table) return false;
  const { rowCount } = await query(
    `SELECT 1 FROM ${table} x JOIN workspace_members m ON m.workspace_id = x.workspace_id AND m.user_id = $2 WHERE x.id = $1`,
    [id, userId],
  );
  return rowCount > 0;
}
