import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billMonthOptions, byListDate, cardPayDate, defaultBillMonth, listDate, monthTotals, paymentDates } from '../src/cardLogic.js';

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

  it('does not count a purchase in this month, but totals it separately', () => {
    const t = monthTotals([
      row({ id: 1, type: 'income', amount: 1500 }),
      row({ id: 2, amount: 1000 }),
      row({ id: 3, amount: 335, pay_method: 'credit_card', charged_on: '2026-09-01' }), // paid this month, bought before
      row({ id: 4, amount: 71, purchase_only: true, pay_method: 'credit_card', charged_on: '2026-10-01', date: '2026-11-10' }),
      row({ id: 5, amount: 89, purchase_only: true, pay_method: 'credit_card', charged_on: '2026-10-01', date: '2026-11-10' }),
    ]);
    assert.deepEqual(t, { income: 1500, expenses: 1335, net: 165, onCard: 335, bought: 160 });
  });

  it('leaves skipped rows out of everything', () => {
    const t = monthTotals([row({ amount: 50, status: 'skipped' }), row({ amount: 70, status: 'skipped', purchase_only: true, pay_method: 'credit_card' }), row({ amount: 5 })]);
    assert.deepEqual(t, { income: 0, expenses: 5, net: -5, onCard: 0, bought: 0 });
  });

  it('adds in whole cents: amounts that are not exact in floating point still add up to the cent', () => {
    // 1.15 * 100, 0.57 * 100 and 8.2 * 100 are not whole numbers in floating point (114.99999999999999 ...), so unrounded sums drift
    const t = monthTotals([row({ id: 1, amount: 1.15 }), row({ id: 2, amount: 0.57 }), row({ id: 3, amount: 8.2 })]);
    assert.equal(t.expenses, 9.92);
    assert.equal(t.net, -9.92);
    const u = monthTotals([row({ id: 1, amount: 1.15, purchase_only: true }), row({ id: 2, amount: 0.57, purchase_only: true }), row({ id: 3, amount: 8.2, purchase_only: true })]);
    assert.equal(u.bought, 9.92);
  });

  it('adds in whole cents, so ten cents ten times is exactly one', () => {
    const t = monthTotals(Array.from({ length: 10 }, (_, i) => row({ id: i + 1, amount: 0.1 })));
    assert.equal(t.expenses, 1);
    const u = monthTotals([row({ amount: 0.1 }), row({ amount: 0.2 })]);
    assert.equal(u.expenses, 0.3);
  });

  it('is zero for an empty month', () => {
    assert.deepEqual(monthTotals([]), { income: 0, expenses: 0, net: 0, onCard: 0, bought: 0 });
  });
});
