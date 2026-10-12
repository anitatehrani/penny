import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatedNumber } from '../../components/ds/AnimatedNumber.jsx';
import { Icon, Skeleton } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { monthLabel } from '../../format.js';
import { monthFigures, windowAround } from '../../monthLogic.js';
import { useWorkspace } from '../../workspace.jsx';
import { BalanceTrend } from '../charts.jsx';
import { t } from '../../i18n/translate.js';

/**
 * The balance widget when the dashboard is pointed at another month: the balance at the end of that month (what it was, or what is
 * expected), what came in and went out during it, and the arithmetic behind it. The chart marks the month.
 */
export default function HeroMonthWidget({ month, forecast, size }) {
  const { money, settings } = useApp();
  const { isGroup } = useWorkspace();
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const months = forecast?.months ?? [];
  const f = monthFigures(months, month);
  if (!f) return <Skeleton w="100%" h={190} r={8} />;

  const name = monthLabel(month);
  const future = f.kind !== 'actual';
  const negative = f.endBalance < 0;
  const open = pinned || hover;
  const rows = [
    [t('Balance at the start of {name}', { name }), money(f.startBalance), f.startBalance < 0 ? 'neg' : ''],
    [future ? t('Income expected') : t('Income'), `+${money(f.income)}`, 'pos'],
    [future ? t('Spending expected') : t('Spending'), `−${money(f.expenses)}`, 'neg'],
    [t('{value} at the end of {name}', { value: future ? t('Expected') : t('Balance'), name }), money(f.endBalance), negative ? 'neg' : '', true],
  ];

  return (
    <div className={`hero hero-${size}`}>
      <div className="hero-figure">
        <div className="eyebrow">{t('{value} · end of {name}', { value: isGroup ? t('Our balance') : t('Balance'), name })}</div>
        <div
          className={`hero-balance num${negative ? ' neg' : ''}`}
          tabIndex={0}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          aria-label={t('{value} at the end of {name}: {money}. Press to see how it is made up.', { value: future ? t('Expected balance') : t('Balance'), name, money: money(f.endBalance) })}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setPinned((p) => !p))}
          onClick={() => setPinned((p) => !p)}
        >
          <AnimatedNumber value={f.endBalance} format={money} />
          {negative && <Icon name="alert" size={22} />}
        </div>
        <div className="hero-meta">
          <span className={`hero-moved ${f.net >= 0 ? 'good' : 'bad'}`}>
            <Icon name={f.net >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
            <span className="num">
              {f.net >= 0 ? '+' : '−'}
              {money(Math.abs(f.net))}
            </span>
            <span className="muted"> {future ? t('expected for the month') : t('over the month')}</span>
          </span>
          <span className="hero-end">
            <span className="muted">{future ? t('Forecast, not yet happened') : t('Actual')}</span>
          </span>
        </div>
        <button className="hero-why" onClick={() => setPinned((p) => !p)} aria-expanded={open} aria-controls="hero-breakdown">
          {t('How is this made up?')} <Icon name="chevron" size={13} />
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
            <span className="eyebrow">{t('Balance history & forecast')}</span>
            <span className="legend-inline">
              <i className="line solid" /> {t('Actual')} <i className="line dashed" /> {t('Forecast')}
            </span>
            <Link to="/forecast" className="link-quiet">
              {t('Full forecast')}
            </Link>
          </div>
          <BalanceTrend months={windowAround(months, month, 5, 6)} marker={month} buffer={Number(settings?.min_balance ?? 0)} height={size === 'm' ? 150 : 176} />
        </div>
      )}
    </div>
  );
}
