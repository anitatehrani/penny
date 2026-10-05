import { addMonthsYM } from './dates.js';

const MAX_MONTHS = 1200; // far more than a budget will ever hold; keeps a stray request cheap

/**
 * Cents carried into `month` ('YYYY-MM'). `netCents` maps each month with payments to its income less expenses, in cents.
 * leftover(m) = max(0, carried into m + net(m)); the first month has nothing carried in. Only money is carried, never a shortfall.
 */
export function carriedInto(netCents, month) {
  const months = Object.keys(netCents).sort();
  if (!months.length || months[0] >= month) return 0;
  let m = months[0];
  const earliest = addMonthsYM(month, -MAX_MONTHS);
  if (m < earliest) m = earliest;
  let left = 0;
  for (; m < month; m = addMonthsYM(m, 1)) left = Math.max(0, left + (netCents[m] ?? 0));
  return left;
}
