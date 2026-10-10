import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useInsights } from '../assistant/insights.jsx';
import { MonthNav } from '../components/ds/MonthPicker.jsx';
import { ErrorState } from '../components/ds/States.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Icon, Skeleton } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { addMonthsYM, currentMonth, monthLabel } from '../format.js';
import { useFetch } from '../hooks.js';
import { compareFromSummaries, dashboardBounds, dashboardMonth, forecastWindow } from '../monthLogic.js';
import { usePrefs, WIDGETS } from '../prefs.jsx';
import { useQuick } from '../quick.jsx';
import { useWorkspace } from '../workspace.jsx';
import FirstRun from './FirstRun.jsx';
import WidgetFrame from './WidgetFrame.jsx';
import BudgetWidget from './widgets/BudgetWidget.jsx';
import CashFlowWidget from './widgets/CashFlowWidget.jsx';
import HeroMonthWidget from './widgets/HeroMonthWidget.jsx';
import HeroWidget from './widgets/HeroWidget.jsx';
import InsightsWidget from './widgets/InsightsWidget.jsx';
import MonthPaymentsWidget from './widgets/MonthPaymentsWidget.jsx';
import PayingOffWidget from './widgets/PayingOffWidget.jsx';
import RecurringWidget from './widgets/RecurringWidget.jsx';
import SpendingWidget from './widgets/SpendingWidget.jsx';
import UpcomingWidget from './widgets/UpcomingWidget.jsx';

const TITLES = {
  hero: 'Balance',
  insights: 'Insights',
  upcoming: 'Coming up',
  spending: 'Spending',
  budget: 'Monthly budget',
  recurring: 'Recurring',
  paying: 'Paying off',
  outlook: 'Cash flow',
};
const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function DashboardSkeleton({ bare }) {
  return (
    <div className={bare ? undefined : 'dash'} aria-busy="true" aria-label="Loading your dashboard" role="status">
      <div className="dash-grid">
        <div className="widget size-l">
          <div className="hero hero-l">
            <div className="hero-figure">
              <Skeleton w={90} h={11} />
              <Skeleton w="62%" h={46} r={8} />
              <Skeleton w="80%" h={13} />
            </div>
            <div className="hero-chart">
              <Skeleton w="100%" h={176} r={8} />
            </div>
          </div>
        </div>
        <div className="widget size-l">
          <Skeleton w="100%" h={84} r={8} />
        </div>
        <div className="widget size-m">
          <Skeleton w="30%" h={14} />
          {[0, 1, 2, 3].map((i) => (
            <div className="skel-row" key={i}>
              <Skeleton w={52} h={30} />
              <Skeleton w="55%" h={14} />
              <span className="spacer" />
              <Skeleton w={64} h={14} />
            </div>
          ))}
        </div>
        <div className="widget size-m">
          <Skeleton w="30%" h={14} />
          <div className="skel-row">
            <Skeleton w={150} h={150} r="50%" />
            <div className="skel-col">
              <Skeleton w="100%" h={12} />
              <Skeleton w="85%" h={12} />
              <Skeleton w="70%" h={12} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The dashboard page. It loads the numbers, then lays out the widgets in the person's own order and sizes.
 * "Customise" turns each widget into something you can move, resize or hide; changes save by themselves.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const { isGroup, current } = useWorkspace();
  const { version, openAddPayment } = useQuick();
  const { layout, setPrefs, ready } = usePrefs();
  const { data: insightData } = useInsights();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState(params.get('customize') === '1');

  // The month is in the address (?month=2027-02), so it can be linked and the back button works. No month means this month.
  const today = currentMonth();
  const month = dashboardMonth(params.get('month'), today);
  const browsing = month !== today; // pointed at another month
  const bounds = dashboardBounds(today);
  const win = forecastWindow(today, month);
  const summary = useFetch(async () => ({ ...(await api.get(`/summary?month=${month}`)), requestedMonth: month }), [month, version]);
  const prevSummary = useFetch(() => (browsing ? api.get(`/summary?month=${addMonthsYM(month, -1)}`) : Promise.resolve(null)), [month, browsing, version]);
  const monthRows = useFetch(() => (browsing ? api.get(`/transactions?month=${month}&bought=1&limit=300`) : Promise.resolve(null)), [month, browsing, version]);
  const forecast = useFetch(() => api.get(`/forecast?past=${win.past}&months=${win.months}`), [win.past, win.months, version]);
  const rules = useFetch(() => api.get('/recurring'), [version]);
  const debts = useFetch(() => api.get('/debts'), [version]);
  const safe = useFetch(() => api.get('/safe-to-spend'), [version]);
  const plans = useFetch(() => api.get('/installments'), [version]);
  const setMonth = (m) => {
    const next = new URLSearchParams(params);
    if (m === today) next.delete('month');
    else next.set('month', m);
    setParams(next);
  };

  useEffect(() => {
    if (params.get('customize') === '1') {
      setEdit(true);
      const next = new URLSearchParams(params);
      next.delete('customize');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  // While customising, the dashboard is always today's, so every widget can be moved. Insights are about today, so another month leaves them out.
  const monthView = browsing && !edit;
  const visible = useMemo(() => layout.order.filter((w) => !layout.hidden.includes(w) && !(monthView && w === 'insights')), [layout, monthView]);
  const hidden = layout.order.filter((w) => layout.hidden.includes(w));

  const save = (next) => setPrefs({ layout: { order: next.order ?? layout.order, hidden: next.hidden ?? layout.hidden, sizes: next.sizes ?? layout.sizes } });
  const move = (id, dir) => {
    const order = [...layout.order];
    const vis = order.filter((w) => !layout.hidden.includes(w));
    const target = vis[vis.indexOf(id) + dir];
    if (!target) return;
    const a = order.indexOf(id);
    const b = order.indexOf(target);
    [order[a], order[b]] = [order[b], order[a]];
    save({ order });
  };
  const hide = (id) => save({ hidden: [...layout.hidden, id] });
  const show = (id) => save({ hidden: layout.hidden.filter((w) => w !== id) });
  const size = (id, s) => save({ sizes: { ...layout.sizes, [id]: s } });
  const reset = () => setPrefs({ layout: { order: WIDGETS.slice(), hidden: [], sizes: { hero: 'l', insights: 'l', upcoming: 'm', spending: 'm', budget: 'm', recurring: 'm', paying: 'm', outlook: 'm' } }, collapsed: [] });

  if (summary.error && !summary.data) return <ErrorState error={summary.error} onRetry={summary.reload} title="The dashboard did not load" />;
  if (!summary.data || !ready) return <DashboardSkeleton />;

  const s = summary.data;
  const firstTime = insightData?.empty;
  // The figures on screen are for another month: the person just chose a month and its numbers are on their way. (An ordinary refresh of
  // the same month keeps showing what it has, so the page does not blink.)
  const pending = summary.data.requestedMonth !== month;
  const compare = monthView && prevSummary.data !== undefined && !prevSummary.loading ? compareFromSummaries(s, prevSummary.data, month) : null;

  const controlsFor = (id) => {
    const i = visible.indexOf(id);
    return { canUp: i > 0, canDown: i < visible.length - 1, onUp: () => move(id, -1), onDown: () => move(id, 1), onHide: () => hide(id), size: layout.sizes[id], onSize: (v) => size(id, v) };
  };

  const render = (id) => {
    const sz = layout.sizes[id];
    const common = { id, size: sz, edit, controls: edit ? controlsFor(id) : null, label: TITLES[id] };
    switch (id) {
      case 'hero':
        return (
          <WidgetFrame key={id} {...common} collapsible={false} className="bare">
            {monthView ? <HeroMonthWidget month={month} forecast={forecast.data} size={sz} /> : <HeroWidget summary={s} forecast={forecast.data} safe={safe.data} size={sz} />}
          </WidgetFrame>
        );
      case 'insights':
        return (
          <WidgetFrame key={id} {...common} collapsible={false} className="bare">
            <InsightsWidget />
          </WidgetFrame>
        );
      case 'upcoming':
        return monthView ? (
          <WidgetFrame key={id} {...common} eyebrow={monthLabel(month)} title="Payments this month">
            <MonthPaymentsWidget month={month} rows={monthRows.data} />
          </WidgetFrame>
        ) : (
          <WidgetFrame key={id} {...common} eyebrow="Next 14 days" title="Coming up">
            <UpcomingWidget summary={s} />
          </WidgetFrame>
        );
      case 'spending':
        return (
          <WidgetFrame key={id} {...common} eyebrow={monthView ? monthLabel(month) : 'This month'} title="Where the money goes">
            <SpendingWidget compare={monthView ? compare : insightData?.compare} />
          </WidgetFrame>
        );
      case 'budget':
        return (
          <WidgetFrame key={id} {...common} eyebrow={monthLabel(month)} title="Monthly budget">
            <BudgetWidget month={month} version={version} />
          </WidgetFrame>
        );
      case 'recurring':
        return (
          <WidgetFrame key={id} {...common} eyebrow="Commitments" title="Recurring">
            <RecurringWidget rules={rules.data} />
          </WidgetFrame>
        );
      case 'paying':
        return (
          <WidgetFrame key={id} {...common} eyebrow="Debts and plans" title="Paying off">
            <PayingOffWidget debts={debts.data} plans={plans.data} />
          </WidgetFrame>
        );
      case 'outlook':
        return (
          <WidgetFrame key={id} {...common} eyebrow={monthView ? `Around ${monthLabel(month)}` : 'Past 4 months · next 3'} title="Cash flow">
            <CashFlowWidget forecast={forecast.data} month={monthView ? month : undefined} />
          </WidgetFrame>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`dash${edit ? ' is-editing' : ''}`}>
      <header className="dash-head">
        <Avatar user={user} size={44} showStatus={false} />
        <div className="dash-title">
          <h1>
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="muted">{isGroup ? `${current.name} · the group’s shared money` : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="dash-actions">
          <button className={`btn${edit ? ' primary-soft' : ' ghost'}`} onClick={() => setEdit((e) => !e)} aria-pressed={edit}>
            <Icon name="layout" size={16} /> {edit ? 'Done' : 'Customise'}
          </button>
          <button className="btn primary add-btn" onClick={() => openAddPayment()}>
            <Icon name="plus" /> Add payment
          </button>
        </div>
      </header>

      {!edit && !firstTime && (
        <div className="dash-monthbar">
          <MonthNav month={month} onChange={setMonth} min={bounds.min} max={bounds.max} />
          {browsing && (
            <p className="month-note muted" role="status">
              Showing <strong>{monthLabel(month)}</strong>
              {month > today ? ', a month still to come, so figures are expected' : ''}. Coming up, spending and cash flow follow the month; insights are about today.
            </p>
          )}
        </div>
      )}

      {edit && (
        <div className="customize-bar" role="region" aria-label="Customise dashboard">
          <p>
            <strong>Customising.</strong> Move, resize or hide widgets. It saves as you go and only changes your own dashboard.
          </p>
          <button className="btn sm" onClick={reset}>
            Reset layout
          </button>
        </div>
      )}

      {firstTime && !edit ? (
        <FirstRun rulesCount={rules.data?.length ?? 0} />
      ) : (
        <div aria-busy={pending || undefined}>{pending ? <DashboardSkeleton bare /> : <div className="dash-grid">{visible.map(render)}</div>}</div>
      )}

      {edit && hidden.length > 0 && (
        <div className="hidden-widgets" role="region" aria-label="Hidden widgets">
          <span className="eyebrow">Hidden</span>
          {hidden.map((id) => (
            <button key={id} className="chip" onClick={() => show(id)}>
              <Icon name="plus" size={12} /> {TITLES[id]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
