import { useState } from 'react';
import { api, qs } from '../api.js';
import { BalanceChart, CashflowChart } from '../components/Charts.jsx';
import { ErrorBox, Icon, Loading } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { monthLabel } from '../format.js';
import { useFetch } from '../hooks.js';

export default function Forecast() {
  const { money } = useApp();
  const [months, setMonths] = useState(12);
  const [estExpenses, setEstExpenses] = useState(true);
  const [estIncome, setEstIncome] = useState(false);

  const query = qs({ months, past: 3, estimateExpenses: estExpenses ? 1 : 0, estimateIncome: estIncome ? 1 : 0 });
  const { data, error } = useFetch(() => api.get(`/forecast${query}`), [query]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const { insights, estimates } = data;
  const ahead = data.months.filter((m) => m.kind !== 'actual');
  const avgNet = ahead.slice(1).reduce((s, m) => s + m.net, 0) / Math.max(1, ahead.length - 1);
  const showEst = estExpenses && estimates.expenses > 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Forecast</h1>
          <p className="muted">
            Built from your pending payments, recurring items and installments{showEst ? ', plus an estimate of everyday spending' : ''}.
          </p>
        </div>
        <div className="head-actions">
          <label className="inline-select">
            Look ahead
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[3, 6, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n} months
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {insights.firstNegativeMonth ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>
            <strong>
              Your balance is projected to go negative in {monthLabel(insights.firstNegativeMonth.month)} ({money(insights.firstNegativeMonth.balance)}).
            </strong>{' '}
            It stays below zero in {insights.negativeMonths} of the next {data.months.filter((m) => m.kind !== 'actual').length} months; the lowest point is{' '}
            {money(insights.lowest.balance)} ({monthLabel(insights.lowest.month)}).
          </div>
        </div>
      ) : (
        <div className="banner ok">
          <Icon name="check" />
          <div>
            No negative balance expected. The lowest projected balance is <strong>{money(insights.lowest.balance)}</strong> in {monthLabel(insights.lowest.month)}.
          </div>
        </div>
      )}

      <section className="kpis three">
        <div className="card kpi">
          <span className="kpi-label">Balance today</span>
          <span className={`kpi-value num ${data.currentBalance < 0 ? 'neg' : ''}`}>{money(data.currentBalance)}</span>
          {data.overdueNet !== 0 && <span className="kpi-sub">Includes overdue items ({money(data.overdueNet, { signed: true })}) in this month's outlook</span>}
        </div>
        <div className="card kpi">
          <span className="kpi-label">Balance in {months} months</span>
          <span className={`kpi-value num ${data.months.at(-1).endBalance < 0 ? 'neg' : ''}`}>{money(data.months.at(-1).endBalance)}</span>
          <span className="kpi-sub">{monthLabel(data.months.at(-1).month)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Average monthly result</span>
          <span className={`kpi-value num ${avgNet < 0 ? 'neg' : ''}`}>{money(avgNet, { signed: true })}</span>
          <span className="kpi-sub">Income minus expenses, future months</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Estimates</h2>
        </div>
        <div className="options">
          <label className="check">
            <input type="checkbox" checked={estExpenses} onChange={(e) => setEstExpenses(e.target.checked)} />
            <span>
              Estimate everyday spending{' '}
              <span className="muted">
                {estimates.monthsUsed > 0 ? `(≈ ${money(estimates.expenses)}/month, average of your last ${estimates.monthsUsed} month${estimates.monthsUsed > 1 ? 's' : ''} of one-off expenses in categories not already covered by recurring items or installments)` : '(needs at least one full month of history)'}
              </span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={estIncome} onChange={(e) => setEstIncome(e.target.checked)} />
            <span>
              Estimate one-off income <span className="muted">(off by default — only turn on if extra income is regular)</span>
            </span>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Balance at the end of each month</h2>
        </div>
        <BalanceChart months={data.months} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Income and expenses per month</h2>
        </div>
        <CashflowChart months={data.months} showEstimates={showEst} />
      </section>

      <section className="card flush">
        <div className="card-head pad">
          <h2>Month by month</h2>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Month by month table (scrolls sideways on small screens)">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">Income</th>
                <th className="r">Expenses</th>
                {(showEst || estIncome) && <th className="r">Estimated</th>}
                <th className="r">Net</th>
                <th className="r">End balance</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className={m.kind === 'current' ? 'current' : ''}>
                  <td>
                    {monthLabel(m.month)}{' '}
                    {m.kind === 'actual' && <span className="badge">Actual</span>}
                    {m.kind === 'current' && <span className="badge accent">This month</span>}
                  </td>
                  <td className="r num pos">{money(m.income)}</td>
                  <td className="r num">{money(m.expenses)}</td>
                  {(showEst || estIncome) && (
                    <td className="r num muted">{m.estimatedIncome - m.estimatedExpenses !== 0 ? money(m.estimatedIncome - m.estimatedExpenses, { signed: true }) : '—'}</td>
                  )}
                  <td className={`r num ${m.net < 0 ? 'neg' : ''}`}>{money(m.net, { signed: true })}</td>
                  <td className={`r num strong ${m.endBalance < 0 ? 'neg' : ''}`}>
                    {m.endBalance < 0 && (
                      <span className="neg-flag" title="Negative balance">
                        <Icon name="alert" size={14} />
                      </span>
                    )}
                    {money(m.endBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted small">
        How it works: your balance today (starting balance plus everything marked paid) is carried forward, month by month, subtracting
        unpaid expenses and adding expected income. Overdue unpaid items count against the current month. Past months show what was
        actually paid.
      </p>
    </>
  );
}
