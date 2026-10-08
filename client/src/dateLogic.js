// Everything the date picker needs, as plain functions, so it is tested without a browser. A date is "YYYY-MM-DD" (a calendar day, no
// time zone): all arithmetic is done in UTC so a daylight-saving change can never move a day.

const pad = (n) => String(n).padStart(2, '0');

const utc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (dt) => `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

/** A real calendar day written as YYYY-MM-DD (2031-02-30 is not one). */
export function isYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUtc(utc(s)) === s;
}

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const addDaysYMD = (ymd, n) => {
  const dt = utc(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
};

/** The same day some months on, or the last day of that month when it has no such day (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonthsYMD(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** 0 to 6: how many days after the start of its week a day is. `weekStart`: 1 = Monday (default), 0 = Sunday. */
export function weekdayIndex(ymd, weekStart = 1) {
  return (utc(ymd).getUTCDay() - weekStart + 7) % 7;
}

/** The first and last day of the week a day is in. */
export const weekStartOf = (ymd, weekStart = 1) => addDaysYMD(ymd, -weekdayIndex(ymd, weekStart));
export const weekEndOf = (ymd, weekStart = 1) => addDaysYMD(weekStartOf(ymd, weekStart), 6);

/**
 * The days a month's page shows: always six whole weeks (42 days), starting on the first day of the week that holds the 1st, so the page
 * does not change height from month to month. Each: { ymd, day, inMonth }.
 */
export function monthGrid(ym, weekStart = 1) {
  const first = `${ym}-01`;
  const start = weekStartOf(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => {
    const ymd = addDaysYMD(start, i);
    return { ymd, day: Number(ymd.slice(8)), inMonth: ymd.startsWith(ym) };
  });
}

/** Short weekday names in the order of the page, in the browser's language ("Mo", "Tu" ...). */
export function weekdayLabels(weekStart = 1, locale) {
  const monday = '2024-01-01'; // a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const name = utc(addDaysYMD(monday, weekStart - 1 + i)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
    return name.length > 3 ? name.slice(0, 2) : name;
  });
}

/** Whether a day can be picked, and if not why (a tooltip and read out). `min` and `max` are days or empty. */
export function dateChoice(ymd, { min, max } = {}) {
  if (min && ymd < min) return { ok: false, reason: 'Too early' };
  if (max && ymd > max) return { ok: false, reason: 'Too late' };
  return { ok: true };
}

export const clampDate = (ymd, min, max) => (min && ymd < min ? min : max && ymd > max ? max : ymd);

/**
 * Where the keyboard goes from a day. Arrows: a day or a week; Home and End: the start and end of the week; Page Up and Down: a month
 * (a year with Shift). The result is kept inside `min` and `max`; when the move would leave them the day stays where it is.
 */
export function moveCursor(ymd, key, { shift = false, min, max, weekStart = 1 } = {}) {
  let to = ymd;
  if (key === 'ArrowLeft') to = addDaysYMD(ymd, -1);
  else if (key === 'ArrowRight') to = addDaysYMD(ymd, 1);
  else if (key === 'ArrowUp') to = addDaysYMD(ymd, -7);
  else if (key === 'ArrowDown') to = addDaysYMD(ymd, 7);
  else if (key === 'Home') to = weekStartOf(ymd, weekStart);
  else if (key === 'End') to = weekEndOf(ymd, weekStart);
  else if (key === 'PageUp') to = addMonthsYMD(ymd, shift ? -12 : -1);
  else if (key === 'PageDown') to = addMonthsYMD(ymd, shift ? 12 : 1);
  else return ymd;
  return dateChoice(to, { min, max }).ok ? to : ymd;
}

/** The month ("YYYY-MM") a page shows for a value: the value's own, else the one holding today (clamped into min..max). */
export function pageFor(value, today, { min, max } = {}) {
  const base = isYMD(value) ? value : clampDate(today, min, max);
  return base.slice(0, 7);
}
