import { pool } from '../db.js';
import { addMonthsYM, monthEnd, monthOf, monthStart, todayYMD } from './dates.js';
import { occurrences } from './schedule.js';

/** How far ahead recurring items are turned into real pending payments. */
export const HORIZON_MONTHS = 24;

/**
 * Create pending payments for a recurring rule from the start of the current month up to the
 * horizon. Idempotent: the unique (recurring_id, occurrence_date) index silently skips slots that already exist, including ones
 * the user skipped (so skipping sticks) and ones the user moved to another day (so moving does not make a second copy).
 *
 * A monthly item gets one payment a month and a yearly one a year (docs/DESIGN.md section 32). When the rule's day is changed, a month
 * that already has a paid or skipped payment of it (on the old day) is that month's payment: it does not get a second one on the new day.
 */
export async function materializeRule(rule, db = pool) {
  if (!rule.active) return 0;
  const thisMonth = monthOf(todayYMD());
  const from = rule.start_date > monthStart(thisMonth) ? rule.start_date : monthStart(thisMonth);
  const to = monthEnd(addMonthsYM(thisMonth, HORIZON_MONTHS));
  let dates = occurrences(rule, from, to);
  if (rule.frequency !== 'weekly' && dates.length) dates = await withoutSettledPeriods(rule, dates, from, db);
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

/** The dates whose month (monthly) or year (yearly) already holds a different occurrence of this rule, left out. */
async function withoutSettledPeriods(rule, dates, from, db) {
  const len = rule.frequency === 'yearly' ? 4 : 7;
  const { rows } = await db.query(`SELECT to_char(occurrence_date, 'YYYY-MM-DD') AS d FROM transactions WHERE recurring_id = $1 AND occurrence_date >= $2`, [rule.id, monthStart(from.slice(0, 7))]);
  const taken = new Map();
  for (const { d } of rows) taken.set(d.slice(0, len), (taken.get(d.slice(0, len)) ?? new Set()).add(d));
  return dates.filter((d) => {
    const others = taken.get(d.slice(0, len));
    return !others || (others.size === 1 && others.has(d)); // nothing there, or only this very slot (the unique index skips it)
  });
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
