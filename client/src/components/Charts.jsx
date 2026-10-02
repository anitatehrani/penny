import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../context.jsx';
import { monthLabel, monthShort } from '../format.js';

const axisProps = {
  tick: { fill: 'var(--ink-3)', fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: 'var(--line)' },
};

/** "Nice" y-axis: always includes 0 as a tick and uses round step sizes. */
function niceAxis(values, targetTicks = 5) {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const rough = (hi - lo || 1) / (targetTicks - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { domain: [min, max], ticks };
}

const Dot = ({ cx, cy, value }) =>
  cx == null || cy == null || value == null ? null : (
    <circle cx={cx} cy={cy} r={4} fill="var(--surface)" stroke="var(--series-3)" strokeWidth={2} />
  );

function Legend({ items }) {
  const hatchId = `legend-hatch-${useId().replace(/:/g, '')}`; // unique per legend (two can be on one page)
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-2)" strokeWidth="2" />
          </pattern>
        </defs>
      </svg>
      <ul className="legend">
        {items.map((i) => (
          <li key={i.label}>
            <svg width="22" height="10" aria-hidden="true">
              {i.kind === 'line' ? (
                <line x1="1" x2="21" y1="5" y2="5" stroke={i.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={i.dashed ? '5 4' : undefined} />
              ) : i.hatched ? (
                <rect x="1" y="1" width="20" height="8" rx="2" fill={`url(#${hatchId})`} stroke={i.color} strokeWidth="1" />
              ) : (
                <rect x="1" y="1" width="20" height="8" rx="2" fill={i.color} />
              )}
            </svg>
            {i.label}
          </li>
        ))}
      </ul>
    </>
  );
}

function MonthTooltip({ active, payload }) {
  const { money } = useApp();
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const rows = [
    ['Income', r.income, r.estimatedIncome ? `+ ${money(r.estimatedIncome)} est.` : null],
    ['Expenses', r.expenses, r.estimatedExpenses ? `+ ${money(r.estimatedExpenses)} est.` : null],
    ['Net', r.net],
  ];
  return (
    <div className="tooltip">
      <strong>
        {monthLabel(r.month)}
        {r.kind === 'actual' ? ' · actual' : r.kind === 'current' ? ' · this month' : ' · forecast'}
      </strong>
      {rows.map(([label, value, extra]) => (
        <div key={label} className="tooltip-row">
          <span>{label}</span>
          <span className="num">
            {money(value, { signed: label === 'Net' })} {extra && <small className="muted">{extra}</small>}
          </span>
        </div>
      ))}
      <div className="tooltip-row total">
        <span>Balance at month end</span>
        <span className={`num ${r.endBalance < 0 ? 'neg' : ''}`}>{money(r.endBalance)}</span>
      </div>
    </div>
  );
}

/** Month-end balance: solid for actuals, dashed for projections, zero line + tinted negative zone. */
export function BalanceChart({ months, height = 260 }) {
  const { money } = useApp();
  const data = months.map((m) => ({
    ...m,
    actual: m.kind === 'forecast' ? null : m.endBalance,
    projected: m.kind === 'actual' ? null : m.endBalance,
  }));
  const min = Math.min(...months.map((m) => m.endBalance));
  const axis = niceAxis(months.map((m) => m.endBalance));
  const label = `Month-end balance from ${monthLabel(months[0].month)} to ${monthLabel(months.at(-1).month)}; lowest ${money(min)}.`;

  return (
    <div role="img" aria-label={label}>
      <Legend
        items={[
          { kind: 'line', color: 'var(--series-3)', label: 'Actual balance' },
          { kind: 'line', color: 'var(--series-3)', dashed: true, label: 'Projected balance' },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthShort} {...axisProps} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...axisProps} width={64} tickFormatter={money.compact} domain={axis.domain} ticks={axis.ticks} />
          {min < 0 && <ReferenceArea y1={-1e12} y2={0} fill="var(--bad-bg)" ifOverflow="hidden" />}
          <ReferenceLine y={0} stroke="var(--ink-3)" />
          <Tooltip content={<MonthTooltip />} cursor={{ stroke: 'var(--ink-3)', strokeDasharray: '3 3' }} />
          <Line type="linear" dataKey="actual" stroke="var(--series-3)" strokeWidth={2.5} dot={<Dot />} activeDot={{ r: 6 }} isAnimationActive={false} />
          <Line type="linear" dataKey="projected" stroke="var(--series-3)" strokeWidth={2.5} strokeDasharray="6 5" dot={<Dot />} activeDot={{ r: 6 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Income vs expenses per month. Estimated variable spending is a hatched segment on top. */
export function CashflowChart({ months, showEstimates, height = 260 }) {
  const { money } = useApp();
  const hasEstIncome = months.some((m) => m.estimatedIncome > 0);
  const legend = [
    { color: 'var(--series-1)', label: 'Income' },
    { color: 'var(--series-2)', label: 'Expenses' },
  ];
  if (showEstimates) legend.push({ color: 'var(--series-2)', hatched: true, label: 'Estimated variable spending' });
  return (
    <div role="img" aria-label="Income and expenses per month. See the table below for exact values.">
      <Legend items={legend} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={months} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-2)" strokeWidth="2.2" />
            </pattern>
            <pattern id="hatch-income" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-1)" strokeWidth="2.2" />
            </pattern>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthShort} {...axisProps} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...axisProps} width={64} tickFormatter={money.compact} />
          <Tooltip content={<MonthTooltip />} cursor={{ fill: 'var(--hover)' }} />
          <Bar dataKey="income" stackId="in" fill="var(--series-1)" radius={hasEstIncome ? 0 : [4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          {hasEstIncome && <Bar dataKey="estimatedIncome" stackId="in" fill="url(#hatch-income)" stroke="var(--series-1)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />}
          <Bar dataKey="expenses" stackId="out" fill="var(--series-2)" radius={showEstimates ? 0 : [4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          {showEstimates && <Bar dataKey="estimatedExpenses" stackId="out" fill="url(#hatch)" stroke="var(--series-2)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny balance trend for a stat card: month-end balances, a faint zero line, the current month marked. */
export function Sparkline({ months, height = 56 }) {
  const { money } = useApp();
  const vals = months.map((m) => m.endBalance);
  if (vals.length < 2) return null;
  const w = 240;
  const pad = 4;
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i) => pad + (i * (w - pad * 2)) / (vals.length - 1);
  const y = (v) => pad + ((hi - v) * (height - pad * 2)) / span;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const label = `Month-end balance trend from ${monthLabel(months[0].month)} to ${monthLabel(months.at(-1).month)}; lowest ${money(Math.min(...vals))}, highest ${money(Math.max(...vals))}.`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="spark-zero" />
      <polyline points={pts} className="spark-line" pathLength="1" />
    </svg>
  );
}
