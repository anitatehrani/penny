import { useState } from 'react';
import { api, qs } from '../api.js';
import { BalanceTrend, CashFlowChart } from '../dashboard/charts.jsx';
import { ErrorBox, Icon, Loading, Segmented, Switch } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { monthLabel } from '../format.js';
import { useFetch } from '../hooks.js';
import { t, tn } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

const LOOK_AHEAD = [
  { value: 3, get label() { return t('3 mo'); } },
  { value: 6, get label() { return t('6 mo'); } },
  { value: 12, get label() { return t('1 yr'); } },
  { value: 24, get label() { return t('2 yrs'); } },
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
          <h1>{t('Forecast')}</h1>
          <p className="muted">
            {showEst ? t('Built from your pending payments, recurring items and installments, plus an estimate of everyday spending.') : t('Built from your pending payments, recurring items and installments.')}
          </p>
        </div>
        <div className="head-actions look-ahead">
          <span className="muted" aria-hidden="true">
            {t('Look ahead')}
          </span>
          <Segmented label={t('Look ahead')} value={months} onChange={setMonths} options={LOOK_AHEAD} />
        </div>
      </header>

      {insights.firstNegativeMonth ? (
        <div className={`banner ${belowZero ? 'danger' : 'warn'}`} role="alert">
          <Icon name="alert" />
          <div>
            <strong>
              {belowZero ? t('Your balance is projected to go negative in {monthLabel} ({money}).', { monthLabel: monthLabel(insights.firstNegativeMonth.month), money: money(insights.firstNegativeMonth.balance) }) : t('Your balance is projected to dip below your {money} buffer in {monthLabel} ({money2}).', { money: money(buffer), monthLabel: monthLabel(insights.firstNegativeMonth.month), money2: money(insights.firstNegativeMonth.balance) })}
            </strong>{' '}
            {t(buffer > 0 ? 'It stays below your buffer in {n} of the next {total} months; the lowest point is {amount} ({month}).' : 'It stays below zero in {n} of the next {total} months; the lowest point is {amount} ({month}).', { n: insights.negativeMonths, total: data.months.filter((m) => m.kind !== 'actual').length, amount: money(insights.lowest.balance), month: monthLabel(insights.lowest.month) })}
          </div>
        </div>
      ) : (
        <div className="banner ok">
          <Icon name="check" />
          <div>
            {buffer > 0 ? t('Your balance stays above your {money} buffer.', { money: money(buffer) }) : t('No negative balance expected.')} {tRich('The lowest projected balance is {bold} in {monthLabel}.', { monthLabel: monthLabel(insights.lowest.month), bold: <strong>{money(insights.lowest.balance)}</strong> })}
          </div>
        </div>
      )}

      <section className="kpis three">
        <div className="card kpi">
          <span className="kpi-label">{t('Balance today')}</span>
          <span className={`kpi-value num ${data.currentBalance < 0 ? 'neg' : ''}`}>{money(data.currentBalance)}</span>
          {data.overdueNet !== 0 && <span className="kpi-sub">{t('Includes overdue items ({money}) in this month\'s outlook', { money: money(data.overdueNet, { signed: true }) })}</span>}
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t('Balance in {months} months', { months })}</span>
          <span className={`kpi-value num ${data.months.at(-1).endBalance < 0 ? 'neg' : ''}`}>{money(data.months.at(-1).endBalance)}</span>
          <span className="kpi-sub">{monthLabel(data.months.at(-1).month)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t('Average monthly result')}</span>
          <span className={`kpi-value num ${avgNet < 0 ? 'neg' : ''}`}>{money(avgNet, { signed: true })}</span>
          <span className="kpi-sub">{t('Income minus expenses, future months')}</span>
        </div>
      </section>

      <section className="card est-card" aria-label={t('Estimates')}>
        <div className="est-row">
          <div>
            <strong id="est-spend">{t('Estimate everyday spending')}</strong>
            <p className="muted small">
              {estimates.monthsUsed > 0 ? tn(estimates.monthsUsed, 'About {money} a month: the average of your last {n} month of one-off expenses in categories not already covered by recurring items or installments.', 'About {money} a month: the average of your last {n} months of one-off expenses in categories not already covered by recurring items or installments.', { money: money(estimates.expenses) }) : t('Needs at least one full month of history.')}
            </p>
          </div>
          <Switch checked={estExpenses} onChange={setEstExpenses} label={t('Estimate everyday spending')} />
        </div>
        <div className="est-row">
          <div>
            <strong id="est-income">{t('Estimate one-off income')}</strong>
            <p className="muted small">{t('Off by default. Only turn it on if your extra income is regular.')}</p>
          </div>
          <Switch checked={estIncome} onChange={setEstIncome} label={t('Estimate one-off income')} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Balance at the end of each month')}</h2>
          <span className="legend-inline">
            <i className="line solid" /> {t('Actual')} <i className="line dashed" /> {t('Forecast')}
          </span>
        </div>
        <BalanceTrend months={data.months} buffer={buffer} height={270} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Income and expenses per month')}</h2>
        </div>
        <CashFlowChart months={data.months} height={270} />
        <ul className="legend-inline cf-legend">
          <li>
            <i className="swatch" style={{ background: 'var(--series-1)' }} /> {t('Income')}
          </li>
          <li>
            <i className="swatch" style={{ background: 'var(--series-2)' }} /> {t('Expenses')}
          </li>
          <li>
            <i className="line solid ink" /> {t('Net')}
          </li>
          <li>
            <i className="swatch hatch" /> {t('Forecast (lighter, dashed)')}
          </li>
        </ul>
      </section>

      <section className="card flush">
        <div className="card-head pad">
          <h2>{t('Month by month')}</h2>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('Month by month table (scrolls sideways on small screens)')}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('Month')}</th>
                <th className="r">{t('Income')}</th>
                <th className="r">{t('Expenses')}</th>
                {(showEst || estIncome) && <th className="r">{t('Estimated')}</th>}
                <th className="r">{t('Net')}</th>
                <th className="r">{t('End balance')}</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className={m.kind === 'current' ? 'current' : ''}>
                  <td>
                    {monthLabel(m.month)}{' '}
                    {m.kind === 'actual' && <span className="badge">{t('Actual')}</span>}
                    {m.kind === 'current' && <span className="badge accent">{t('This month')}</span>}
                  </td>
                  <td className="r num pos">{money(m.income)}</td>
                  <td className="r num">{money(m.expenses)}</td>
                  {(showEst || estIncome) && (
                    <td className="r num muted">{m.estimatedIncome - m.estimatedExpenses !== 0 ? money(m.estimatedIncome - m.estimatedExpenses, { signed: true }) : '—'}</td>
                  )}
                  <td className={`r num ${m.net < 0 ? 'neg' : ''}`}>{money(m.net, { signed: true })}</td>
                  <td className={`r num strong ${m.endBalance < 0 ? 'neg' : ''}`}>
                    {m.endBalance < 0 && (
                      <span className="neg-flag" title={t('Negative balance')}>
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
        {t('How it works: your balance today (starting balance plus everything marked paid) is carried forward, month by month, subtracting unpaid expenses and adding expected income. Overdue unpaid items count against the current month. Past months show what was actually paid.')}
      </p>
    </>
  );
}
