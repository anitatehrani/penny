import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Bar } from '../../pages/Budget.jsx';
import { EmptyState } from '../../components/ds/States.jsx';
import { CategoryDot, Skeleton } from '../../components/ui.jsx';
import { useApp } from '../../context.jsx';
import { daysLeftText, headline, statusOf } from '../../budgetLogic.js';
import { monthLabel } from '../../format.js';
import { useFetch } from '../../hooks.js';
import { useWorkspace } from '../../workspace.jsx';
import { t } from '../../i18n/translate.js';

/**
 * The month against the budget in a corner of the dashboard: what is left, one bar, and the categories that need a look. The whole thing,
 * with every category and a place to change the budgets, is on the Monthly budget page.
 */
export default function BudgetWidget({ month, version }) {
  const { money } = useApp();
  const { current } = useWorkspace();
  const { data: view, error } = useFetch(() => api.get(`/budgets?month=${month}`), [month, version, current?.id]);

  if (error && !view) return <p className="muted small">{t('The budget could not be loaded just now.')}</p>;
  if (!view) return <Skeleton w="100%" h={120} r={8} />;
  if (view.budgetedCount === 0) {
    return (
      <EmptyState art="chart" title={t('No monthly budget yet')} action={<Link className="btn sm primary" to="/budget">{t('Plan your month')}</Link>}>
        {t('Give each category an amount, and see how much of it is spent along the way.')}
      </EmptyState>
    );
  }
  const tt = view.totals;
  const top = headline(view, money);
  const watch = view.lines.filter((l) => ['over', 'heading-over', 'close'].includes(l.status)).slice(0, 3);
  return (
    <div className="bud-widget">
      <div>
        <span className="eyebrow">{top.label}</span>
        <div className={`bud-big num ${top.tone}`}>{top.value}</div>
        <p className="muted small">
          {t('{money} spent of {money2}', { money: money(tt.spent), money2: money(tt.budget) })}
          {view.phase === 'current' ? ` · ${daysLeftText(view)}` : ''}
        </p>
      </div>
      <Bar line={{ budget: tt.budget, spent: tt.spent, planned: tt.planned }} elapsed={view.elapsed} label={t('{money} spent of {money2}, {money3} planned.', { money: money(tt.spent), money2: money(tt.budget), money3: money(tt.planned) })} />
      {watch.length > 0 ? (
        <ul aria-label={t('Categories to watch')}>
          {watch.map((l) => {
            const st = statusOf(l.status, view.phase);
            return (
              <li key={l.id}>
                <CategoryDot color={l.color} name={l.name} />
                <span className={`bud-chip ${st.tone}`}>{st.label}</span>
                <span className="bud-nums num muted">
                  {t('{money} of {money2}', { money: money(l.spent), money2: money(l.budget) })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">{view.phase === 'past' ? t('Every category is on track (the month is over) for {month}.', { month: monthLabel(month, { month: 'long' }) }) : t('Every category is on track for {month}.', { month: monthLabel(month, { month: 'long' }) })}</p>
      )}
      <Link className="btn sm" to={`/budget${view.phase === 'current' ? '' : `?month=${month}`}`}>
        {t('Open the monthly budget')}
      </Link>
    </div>
  );
}
