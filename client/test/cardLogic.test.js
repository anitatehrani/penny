import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billMonthOptions, byListDate, cardPayDate, defaultBillMonth, listDate, monthTotals, paymentDates, rowState, billsBehind, cardInstallmentSummary, suggestEach } from '../src/cardLogic.js';
import { installmentDates } from '../../server/src/lib/schedule.js';

describe('the day the card bill is paid', () => {
  it('is the pay day in that month', () => {
    assert.equal(cardPayDate('2026-11', 10), '2026-11-10');
    assert.equal(cardPayDate('2026-11', 1), '2026-11-01');
    assert.equal(cardPayDate('2027-01', 28), '2027-01-28');
  });
  it('never falls outside a short month, and survives odd input', () => {
    assert.equal(cardPayDate('2027-02', 31), '2027-02-28');
    assert.equal(cardPayDate('2028-02', 31), '2028-02-29', 'leap year');
    assert.equal(cardPayDate('2026-11', 0), '2026-11-10', 'no usable day: the 10th');
    assert.equal(cardPayDate('2026-11', -5), '2026-11-01', 'too small: the 1st');
    assert.equal(cardPayDate('2026-11', 99), '2026-11-30', 'too big: the last day of the month');
    assert.equal(cardPayDate('2026-11', undefined), '2026-11-10', 'falls back to the 10th');
    assert.equal(cardPayDate('2026-11', '15'), '2026-11-15', 'a number typed as text');
  });
});

describe('which month a purchase is paid in by default', () => {
  it('is the next month, across the year end too', () => {
    assert.equal(defaultBillMonth('2026-10-01'), '2026-11');
    assert.equal(defaultBillMonth('2026-12-31'), '2027-01');
    assert.equal(defaultBillMonth('2026-01-31'), '2026-02');
  });
});

describe('the months offered for "Counts in"', () => {
  it('starts with the purchase month when its pay day is still ahead', () => {
    const o = billMonthOptions('2026-10-04', 10);
    assert.equal(o[0], '2026-10');
    assert.equal(o.length, 13);
    assert.equal(o.at(-1), '2027-10');
  });
  it('skips the purchase month when its pay day has already passed', () => {
    const o = billMonthOptions('2026-10-20', 10);
    assert.equal(o[0], '2026-11');
    assert.ok(!o.includes('2026-10'));
  });
  it('allows buying on the pay day itself', () => {
    assert.equal(billMonthOptions('2026-10-10', 10)[0], '2026-10');
    assert.equal(billMonthOptions('2026-10-11', 10)[0], '2026-11');
  });
  it('always keeps the month a payment already has, in order, without duplicating it', () => {
    assert.deepEqual(billMonthOptions('2026-10-20', 10, '2025-01').slice(0, 2), ['2025-01', '2026-11']);
    const o = billMonthOptions('2026-10-04', 10, '2026-12');
    assert.equal(o.filter((m) => m === '2026-12').length, 1);
    assert.deepEqual([...o].sort(), o);
  });
  it('every offered month has a bill day on or after the purchase, so the API never refuses it', () => {
    for (const bought of ['2026-01-31', '2026-02-28', '2026-03-15', '2026-12-31']) {
      for (const day of [1, 10, 28]) {
        for (const m of billMonthOptions(bought, day)) assert.ok(cardPayDate(m, day) >= bought, `${bought} day ${day} -> ${m}`);
      }
    }
  });
});

describe('what is sent for a payment', () => {
  it('cash keeps its one date and no purchase day', () => {
    assert.deepEqual(paymentDates({ onCard: false, date: '2026-10-04', billMonth: '2026-11', day: 10 }), { date: '2026-10-04', pay_method: 'cash', charged_on: null });
  });
  it('a card payment sends the purchase day and the day the bill is paid', () => {
    assert.deepEqual(paymentDates({ onCard: true, date: '2026-10-01', billMonth: '2026-11', day: 10 }), { date: '2026-11-10', pay_method: 'credit_card', charged_on: '2026-10-01' });
  });
  it('keeps an existing bill day when the month is unchanged, and uses the pay day when it changes', () => {
    const args = { onCard: true, date: '2026-10-01', day: 10, keepPayDate: '2026-11-12' };
    assert.equal(paymentDates({ ...args, billMonth: '2026-11' }).date, '2026-11-12');
    assert.equal(paymentDates({ ...args, billMonth: '2026-12' }).date, '2026-12-10');
  });
});

describe('the monthly list with card purchases in it', () => {
  const row = (over) => ({ id: 1, type: 'expense', amount: 10, status: 'paid', date: '2026-10-10', pay_method: 'cash', ...over });

  it('lists a purchase on the day it was bought, and everything else on its own day', () => {
    assert.equal(listDate(row({ purchase_only: true, charged_on: '2026-10-01', date: '2026-11-10' })), '2026-10-01');
    assert.equal(listDate(row({ purchase_only: false, charged_on: '2026-10-01', date: '2026-10-20' })), '2026-10-20', 'bought and paid in the same month: its own day');
    assert.equal(listDate(row({ date: '2026-10-05' })), '2026-10-05');
  });

  it('orders by the day each row is listed on, so a purchase is not pushed to the end by its later bill', () => {
    const rows = [
      row({ id: 3, date: '2026-10-15', description: 'cash 15th' }),
      row({ id: 4, purchase_only: true, charged_on: '2026-10-01', date: '2026-11-10', description: 'bought 1st too' }),
      row({ id: 1, date: '2026-10-10', description: 'cash 10th' }),
      row({ id: 2, purchase_only: true, charged_on: '2026-10-01', date: '2026-11-10', description: 'bought 1st' }),
    ]; // deliberately in the wrong order for the two on the 1st, so only the id can put them right
    assert.deepEqual([...rows].sort(byListDate).map((r) => r.id), [2, 4, 1, 3], 'both purchases on the 1st (by id), then the 10th, then the 15th');
  });

  it('does not count a purchase in this month, but totals it as bought with the credit card', () => {
    const t = monthTotals(
      [
        row({ id: 1, type: 'income', amount: 1500 }),
        row({ id: 2, amount: 1000 }),
        row({ id: 3, amount: 335, pay_method: 'credit_card', charged_on: '2026-09-01' }), // paid this month, bought before
        row({ id: 4, amount: 71, purchase_only: true, pay_method: 'credit_card', charged_on: '2026-10-01', date: '2026-11-10' }),
        row({ id: 5, amount: 89, purchase_only: true, pay_method: 'credit_card', charged_on: '2026-10-01', date: '2026-11-10' }),
      ],
      '2026-10',
    );
    // expenses are what leaves the account this month (1000 cash + the 335 bill); credit card is what was bought this month (71 + 89)
    assert.deepEqual(t, { income: 1500, expenses: 1335, net: 165, boughtCredit: 160, boughtDebit: 1000 });
  });

  it('counts a card purchase made and billed in the same month under credit card, once, and not under debit', () => {
    const t = monthTotals([row({ id: 1, amount: 50, pay_method: 'credit_card', charged_on: '2026-10-02', date: '2026-10-20' }), row({ id: 2, amount: 7 })], '2026-10');
    assert.deepEqual(t, { income: 0, expenses: 57, net: -57, boughtCredit: 50, boughtDebit: 7 });
  });

  it('does not count a bill for something bought in an earlier month as bought this month', () => {
    const t = monthTotals([row({ amount: 335, pay_method: 'credit_card', charged_on: '2026-09-01' })], '2026-10');
    assert.equal(t.boughtCredit, 0);
    assert.equal(t.expenses, 335);
  });

  it('never counts income as bought with either card', () => {
    const t = monthTotals([row({ type: 'income', amount: 900 })], '2026-10');
    assert.deepEqual([t.boughtCredit, t.boughtDebit], [0, 0]);
  });

  it('leaves skipped rows out of everything', () => {
    const t = monthTotals([row({ amount: 50, status: 'skipped' }), row({ amount: 70, status: 'skipped', purchase_only: true, pay_method: 'credit_card' }), row({ amount: 5 })], '2026-10');
    assert.deepEqual(t, { income: 0, expenses: 5, net: -5, boughtCredit: 0, boughtDebit: 5 });
  });

  it('adds in whole cents: amounts that are not exact in floating point still add up to the cent', () => {
    // 1.15 * 100, 0.57 * 100 and 8.2 * 100 are not whole numbers in floating point (114.99999999999999 ...), so unrounded sums drift
    const t = monthTotals([row({ id: 1, amount: 1.15 }), row({ id: 2, amount: 0.57 }), row({ id: 3, amount: 8.2 })]);
    assert.equal(t.expenses, 9.92);
    assert.equal(t.net, -9.92);
    const card = { purchase_only: true, pay_method: 'credit_card', charged_on: '2026-10-03' };
    const u = monthTotals([row({ id: 1, amount: 1.15, ...card }), row({ id: 2, amount: 0.57, ...card }), row({ id: 3, amount: 8.2, ...card })], '2026-10');
    assert.equal(u.boughtCredit, 9.92);
    assert.equal(t.boughtDebit, 9.92);
  });

  it('adds in whole cents, so ten cents ten times is exactly one', () => {
    const t = monthTotals(Array.from({ length: 10 }, (_, i) => row({ id: i + 1, amount: 0.1 })));
    assert.equal(t.expenses, 1);
    const u = monthTotals([row({ amount: 0.1 }), row({ amount: 0.2 })]);
    assert.equal(u.expenses, 0.3);
  });

  it('is zero for an empty month', () => {
    assert.deepEqual(monthTotals([], '2026-10'), { income: 0, expenses: 0, net: 0, boughtCredit: 0, boughtDebit: 0 });
  });
});

describe('how a payment row reads at a glance', () => {
  const TODAY = '2031-02-15';
  const tx = (over) => ({ status: 'pending', date: TODAY, ...over });
  it('is overdue only for a pending payment whose day has passed', () => {
    assert.equal(rowState(tx({ date: '2031-02-14' }), TODAY), 'overdue');
    assert.equal(rowState(tx({ date: TODAY }), TODAY), '', 'today is still to come');
    assert.equal(rowState(tx({ date: '2031-03-01' }), TODAY), '');
  });
  it('is paid for a paid one, however old', () => {
    assert.equal(rowState(tx({ status: 'paid', date: '2020-01-01' }), TODAY), 'paid');
  });
  it('is plain for a skipped payment, and for a card purchase that only counts when the bill is paid', () => {
    assert.equal(rowState(tx({ status: 'skipped', date: '2020-01-01' }), TODAY), '');
    assert.equal(rowState(tx({ purchase_only: true, date: '2020-01-01' }), TODAY), '');
    assert.equal(rowState(tx({ status: 'paid', purchase_only: true }), TODAY), '');
  });
});

describe('a card purchase paid in installments', () => {
  const inst = (over) => ({ id: 1, type: 'expense', amount: 190, status: 'pending', date: '2032-01-10', pay_method: 'credit_card', charged_on: '2031-12-02', installment_no: 1, plan_purchase_amount: 1000, ...over });

  it('counts the price once, in the purchase month, whatever the installments add up to', () => {
    const dec = monthTotals([inst({ purchase_only: true })], '2031-12');
    assert.deepEqual([dec.boughtCredit, dec.expenses], [1000, 0], 'the price, and nothing spent yet');
  });

  it('adds nothing for the later installments in their own months, but counts each in expenses', () => {
    const feb = monthTotals([inst({ id: 2, installment_no: 2, date: '2032-02-10' })], '2032-02');
    assert.deepEqual([feb.boughtCredit, feb.expenses], [0, 190]);
  });

  it('counts the first installment as the price even when its bill is in the same month', () => {
    const t = monthTotals([inst({ date: '2031-12-20' })], '2031-12');
    assert.deepEqual([t.boughtCredit, t.expenses], [1000, 190]);
  });

  it('does not fall over on an installment row from an older server with no plan price', () => {
    assert.equal(monthTotals([inst({ plan_purchase_amount: undefined, purchase_only: true })], '2031-12').boughtCredit, 190);
  });
});

describe('the summary of card installments', () => {
  it('starts each installment as the price over the count, to the cent', () => {
    assert.equal(suggestEach(1000, 6), 166.67);
    assert.equal(suggestEach(600, 3), 200);
    assert.equal(suggestEach(0, 3), 0);
    assert.equal(suggestEach(100, 0), 0);
  });

  it('with no amount typed, divides the price with no interest', () => {
    assert.deepEqual(cardInstallmentSummary({ price: 600, each: '', count: 3 }), { valid: true, n: 3, each: 200, total: 600, interest: 0, pct: 0 });
  });

  it('works out the interest in money and percent from the amount the bank charges', () => {
    assert.deepEqual(cardInstallmentSummary({ price: 1000, each: 190, count: 6 }), { valid: true, n: 6, each: 190, total: 1140, interest: 140, pct: 14 });
    assert.equal(cardInstallmentSummary({ price: 333, each: 60, count: 6 }).pct, 8.1);
  });

  it('adds in whole cents', () => {
    assert.equal(cardInstallmentSummary({ price: 0.3, each: 0.1, count: 3 }).interest, 0);
    assert.equal(cardInstallmentSummary({ price: 1, each: 0.34, count: 3 }).interest, 0.02);
  });

  it('says so when the installments add up to less than the price', () => {
    assert.deepEqual(cardInstallmentSummary({ price: 1000, each: 150, count: 6 }), { valid: false, n: 6, total: 900, price: 1000 });
  });

  it('is nothing for numbers that cannot be a plan', () => {
    assert.equal(cardInstallmentSummary({ price: 1000, each: 100, count: 1 }), null);
    assert.equal(cardInstallmentSummary({ price: 1000, each: 100, count: 37 }), null);
    assert.equal(cardInstallmentSummary({ price: 0, each: 100, count: 3 }), null);
    assert.equal(cardInstallmentSummary({ price: 1000, each: 0, count: 3 }), null);
    assert.equal(cardInstallmentSummary({ price: 1000, each: '', count: 'abc' }), null);
  });
});

describe('which monthly card bills are already behind us', () => {
  it('counts the bills on or before today', () => {
    assert.equal(billsBehind('2031-01-10', 6, '2031-01-09'), 0, 'none yet');
    assert.equal(billsBehind('2031-01-10', 6, '2031-01-10'), 1, 'today counts');
    assert.equal(billsBehind('2031-01-10', 6, '2031-03-15'), 3);
    assert.equal(billsBehind('2031-01-10', 6, '2040-01-01'), 6, 'never more than there are');
  });
  it('keeps the pay day in short months, like the server', () => {
    for (const first of ['2031-01-31', '2032-02-29', '2031-12-30']) {
      const dates = installmentDates(first, 8);
      for (const today of ['2030-01-01', first, dates[3], dates[7], '2040-01-01']) {
        assert.equal(billsBehind(first, 8, today), dates.filter((d) => d <= today).length, first + ' on ' + today);
      }
    }
  });
  it('is zero for nothing to count', () => {
    assert.equal(billsBehind('2031-01-10', 0, '2031-06-01'), 0);
    assert.equal(billsBehind('2031-01-10', -3, '2031-06-01'), 0);
  });
});
