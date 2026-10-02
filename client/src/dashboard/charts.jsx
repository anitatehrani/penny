import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from '../components/ds/hooks.js';
import { Icon } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { monthLabel } from '../format.js';

/** Round tick values that always include 0, so the axis reads "−€1K, €0, €1K, €2K" rather than "€700.6". */
function niceAxis(values, target = 4) {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const rough = (hi - lo || 1) / (target - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { domain: [min, max], ticks };
}

/** "May", "Jun" … and the year only where it changes, so months are never mistaken for days. */
const axisLabel = (ym, i) => {
  const name = monthLabel(ym, { month: 'short' });
  return i === 0 || ym.endsWith('-01') ? `${name} ’${ym.slice(2, 4)}` : name;
};

const AXIS = { tick: { fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }, tickLine: false, axisLine: false };

/** "▲ 12% vs last month": direction is an arrow and a sign, colour only reinforces it. `goodWhen` says which way is good. */
export function Delta({ now, before, goodWhen = 'down', suffix = 'vs last month', compact }) {
  if (before == null || before === 0) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (pct === 0) return <span className="delta flat">Unchanged {suffix}</span>;
  const up = pct > 0;
  const good = (goodWhen === 'down') === !up;
  return (
    <span className={`delta ${good ? 'good' : 'bad'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} />
      <span className="num">
        {up ? '+' : '−'}
        {Math.abs(pct)}%
      </span>
      {!compact && <span className="delta-suffix">{suffix}</span>}
    </span>
  );
}

function TrendTooltip({ active, payload }) {
  const { money } = useApp();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>{monthLabel(p.month)}</strong>
      <div className="chart-tip-row">
        <span>{p.kind === 'forecast' ? 'Forecast' : p.kind === 'current' ? 'Expected at month end' : 'Month-end balance'}</span>
        <span className={`num ${p.balance < 0 ? 'neg' : ''}`}>{money(p.balance)}</span>
      </div>
      {p.change != null && (
        <div className="chart-tip-row muted">
          <span>Change over the month</span>
          <span className="num">{p.change >= 0 ? '+' : '−'}{money(Math.abs(p.change))}</span>
        </div>
      )}
      {p.kind !== 'actual' && <div className="chart-tip-note">Dashed means predicted</div>}
    </div>
  );
}

/** Month-end balance: solid for what happened, dashed for the forecast, a clear zero line, and a flag where it dips below zero. */
export function BalanceTrend({ months, height = 190 }) {
  const { money } = useApp();
  const reduced = useReducedMotion();
  const data = months.map((m, i) => ({
    month: m.month,
    label: axisLabel(m.month, i),
    kind: m.kind,
    balance: m.endBalance,
    change: i > 0 ? m.endBalance - months[i - 1].endBalance : null,
    actual: m.kind === 'forecast' ? null : m.endBalance,
    forecast: m.kind === 'actual' ? null : m.endBalance,
  }));
  const values = data.map((d) => d.balance);
  const axis = niceAxis(values);
  const dipping = data.some((d) => d.kind !== 'actual' && d.balance < 0);
  if (dipping && axis.ticks.length > 1) {
    // leave room under the lowest point for its label
    const step = axis.ticks[1] - axis.ticks[0];
    axis.ticks.unshift(axis.ticks[0] - step);
    axis.domain = [axis.domain[0] - step, axis.domain[1]];
  }
  const dip = data.find((d) => d.kind !== 'actual' && d.balance < 0);
  const label = `Month-end balance from ${monthLabel(months[0].month)} to ${monthLabel(months.at(-1).month)}. Lowest ${money(Math.min(...values))}.${dip ? ` It dips below zero in ${monthLabel(dip.month)}.` : ''}`;

  return (
    <div role="img" aria-label={label} className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 14, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
          <YAxis {...AXIS} width={54} domain={axis.domain} ticks={axis.ticks} tickFormatter={(v) => money.compact(v)} />
          <ReferenceLine y={0} stroke="var(--ink-3)" strokeDasharray="3 3" />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--ink-3)', strokeDasharray: '2 3' }} isAnimationActive={false} />
          <Area type="monotone" dataKey="actual" stroke="var(--series-3)" strokeWidth={2.25} fill="var(--series-3)" fillOpacity={0.1} dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={!reduced} animationDuration={700} connectNulls={false} />
          <Line type="monotone" dataKey="forecast" stroke="var(--forecast)" strokeWidth={2.25} strokeDasharray="5 5" dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={!reduced} animationDuration={700} connectNulls={false} />
          {dip && <ReferenceDot x={dip.label} y={dip.balance} r={5} fill="var(--neg)" stroke="var(--surface)" strokeWidth={2} label={{ value: 'Dips below zero', position: 'bottom', fill: 'var(--neg)', fontSize: 11, fontWeight: 600 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function FlowTooltip({ active, payload }) {
  const { money } = useApp();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>
        {monthLabel(p.month)} <span className="muted">{p.kind === 'forecast' ? '· forecast' : p.kind === 'current' ? '· this month' : ''}</span>
      </strong>
      <div className="chart-tip-row">
        <span>
          <i className="swatch" style={{ background: 'var(--series-1)' }} /> Income
        </span>
        <span className="num">{money(p.income)}</span>
      </div>
      <div className="chart-tip-row">
        <span>
          <i className="swatch" style={{ background: 'var(--series-2)' }} /> Expenses
        </span>
        <span className="num">{money(p.expenses)}</span>
      </div>
      <div className="chart-tip-row strong">
        <span>Net</span>
        <span className={`num ${p.net < 0 ? 'neg' : 'pos'}`}>
          {p.net >= 0 ? '+' : '−'}
          {money(Math.abs(p.net))}
        </span>
      </div>
      {p.prevExpenses != null && p.prevExpenses > 0 && (
        <div className="chart-tip-row muted">
          <span>Expenses vs previous month</span>
          <Delta now={p.expenses} before={p.prevExpenses} goodWhen="down" suffix="" compact />
        </div>
      )}
      {p.kind === 'forecast' && <div className="chart-tip-note">Includes an estimate of everyday spending</div>}
    </div>
  );
}

/** Income against expenses by month, with net as a line. Forecast months are lighter with a dashed outline. */
export function CashFlowChart({ months, height = 230, showForecast = true }) {
  const { money } = useApp();
  const reduced = useReducedMotion();
  const rows = months
    .filter((m) => showForecast || m.kind !== 'forecast')
    .map((m, i, arr) => {
      const income = m.income + m.estimatedIncome;
      const expenses = m.expenses + m.estimatedExpenses;
      const prev = arr[i - 1];
      return { month: m.month, label: axisLabel(m.month, i), kind: m.kind, income, expenses, net: income - expenses, prevExpenses: prev ? prev.expenses + prev.estimatedExpenses : null };
    });
  const flowAxis = niceAxis(rows.flatMap((r) => [r.income, r.expenses, r.net]));
  const label = `Income and expenses by month, ${monthLabel(rows[0].month)} to ${monthLabel(rows.at(-1).month)}.`;
  return (
    <div role="img" aria-label={label} className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} barGap={3} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={10} />
          <YAxis {...AXIS} width={54} domain={flowAxis.domain} ticks={flowAxis.ticks} tickFormatter={(v) => money.compact(v)} />
          <ReferenceLine y={0} stroke="var(--ink-3)" />
          <Tooltip content={<FlowTooltip />} cursor={{ fill: 'var(--hover)', fillOpacity: 0.6 }} isAnimationActive={false} />
          <Bar dataKey="income" fill="var(--series-1)" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={!reduced} animationDuration={600}>
            {rows.map((r) => (
              <Cell key={r.month} fillOpacity={r.kind === 'forecast' ? 0.4 : 1} stroke={r.kind === 'forecast' ? 'var(--series-1)' : 'none'} strokeDasharray="3 3" />
            ))}
          </Bar>
          <Bar dataKey="expenses" fill="var(--series-2)" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={!reduced} animationDuration={600}>
            {rows.map((r) => (
              <Cell key={r.month} fillOpacity={r.kind === 'forecast' ? 0.4 : 1} stroke={r.kind === 'forecast' ? 'var(--series-2)' : 'none'} strokeDasharray="3 3" />
            ))}
          </Bar>
          <Line type="monotone" dataKey="net" stroke="var(--ink)" strokeWidth={1.75} dot={{ r: 2.5, fill: 'var(--surface)', stroke: 'var(--ink)', strokeWidth: 1.5 }} activeDot={{ r: 4.5 }} isAnimationActive={!reduced} animationDuration={700} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ring of spending by category. Hovering a slice (or its row in the list) lights up the other and dims the rest. */
export function Donut({ items, active, onActive, size = 188, centre }) {
  const reduced = useReducedMotion();
  return (
    <div className="donut" aria-hidden="true" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer={false} rootTabIndex={-1}>
          <Pie
            data={items}
            dataKey="current"
            nameKey="name"
            rootTabIndex={-1}
            innerRadius="66%"
            outerRadius="96%"
            paddingAngle={items.length > 1 ? 2 : 0}
            stroke="var(--surface)"
            strokeWidth={2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={!reduced}
            animationDuration={650}
            onMouseEnter={(_, i) => onActive(i)}
            onMouseLeave={() => onActive(null)}
          >
            {items.map((it, i) => (
              <Cell key={it.name} fill={it.color} fillOpacity={active == null || active === i ? 1 : 0.28} style={{ transition: 'fill-opacity 160ms', cursor: 'pointer' }} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-centre">{centre}</div>
    </div>
  );
}
