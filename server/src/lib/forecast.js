import { addMonthsYM } from './dates.js';

const emptyMonth = () => ({ income: { paid: 0, pending: 0 }, expense: { paid: 0, pending: 0 } });

/**
 * Pure forecast builder. All money is handled in integer cents.
 *
 * rows:           [{ month:'YYYY-MM', type, status:'paid'|'pending', cents }]  (skipped excluded)
 * manualPaidRows: same shape, only source='manual' paid rows (used to estimate variable spending)
 *
 * Balance model:
 *   current balance = opening + every paid income - every paid expense
 *   month-end balance (current/future) = current balance + overdue pending carried into the
 *     current month + pending items up to that month + optional variable-spending estimates.
 */
export function buildForecast({
  rows,
  manualPaidRows,
  openingCents,
  currentMonth,
  past = 3,
  months = 12,
  estimateExpenses = true,
  estimateIncome = false,
  minCents = 0, // the balance the person does not want to go below
}) {
  const agg = {};
  for (const r of rows) (agg[r.month] ??= emptyMonth())[r.type][r.status] += r.cents;
  const monthsWithData = Object.keys(agg).sort();

  const paidNet = (m) => agg[m].income.paid - agg[m].expense.paid;
  const currentBalance = openingCents + monthsWithData.reduce((s, m) => s + paidNet(m), 0);
  const overdueNet = monthsWithData
    .filter((m) => m < currentMonth)
    .reduce((s, m) => s + agg[m].income.pending - agg[m].expense.pending, 0);

  // Variable-spending estimate: average ad-hoc (manual) paid amounts over the last 3 full
  // months, counting only months since the first recorded transaction.
  const firstMonth = monthsWithData[0] ?? currentMonth;
  const window = [-3, -2, -1].map((n) => addMonthsYM(currentMonth, n)).filter((m) => m >= firstMonth);
  const manual = {};
  for (const r of manualPaidRows) manual[`${r.month}:${r.type}`] = (manual[`${r.month}:${r.type}`] ?? 0) + r.cents;
  const avg = (type) =>
    window.length ? Math.round(window.reduce((s, m) => s + (manual[`${m}:${type}`] ?? 0), 0) / window.length) : 0;
  const estExpense = estimateExpenses ? avg('expense') : 0;
  const estIncome = estimateIncome ? avg('income') : 0;

  const result = [];

  for (let i = -past; i < 0; i++) {
    const m = addMonthsYM(currentMonth, i);
    const a = agg[m] ?? emptyMonth();
    result.push({
      month: m,
      kind: 'actual',
      income: a.income.paid,
      expenses: a.expense.paid,
      estimatedIncome: 0,
      estimatedExpenses: 0,
      pendingIncome: 0,
      pendingExpenses: 0,
      endBalance: openingCents + monthsWithData.filter((k) => k <= m).reduce((s, k) => s + paidNet(k), 0),
    });
  }

  let running = currentBalance + overdueNet;
  for (let i = 0; i <= months; i++) {
    const m = addMonthsYM(currentMonth, i);
    const a = agg[m] ?? emptyMonth();
    const isCurrent = i === 0;
    // In the current month, variable spending already paid counts against the estimate.
    const eInc = isCurrent ? Math.max(0, estIncome - (manual[`${m}:income`] ?? 0)) : estIncome;
    const eExp = isCurrent ? Math.max(0, estExpense - (manual[`${m}:expense`] ?? 0)) : estExpense;
    running += a.income.pending - a.expense.pending + eInc - eExp;
    result.push({
      month: m,
      kind: isCurrent ? 'current' : 'forecast',
      income: a.income.paid + a.income.pending,
      expenses: a.expense.paid + a.expense.pending,
      estimatedIncome: eInc,
      estimatedExpenses: eExp,
      pendingIncome: a.income.pending,
      pendingExpenses: a.expense.pending,
      endBalance: running,
    });
  }

  const ahead = result.filter((r) => r.kind !== 'actual');
  const lowest = ahead.reduce((lo, r) => (lo === null || r.endBalance < lo.endBalance ? r : lo), null);
  // "Negative" means below the person's safety buffer (0 unless they set one)
  const firstNegative = ahead.find((r) => r.endBalance < minCents) ?? null;
  const units = (c) => c / 100;

  return {
    minBalance: units(minCents),
    currentBalance: units(currentBalance),
    overdueNet: units(overdueNet),
    estimates: {
      expenses: units(estExpense),
      income: units(estIncome),
      monthsUsed: window.length,
    },
    months: result.map((r) => ({
      month: r.month,
      kind: r.kind,
      income: units(r.income),
      expenses: units(r.expenses),
      estimatedIncome: units(r.estimatedIncome),
      estimatedExpenses: units(r.estimatedExpenses),
      pendingIncome: units(r.pendingIncome),
      pendingExpenses: units(r.pendingExpenses),
      net: units(r.income + r.estimatedIncome - r.expenses - r.estimatedExpenses),
      endBalance: units(r.endBalance),
    })),
    insights: {
      lowest: lowest && { month: lowest.month, balance: units(lowest.endBalance) },
      firstNegativeMonth: firstNegative && { month: firstNegative.month, balance: units(firstNegative.endBalance) },
      negativeMonths: ahead.filter((r) => r.endBalance < minCents).length,
      minBalance: units(minCents),
    },
  };
}
