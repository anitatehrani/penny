// Working out what each column of a table is, and how the file writes dates, numbers and signs (docs/DESIGN.md section 41).
// The headings propose, the data decides: a column called "Date" must contain dates, a column called "Valuta" is a date or a currency
// depending on what is in it, and a table with no headings at all is understood from its content alone.

import { directionOf, headerRole, statusOf } from './headers.js';
import { currencyIn, fold, inferDateOrder, inferDecimal, looksLikeDate, looksLikeMoney, parseAmount, parseDate, tidy } from './values.js';
import { t } from '../i18n/translate.js';

const MAX_COLS = 60;
const SAMPLE = 500;

const cell = (row, i) => tidy(row?.[i] ?? '');
export const widthOf = (rows) => Math.min(MAX_COLS, rows.reduce((w, r) => Math.max(w, r.length), 0));

/** A short, stable text for a table's headings, so a layout someone matched by hand is recognised next time. */
export const headerSignature = (cells) => cells.map((c) => fold(c).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean).join('|');

const WEIGHT = { date: 3, amount: 3, debit: 3, credit: 3, description: 2, payee: 2, counterparty: 2, details: 1, balance: 1, currency: 1, category: 1, status: 1, direction: 1, reference: 1, fee: 1, valueDate: 1, payer: 1 };

/** Find the heading row of a table: the row that names the most things and is followed by dated lines. Returns an index or -1. */
export function findHeaderRow(rows) {
  let best = { score: 0, at: -1 };
  const limit = Math.min(rows.length, 80);
  for (let r = 0; r < limit; r++) {
    const roles = new Set();
    let named = 0;
    for (const c of rows[r]) {
      const tt = tidy(c);
      if (!tt || tt.length > 60) continue;
      const hr = headerRole(tt);
      if (hr && hr.score >= 60) {
        roles.add(hr.role);
        named++;
      }
    }
    if (roles.size < 2 || !roles.has('date') || !(roles.has('amount') || roles.has('debit') || roles.has('credit'))) continue;
    let score = [...roles].reduce((s, role) => s + (WEIGHT[role] ?? 0), 0);
    // a heading is followed by lines with dates in them
    let dated = 0;
    let seen = 0;
    for (let k = r + 1; k < Math.min(rows.length, r + 8) && seen < 4; k++) {
      if (!rows[k].some((c) => tidy(c))) continue;
      seen++;
      if (rows[k].some((c) => looksLikeDate(c))) dated++;
    }
    if (seen && !dated) score /= 2;
    if (score > best.score) best = { score, at: r };
  }
  return best.at;
}

function profile(rows, start, col) {
  const cells = [];
  for (let r = start; r < Math.min(rows.length, start + SAMPLE); r++) {
    const tt = cell(rows[r], col);
    if (tt) cells.push(tt);
  }
  const n = cells.length;
  const frac = (fn) => (n ? cells.filter(fn).length / n : 0);
  const dateOf = (tt) => looksLikeDate(tt, { order: 'dmy' }) || looksLikeDate(tt, { order: 'mdy' });
  return {
    cells,
    n,
    dates: frac(dateOf),
    money: frac((tt) => looksLikeMoney(tt)),
    numbers: frac((tt) => parseAmount(tt) !== null && /\d/.test(tt)),
    text: frac((tt) => !dateOf(tt) && parseAmount(tt) === null),
    avgLen: n ? cells.reduce((s, tt) => s + tt.length, 0) / n : 0,
    compact: frac((tt) => /^(19|20)\d{6}$/.test(tt) && parseDate(tt, { compact: true }) !== null),
    codes: frac((tt) => /^[A-Za-z]{3}$/.test(tt)),
    ids: frac((tt) => /^[A-Za-z0-9][A-Za-z0-9\-_/.]{7,}$/.test(tt) && /\d/.test(tt) && !/\s/.test(tt)),
    directions: frac((tt) => directionOf(tt) !== 0),
    statuses: frac((tt) => statusOf(tt) !== 0),
    distinct: new Set(cells).size,
  };
}

/** Does the column behave like a running balance next to this amount column? Rows must follow each other. */
function chainFits(rows, start, balCol, amtCol, opts) {
  let checked = 0;
  let agree = 0;
  let prev = null;
  let prevAmt = null;
  for (let r = start; r < Math.min(rows.length, start + 200); r++) {
    const b = parseAmount(cell(rows[r], balCol), opts);
    const a = parseAmount(cell(rows[r], amtCol), opts);
    if (b === null || a === null) continue;
    if (prev !== null) {
      checked++;
      const d = b - prev;
      if (Math.abs(Math.abs(d) - Math.abs(a)) < 0.011 || Math.abs(Math.abs(d) - Math.abs(prevAmt)) < 0.011) agree++;
    }
    prev = b;
    prevAmt = a;
  }
  return checked >= 3 && agree / checked >= 0.7;
}

/**
 * Decide the roles of the columns of one grid. Returns the mapping (serialisable, editable by the matching screen) plus how sure Penny is.
 *   { headerRow, dataStart, roles: [role per column], headers: [text per column], dateOrder, decimal, sign, currency, confidence, notes: [], ... }
 * `hint` ({ dateOrder, decimal }) is what to assume when the file cannot say; `saved` is a mapping the person made by hand for the same headings.
 */
export function analyseGrid(grid, { hint = {}, saved = null } = {}) {
  const rows = grid.rows;
  const width = widthOf(rows);
  const notes = [];
  if (!width || rows.length < 2) return { ok: false, confidence: 'low', roles: [], headers: [], headerRow: -1, dataStart: 0, notes: [t('The table is empty.')] };

  // a layout the person matched by hand before (same headings) is used as they left it
  if (saved) {
    const at = saved.headerRow;
    return { ...saved.mapping, ok: true, confidence: 'high', notes: [t('Penny used the way you matched this layout before.')], fromMemory: true, headers: rows[at].map(tidy), headerRow: at, dataStart: at + 1 };
  }
  const headerRow = Number.isInteger(grid.headerRow) ? grid.headerRow : findHeaderRow(rows);
  // where the payments start: after the heading; with no heading, at the first line that has a date in it (what is above is explanation)
  const dataStart = (() => {
    const hasDate = (r) => rows[r]?.some((c) => looksLikeDate(c));
    let s = headerRow >= 0 ? headerRow + 1 : 0;
    if (headerRow < 0) {
      const first = rows.findIndex((_r, r) => hasDate(r) && (r + 1 >= rows.length || hasDate(r + 1) || !rows[r + 1].some((c) => tidy(c))));
      if (first >= 0) s = first;
    }
    while (s < rows.length && !rows[s].some((c) => tidy(c))) s++;
    return s;
  })();
  const headers = Array.from({ length: width }, (_v, i) => (headerRow >= 0 ? cell(rows[headerRow], i) : ''));
  const stat = Array.from({ length: width }, (_v, i) => profile(rows, dataStart, i));
  const roles = Array(width).fill('ignore');
  const claimed = new Set();
  const take = (role, i) => {
    roles[i] = role;
    claimed.add(i);
  };

  // 1. what the headings say
  const proposed = headers.map((h) => (h ? headerRole(h) : null));
  const strong = proposed.map((p) => (p && p.score >= 60 ? p : null));

  // 2. dates: a heading that says date, confirmed by dates in the column
  const dateScore = (i) => Math.max(stat[i].dates, strong[i]?.role === 'date' ? stat[i].compact : 0); // 20261001, when the heading says date
  const dateCols = strong.map((p, i) => (p && (p.role === 'date' || p.role === 'valueDate' || p.alt === 'valueDate') ? i : -1)).filter((i) => i >= 0 && dateScore(i) >= 0.6);
  const prefer = (i) => (/\b(completed|booking|posting|contabil|registraz|operazione|buchung|operation|transaction)/i.test(fold(headers[i])) ? 1 : 0) + (strong[i]?.role === 'date' ? 2 : 0);
  let dateCol = dateCols.sort((a, b) => prefer(b) - prefer(a) || a - b)[0] ?? -1;
  if (dateCol < 0) {
    // no usable heading: the column with the most dates in it
    let best = 0.7;
    stat.forEach((s, i) => {
      if (s.dates > best && s.n >= 2) {
        best = s.dates;
        dateCol = i;
      }
    });
    if (dateCol >= 0) notes.push(t('Penny found the date column by looking at what is in it.'));
  }
  const compactDates = dateCol >= 0 && stat[dateCol].dates < 0.6 && stat[dateCol].compact >= 0.6;
  if (dateCol >= 0) take('date', dateCol);
  for (const i of dateCols) if (i !== dateCol) {
    take('valueDate', i);
  }

  // 3. money columns
  const moneyOk = (i) => stat[i].n >= 1 && stat[i].numbers >= 0.8 && (stat[i].money >= 0.3 || stat[i].numbers === 1);
  const byRole = (role) => strong.map((p, i) => (p && p.role === role && !claimed.has(i) ? i : -1)).filter((i) => i >= 0);
  const amountCols = byRole('amount').filter(moneyOk);
  const debitCols = byRole('debit').filter(moneyOk);
  const creditCols = byRole('credit').filter(moneyOk);
  let sign = null;
  if (debitCols.length && creditCols.length) {
    take('debit', debitCols[0]);
    take('credit', creditCols[0]);
    sign = 'debitcredit';
  } else if (amountCols.length) {
    // several columns called amount (the amount and the amount in the original currency): the first, which is nearly always the account's
    take('amount', amountCols[0]);
  } else if (debitCols.length || creditCols.length) {
    take(debitCols.length ? 'debit' : 'credit', (debitCols.length ? debitCols : creditCols)[0]);
    sign = debitCols.length ? 'positiveOut' : 'positiveIn';
    roles[(debitCols.length ? debitCols : creditCols)[0]] = 'amount';
  }

  // 4. other roles from headings, each checked against its data
  for (let i = 0; i < width; i++) {
    if (claimed.has(i)) continue;
    const p = strong[i];
    if (!p) continue;
    const s = stat[i];
    let role = p.role;
    if (p.alt === 'valueDate' && role === 'currency') role = s.dates >= 0.6 ? 'valueDate' : 'currency';
    if (p.alt === 'reference') role = s.ids >= 0.6 ? 'reference' : 'details';
    if (role === 'direction' && s.directions < 0.8) continue;
    if (role === 'status' && s.statuses < 0.6) continue;
    if (role === 'currency' && s.codes < 0.8) continue;
    if (role === 'balance' && s.numbers < 0.6) continue;
    if (role === 'fee' && s.numbers < 0.6) continue;
    if (role === 'reference' && (s.n === 0 || s.distinct < 0.9 * s.n)) continue; // an id is different on every line (an account number is not)
    if (['description', 'payee', 'payer', 'counterparty', 'details'].includes(role) && s.text < 0.3 && s.n > 0) continue;
    if (['date', 'valueDate', 'amount', 'debit', 'credit'].includes(role)) continue; // already decided above
    take(role, i);
  }

  // a column the heading calls a description that only holds debit and credit words is the direction ("Details" in some US exports)
  for (let i = 0; i < width; i++) {
    if (['description', 'details'].includes(roles[i]) && stat[i].directions >= 0.8 && stat[i].distinct <= 4 && !roles.includes('direction')) roles[i] = 'direction';
  }
  // with several text columns, the most varied one is the description; the others (the kind of operation, a category) are details
  const texts = roles.map((r, i) => (r === 'description' || r === 'details' ? i : -1)).filter((i) => i >= 0);
  if (texts.length > 1) {
    const informative = (i) => stat[i].distinct * (stat[i].avgLen > 3 ? 1 : 0.2);
    const main = texts.reduce((best, i) => (informative(i) > informative(best) ? i : best), texts[0]);
    for (const i of texts) roles[i] = i === main ? 'description' : 'details';
  }

  // 5. no heading names the money: the numeric columns that look like money
  if (!roles.includes('amount') && !roles.includes('debit') && !roles.includes('credit')) {
    const cand = stat.map((s, i) => (claimed.has(i) || !moneyOk(i) || s.money < 0.5 ? -1 : i)).filter((i) => i >= 0);
    if (cand.length) {
      notes.push(t('Penny found the amount column by looking at what is in it.'));
      const [first, second, third] = cand;
      if (cand.length === 1) take('amount', first);
      else if (chainFits(rows, dataStart, second, first, {}) && cand.length >= 2) {
        take('amount', first);
        take('balance', second);
      } else if (chainFits(rows, dataStart, first, second, {}) && cand.length >= 2) {
        take('amount', second);
        take('balance', first);
      } else {
        const sparse = (i) => stat[i].n < 0.8 * Math.max(...cand.map((c) => stat[c].n));
        if (cand.length >= 2 && (sparse(first) || sparse(second)) && !(third && chainFits(rows, dataStart, third, first, {}))) {
          take('debit', first);
          take('credit', second);
          sign = 'debitcredit';
          notes.push(t('Two number columns, one for money out and one for money in: Penny assumed the first is money out.'));
          if (third) take('balance', third);
        } else {
          take('amount', first);
          if (third && stat[third].money >= 0.5) take('balance', third);
        }
      }
    }
  }

  // 6. a description: what the headings say, or the column of the longest text
  const textual = (i) => !claimed.has(i) && stat[i].text >= 0.5 && stat[i].n > 0;
  if (!roles.some((r) => ['description', 'payee', 'counterparty', 'details', 'payer'].includes(r))) {
    const best = stat.map((s, i) => ({ i, len: s.avgLen })).filter(({ i }) => textual(i)).sort((a, b) => b.len - a.len)[0];
    if (best) {
      take('description', best.i);
      notes.push(t('Penny took the column with the longest text as the description.'));
    }
  }

  const hasAmount = roles.includes('amount') || (roles.includes('debit') && roles.includes('credit'));
  const dateAt = roles.indexOf('date');
  const col = (role) => roles.indexOf(role);

  // 7. how dates and numbers are written
  const dateSamples = dateAt >= 0 ? stat[dateAt].cells.slice(0, 300) : [];
  const dateInfo = inferDateOrder(dateSamples, hint.dateOrder ?? 'dmy');
  const moneySamples = [];
  for (const role of ['amount', 'debit', 'credit', 'balance']) {
    const c = col(role);
    if (c >= 0) moneySamples.push(...stat[c].cells.slice(0, 300));
  }
  const decInfo = inferDecimal(moneySamples, hint.decimal ?? ',');
  if (dateInfo.ambiguous) notes.push(t('Dates could be read day first or month first; Penny chose {value}.', { value: dateInfo.order === 'dmy' ? t('day first') : t('month first') }));

  // 8. what the sign of an amount means
  const parseOpts = { decimal: decInfo.decimal };
  if (!sign && hasAmount) {
    const a = col('amount');
    const values = stat[a].cells.map((tt) => parseAmount(tt, parseOpts)).filter((v) => v !== null);
    const negatives = values.filter((v) => v < 0).length;
    const dirCol = col('direction');
    if (negatives > 0) {
      sign = 'signed';
      // a card statement shows purchases as plus and payments as minus
      if (values.length >= 5 && negatives / values.length <= 0.35 && descriptionsLookLikePayments(rows, dataStart, a, parseOpts, roles)) {
        sign = 'positiveOut';
        notes.push(t('Penny took positive amounts as money you spent (it looks like a card statement). Check the first lines.'));
      }
    } else if (dirCol >= 0) {
      sign = 'direction';
    } else {
      sign = 'positiveOut';
      notes.push(t('The amounts have no minus sign, so Penny took them all as money you spent. If that is wrong, change it in "How Penny read this file".'));
    }
  }
  // the balance column, if any, can confirm or correct a guessed direction
  const balanceAt = col('balance');
  if (sign === 'positiveOut' && balanceAt >= 0 && col('amount') >= 0) {
    const agree = balanceDirection(rows, dataStart, balanceAt, col('amount'), parseOpts);
    if (agree === 'in') {
      sign = 'positiveIn';
      notes.push(t('The balance column shows these amounts add to the balance, so Penny took them as money received.'));
    }
  }

  const currency = (() => {
    const c = col('currency');
    if (c >= 0) {
      const counts = new Map();
      for (const tt of stat[c].cells) counts.set(tt.toUpperCase(), (counts.get(tt.toUpperCase()) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (top) return top[0];
    }
    for (const role of ['amount', 'debit', 'credit']) {
      const cc = col(role);
      if (cc >= 0) {
        const found = currencyIn(headers[cc]) ?? stat[cc].cells.map((tt) => currencyIn(tt)).find(Boolean);
        if (found) return found;
      }
    }
    return null;
  })();

  let confidence = 'high';
  if (dateAt < 0 || !hasAmount) confidence = 'low';
  else if (headerRow < 0 || !roles.some((r) => ['description', 'payee', 'counterparty', 'details'].includes(r)) || notes.length) confidence = 'medium';
  if (dateAt >= 0 && Math.max(stat[dateAt].dates, compactDates ? stat[dateAt].compact : 0) < 0.6) confidence = 'low';
  if (confidence === 'high' && (dateInfo.ambiguous || decInfo.ambiguous)) confidence = 'medium';
  if (grid.loose && confidence === 'high') confidence = 'medium';
  if (headerRow < 0 && confidence !== 'low') notes.unshift(t('This table has no headings: Penny worked out the columns from their content.'));

  return {
    ok: confidence !== 'low',
    headerRow,
    dataStart,
    headers,
    roles,
    dateOrder: dateInfo.order,
    compactDates,
    dateAmbiguous: dateInfo.ambiguous,
    decimal: decInfo.decimal,
    decimalAmbiguous: decInfo.ambiguous,
    sign: sign ?? 'signed',
    currency,
    confidence,
    notes,
  };
}

function descriptionsLookLikePayments(rows, start, amtCol, opts, roles) {
  const textCols = roles.map((r, i) => (['description', 'payee', 'counterparty', 'details'].includes(r) ? i : -1)).filter((i) => i >= 0);
  if (!textCols.length) return false;
  let neg = 0;
  let paymentLike = 0;
  for (let r = start; r < Math.min(rows.length, start + SAMPLE); r++) {
    const v = parseAmount(cell(rows[r], amtCol), opts);
    if (v === null || v >= 0) continue;
    neg++;
    const text = fold(textCols.map((c) => cell(rows[r], c)).join(' '));
    if (/payment|thank you|pagamento|grazie|autopay|direct debit|rimbors|refund|credit|accredit|storno|saldo|zahlung|danke|paiement|merci/.test(text)) paymentLike++;
  }
  return neg >= 1 && paymentLike / neg >= 0.6;
}

/** Whether the amounts, as written, move the running balance up ('in') or down ('out') from one line to the next; null if unclear. */
function balanceDirection(rows, start, balCol, amtCol, opts) {
  let up = 0;
  let down = 0;
  let prev = null;
  let ascending = null;
  const pairs = [];
  for (let r = start; r < Math.min(rows.length, start + 200); r++) {
    const b = parseAmount(cell(rows[r], balCol), opts);
    const a = parseAmount(cell(rows[r], amtCol), opts);
    if (b === null || a === null) continue;
    pairs.push([b, a]);
  }
  for (let i = 1; i < pairs.length; i++) {
    const [b, a] = pairs[i];
    const [pb] = pairs[i - 1];
    // top to bottom is oldest to newest: this line's balance = previous balance + (or -) its amount
    if (Math.abs(b - (pb + a)) < 0.011) up++;
    else if (Math.abs(b - (pb - a)) < 0.011) down++;
    prev = b;
    ascending = true;
  }
  if (!pairs.length || prev === null || ascending === null) return null;
  if (up + down < 3) return null;
  if (up > down * 2) return 'in';
  if (down > up * 2) return 'out';
  // newest first: the balance of the line above is this line's balance plus (or minus) the line above's amount
  let upDesc = 0;
  let downDesc = 0;
  for (let i = 1; i < pairs.length; i++) {
    const [b] = pairs[i];
    const [pb, pa] = pairs[i - 1];
    if (Math.abs(pb - (b + pa)) < 0.011) upDesc++;
    else if (Math.abs(pb - (b - pa)) < 0.011) downDesc++;
  }
  if (upDesc > downDesc * 2 && upDesc >= 3) return 'in';
  if (downDesc > upDesc * 2 && downDesc >= 3) return 'out';
  return null;
}

/** Roles a person may pick for a column in the matching screen need at least these, to produce payments. */
export function mappingProblem(mapping) {
  const has = (r) => mapping.roles.includes(r);
  if (!has('date')) return t('Choose which column holds the date.');
  if (!has('amount') && !(has('debit') || has('credit'))) return t('Choose which column holds the amount (or the columns for money out and money in).');
  if (has('amount') && (has('debit') || has('credit'))) return t('Use either one amount column, or the money out and money in columns, not both.');
  return null;
}
