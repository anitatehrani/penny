import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatedNumber } from '../../components/ds/AnimatedNumber.jsx';
import { Icon, Skeleton } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { addMonthsYM, currentMonth, monthLabel } from '../../format.js';
import { useWorkspace } from '../../workspace.jsx';
import { BalanceTrend } from '../charts.jsx';

/**
 * Where you stand: today's balance as the biggest thing on the page, how it moved, where the month should end,
 * and the balance trend (history solid, forecast dashed) next to it. Hover or focus the figure, or press "How is this made up?",
 * to see the arithmetic behind it.
 */
export default function HeroWidget({ summary, forecast, size }) {
  const { money, settings } = useApp();
  const { isGroup } = useWorkspace();
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const s = summary;
  const t = s.totals;
  const month = currentMonth();
  const months = forecast?.months ?? [];
  const idx = months.findIndex((m) => m.kind === 'current');
  const prevEnd = idx > 0 ? months[idx - 1].endBalance : null;
  const moved = prevEnd == null ? null : s.balance - prevEnd;
  const prevName = monthLabel(addMonthsYM(month, -1), { month: 'long' });
  const open = pinned || hover;
  const negative = s.balance < 0;
  const netSince = s.balance - Number(settings?.opening_balance ?? 0);

  const rows = [
    ['Starting balance', money(Number(settings?.opening_balance ?? 0)), ''],
    ['Income and spending since', `${netSince >= 0 ? '+' : '−'}${money(Math.abs(netSince))}`, netSince < 0 ? 'neg' : 'pos'],
    ['Balance today', money(s.balance), negative ? 'neg' : '', true],
    ['Income still expected this month', `+${money(t.incomePending)}`, 'pos'],
    ['Payments still to make this month', `−${money(t.expensePending)}`, 'neg'],
    [`Expected at the end of ${monthLabel(month, { month: 'long' })}`, money(s.projectedMonthEnd), s.projectedMonthEnd < 0 ? 'neg' : '', true],
  ];

  return (
    <div className={`hero hero-${size}`}>
      <div className="hero-figure">
        <div className="eyebrow">{isGroup ? 'Our balance today' : 'Balance today'}</div>
        <div className={`hero-balance num${negative ? ' neg' : ''}`} tabIndex={0} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={`Balance today ${money(s.balance)}. Press to see how it is made up.`} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setPinned((p) => !p))} onClick={() => setPinned((p) => !p)}>
          <AnimatedNumber value={s.balance} format={money} />
          {negative && <Icon name="alert" size={22} />}
        </div>
        <div className="hero-meta">
          {moved != null && Math.abs(moved) >= 0.005 && (
            <span className={`hero-moved ${moved >= 0 ? 'good' : 'bad'}`}>
              <Icon name={moved >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
              <span className="num">
                {moved >= 0 ? '+' : '−'}
                {money(Math.abs(moved))}
              </span>
              <span className="muted"> since the end of {prevName}</span>
            </span>
          )}
          <span className="hero-end">
            <span className="muted">Expected month end </span>
            <span className={`num forecast-text${s.projectedMonthEnd < 0 ? ' neg' : ''}`}>{money(s.projectedMonthEnd)}</span>
          </span>
        </div>
        <button className="hero-why" onClick={() => setPinned((p) => !p)} aria-expanded={open} aria-controls="hero-breakdown">
          How is this made up? <Icon name="chevron" size={13} />
        </button>
        <div className={`hero-breakdown${open ? ' open' : ''}`} id="hero-breakdown">
          <dl>
            {rows.map(([label, value, tone, strong]) => (
              <div key={label} className={`bd-row${strong ? ' strong' : ''}`}>
                <dt>{label}</dt>
                <dd className={`num ${tone}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {size !== 's' && (
        <div className="hero-chart">
          <div className="hero-chart-head">
            <span className="eyebrow">Balance history &amp; forecast</span>
            <span className="legend-inline">
              <i className="line solid" /> Actual <i className="line dashed" /> Forecast
            </span>
            <Link to="/forecast" className="link-quiet">
              Full forecast
            </Link>
          </div>
          {forecast ? <BalanceTrend months={months} height={size === 'm' ? 150 : 176} /> : <Skeleton w="100%" h={160} r={8} />}
        </div>
      )}
    </div>
  );
}
