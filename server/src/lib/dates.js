// Date helpers working on plain 'YYYY-MM-DD' / 'YYYY-MM' strings (no timezone surprises).
const pad = (n) => String(n).padStart(2, '0');

export const fmtYMD = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function isValidYMD(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseYMD(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Add n months, keeping `anchorDay` (default: the date's own day) clamped to month length. */
export function addMonths(ymd, n, anchorDay) {
  const { y, m, d } = parseYMD(ymd);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmtYMD(ny, nm, Math.min(anchorDay ?? d, daysInMonth(ny, nm)));
}

export function addDays(ymd, n) {
  const { y, m, d } = parseYMD(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtYMD(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function todayYMD() {
  const t = new Date();
  return fmtYMD(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

// 'YYYY-MM' helpers
export const monthOf = (ymd) => ymd.slice(0, 7);
export const monthStart = (ym) => `${ym}-01`;
export function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return fmtYMD(y, m, daysInMonth(y, m));
}
export function addMonthsYM(ym, n) {
  return addMonths(`${ym}-01`, n).slice(0, 7);
}
export const isValidYM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
