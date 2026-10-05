import { addMonths } from './recurrenceLogic.js';

const toCents = (v) => Math.round((Number(v) || 0) * 100);

/** Split an amount in cents into `count` equal parts; the odd cents go to the first ones (the server does the same). */
export function splitCents(totalCents, count) {
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * What a repayment plan would create, for the preview in the form. `owed` is what is still to pay (the total, less anything already paid).
 * Returns null when there is nothing to schedule.
 */
export function previewPlan({ plan, owed, firstDate, count }) {
  const cents = toCents(owed);
  if (plan === 'none' || cents <= 0 || !firstDate) return null;
  if (plan === 'monthly' && !(Number(count) >= 2)) return null;
  const n = plan === 'once' ? 1 : Math.min(Math.floor(Number(count)), 120, cents); // never a payment of nothing
  const parts = splitCents(cents, n);
  const day = Number(firstDate.slice(8));
  return { count: n, first: firstDate, last: n === 1 ? firstDate : addMonths(firstDate, n - 1, day), each: parts[0] / 100, eachLast: parts[n - 1] / 100, even: parts[0] === parts[n - 1] };
}

/** One line saying what the plan of a debt is. */
export function describePlan(debt, dateLong) {
  if (debt.plan === 'none') return 'Not scheduled yet';
  if (debt.plan === 'once') return `All in one go on ${dateLong(debt.first_due_date)}`;
  return `${debt.installment_count} monthly payments from ${dateLong(debt.first_due_date)}`;
}

/** The short badge that says how the debt relates to the budget. */
export function budgetStatus(debt) {
  if (debt.status === 'settled') return { tone: 'ok', label: 'Settled' };
  if (!debt.count_in_budget) return { tone: '', label: 'Not counted' };
  if (debt.scheduled_count > 0) return { tone: 'tone-forecast', label: 'In your forecast' };
  return { tone: '', label: 'Counted · no plan yet' };
}

/**
 * The steps of a debt's repayment timeline, oldest first. `debt.payments` are its paid and pending payments (oldest first), `today` is
 * 'YYYY-MM-DD'. States: paid, overdue (pending, day passed), next (first pending not overdue), later, and a final `open` step for the
 * part of what is still owed that no payment covers. `debtFree` is the date of the last planned payment when the plan covers everything
 * still owed, else null.
 */
export function timelineSteps(debt, today) {
  const steps = [];
  let nextTaken = false;
  let plannedCents = 0;
  let lastPlanned = null;
  for (const p of debt.payments ?? []) {
    if (p.status === 'paid') {
      steps.push({ key: `p${p.id}`, state: 'paid', date: p.date, amount: p.amount });
      continue;
    }
    plannedCents += toCents(p.amount);
    lastPlanned = p.date;
    let state = 'later';
    if (p.date < today) state = 'overdue';
    else if (!nextTaken) {
      state = 'next';
      nextTaken = true;
    }
    steps.push({ key: `p${p.id}`, state, date: p.date, amount: p.amount });
  }
  const openCents = debt.status === 'settled' ? 0 : Math.max(0, toCents(debt.remaining) - plannedCents);
  if (openCents > 0) steps.push({ key: 'open', state: 'open', date: null, amount: openCents / 100 });
  return { steps, debtFree: debt.status !== 'settled' && openCents === 0 && plannedCents > 0 ? lastPlanned : null };
}
