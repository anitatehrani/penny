import { addMonthsYM } from './format.js';

// Everything about months that the calendar and the dashboard's month view need, as plain functions. A month is "YYYY-MM".

export const isYM = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Whole months from a to b (negative when b is earlier). */
export function monthDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export const yearOf = (ym) => Number(ym.slice(0, 4));
export const monthsOfYear = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
export const minYM = (a, b) => (a <= b ? a : b);
export const maxYM = (a, b) => (a >= b ? a : b);
export const clampYM = (ym, min, max) => (min && ym < min ? min : max && ym > max ? max : ym);

/**
 * Whether a month can be picked, and if not why (shown as a tooltip and read out).
 * `min` and `max` bound the range; `allowed` (a list) limits it to those months.
 */
export function monthChoice(ym, { min, max, allowed, notAllowedReason = 'Not available' } = {}) {
  if (min && ym < min) return { ok: false, reason: 'Too far back' };
  if (max && ym > max) return { ok: false, reason: 'Too far ahead' };
  if (allowed && !allowed.includes(ym)) return { ok: false, reason: notAllowedReason };
  return { ok: true };
}

/** Does this year have any month that can be picked? (Decides whether the year arrows are active.) */
export const yearHasChoice = (year, opts) => monthsOfYear(year).some((m) => monthChoice(m, opts).ok);

/**
 * Where keyboard focus goes from month number `from` (0 to 11) when moving by `step` (±1 along a row, ±4 down a column of a 4 x 3 grid):
 * the next month that can be picked in that direction, or null at the edge.
 */
export function nextPickable(from, step, pickable) {
  for (let i = from + step; i >= 0 && i < 12; i += step) if (pickable(i)) return i;
  return null;
}

// ---- the dashboard's month view ----

export const DASH_BACK = 12; // the forecast can show 12 months of history ...
export const DASH_AHEAD = 24; // ... and look 24 months ahead

/** The months the dashboard can be pointed at. */
export const dashboardBounds = (today) => ({ min: addMonthsYM(today, -DASH_BACK), max: addMonthsYM(today, DASH_AHEAD) });

/** The month in the address if it is a real month inside the bounds, otherwise this month. */
export function dashboardMonth(param, today) {
  const { min, max } = dashboardBounds(today);
  return isYM(param) && param >= min && param <= max ? param : today;
}

/**
 * The `past` and `months` to ask the forecast for so that it covers 4 months before and 3 after the chosen month, and at least
 * the usual 5 back and 6 ahead of today, within what the server allows (0 to 12 back, 1 to 24 ahead).
 */
export function forecastWindow(today, month) {
  const from = minYM(addMonthsYM(month, -4), addMonthsYM(today, -5));
  const to = maxYM(addMonthsYM(month, 3), addMonthsYM(today, 6));
  return { past: Math.min(12, Math.max(0, monthDiff(from, today))), months: Math.min(24, Math.max(1, monthDiff(today, to))) };
}

/** The forecast months from `back` before the chosen month to `ahead` after it. */
export function windowAround(months, month, back = 4, ahead = 3) {
  const i = months.findIndex((m) => m.month === month);
  return i < 0 ? [] : months.slice(Math.max(0, i - back), i + ahead + 1);
}

/**
 * One month's figures from the forecast: what came in and went out (estimates included for months to come), the net, and the
 * balance at the start and at the end of it. `kind` says whether it is behind us, this month, or still to come.
 */
export function monthFigures(months, month) {
  const i = months.findIndex((m) => m.month === month);
  if (i < 0) return null;
  const m = months[i];
  const income = round2(m.income + (m.estimatedIncome ?? 0));
  const expenses = round2(m.expenses + (m.estimatedExpenses ?? 0));
  const net = round2(income - expenses);
  return { month, kind: m.kind, income, expenses, net, endBalance: m.endBalance, startBalance: i > 0 ? months[i - 1].endBalance : round2(m.endBalance - net) };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * What the Spending widget needs for any month, from that month's summary and the one before it (each has `byCategory`).
 * Same shape the server gives for the current month.
 */
export function compareFromSummaries(current, previous, month) {
  const prevByKey = new Map((previous?.byCategory ?? []).map((c) => [c.category_id ?? c.name, c.total]));
  const seen = new Set();
  const categories = [];
  for (const c of current?.byCategory ?? []) {
    const key = c.category_id ?? c.name;
    seen.add(key);
    categories.push({ category_id: c.category_id ?? null, name: c.name, color: c.color, current: c.total, previous: prevByKey.get(key) ?? 0 });
  }
  for (const c of previous?.byCategory ?? []) {
    const key = c.category_id ?? c.name;
    if (!seen.has(key)) categories.push({ category_id: c.category_id ?? null, name: c.name, color: c.color, current: 0, previous: c.total });
  }
  categories.sort((a, b) => b.current - a.current || b.previous - a.previous);
  const sum = (list) => Math.round(list.reduce((t, c) => t + Math.round(c.total * 100), 0)) / 100;
  return {
    month,
    prevMonth: addMonthsYM(month, -1),
    categories,
    totals: { expenses: sum(current?.byCategory ?? []), expensesPrevious: sum(previous?.byCategory ?? []) },
  };
}

/**
 * A one-line answer to "am I going to be all right?" from the forecast: is the balance below zero today, under the safety buffer
 * today, does it dip below zero (or under the buffer) in a month still to come and when first, or does it stay above (and where is the
 * lowest point). Below zero is always the stronger state. Past months are not looked at. `buffer` is the balance the person wants to
 * keep (0 = none). Returns null when there is no forecast to go on.
 */
export function outlook(months, balanceToday, buffer = 0) {
  const ahead = (months ?? []).filter((m) => m.kind !== 'actual');
  if (!ahead.length) return null;
  const min = Math.max(0, Number(buffer) || 0);
  const lowest = ahead.reduce((low, m) => (m.endBalance < low.endBalance ? m : low), ahead[0]);
  const firstNegative = ahead.find((m) => m.endBalance < 0) ?? null;
  const firstLow = min > 0 ? ahead.find((m) => m.endBalance < min) ?? null : null;
  const status = balanceToday < 0 ? 'below' : balanceToday < min ? 'under' : firstNegative ? 'dip' : firstLow ? 'low' : 'ok';
  return {
    status,
    firstNegative: firstNegative && { month: firstNegative.month, balance: firstNegative.endBalance },
    firstLow: firstLow && { month: firstLow.month, balance: firstLow.endBalance },
    lowest: { month: lowest.month, balance: lowest.endBalance },
    buffer: min,
  };
}
