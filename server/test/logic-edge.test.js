import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, addMonths, addMonthsYM, daysInMonth, fmtYMD, isValidYM, isValidYMD, monthEnd, monthOf, monthStart, parseYMD } from '../src/lib/dates.js';
import { buildForecast } from '../src/lib/forecast.js';
import { installmentDates, occurrences, splitInstallments } from '../src/lib/schedule.js';

describe('dates', () => {
  it('knows leap years', () => {
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2025, 2), 28);
    assert.equal(daysInMonth(1900, 2), 28, '1900 was not a leap year');
    assert.equal(daysInMonth(2000, 2), 29);
    assert.ok(isValidYMD('2024-02-29'));
    assert.ok(!isValidYMD('2025-02-29'));
    assert.ok(!isValidYMD('1900-02-29'));
  });

  it('validates the shapes it accepts', () => {
    for (const ok of ['2026-01-01', '2026-12-31', '0001-01-01', '9999-12-31']) assert.ok(isValidYMD(ok), ok);
    for (const bad of ['', '2026-1-1', '2026-00-10', '2026-13-10', '2026-04-31', '2026-01-00', '2026/01/01', ' 2026-01-01', '2026-01-01T00:00', 'abcd-ef-gh', null, undefined]) {
      assert.ok(!isValidYMD(bad ?? ''), String(bad));
    }
    assert.ok(isValidYM('2026-01') && isValidYM('2026-12'));
    assert.ok(!isValidYM('2026-00') && !isValidYM('2026-13') && !isValidYM('2026-1') && !isValidYM('26-01'));
  });

  it('moves by months across years, in both directions, clamping the day', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
    assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
    assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
    assert.equal(addMonths('2026-01-15', 24), '2028-01-15');
    assert.equal(addMonths('2026-01-15', -25), '2023-12-15');
    assert.equal(addMonths('2026-01-31', 1, 31), '2026-02-28');
    assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31', 'the anchor day is restored after a short month');
    assert.equal(addMonthsYM('2026-01', -1), '2025-12');
    assert.equal(addMonthsYM('2026-12', 1), '2027-01');
    assert.equal(addMonthsYM('2026-06', 0), '2026-06');
  });

  it('moves by days across month and year ends', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2025-02-28', 1), '2025-03-01');
    assert.equal(addDays('2026-01-01', 365), '2027-01-01');
    assert.equal(addDays('2026-05-10', 0), '2026-05-10');
  });

  it('month helpers', () => {
    assert.equal(monthStart('2026-02'), '2026-02-01');
    assert.equal(monthEnd('2026-02'), '2026-02-28');
    assert.equal(monthEnd('2024-02'), '2024-02-29');
    assert.equal(monthEnd('2026-12'), '2026-12-31');
    assert.equal(monthOf('2026-07-19'), '2026-07');
    assert.deepEqual(parseYMD('2026-07-09'), { y: 2026, m: 7, d: 9 });
    assert.equal(fmtYMD(2026, 7, 9), '2026-07-09');
  });
});

describe('recurring schedules', () => {
  const rule = (o) => ({ frequency: 'monthly', interval_count: 1, start_date: '2026-01-15', ...o });

  it('yearly rules on Feb 29 fall on Feb 28 in common years and Feb 29 in leap years', () => {
    assert.deepEqual(occurrences(rule({ frequency: 'yearly', start_date: '2024-02-29' }), '2024-01-01', '2029-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28']);
  });

  it('weekly rules cross month and year boundaries', () => {
    assert.deepEqual(occurrences(rule({ frequency: 'weekly', start_date: '2026-12-17' }), '2026-12-01', '2027-01-20'), ['2026-12-17', '2026-12-24', '2026-12-31', '2027-01-07', '2027-01-14']);
  });

  it('only returns dates inside the window, even when the rule started long before', () => {
    assert.deepEqual(occurrences(rule({ start_date: '2020-01-15' }), '2026-03-01', '2026-05-31'), ['2026-03-15', '2026-04-15', '2026-05-15']);
    assert.deepEqual(occurrences(rule({}), '2026-01-16', '2026-02-14'), []);
    assert.deepEqual(occurrences(rule({}), '2026-01-15', '2026-01-15'), ['2026-01-15'], 'inclusive on both ends');
  });

  it('returns nothing for empty or inverted windows and for rules that end before the window', () => {
    assert.deepEqual(occurrences(rule({}), '2027-01-01', '2026-01-01'), []);
    assert.deepEqual(occurrences(rule({ end_date: '2026-01-10' }), '2026-01-01', '2026-12-31'), []);
    assert.deepEqual(occurrences(rule({ start_date: '2030-01-01' }), '2026-01-01', '2026-12-31'), []);
  });

  it('an end date is inclusive', () => {
    assert.deepEqual(occurrences(rule({ end_date: '2026-03-15' }), '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('intervals multiply', () => {
    assert.deepEqual(occurrences(rule({ interval_count: 6 }), '2026-01-01', '2027-12-31'), ['2026-01-15', '2026-07-15', '2027-01-15', '2027-07-15']);
    assert.equal(occurrences(rule({ frequency: 'yearly', interval_count: 2, start_date: '2026-06-01' }), '2026-01-01', '2032-12-31').length, 4);
    assert.equal(occurrences(rule({ frequency: 'weekly', interval_count: 4, start_date: '2026-01-01' }), '2026-01-01', '2026-12-31').length, 14);
  });

  it('the 29th, 30th and 31st survive February', () => {
    for (const day of [29, 30, 31]) {
      const dates = occurrences(rule({ start_date: `2026-01-${day}` }), '2026-01-01', '2026-04-30');
      assert.equal(dates[0], `2026-01-${day}`);
      assert.equal(dates[1], '2026-02-28');
      assert.equal(dates[2], `2026-03-${day}`, `back to the ${day}th in March`);
    }
  });

  it('never loops forever', () => {
    const many = occurrences(rule({ frequency: 'weekly', start_date: '1900-01-01' }), '1900-01-01', '9999-12-31');
    assert.ok(many.length <= 5000);
  });
});

describe('installment maths', () => {
  const sum = (a) => a.reduce((s, v) => s + v, 0);

  it('always adds up exactly and never differs by more than one cent', () => {
    for (const [total, n] of [[100000, 3], [100, 7], [1, 3], [2, 3], [0, 4], [999999, 360], [10000, 1], [12345, 12], [7, 7], [6, 7]]) {
      const parts = splitInstallments(total, n);
      assert.equal(parts.length, n);
      assert.equal(sum(parts), total, `${total}/${n}`);
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1, `${total}/${n}`);
      assert.deepEqual([...parts].sort((a, b) => b - a), parts, 'larger parts come first');
      assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
    }
  });

  it('dates are monthly from the first due date with the anchor day', () => {
    assert.deepEqual(installmentDates('2026-11-30', 4), ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
    assert.deepEqual(installmentDates('2026-05-10', 1), ['2026-05-10']);
    const long = installmentDates('2026-01-31', 36);
    assert.equal(long.length, 36);
    assert.ok(long.every((d, i) => i === 0 || d > long[i - 1]), 'strictly increasing');
    assert.equal(long[35], '2028-12-31');
  });
});

describe('forecast model', () => {
  const row = (month, type, status, cents) => ({ month, type, status, cents });
  const run = (o) => buildForecast({ rows: [], manualPaidRows: [], openingCents: 0, currentMonth: '2026-10', past: 0, months: 3, ...o });

  it('an empty budget is all zeros and never negative', () => {
    const f = run({});
    assert.equal(f.currentBalance, 0);
    assert.ok(f.months.every((m) => m.endBalance === 0 && m.income === 0 && m.expenses === 0 && m.net === 0));
    assert.equal(f.insights.firstNegativeMonth, null);
    assert.equal(f.insights.negativeMonths, 0);
    assert.deepEqual(f.months.map((m) => m.kind), ['current', 'forecast', 'forecast', 'forecast']);
  });

  it('a negative opening balance is carried through every month', () => {
    const f = run({ openingCents: -5000, months: 2 });
    assert.ok(f.months.every((m) => m.endBalance === -50));
    assert.equal(f.insights.negativeMonths, 3);
    assert.equal(f.insights.firstNegativeMonth.month, '2026-10');
  });

  it('past months are actuals computed only from what was paid, and their balance is cumulative', () => {
    const f = run({
      past: 3,
      openingCents: 1000,
      rows: [row('2026-07', 'income', 'paid', 20000), row('2026-08', 'expense', 'paid', 5000), row('2026-08', 'expense', 'pending', 99999), row('2026-09', 'income', 'paid', 1000)],
    });
    const past = f.months.filter((m) => m.kind === 'actual');
    assert.deepEqual(past.map((m) => m.month), ['2026-07', '2026-08', '2026-09']);
    assert.deepEqual(past.map((m) => m.endBalance), [210, 160, 170]);
    assert.equal(past[1].expenses, 50, 'the pending item is not an actual');
  });

  it('pending items in the current month and the future move the balance, paid future items do not move it twice', () => {
    const f = run({
      rows: [row('2026-10', 'income', 'paid', 10000), row('2026-10', 'expense', 'pending', 3000), row('2026-11', 'expense', 'paid', 2000), row('2026-11', 'expense', 'pending', 500)],
    });
    // balance now = 100 (paid income) - 20 (paid expense in Nov, already paid) = 80
    assert.equal(f.currentBalance, 80);
    assert.deepEqual(f.months.map((m) => m.endBalance), [50, 45, 45, 45]);
    assert.equal(f.months[1].expenses, 25, 'the month still lists both paid and pending expenses');
  });

  it('overdue items from earlier months are charged to the current month only', () => {
    const f = run({ rows: [row('2026-06', 'expense', 'pending', 1000), row('2026-07', 'income', 'pending', 400)] });
    assert.equal(f.overdueNet, -6);
    assert.deepEqual(f.months.map((m) => m.endBalance), [-6, -6, -6, -6]);
  });

  it('estimates: window is the last three full months since first use; the current month is topped up, not doubled', () => {
    const manual = [row('2026-07', 'expense', 'paid', 30000), row('2026-08', 'expense', 'paid', 60000), row('2026-09', 'expense', 'paid', 90000), row('2026-10', 'expense', 'paid', 20000)];
    const f = run({ rows: [row('2026-07', 'income', 'paid', 1), ...manual], manualPaidRows: manual });
    assert.equal(f.estimates.expenses, 600);
    assert.equal(f.estimates.monthsUsed, 3);
    assert.equal(f.months[0].estimatedExpenses, 400);
    assert.equal(f.months[1].estimatedExpenses, 600);
    const young = run({ rows: [row('2026-09', 'expense', 'paid', 90000)], manualPaidRows: [row('2026-09', 'expense', 'paid', 90000)] });
    assert.equal(young.estimates.monthsUsed, 1);
    assert.equal(young.estimates.expenses, 900);
    const spent = run({ rows: manual, manualPaidRows: [...manual.slice(0, 3), row('2026-10', 'expense', 'paid', 999999)] });
    assert.equal(spent.months[0].estimatedExpenses, 0, 'never negative when this month already exceeds the average');
    assert.equal(run({ manualPaidRows: manual, rows: manual }).estimates.monthsUsed, 3);
    assert.equal(run({ rows: manual, manualPaidRows: manual, estimateExpenses: false }).months[1].estimatedExpenses, 0);
  });

  it('income estimates are separate and off unless requested', () => {
    const manual = [row('2026-09', 'income', 'paid', 50000)];
    assert.equal(run({ rows: manual, manualPaidRows: manual }).months[1].estimatedIncome, 0);
    assert.equal(run({ rows: manual, manualPaidRows: manual, estimateIncome: true }).months[1].estimatedIncome, 500);
  });

  it('insights find the lowest point and the first negative month', () => {
    const f = run({ rows: [row('2026-10', 'income', 'paid', 10000), row('2026-11', 'expense', 'pending', 15000), row('2026-12', 'income', 'pending', 20000)], months: 4 });
    assert.deepEqual(f.months.map((m) => m.endBalance), [100, -50, 150, 150, 150]);
    assert.equal(f.insights.lowest.month, '2026-11');
    assert.equal(f.insights.lowest.balance, -50);
    assert.equal(f.insights.firstNegativeMonth.month, '2026-11');
    assert.equal(f.insights.negativeMonths, 1);
  });

  it('works across a year boundary and for the maximum horizon', () => {
    const f = buildForecast({ rows: [], manualPaidRows: [], openingCents: 100, currentMonth: '2026-11', past: 12, months: 24 });
    assert.equal(f.months.length, 12 + 1 + 24);
    assert.equal(f.months[0].month, '2025-11');
    assert.equal(f.months.at(-1).month, '2028-11');
    assert.ok(f.months.every((m) => m.endBalance === 1 || m.kind === 'actual'));
  });

  it('keeps cents exact (no floating point drift)', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row('2026-11', 'expense', 'pending', 10 + (i % 3)));
    const f = run({ rows, openingCents: 100000 });
    const total = rows.reduce((s, r) => s + r.cents, 0);
    assert.equal(f.months[1].endBalance * 100, 100000 - total);
    assert.ok(Number.isInteger(Math.round(f.months[1].endBalance * 100)));
  });
});
