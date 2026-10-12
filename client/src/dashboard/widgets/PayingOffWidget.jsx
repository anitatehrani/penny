import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ds/States.jsx';
import { Icon, Skeleton } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { dateLabel, todayYMD } from '../../format.js';
import { payingOff } from '../../payingOffLogic.js';
import { t } from '../../i18n/translate.js';

/** What is left on the debts and installment plans, soonest payment first, each with how far along it is. */
export default function PayingOffWidget({ debts, plans }) {
  const { money } = useApp();
  if (!debts || !plans) return <Skeleton w="100%" h={150} r={8} />;
  const r = payingOff(debts.debts, plans, todayYMD());
  if (r.count === 0) {
    return (
      <EmptyState art="ledger" title={t('Nothing to pay off')} action={<Link className="btn sm" to="/debts?new=1">{t('Add a debt')}</Link>}>
        {t('Debts and installment plans you are paying off show up here, with how far along each one is.')}
      </EmptyState>
    );
  }
  return (
    <div className="paying">
      <p className="widget-lead">
        <span className="num">{money(r.total)}</span> {t('still to pay in your budget')}
        {r.overdue > 0 && <span className="neg-text"> {t('· {overdue} overdue', { overdue: r.overdue })}</span>}
      </p>
      <ul className="paying-list" aria-label={t('Debts and installment plans')}>
        {r.items.map((x) => (
          <li key={`${x.kind}${x.id}`} className={`paying-row${x.overdue ? ' overdue' : ''}`}>
            <Link to={x.kind === 'debt' ? '/debts' : '/installments'} className="paying-link">
              <span className="paying-name">
                {x.name}
                {!x.counted && <span className="badge">{t('Not counted')}</span>}
              </span>
              <span className="num paying-left">{money(x.remaining)}</span>
              <span className={`progress${x.segments ? ' steps' : ''}`} role="progressbar" aria-valuenow={x.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${x.name}: ${x.paidText ?? t('{pct}% paid', { pct: x.pct })}`}>
                {x.segments ? x.segments.map((state, i) => <span key={i} className={`step ${state}`} aria-hidden="true" />) : <div style={{ width: `${x.pct}%` }} />}
              </span>
              <span className="muted small paying-next">
                {x.paidText ?? t('{pct}% paid', { pct: x.pct })} ·{' '}
                {x.nextDate ? <span className={x.overdue ? 'neg-text' : undefined}>
                    {x.overdue ? t('overdue since {dateLabel}', { dateLabel: dateLabel(x.nextDate) }) : t('next {dateLabel}', { dateLabel: dateLabel(x.nextDate) })} · <span className="num">{money(x.nextAmount)}</span>
                  </span> : t('nothing scheduled yet')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="widget-foot">
        {r.more > 0 && <span className="muted small">{t('{more} more', { more: r.more })}</span>}
        <span className="spacer" />
        <Link to="/debts" className="link-quiet">
          {t('Debts')} <Icon name="right" size={13} />
        </Link>
        <Link to="/installments" className="link-quiet">
          {t('Installments')} <Icon name="right" size={13} />
        </Link>
      </div>
    </div>
  );
}
