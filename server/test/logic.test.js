import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, addMonthsYM, isValidYMD, monthEnd } from '../src/lib/dates.js';
import { buildForecast } from '../src/lib/forecast.js';
import { installmentDates, occurrences, splitInstallments } from '../src/lib/schedule.js';

test('date helpers clamp to month length and validate', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonthsYM('2026-01', -2), '2025-11');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.ok(isValidYMD('2026-02-28'));
  assert.ok(!isValidYMD('2026-02-30'));
  assert.ok(!isValidYMD('2026-2-3'));
});

test('monthly rule on the 31st keeps its anchor day', () => {
  const rule = { frequency: 'monthly', interval_count: 1, start_date: '2026-01-31' };
  assert.deepEqual(occurrences(rule, '2026-01-01', '2026-04-30'), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
});

test('rules respect from/to, intervals and end date', () => {
  const biweekly = { frequency: 'weekly', interval_count: 2, start_date: '2026-10-01' };
  assert.deepEqual(occurrences(biweekly, '2026-10-10', '2026-11-15'), ['2026-10-15', '2026-10-29', '2026-11-12']);

  const yearly = { frequency: 'yearly', interval_count: 1, start_date: '2024-03-14' };
  assert.deepEqual(occurrences(yearly, '2026-01-01', '2028-12-31'), ['2026-03-14', '2027-03-14', '2028-03-14']);

  const ended = { frequency: 'monthly', interval_count: 3, start_date: '2026-01-10', end_date: '2026-08-01' };
  assert.deepEqual(occurrences(ended, '2026-01-01', '2027-01-01'), ['2026-01-10', '2026-04-10', '2026-07-10']);
});

test('installments split exactly and land monthly', () => {
  const parts = splitInstallments(100000, 3); // 1000.00 / 3
  assert.deepEqual(parts, [33334, 33333, 33333]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100000);
  assert.deepEqual(installmentDates('2026-11-30', 3), ['2026-11-30', '2026-12-30', '2027-01-30']);
});

const row = (month, type, status, cents) => ({ month, type, status, cents });

test('forecast carries pending items forward and can go negative', () => {
  const f = buildForecast({
    rows: [
      row('2026-09', 'income', 'paid', 200000),
      row('2026-09', 'expense', 'paid', 50000),
      row('2026-10', 'income', 'paid', 100000),
      row('2026-10', 'expense', 'pending', 80000),
      row('2026-11', 'expense', 'pending', 150000),
      row('2026-12', 'income', 'pending', 40000),
    ],
    manualPaidRows: [],
    openingCents: 10000,
    currentMonth: '2026-10',
    past: 1,
    months: 3,
  });
  // current balance = 100.00 + 2000 - 500 + 1000 = 2600
  assert.equal(f.currentBalance, 2600);
  const byMonth = Object.fromEntries(f.months.map((m) => [m.month, m]));
  assert.equal(byMonth['2026-09'].kind, 'actual');
  assert.equal(byMonth['2026-09'].endBalance, 1600); // 100 + 2000 - 500
  assert.equal(byMonth['2026-10'].endBalance, 1800); // 2600 - 800
  assert.equal(byMonth['2026-11'].endBalance, 300); // - 1500
  assert.equal(byMonth['2026-12'].endBalance, 700); // + 400
  assert.equal(f.insights.firstNegativeMonth, null);

  const tight = buildForecast({
    rows: [row('2026-10', 'income', 'paid', 10000), row('2026-11', 'expense', 'pending', 50000)],
    manualPaidRows: [],
    openingCents: 0,
    currentMonth: '2026-10',
    past: 0,
    months: 2,
  });
  assert.equal(tight.insights.firstNegativeMonth.month, '2026-11');
  assert.equal(tight.insights.firstNegativeMonth.balance, -400);
  assert.equal(tight.insights.negativeMonths, 2);
});

test('overdue pending items are charged to the current month', () => {
  const f = buildForecast({
    rows: [row('2026-08', 'expense', 'pending', 30000), row('2026-08', 'income', 'paid', 100000)],
    manualPaidRows: [],
    openingCents: 0,
    currentMonth: '2026-10',
    past: 0,
    months: 1,
  });
  assert.equal(f.overdueNet, -300);
  assert.equal(f.months[0].endBalance, 700);
});

test('variable-spending estimate averages the last full months since first use', () => {
  const manual = [
    row('2026-07', 'expense', 'paid', 30000),
    row('2026-08', 'expense', 'paid', 60000),
    row('2026-09', 'expense', 'paid', 90000),
    row('2026-10', 'expense', 'paid', 20000), // already spent this month
  ];
  const rows = [row('2026-07', 'income', 'paid', 500000), ...manual];
  const f = buildForecast({ rows, manualPaidRows: manual, openingCents: 0, currentMonth: '2026-10', past: 0, months: 2 });
  assert.equal(f.estimates.expenses, 600); // (300 + 600 + 900) / 3
  assert.equal(f.months[0].estimatedExpenses, 400); // 600 - 200 already spent
  assert.equal(f.months[1].estimatedExpenses, 600);

  const off = buildForecast({
    rows, manualPaidRows: manual, openingCents: 0, currentMonth: '2026-10', past: 0, months: 1, estimateExpenses: false,
  });
  assert.equal(off.months[1].estimatedExpenses, 0);

  // Only months since first use count: first transaction in September => window = [Sep]
  const young = buildForecast({
    rows: [row('2026-09', 'expense', 'paid', 90000)],
    manualPaidRows: [row('2026-09', 'expense', 'paid', 90000)],
    openingCents: 0, currentMonth: '2026-10', past: 0, months: 1,
  });
  assert.equal(young.estimates.expenses, 900);
  assert.equal(young.estimates.monthsUsed, 1);
});
