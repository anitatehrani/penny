import { t, tn } from './i18n/translate.js';
// What the admin dashboard shows, worked out by plain functions so it is tested without a browser (docs/DESIGN.md section 33).

/** 1536 -> "1.5 KB". Whole numbers stay whole ("2 MB"). */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
  const x = v / 1024 ** i;
  return `${i === 0 || Number.isInteger(Math.round(x * 10) / 10) ? Math.round(x * 10) / 10 : x.toFixed(1)} ${units[i]}`;
}

/** 200 -> "3 min", 12000 -> "3 h 20 min", 200000 -> "2 days 7 h". */
export function uptimeText(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return t('{m} min', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{h} h {value} min', { h, value: m % 60 });
  const d = Math.floor(h / 24);
  return tn(d, '{n} day {value} h', '{n} days {value} h', { value: h % 24 });
}

/** "5 min ago" and so on for a time, or "never" when there is none. `now` is a number of milliseconds (passed in so it can be tested). */
export function agoText(iso, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return t('just now');
  if (s < 3600) return t('{max} min ago', { max: Math.max(1, Math.round(s / 60)) });
  if (s < 86400) return t('{round} h ago', { round: Math.round(s / 3600) });
  const d = Math.round(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return t('{d} days ago', { d });
  if (d < 365) return tn(Math.round(d / 30), '{n} month ago', '{n} months ago');
  return tn(Math.round(d / 365), '{n} year ago', '{n} years ago');
}

/**
 * The bars of the sign-ups chart. `rows` is [{ day: 'YYYY-MM-DD', count }]. Each bar gets a height in percent of the tallest (a day with people
 * never shrinks to nothing), and the chart says how many there were in all and which day was busiest.
 */
export function signupBars(rows) {
  const list = (rows ?? []).map((r) => ({ day: r.day, count: Number(r.count) || 0 }));
  const max = Math.max(0, ...list.map((r) => r.count));
  const total = list.reduce((tt, r) => tt + r.count, 0);
  const busiest = max > 0 ? list.find((r) => r.count === max) : null;
  return {
    max,
    total,
    busiest,
    bars: list.map((r) => ({ ...r, pct: max === 0 ? 0 : r.count === 0 ? 0 : Math.max(4, Math.round((r.count / max) * 100)) })),
  };
}

/** "Showing 26 to 50 of 61" for a page of a list. */
export function rangeText(page, size, total) {
  if (!total) return t('Nothing to show');
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return t('Showing {from} to {to} of {total}', { from, to, total });
}

/** The little labels on a person: what they are and what state they are in. */
export function personBadges(u) {
  const out = [];
  if (u.is_admin) out.push({ label: t('Admin'), tone: 'tone-forecast' });
  out.push(u.suspended ? { label: t('Suspended'), tone: 'tone-neg' } : { label: t('Active'), tone: 'ok' });
  if (!u.email_verified) out.push({ label: t('E-mail not confirmed'), tone: '' });
  return out;
}

export function signInMethods(u) {
  if (u.has_password && u.google_linked) return t('Password and Google');
  if (u.google_linked) return t('Google');
  return u.has_password ? t('Password') : t('None');
}

/** The words for "who" in an event: the person it is about, and the admin who did it when there is one. */
export function eventWho(e) {
  // no account: a failed sign-in by someone who never had one; "deleted": something that was about a person who has since been deleted
  const person = e.user_name ? `${e.user_name} (@${e.user_username})` : e.user_id ? t('A person') : !e.kind || e.kind === 'login_failed' ? t('No account') : t('Deleted account');
  return { person, actor: e.actor_name ? `${e.actor_name} (@${e.actor_username})` : null };
}

/** How many of the going-public checks are done. */
export function checkSummary(checks) {
  const total = (checks ?? []).length;
  const done = (checks ?? []).filter((c) => c.ok).length;
  return { done, total, allOk: total > 0 && done === total };
}

/** Deleting an account needs the username typed (any case, spaces around it ignored). */
export const deleteConfirmed = (typed, username) => !!username && String(typed ?? '').trim().toLowerCase() === String(username).toLowerCase();

/** A share as a whole percent ("12 of 40" is 30). Nothing to divide by is 0. */
export const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Whole minutes left of a "view as" (rounded up, never negative). `now` is in milliseconds, passed in so it can be tested. */
export const minutesLeft = (expiresAt, now = Date.now()) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));

/** What is still missing before "View as" can start: a reason of a few words, and the admin's own password when they have one. Null when ready. */
export function viewAsProblem({ reason, password }, needsPassword) {
  if (String(reason ?? '').trim().length < 5) return t('Say why, in a few words.');
  if (needsPassword && !password) return t('Type your password to confirm it is you.');
  return null;
}

/** The first line of a message, cut short, for the closed row in the Messages list. */
export function messagePreview(text, max = 120) {
  const line = String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
  const one = line.trim().replace(/\s+/g, ' ');
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
