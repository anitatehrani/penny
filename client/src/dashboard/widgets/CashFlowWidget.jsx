import { useState } from 'react';
import { Skeleton, Switch } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { monthLabel } from '../../format.js';
import { Delta, CashFlowChart } from '../charts.jsx';

/** Income against expenses month by month, with this month's net and how it compares to last month. Forecast months can be hidden. */
export default function CashFlowWidget({ forecast, month }) {
  const { money } = useApp();
  const [showForecast, setShowForecast] = useState(true);
  if (!forecast) return <Skeleton w="100%" h={230} r={8} />;
  const all = forecast.months;
  const i = month ? all.findIndex((m) => m.month === month) : all.findIndex((m) => m.kind === 'current'); // the chosen month, or this one
  if (i < 0) return <Skeleton w="100%" h={230} r={8} />;
  const months = all.slice(Math.max(0, i - 4), i + 4); // four months back, that month, three ahead
  const cur = all[i];
  const prev = all[i - 1];
  const curNet = cur.income + cur.estimatedIncome - cur.expenses - cur.estimatedExpenses;
  return (
    <div className="cashflow panel">
      <div className="cashflow-head">
        <div>
          <div className="eyebrow">{cur.kind === 'current' ? 'Net this month' : `Net in ${monthLabel(cur.month)}`}</div>
          <div className={`cashflow-net num ${curNet < 0 ? 'neg' : 'pos'}`}>
            {curNet >= 0 ? '+' : '−'}
            {money(Math.abs(curNet))}
          </div>
          {prev && <Delta now={cur.expenses + cur.estimatedExpenses} before={prev.expenses} goodWhen="down" suffix="spending vs last month" />}
        </div>
        <label className="cashflow-toggle small muted">
          Show forecast
          <Switch checked={showForecast} onChange={setShowForecast} label="Show forecast months" />
        </label>
      </div>
      <CashFlowChart months={months} showForecast={showForecast} height={220} />
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
        {showForecast && (
          <li>
            <i className="swatch hatch" /> Forecast (lighter, dashed)
          </li>
        )}
      </ul>
    </div>
  );
}
