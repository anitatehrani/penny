import { pool } from '../db.js';
import { addMonthsYM, monthEnd, monthOf, monthStart, todayYMD } from './dates.js';
import { occurrences } from './schedule.js';

/** How far ahead recurring items are turned into real pending payments. */
export const HORIZON_MONTHS = 24;

/**
 * Create pending payments for a recurring rule from the start of the current month up to the
 * horizon. Idempotent: the unique (recurring_id, occurrence_date) index silently skips slots that already exist, including ones
 * the user skipped (so skipping sticks) and ones the user moved to another day (so moving does not make a second copy).
 */
export async function materializeRule(rule, db = pool) {
  if (!rule.active) return 0;
  const thisMonth = monthOf(todayYMD());
  const from = rule.start_date > monthStart(thisMonth) ? rule.start_date : monthStart(thisMonth);
  const to = monthEnd(addMonthsYM(thisMonth, HORIZON_MONTHS));
  const dates = occurrences(rule, from, to);
  if (!dates.length) return 0;
  const res = await db.query(
    `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, source, recurring_id, occurrence_date)
     SELECT $8::int, $9::int, $10::int, $1::text, $2::text, $3::numeric, $4::int, d, 'pending', $5::text, 'recurring', $6::int, d
     FROM unnest($7::date[]) AS d
     ON CONFLICT DO NOTHING`,
    [rule.type, rule.description, rule.amount, rule.category_id, rule.note, rule.id, dates, rule.user_id, rule.workspace_id, rule.member_id ?? rule.user_id],
  );
  return res.rowCount;
}

/** Drop pending occurrences from this month on, then regenerate (used after rule edits). Skipped ones stay skipped. */
export async function resetRule(rule, db = pool) {
  await db.query(
    `DELETE FROM transactions
     WHERE recurring_id = $1 AND status = 'pending' AND date >= $2`,
    [rule.id, monthStart(monthOf(todayYMD()))],
  );
  return materializeRule(rule, db);
}

export async function materializeAll() {
  const { rows } = await pool.query('SELECT * FROM recurring_rules WHERE active');
  let created = 0;
  for (const rule of rows) created += await materializeRule(rule);
  return created;
}
