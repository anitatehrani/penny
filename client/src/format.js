const pad = (n) => String(n).padStart(2, '0');

export function todayYMD() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
export const currentMonth = () => todayYMD().slice(0, 7);

export function addMonthsYM(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

const localDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const monthLabel = (ym, opts = { month: 'long', year: 'numeric' }) =>
  localDate(`${ym}-01`).toLocaleDateString(undefined, opts);
export const monthShort = (ym) => monthLabel(ym, { month: 'short', year: '2-digit' });
export const dateLabel = (ymd, opts = { day: 'numeric', month: 'short' }) => localDate(ymd).toLocaleDateString(undefined, opts);
export const dateLong = (ymd) => dateLabel(ymd, { day: 'numeric', month: 'short', year: 'numeric' });
export const weekday = (ymd) => dateLabel(ymd, { weekday: 'short' });

export function daysFromToday(ymd) {
  return Math.round((localDate(ymd) - localDate(todayYMD())) / 86400000);
}

export function relativeDay(ymd) {
  const d = daysFromToday(ymd);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d} days overdue`;
  return `In ${d} days`;
}

export function makeMoney(currency) {
  const full = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const fmt = (n, { signed = false } = {}) => {
    const rounded = Math.round(n * 100) / 100; // an amount that rounds to zero has no sign
    const s = full.format(Math.abs(rounded));
    if (rounded < 0) return `−${s}`;
    return signed && rounded > 0 ? `+${s}` : s;
  };
  fmt.compact = (n) => (n < 0 ? `−${compact.format(Math.abs(n))}` : compact.format(n));
  return fmt;
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

export function describeRule(r) {
  const every = r.interval_count > 1 ? r.interval_count : null;
  const [, m, d] = r.start_date.split('-').map(Number);
  if (r.frequency === 'weekly') {
    const day = localDate(r.start_date).toLocaleDateString(undefined, { weekday: 'long' });
    return every ? `Every ${every} weeks on ${day}` : `Weekly on ${day}`;
  }
  if (r.frequency === 'monthly') {
    if (every === 3) return `Every quarter on the ${ordinal(d)}`;
    return every ? `Every ${every} months on the ${ordinal(d)}` : `Monthly on the ${ordinal(d)}`;
  }
  const day = localDate(r.start_date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return every ? `Every ${every} years on ${day}` : `Yearly on ${day}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a date for older ones. */
export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}
