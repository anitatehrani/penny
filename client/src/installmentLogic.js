import { addMonths } from './recurrenceLogic.js';

/** Past this many installments the step track would be hair-thin, so the plan keeps the continuous bar. */
export const MAX_SEGMENTS = 24;

/**
 * What a plan's card shows: the share paid, the step track (paid / next / later), the average payment and the last due date.
 * `plan` has installment_count, first_due_date, total_amount and paid_count (as GET /api/installments returns them).
 */
export function planFacts(plan) {
  const count = Math.max(0, Math.floor(Number(plan.installment_count) || 0));
  const paid = Math.min(count, Math.max(0, Math.floor(Number(plan.paid_count) || 0)));
  const segments =
    count > 0 && count <= MAX_SEGMENTS ? Array.from({ length: count }, (_, i) => (i < paid ? 'paid' : i === paid ? 'next' : 'later')) : null;
  const lastDue = count > 0 && plan.first_due_date ? addMonths(plan.first_due_date, count - 1, Number(plan.first_due_date.slice(8))) : null;
  return {
    count,
    paid,
    pct: count > 0 ? Math.round((paid / count) * 100) : 0,
    segments,
    each: count > 0 ? Math.round((Number(plan.total_amount) * 100) / count) / 100 : 0,
    lastDue,
    finished: count > 0 && paid >= count,
  };
}
