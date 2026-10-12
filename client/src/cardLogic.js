import { addMonthsYM } from './format.js';
import { addMonths } from './recurrenceLogic.js';

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** The day the card bill is paid in a month: the budget's card pay day (1 to 28, so it always exists). */
export function cardPayDate(month, day) {
  const d = Math.min(Math.max(1, Math.round(Number(day) || 10)), daysIn(month));
  return `${month}-${pad(d)}`;
}

/** Unless told otherwise, a card purchase is paid with the next month's bill. */
export const defaultBillMonth = (boughtOn) => addMonthsYM(boughtOn.slice(0, 7), 1);

/**
 * The months a purchase can be paid in: from the month it was bought (if that month's pay day has not passed yet)
 * up to a year ahead. `keep` is always included, so editing an old payment never loses its own month.
 */
export function billMonthOptions(boughtOn, day, keep) {
  const first = boughtOn.slice(0, 7);
  const out = [];
  for (let i = 0; i <= 12; i++) {
    const month = addMonthsYM(first, i);
    if (cardPayDate(month, day) >= boughtOn) out.push(month);
  }
  if (keep && !out.includes(keep)) out.push(keep);
  return out.sort();
}

/** What to send for a payment: cash keeps one date; a card payment sends the purchase day and the day the bill is paid. */
export function paymentDates({ onCard, date, billMonth, day, keepPayDate }) {
  if (!onCard) return { date, pay_method: 'cash', charged_on: null };
  const payDate = keepPayDate && keepPayDate.slice(0, 7) === billMonth ? keepPayDate : cardPayDate(billMonth, day);
  return { date: payDate, pay_method: 'credit_card', charged_on: date };
}

/** The day a row is listed on in the monthly Payments list: a purchase shown only for the month it was bought sits on the day it was bought. */
export const listDate = (tx) => (tx.purchase_only ? tx.charged_on : tx.date);

/** Order for the monthly list: by the day each row is listed on, then by id. */
export const byListDate = (a, b) => listDate(a).localeCompare(listDate(b)) || a.id - b.id;

/**
 * The strip above the list. A purchase listed only because it was bought this month (`purchase_only`) is not counted in the month's
 * income, expenses or net: it counts in the month its bill is paid. Beside them, "bought with credit card" is everything bought with
 * the credit card on a day of `month` (whenever its bill is paid) and "bought with debit card" is everything paid from cash or the
 * bank that month. Skipped payments are left out; everything is added in whole cents so the sums are exact.
 */
export function monthTotals(rows, month) {
  const cents = (r) => Math.round(r.amount * 100);
  let income = 0;
  let expenses = 0;
  let boughtCredit = 0;
  let boughtDebit = 0;
  for (const r of rows) {
    if (r.status === 'skipped') continue;
    const credit = r.pay_method === 'credit_card';
    if (credit && (!month || (r.charged_on ?? r.date).slice(0, 7) === month)) {
      // a purchase paid in installments counts once, at its price, with the first installment; the later ones add nothing here
      if (!(r.installment_no > 1)) boughtCredit += r.installment_no === 1 && r.plan_purchase_amount != null ? Math.round(r.plan_purchase_amount * 100) : cents(r);
    }
    if (r.purchase_only) continue;
    if (r.type === 'income') income += cents(r);
    else {
      expenses += cents(r);
      if (!credit) boughtDebit += cents(r);
    }
  }
  return { income: income / 100, expenses: expenses / 100, net: (income - expenses) / 100, boughtCredit: boughtCredit / 100, boughtDebit: boughtDebit / 100 };
}

/**
 * How a payment row should read at a glance: 'overdue' (pending, day passed), 'paid', or '' (pending, skipped, or a card purchase that
 * only counts later). `today` is 'YYYY-MM-DD'.
 */
export function rowState(tx, today) {
  if (tx.purchase_only || tx.status === 'skipped') return '';
  if (tx.status === 'paid') return 'paid';
  return tx.status === 'pending' && tx.date < today ? 'overdue' : '';
}

const toCents = (v) => Math.round((Number(v) || 0) * 100);

/** The price divided over `count` installments, to the cent: where the "each installment" box starts. */
export function suggestEach(price, count) {
  const n = Math.floor(Number(count));
  const c = toCents(price);
  return n >= 1 && c > 0 ? Math.round(c / n) / 100 : 0;
}

/**
 * What paying a card purchase in installments comes to. `each` is what the bank charges each month; with no `each` the price is
 * simply divided with no interest. Returns null when the numbers cannot be a plan (2 to 36 installments, a price and an amount),
 * `{ valid: false }` when the installments add up to less than the price, otherwise the total, the interest in money and in percent.
 */
export function cardInstallmentSummary({ price, each, count, amounts }) {
  const priceC = toCents(price);
  if (Array.isArray(amounts)) {
    // installments that are not equal: one amount for each, exactly as listed
    const partsC = amounts.map(toCents);
    const n = partsC.length;
    if (!(n >= 2 && n <= 36) || priceC <= 0 || partsC.some((c) => c <= 0)) return null;
    const totalC = partsC.reduce((tt, c) => tt + c, 0);
    if (totalC < priceC) return { valid: false, n, total: totalC / 100, price: priceC / 100 };
    const interestC = totalC - priceC;
    return { valid: true, n, parts: partsC.map((c) => c / 100), total: totalC / 100, interest: interestC / 100, pct: Math.round((interestC * 1000) / priceC) / 10 };
  }
  const n = Math.floor(Number(count));
  if (!(n >= 2 && n <= 36) || priceC <= 0) return null;
  const hasEach = each !== '' && each != null;
  const eachC = hasEach ? toCents(each) : null;
  if (hasEach && eachC <= 0) return null;
  const totalC = hasEach ? eachC * n : priceC;
  if (totalC < priceC) return { valid: false, n, total: totalC / 100, price: priceC / 100 };
  const interestC = totalC - priceC;
  return {
    valid: true,
    n,
    each: hasEach ? eachC / 100 : suggestEach(price, n),
    ...(!hasEach && priceC % n !== 0 ? { approx: true } : {}), // the price does not divide evenly: the first installments carry the odd cents
    total: totalC / 100,
    interest: interestC / 100,
    pct: Math.round((interestC * 1000) / priceC) / 10,
  };
}

/** How many of a card purchase's monthly bills (the first on `first`) fall on or before `today`: those are already paid. */
export function billsBehind(first, count, today) {
  const day = Number(first.slice(8));
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => addMonths(first, i, day)).filter((d) => d <= today).length;
}

/**
 * The boxes of an unequal plan: what was typed in each (`typed`: a string per installment, '' = not typed), and the boxes not typed share what
 * is left of the price equally, to the cent (the first ones get the odd cents). If the typed boxes already use up the price, the rest are 0.
 */
export function spreadAmounts({ price, count, typed = [] }) {
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  const priceC = toCents(price);
  const filled = Array.from({ length: n }, (_, i) => (typed[i] !== undefined && typed[i] !== '' ? toCents(typed[i]) : null));
  const open = filled.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  const left = Math.max(0, priceC - filled.reduce((tt, c) => tt + (c ?? 0), 0));
  const share = open.length ? Math.floor(left / open.length) : 0;
  const extra = open.length ? left - share * open.length : 0;
  return filled.map((c, i) => (c !== null ? c : share + (open.indexOf(i) < extra ? 1 : 0))).map((c) => c / 100);
}

/**
 * The bill month of each installment of a card purchase: the first, then by default one month later each. A month picked for an
 * installment (`picked[i]`, '' = not picked) replaces its default, but months only go forward: a pick that is not after the installment
 * before it falls back to the default (the month after that one).
 */
export function installmentMonths({ first, count, picked = [] }) {
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  const months = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      months.push(first);
      continue;
    }
    const fallback = addMonthsYM(months[i - 1], 1);
    const want = picked[i] || fallback;
    months.push(want > months[i - 1] ? want : fallback);
  }
  return months;
}
