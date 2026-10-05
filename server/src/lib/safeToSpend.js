import { addDays, monthEnd } from './dates.js';

const HORIZON_DAYS = 62; // an income further away than this is not "the next one": the figure runs to the end of the month instead

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * How much can be spent a day until the next income, after what is still to pay (docs/DESIGN.md section 27).
 *
 *   until     = the day before the next income still to arrive (pending, dated after today); none in 62 days: the last day of the month
 *   days      = today to `until`, both included, at least 1
 *   bills     = every pending expense dated on or before `until` (overdue ones included)
 *   available = balance - bills - safety buffer
 *   per day   = available / days, rounded down; nothing when available is not above zero (then `short` says by how much)
 *
 * `pending` is [{ date, type, cents, description }] (anything not pending is ignored). Everything is whole cents.
 */
export function safeToSpend({ today, balanceCents, bufferCents = 0, pending }) {
  const incomes = pending
    .filter((p) => p.type === 'income' && p.date > today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = incomes.find((p) => daysBetween(today, p.date) <= HORIZON_DAYS) ?? null;
  const until = next ? addDays(next.date, -1) : monthEnd(today.slice(0, 7));
  const days = Math.max(1, daysBetween(today, until) + 1);
  const due = pending.filter((p) => p.type === 'expense' && p.date <= until);
  const billsCents = due.reduce((t, p) => t + p.cents, 0);
  const buffer = Math.max(0, bufferCents);
  const availableCents = balanceCents - billsCents - buffer;
  const perDay = availableCents > 0 ? Math.floor(availableCents / days) : 0;
  return {
    today,
    until,
    until_kind: next ? 'income' : 'month-end',
    days,
    balance: balanceCents / 100,
    bills: billsCents / 100,
    bills_count: due.length,
    buffer: buffer / 100,
    available: availableCents / 100,
    per_day: perDay / 100,
    short: availableCents < 0 ? -availableCents / 100 : 0,
    next_income: next ? { date: next.date, description: next.description, amount: next.cents / 100 } : null,
  };
}
