import { addDays, addMonths, parseYMD } from './dates.js';

/**
 * Dates on which a recurring rule fires within [from, to] (inclusive).
 * rule: { frequency: 'weekly'|'monthly'|'yearly', interval_count, start_date, end_date? }
 * Monthly/yearly rules keep their anchor day, clamped for short months (31st -> 30th/28th).
 */
export function occurrences(rule, from, to) {
  const interval = rule.interval_count || 1;
  const last = rule.end_date && rule.end_date < to ? rule.end_date : to;
  const anchorDay = parseYMD(rule.start_date).d;
  const out = [];
  for (let k = 0; k < 5000; k++) {
    let date;
    if (rule.frequency === 'weekly') date = addDays(rule.start_date, 7 * interval * k);
    else if (rule.frequency === 'monthly') date = addMonths(rule.start_date, interval * k, anchorDay);
    else date = addMonths(rule.start_date, 12 * interval * k, anchorDay);
    if (date > last) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** Split a total (in cents) over n installments; extra cents go to the first ones. */
export function splitInstallments(totalCents, count) {
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

export function installmentDates(firstDue, count) {
  const day = parseYMD(firstDue).d;
  return Array.from({ length: count }, (_, i) => addMonths(firstDue, i, day));
}
