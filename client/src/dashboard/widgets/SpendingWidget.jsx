import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/ds/States.jsx';
import { Skeleton, Switch } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { currentMonth, monthLabel } from '../../format.js';
import { useQuick } from '../../quick.jsx';
import { usePlain } from '../../prefs.jsx';
import { Delta, Donut } from '../charts.jsx';
import { t } from '../../i18n/translate.js';
import { catName } from '../../categoryNames.js';

/**
 * Where the money goes this month. The ring and the list are one control: point at a category in either and the
 * other follows. Switch on "compare" to see last month's figure under each, and how it changed.
 */
export default function SpendingWidget({ compare }) {
  const { money } = useApp();
  const navigate = useNavigate();
  const { openAddPayment } = useQuick();
  const plain = usePlain();
  const [active, setActive] = useState(null);
  const [showPrev, setShowPrev] = useState(true);

  if (!compare) return <Skeleton w="100%" h={190} r={8} />;
  const items = compare.categories.filter((c) => c.current > 0);
  if (items.length === 0) {
    return (
      <EmptyState art="chart" title={compare.month === currentMonth() ? (plain ? t('No spending recorded this month') : t('No spending recorded this month. Your wallet is feeling smug.')) : t('No spending recorded for {monthLabel}', { monthLabel: monthLabel(compare.month) })} action={<button className="btn sm" onClick={() => openAddPayment()}>{t('Add a payment')}</button>}>
        {t('Once you add expenses, you will see which categories take the most.')}
      </EmptyState>
    );
  }
  const total = compare.totals.expenses;
  const prevTotal = compare.totals.expensesPrevious;
  const max = Math.max(...items.map((c) => Math.max(c.current, showPrev ? c.previous : 0)));
  const hovered = active != null ? items[active] : null;

  return (
    <div className="spending">
      <div className="spending-ring">
        <Donut
          items={items}
          active={active}
          onActive={setActive}
          centre={
            <div className="donut-label" aria-hidden="true">
              <span className="eyebrow">{hovered ? hovered.name : t('Total')}</span>
              <span className="num donut-value">{money(hovered ? hovered.current : total)}</span>
              <span className="muted small">{hovered ? t('{round}% of spending', { round: Math.round((hovered.current / total) * 100) }) : monthLabel(compare.month, { month: 'long' })}</span>
            </div>
          }
        />
        {prevTotal > 0 && (
          <div className="spending-total">
            <Delta now={total} before={prevTotal} goodWhen="down" suffix={t('vs {monthLabel}', { monthLabel: monthLabel(compare.prevMonth, { month: 'long' }) })} />
          </div>
        )}
      </div>

      <div className="spending-list">
        <div className="spending-toggle">
          <label htmlFor="cmp" className="small muted">
            {t('Compare with {monthLabel}', { monthLabel: monthLabel(compare.prevMonth, { month: 'long' }) })}
          </label>
          <Switch id="cmp" checked={showPrev} onChange={setShowPrev} label={t('Compare with last month')} />
        </div>
        <ul>
          {items.slice(0, 7).map((c, i) => {
            const share = Math.round((c.current / total) * 100);
            return (
              <li key={c.name} className={active === i ? 'active' : active != null ? 'dim' : ''} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                <button
                  className="spend-row"
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => navigate(`/payments?${c.category_id ? `category=${c.category_id}&` : ''}month=${compare.month}&type=expense`)}
                  aria-label={c.previous > 0 ? t('{name}: {money}, {share}% of spending, last month {previous}. See these payments.', { name: catName(c.name), money: money(c.current), share, previous: money(c.previous) }) : t('{name}: {money}, {share}% of spending, nothing last month. See these payments.', { name: catName(c.name), money: money(c.current), share })}
                >
                  <span className="spend-top">
                    <span className="cat">
                      <span className="dot" style={{ background: c.color }} />
                      {catName(c.name)}
                    </span>
                    <span className="spend-right">
                      {showPrev && (c.previous > 0 ? <Delta now={c.current} before={c.previous} goodWhen="down" suffix="" compact /> : <span className="badge">{t('New')}</span>)}
                      <span className="num">{money(c.current)}</span>
                    </span>
                  </span>
                  <span className="bar-track" aria-hidden="true" title={showPrev ? t('Last month: {money}', { money: money(c.previous) }) : undefined}>
                    <span className="bar-now" style={{ width: `${(c.current / max) * 100}%`, background: c.color }} />
                    {showPrev && c.previous > 0 && <span className="bar-tick" style={{ left: `${Math.min(100, (c.previous / max) * 100)}%` }} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {showPrev && <p className="muted small spend-key"><i className="tick-key" /> {t('marks last month')}</p>}
        {items.length > 7 && <p className="muted small">{t('and {value} smaller categories', { value: items.length - 7 })}</p>}
      </div>
    </div>
  );
}
