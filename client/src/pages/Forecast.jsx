import { useState } from 'react';
import { api, qs } from '../api.js';
import { BalanceTrend, CashFlowChart } from '../dashboard/charts.jsx';
import { ErrorBox, Icon, Loading, Segmented, Switch } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { monthLabel } from '../format.js';
import { useFetch } from '../hooks.js';

const LOOK_AHEAD = [
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: 12, label: '1 yr' },
  { value: 24, label: '2 yrs' },
];

export default function Forecast() {
  const { money, settings } = useApp();
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
  const buffer = Number(data.minBalance ?? settings?.min_balance ?? 0);
  const belowZero = insights.firstNegativeMonth && insights.firstNegativeMonth.balance < 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Forecast</h1>
          <p className="muted">
            Built from your pending payments, recurring items and installments{showEst ? ', plus an estimate of everyday spending' : ''}.
          </p>
        </div>
        <div className="head-actions look-ahead">
          <span className="muted" aria-hidden="true">
            Look ahead
          </span>
          <Segmented label="Look ahead" value={months} onChange={setMonths} options={LOOK_AHEAD} />
        </div>
      </header>

      {insights.firstNegativeMonth ? (
        <div className={`banner ${belowZero ? 'danger' : 'warn'}`} role="alert">
          <Icon name="alert" />
          <div>
            <strong>
              {belowZero
                ? `Your balance is projected to go negative in ${monthLabel(insights.firstNegativeMonth.month)} (${money(insights.firstNegativeMonth.balance)}).`
                : `Your balance is projected to dip below your ${money(buffer)} buffer in ${monthLabel(insights.firstNegativeMonth.month)} (${money(insights.firstNegativeMonth.balance)}).`}
            </strong>{' '}
            It stays below {buffer > 0 ? 'your buffer' : 'zero'} in {insights.negativeMonths} of the next {data.months.filter((m) => m.kind !== 'actual').length} months; the lowest point is{' '}
            {money(insights.lowest.balance)} ({monthLabel(insights.lowest.month)}).
          </div>
        </div>
      ) : (
        <div className="banner ok">
          <Icon name="check" />
          <div>
            {buffer > 0 ? `Your balance stays above your ${money(buffer)} buffer.` : 'No negative balance expected.'} The lowest projected balance is <strong>{money(insights.lowest.balance)}</strong> in {monthLabel(insights.lowest.month)}.
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

      <section className="card est-card" aria-label="Estimates">
        <div className="est-row">
          <div>
            <strong id="est-spend">Estimate everyday spending</strong>
            <p className="muted small">
              {estimates.monthsUsed > 0 ? `About ${money(estimates.expenses)} a month: the average of your last ${estimates.monthsUsed} month${estimates.monthsUsed > 1 ? 's' : ''} of one-off expenses in categories not already covered by recurring items or installments.` : 'Needs at least one full month of history.'}
            </p>
          </div>
          <Switch checked={estExpenses} onChange={setEstExpenses} label="Estimate everyday spending" />
        </div>
        <div className="est-row">
          <div>
            <strong id="est-income">Estimate one-off income</strong>
            <p className="muted small">Off by default. Only turn it on if your extra income is regular.</p>
          </div>
          <Switch checked={estIncome} onChange={setEstIncome} label="Estimate one-off income" />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Balance at the end of each month</h2>
          <span className="legend-inline">
            <i className="line solid" /> Actual <i className="line dashed" /> Forecast
          </span>
        </div>
        <BalanceTrend months={data.months} buffer={buffer} height={270} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Income and expenses per month</h2>
        </div>
        <CashFlowChart months={data.months} height={270} />
        <ul className="legend-inline cf-legend">
          <li>
            <i className="swatch" style={{ background: 'var(--series-1)' }} /> Income
          </li>
          <li>
            <i className="swatch" style={{ background: 'var(--series-2)' }} /> Expenses
          </li>
          <li>
            <i className="line solid ink" /> Net
          </li>
          <li>
            <i className="swatch hatch" /> Forecast (lighter, dashed)
          </li>
        </ul>
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
