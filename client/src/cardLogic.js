import { addMonthsYM } from './format.js';

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
    if (credit && (!month || (r.charged_on ?? r.date).slice(0, 7) === month)) boughtCredit += cents(r);
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
