import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatedNumber } from '../../components/ds/AnimatedNumber.jsx';
import MatchBankDialog from '../../components/MatchBankDialog.jsx';
import { Icon, Skeleton } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { addMonthsYM, currentMonth, dateLabel, monthLabel } from '../../format.js';
import { outlook } from '../../monthLogic.js';
import { safeLine } from '../../safeLogic.js';
import { useQuick } from '../../quick.jsx';
import { useWorkspace } from '../../workspace.jsx';
import { BalanceTrend } from '../charts.jsx';
import { t } from '../../i18n/translate.js';

/**
 * Where you stand: today's balance as the biggest thing on the page, how it moved, where the month should end,
 * and the balance trend (history solid, forecast dashed) next to it. Hover or focus the figure, or press "How is this made up?",
 * to see the arithmetic behind it.
 */
export default function HeroWidget({ summary, forecast, size, safe }) {
  const { money, settings } = useApp();
  const { isGroup } = useWorkspace();
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const s = summary;
  const tt = s.totals;
  const month = currentMonth();
  const months = forecast?.months ?? [];
  const idx = months.findIndex((m) => m.kind === 'current');
  const prevEnd = idx > 0 ? months[idx - 1].endBalance : null;
  const moved = prevEnd == null ? null : s.balance - prevEnd;
  const prevName = monthLabel(addMonthsYM(month, -1), { month: 'long' });
  const open = pinned || hover;
  const negative = s.balance < 0;
  const netSince = s.balance - Number(settings?.opening_balance ?? 0);
  const buffer = Number(settings?.min_balance ?? 0);
  const look = outlook(months, s.balance, buffer);
  const spend = safeLine(safe, { money, dateLabel });
  const { bump } = useQuick();
  const [matching, setMatching] = useState(false);

  const rows = [
    [t('Starting balance'), money(Number(settings?.opening_balance ?? 0)), ''],
    [t('Income and spending since'), `${netSince >= 0 ? '+' : '−'}${money(Math.abs(netSince))}`, netSince < 0 ? 'neg' : 'pos'],
    [t('Balance today'), money(s.balance), negative ? 'neg' : '', true],
    [t('Income still expected this month'), `+${money(tt.incomePending)}`, 'pos'],
    [t('Payments still to make this month'), `−${money(tt.expensePending)}`, 'neg'],
    [t('Expected at the end of {monthLabel}', { monthLabel: monthLabel(month, { month: 'long' }) }), money(s.projectedMonthEnd), s.projectedMonthEnd < 0 ? 'neg' : '', true],
  ];

  return (
    <div className={`hero hero-${size}`}>
      <div className="hero-figure">
        <div className="eyebrow">{isGroup ? t('Our balance today') : t('Balance today')}</div>
        <div className={`hero-balance num${negative ? ' neg' : ''}`} tabIndex={0} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={t('Balance today {money}. Press to see how it is made up.', { money: money(s.balance) })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setPinned((p) => !p))} onClick={() => setPinned((p) => !p)}>
          <AnimatedNumber value={s.balance} format={money} />
          {negative && <Icon name="alert" size={22} />}
        </div>
        {look && (
          <div className={`hero-status ${look.status === 'ok' ? 'ok' : look.status === 'under' || look.status === 'low' ? 'caution' : 'warn'}`}>
            <Icon name={look.status === 'ok' ? 'check' : 'alert'} size={14} />
            {look.status === 'below' && t('Below zero today')}
            {look.status === 'under' && t('Below your {money} buffer today', { money: money(buffer) })}
            {look.status === 'dip' && t('Dips below zero in {monthLabel}', { monthLabel: monthLabel(look.firstNegative.month, { month: 'long' }) })}
            {look.status === 'low' && t('Dips below your buffer in {monthLabel}', { monthLabel: monthLabel(look.firstLow.month, { month: 'long' }) })}
            {look.status === 'ok' && t('No dip ahead, lowest {money} in {monthLabel}', { money: money(look.lowest.balance), monthLabel: monthLabel(look.lowest.month, { month: 'long' }) })}
          </div>
        )}
        {spend && (
          <p className={`hero-safe ${spend.tone}`} title={spend.arithmetic.map(([k, v]) => `${k}: ${v}`).join('\n')}>
            {spend.text}
            <span className="sr-only">. {spend.arithmetic.map(([k, v]) => `${k} ${v}`).join('. ')}.</span>
          </p>
        )}
        <div className="hero-meta">
          {moved != null && Math.abs(moved) >= 0.005 && (
            <span className={`hero-moved ${moved >= 0 ? 'good' : 'bad'}`}>
              <Icon name={moved >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
              <span className="num">
                {moved >= 0 ? '+' : '−'}
                {money(Math.abs(moved))}
              </span>
              <span className="muted"> {t('since the end of {prevName}', { prevName })}</span>
            </span>
          )}
          <span className="hero-end">
            <span className="muted">{t('Expected month end')} </span>
            <span className={`num forecast-text${s.projectedMonthEnd < 0 ? ' neg' : ''}`}>{money(s.projectedMonthEnd)}</span>
          </span>
        </div>
        <div className="hero-links">
          <button className="hero-why" onClick={() => setPinned((p) => !p)} aria-expanded={open} aria-controls="hero-breakdown">
            {t('How is this made up?')} <Icon name="chevron" size={13} />
          </button>
          <button className="hero-why" onClick={() => setMatching(true)}>
            {t('Match my bank balance')}
          </button>
        </div>
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
            <span className="eyebrow">{t('Balance history & forecast')}</span>
            <span className="legend-inline">
              <i className="line solid" /> {t('Actual')} <i className="line dashed" /> {t('Forecast')}
            </span>
            <Link to="/forecast" className="link-quiet">
              {t('Full forecast')}
            </Link>
          </div>
          {forecast ? <BalanceTrend months={months} buffer={buffer} height={size === 'm' ? 150 : 176} /> : <Skeleton w="100%" h={160} r={8} />}
        </div>
      )}
      {matching && (
        <MatchBankDialog
          balance={s.balance}
          overdue={s.overdue}
          onClose={() => setMatching(false)}
          onDone={() => {
            setMatching(false);
            bump();
          }}
        />
      )}
    </div>
  );
}
