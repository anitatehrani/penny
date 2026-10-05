// The schedule of a recurring item, for showing "the last payment will be …" while the form is open.
// The server is the authority (server/src/lib/schedule.js); client/test/recurrenceLogic.test.js checks the two agree.

const pad = (n) => String(n).padStart(2, '0');
const parse = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
};
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function addDays(ymd, n) {
  const { y, m, d } = parse(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Months later, keeping the anchor day but never past the end of a short month (31st becomes 30th or 28th). */
export function addMonths(ymd, n, anchorDay) {
  const { y, m, d } = parse(ymd);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmt(ny, nm, Math.min(anchorDay ?? d, daysIn(ny, nm)));
}

/** The date of the k-th slot of a rule, counting from 0 (the start date itself). */
function slotDate(rule, k) {
  const interval = Number(rule.interval_count) || 1;
  const anchorDay = parse(rule.start_date).d;
  if (rule.frequency === 'weekly') return addDays(rule.start_date, 7 * interval * k);
  if (rule.frequency === 'monthly') return addMonths(rule.start_date, interval * k, anchorDay);
  return addMonths(rule.start_date, 12 * interval * k, anchorDay);
}

/** The date of the n-th payment (the 1st is the start date). */
export const nthOccurrence = (rule, n) => slotDate(rule, n - 1);

/** The last payment on or before an end date, and how many payments that makes; null when the end date is before the start. */
export function lastOccurrence(rule, endDate) {
  if (!endDate || endDate < rule.start_date) return null;
  let last = null;
  for (let k = 0; k < 5000; k++) {
    const date = slotDate(rule, k);
    if (date > endDate) break;
    last = { date, count: k + 1 };
  }
  return last;
}
