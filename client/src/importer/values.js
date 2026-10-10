// Reading the text of one cell as a date or an amount, and working out how a whole file writes them (docs/DESIGN.md section 41).
// Nothing here knows about banks: it only knows the ways people write dates and numbers.

const ODD_SPACES = /[  -​  　]/g;

/** Collapse every kind of space (including the no-break and thin ones banks like) into single plain spaces. */
export const tidy = (s) => String(s ?? '').replace(ODD_SPACES, ' ').replace(/\s+/g, ' ').trim();

/** Lower case without accents, so "Märznº" and "marznº" read the same. */
export const fold = (s) => tidy(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');

// ---------------------------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------------------------

// Month names and their usual short forms in English, Italian, German, French, Spanish, Portuguese and Dutch (accents already folded away).
const MONTHS = {
  january: 1, jan: 1, gennaio: 1, gen: 1, januar: 1, janvier: 1, janv: 1, enero: 1, ene: 1, janeiro: 1, januari: 1,
  february: 2, feb: 2, febbraio: 2, februar: 2, fevrier: 2, fev: 2, febrero: 2, fevereiro: 2, februari: 2,
  march: 3, mar: 3, marzo: 3, marz: 3, mrz: 3, mars: 3, marco: 3, maart: 3, mrt: 3,
  april: 4, apr: 4, aprile: 4, avril: 4, avr: 4, abril: 4, abr: 4,
  may: 5, mag: 5, maggio: 5, mai: 5, mayo: 5, maio: 5, mei: 5,
  june: 6, jun: 6, giugno: 6, giu: 6, juni: 6, juin: 6, junio: 6, junho: 6,
  july: 7, jul: 7, luglio: 7, lug: 7, juli: 7, juillet: 7, juil: 7, julio: 7, julho: 7,
  august: 8, aug: 8, agosto: 8, ago: 8, augustus: 8, aout: 8,
  september: 9, sep: 9, sept: 9, settembre: 9, set: 9, sett: 9, septembre: 9, septiembre: 9, setembro: 9,
  october: 10, oct: 10, ottobre: 10, ott: 10, oktober: 10, okt: 10, octobre: 10, octubre: 10, outubro: 10, out: 10,
  november: 11, nov: 11, novembre: 11, noviembre: 11, novembro: 11,
  december: 12, dec: 12, dicembre: 12, dic: 12, dezember: 12, dez: 12, decembre: 12, diciembre: 12, dezembro: 12,
};
const FILLER_WORDS = new Set(['st', 'nd', 'rd', 'th', 'de', 'del', 'of', 'the', 'um', 'am', 'le', 'el', 'il', 'der', 'den', 'a', 'o']);
const WEEKDAYS = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mer|gio|ven|sab|dom|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lu|me|je|ve|sa|di|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miercoles|jueves|viernes|sabado|domingo)$/;

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const validYMD = (y, m, d) => Number.isInteger(y) && y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
const twoDigitYear = (yy, refYear) => (yy <= (refYear % 100) + 1 ? 2000 + yy : 1900 + yy);

export const ymd = ({ y, m, d }) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The year a day and month without a year most likely belong to: the latest one that is not in the future (a week of slack). */
function guessYear(m, d, ref) {
  const r = ref ?? { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() + 1, d: new Date().getUTCDate() };
  const refDay = Date.UTC(r.y, r.m - 1, r.d);
  for (const y of [r.y, r.y - 1]) {
    if (validYMD(y, m, d) && Date.UTC(y, m - 1, d) <= refDay + 7 * 86400000) return y;
  }
  return r.y;
}

/**
 * Read one cell as a calendar date. Returns { y, m, d } (plus guessedYear when the text had no year) or null.
 * `order` settles all-number dates that could be either way round ('dmy' or 'mdy'); `ref` ({y,m,d}) is the "today" a missing year is guessed from.
 * Day and month names in seven languages, times and weekday names are accepted and ignored.
 */
export function parseDate(input, { order = 'dmy', ref = null, compact = false } = {}) {
  let s = tidy(input);
  if (!s || s.length > 48) return null;
  s = fold(s);
  // a time after the date, with or without a zone
  s = s.replace(/[t ,]+\d{1,2}[:.h]\d{2}(?:[:.]\d{2}(?:[.,]\d+)?)?\s*(?:z|am|pm|[+-]\d{2}:?\d{2})?$/i, '').trim();
  s = s.replace(/\s*\(.*\)$/, '').trim();
  const withoutWeekday = () => {
    const m = s.match(/^([a-z]{2,10})[.,]?\s+(.+)$/);
    return m && WEEKDAYS.test(m[1]) ? m[2] : null;
  };
  return readDate(s, order, ref, compact) ?? (() => {
    const rest = withoutWeekday();
    return rest ? readDate(rest, order, ref, compact) : null;
  })();
}

function readDate(s, order, ref, compact) {
  const refYear = ref?.y ?? new Date().getUTCFullYear();
  let m;
  // year first: 2026-10-01, 2026/10/01, 2026.10.01
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return validYMD(y, mo, d) ? { y, m: mo, d } : null;
  }
  if (compact && (m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return validYMD(y, mo, d) ? { y, m: mo, d } : null;
  }
  // numbers only: 01/10/2026, 1.10.26, 01-10-2026, and without a year (01/10, 01.10.)
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}|\d{2}))?[-/.]?$/))) {
    const [a, b] = [+m[1], +m[2]];
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    if (m[3] === undefined) {
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
      const y = guessYear(mo, d, ref);
      return validYMD(y, mo, d) ? { y, m: mo, d, guessedYear: true } : null;
    }
    const y = m[3].length === 2 ? twoDigitYear(+m[3], refYear) : +m[3];
    return validYMD(y, mo, d) ? { y, m: mo, d } : null;
  }
  // a month written out: "1 Oct 2026", "Oct 1, 2026", "01-Oct-26", "1. Oktober 2026", "2026 Oct 1", "1 octubre", "01OCT2026"
  const spaced = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  const tokens = spaced.split(/[\s,./-]+/).filter(Boolean).filter((t) => !FILLER_WORDS.has(t));
  const words = tokens.filter((t) => /^[a-z]+$/.test(t));
  const nums = tokens.filter((t) => /^\d+$/.test(t));
  if (words.length !== 1 || tokens.length !== words.length + nums.length || nums.length < 1 || nums.length > 2) return null;
  const mo = MONTHS[words[0]];
  if (!mo) return null;
  let day;
  let year;
  if (nums.length === 2) {
    const four = nums.findIndex((n) => n.length === 4);
    if (four >= 0) {
      year = +nums[four];
      day = +nums[1 - four];
    } else {
      [day, year] = [+nums[0], twoDigitYear(+nums[1], refYear)]; // 01 Oct 26, Oct 01 26
    }
  } else {
    day = +nums[0];
    if (nums[0].length === 4) return null;
    const y = guessYear(mo, day, ref);
    return validYMD(y, mo, day) ? { y, m: mo, d: day, guessedYear: true } : null;
  }
  return validYMD(year, mo, day) ? { y: year, m: mo, d: day } : null;
}

/** True for a cell that is plainly a date (used when looking for the date column, so it is strict about what a date looks like). */
export const looksLikeDate = (s, opts) => {
  const t = tidy(s);
  if (!t || !/\d/.test(t)) return false;
  if (/^\d{1,3}([.,]\d+)?$/.test(t)) return false; // 12 or 3,5: a quantity, not a date
  return parseDate(t, opts) !== null;
};

const toDays = ({ y, m, d }) => Math.round(Date.UTC(y, m - 1, d) / 86400000);

/**
 * How does this file write its all-number dates? Looks at every sample: a first number above 12 can only be a day, a second above 12 only a day
 * as well. When the samples cannot say (every number is 12 or less), the order of the lines decides (statements run in date order, and the
 * right reading is the one that keeps them in order and in the shortest stretch of time); only then the `hint` is used.
 * Returns { order, ambiguous }.
 */
export function inferDateOrder(samples, hint = 'dmy') {
  let dmy = 0;
  let mdy = 0;
  const numeric = [];
  for (const raw of samples) {
    const s = fold(raw).replace(/[t ,]+\d{1,2}[:.h]\d{2}.*$/, '').trim();
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/);
    if (!m) continue;
    const [a, b] = [+m[1], +m[2]];
    numeric.push([a, b, m[3]]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (!numeric.length) return { order: hint, ambiguous: false };
  if (dmy > 0 && mdy === 0) return { order: 'dmy', ambiguous: false };
  if (mdy > 0 && dmy === 0) return { order: 'mdy', ambiguous: false };
  if (dmy > 0 && mdy > 0) return { order: dmy >= mdy ? 'dmy' : 'mdy', ambiguous: true };
  // no evidence in the numbers: compare the two readings by how well they keep the lines in order
  const read = (order) => {
    const days = [];
    for (const raw of samples) {
      const p = parseDate(raw, { order });
      if (p) days.push(toDays(p));
    }
    let up = 0;
    let down = 0;
    for (let i = 1; i < days.length; i++) {
      if (days[i] > days[i - 1]) up++;
      else if (days[i] < days[i - 1]) down++;
    }
    const moves = up + down;
    return { sorted: moves ? Math.max(up, down) / moves : 1, span: days.length ? Math.max(...days) - Math.min(...days) : 0 };
  };
  const a = read('dmy');
  const b = read('mdy');
  if (Math.abs(a.sorted - b.sorted) >= 0.1) return { order: a.sorted > b.sorted ? 'dmy' : 'mdy', ambiguous: true };
  if (a.span !== b.span) return { order: a.span < b.span ? 'dmy' : 'mdy', ambiguous: true };
  return { order: hint, ambiguous: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------------------------------------------

const CURRENCY_CODES = 'EUR USD GBP CHF JPY CAD AUD NZD SEK NOK DKK PLN CZK HUF RON BGN TRY RUB INR CNY BRL MXN ZAR AED SAR ILS KRW SGD HKD THB UAH ISK';
const CODE = `(?:${CURRENCY_CODES.split(' ').join('|')})`;
const SYMBOLS = '€$£¥₹₽₺₩₪₴';
const MINUS = '-−–—';

/** Which currency a cell, or the text near it, mentions: 'EUR', 'USD', ... or null. */
export function currencyIn(s) {
  const t = String(s ?? '');
  const code = t.match(new RegExp(`\\b${CODE}\\b`, 'i'));
  if (code) return code[0].toUpperCase();
  if (t.includes('€')) return 'EUR';
  if (t.includes('£')) return 'GBP';
  if (t.includes('₹')) return 'INR';
  if (t.includes('₽')) return 'RUB';
  if (t.includes('₺')) return 'TRY';
  if (t.includes('$')) return 'USD';
  return null;
}

/**
 * Read one cell as a signed amount: "-20,33", "€ -20,33", "(20.00)", "20.00-", "1.074,34", "1,074.34", "1'074.34", "20.00 CR", "EUR 5".
 * `decimal` ('.' or ',') is how this file writes its decimals (see inferDecimal); without it a lone separator followed by three digits is
 * taken as a thousands separator. Returns a number (not rounded) or null when the text is not an amount.
 */
export function parseAmount(input, { decimal } = {}) {
  let s = tidy(input);
  if (!s || s.length > 40) return null;
  let negative = false;
  let m = s.match(/^\((.*)\)$/);
  if (m) {
    negative = true;
    s = m[1].trim();
  }
  // "20.00 CR" (credit) and "20.00 DR" (debit), or the letters in front. Whatever is left must still read as a number below.
  m = s.match(/^(.*?)\s*(cr|dr)\.?$/i);
  const lead0 = m ? null : s.match(/^(cr|dr)\.?\s*(.*)$/i);
  if (m || lead0) {
    const [flag, rest] = m ? [m[2], m[1]] : [lead0[1], lead0[2]];
    if (flag.toLowerCase() === 'dr') negative = !negative;
    s = rest.trim();
  }
  s = s.replace(new RegExp(`^${CODE}\\s*`, 'i'), '').replace(new RegExp(`\\s*${CODE}$`, 'i'), '');
  s = s.replace(new RegExp(`[${SYMBOLS}]`, 'g'), '').trim();
  const lead = s.match(new RegExp(`^([${MINUS}+])\\s*(.*)$`));
  if (lead) {
    if (MINUS.includes(lead[1])) negative = !negative;
    s = lead[2];
  }
  const trail = s.match(new RegExp(`^(.*?)\\s*([${MINUS}+])$`));
  if (trail) {
    if (MINUS.includes(trail[2])) negative = !negative;
    s = trail[1];
  }
  s = s.replace(new RegExp(`^${CODE}\\s*`, 'i'), '').replace(new RegExp(`\\s*${CODE}$`, 'i'), '').trim();
  s = s.replace(new RegExp(`[${SYMBOLS}]`, 'g'), '').trim();
  if (!/^[\d.,' ’]+$/.test(s) || !/\d/.test(s)) return null;
  s = s.replace(/['’ ]/g, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let decimalChar = null;
  if (hasDot && hasComma) {
    decimalChar = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) decimalChar = null; // 1.234.567: separators between thousands
    else if (decimal === sep) decimalChar = sep;
    else if (decimal && decimal !== sep) decimalChar = null;
    else decimalChar = parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 ? null : sep;
  }
  let digits;
  if (decimalChar) {
    const at = s.lastIndexOf(decimalChar);
    const whole = s.slice(0, at).replace(/[.,]/g, '');
    const frac = s.slice(at + 1).replace(/[.,]/g, '');
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null;
    digits = `${whole || '0'}.${frac || '0'}`;
  } else {
    digits = s.replace(/[.,]/g, '');
  }
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return negative && n !== 0 ? -n : n;
}

/** Round to cents, away from the float dust Excel leaves behind (-20.329999999999998 is -20.33). */
export const roundCents = (n) => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;

/**
 * How does this file write decimals? Counts the evidence in all the samples: "20,33" and "1.074,34" say comma; "20.33" and "1,074.34" say dot.
 * A lone "1.234" only whispers that the dot is a thousands mark. Returns { decimal, ambiguous }.
 */
export function inferDecimal(samples, hint = ',') {
  let dot = 0;
  let comma = 0;
  let weakDot = 0;
  let weakComma = 0;
  for (const raw of samples) {
    let s = tidy(raw).replace(new RegExp(`[${SYMBOLS}]`, 'g'), '').replace(new RegExp(`\\b${CODE}\\b`, 'gi'), '').replace(/[()\s'’]/g, '').replace(new RegExp(`^[${MINUS}+]|[${MINUS}+]$`, 'g'), '');
    s = s.replace(/(cr|dr)$/i, '');
    if (!/^\d[\d.,]*$/.test(s)) continue;
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');
    if (hasDot && hasComma) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) dot++;
      else comma++;
    } else if (hasDot || hasComma) {
      const sep = hasDot ? '.' : ',';
      const parts = s.split(sep);
      if (parts.length > 2) {
        if (sep === '.') weakComma++;
        else weakDot++;
      } else if (parts[1].length === 3) {
        if (sep === '.') weakComma++;
        else weakDot++;
      } else if (sep === '.') dot++;
      else comma++;
    }
  }
  if (dot > comma) return { decimal: '.', ambiguous: comma > 0 };
  if (comma > dot) return { decimal: ',', ambiguous: dot > 0 };
  if (weakComma > weakDot) return { decimal: ',', ambiguous: false };
  if (weakDot > weakComma) return { decimal: '.', ambiguous: false };
  return { decimal: hint, ambiguous: false };
}

/** A cell that reads as a number of any kind (a whole number too). */
export function looksLikeAmount(s, opts) {
  const t = tidy(s);
  return !!t && /\d/.test(t) && parseAmount(t, opts) !== null;
}

/** A cell that is a number with decimals or a sign or a currency mark (so not a bare year, a count or an id). */
export function looksLikeMoney(s, opts) {
  const t = tidy(s);
  if (!t || !/\d/.test(t)) return false;
  if (parseAmount(t, opts) === null) return false;
  return /[.,]\d{1,2}(?!\d)|[€$£¥₹]|^\(|^[-−+]|[-−+]$/.test(t) || new RegExp(`\\b${CODE}\\b`, 'i').test(t) || /\b(cr|dr)\b/i.test(t);
}
