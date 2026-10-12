import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ds/States.jsx';
import { Icon, Skeleton } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { describeRule } from '../../format.js';
import { monthlyEquivalent } from '../../recurrenceLogic.js';
import { t } from '../../i18n/translate.js';

const SUB = /subscri/i;
/** What you have committed to every month, biggest first, with subscriptions called out. */
export default function RecurringWidget({ rules }) {
  const { money } = useApp();
  const { list, total, subs, income } = useMemo(() => {
    const active = (rules ?? []).filter((r) => r.active && r.type === 'expense').map((r) => ({ ...r, perMonth: monthlyEquivalent(r) }));
    active.sort((a, b) => b.perMonth - a.perMonth);
    return {
      list: active,
      total: active.reduce((s, r) => s + r.perMonth, 0),
      subs: active.filter((r) => SUB.test(r.category_name ?? '')).reduce((s, r) => s + r.perMonth, 0),
      income: (rules ?? []).filter((r) => r.active && r.type === 'income').reduce((s, r) => s + monthlyEquivalent(r), 0),
    };
  }, [rules]);

  if (!rules) return <Skeleton w="100%" h={150} r={8} />;
  if (list.length === 0) {
    return (
      <EmptyState art="ledger" title={t('No recurring payments yet')} action={<Link className="btn sm" to="/recurring?new=1">{t('Add one')}</Link>}>
        {t('Rent, subscriptions, salary: add them once and they appear every month.')}
      </EmptyState>
    );
  }
  const top = list.slice(0, 5);
  const max = top[0].perMonth;
  return (
    <div className="recurring">
      <div className="recurring-lead">
        <div>
          <div className="eyebrow">{t('Fixed each month')}</div>
          <div className="recurring-total num">{money(total)}</div>
        </div>
        {subs > 0 && (
          <div>
            <div className="eyebrow">{t('Subscriptions')}</div>
            <div className="num recurring-subs">{money(subs)}</div>
          </div>
        )}
        {income > 0 && (
          <div>
            <div className="eyebrow">{t('Regular income')}</div>
            <div className="num pos">{money(income)}</div>
          </div>
        )}
      </div>
      <ul className="recurring-list">
        {top.map((r) => (
          <li key={r.id}>
            <Link to="/recurring" className="rec-row" title={describeRule(r)}>
              <span className="cat">
                <span className="dot" style={{ background: r.category_color ?? 'var(--ink-3)' }} />
                {r.description}
              </span>
              <span className="rec-bar" aria-hidden="true">
                <span style={{ width: `${(r.perMonth / max) * 100}%`, background: r.category_color ?? 'var(--ink-3)' }} />
              </span>
              <span className="num">{money(r.perMonth)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="widget-foot">
        <span className="muted small">
          {t('{length} active · weekly and yearly items shown per month', { length: list.length })}
        </span>
        <span className="spacer" />
        <Link to="/recurring" className="link-quiet">
          {t('Manage')} <Icon name="right" size={13} />
        </Link>
      </div>
    </div>
  );
}
