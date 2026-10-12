import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { describeAlert, saveAlertChoice } from '../components/Alerts.jsx';
import NotificationSettings from '../components/NotificationSettings.jsx';
import { KIND_ICON, KIND_TONE } from '../components/notifMeta.js';
import Select from '../components/ds/Select.jsx';
import { CategoryDot, Empty, ErrorBox, Icon, Loading } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { dateLabel, makeMoney, relativeDay, timeAgo, todayYMD } from '../format.js';
import { useNotifications } from '../notifications.jsx';
import { useWorkspace } from '../workspace.jsx';
import { N_, localeOf, t, tn } from '../i18n/translate.js';

const TABS = [
  ['inbox', N_('Inbox')],
  ['upcoming', N_('Upcoming & alerts')],
  ['settings', N_('Settings')],
];


const KIND_FILTERS = [
  ['', N_('All types')],
  ['payment_due', N_('Payments due')],
  ['payment_overdue', N_('Overdue')],
  ['balance_warning', N_('Low balance')],
  ['forecast_warning', N_('Forecast warnings')],
  ['ai_insight', N_('AI insights')],
  ['summary_weekly', N_('Weekly summaries')],
  ['summary_monthly', N_('Monthly summaries')],
  ['security', N_('Security')],
  ['connection_request', N_('Connection requests')],
  ['connection_accepted', N_('Accepted connections')],
  ['group_invite', N_('Group invitations')],
  ['group_change', N_('Group changes')],
  ['payment_shared', N_('Shared payments')],
  ['group_activity', N_('Group activity')],
  ['system', N_('Account')],
];

export default function Notifications() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'inbox';
  const { unread } = useNotifications();
  const setTab = (id) => setParams(id === 'inbox' ? {} : { tab: id }, { replace: true });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('Notifications')}</h1>
          <p className="muted">{t('Reminders for upcoming payments, requests from other people, and the alerts you chose.')}</p>
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label={t('Notification sections')}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="tab-panel" className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {t(label)}
            {id === 'inbox' && unread > 0 && <span className="tab-badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
        ))}
      </div>
      <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'inbox' && <Inbox />}
        {tab === 'upcoming' && <Upcoming />}
        {tab === 'settings' && <NotificationSettings />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ inbox */

/** Payment alerts carry the budget's name, invitations carry {id, name}. Only group names are worth showing. */
const workspaceName = (data) => {
  const w = data?.workspace;
  return typeof w === 'string' ? w : typeof w?.name === 'string' ? w.name : null;
};

function Inbox() {
  const { notify } = useApp();
  const { reload: reloadBell, version } = useNotifications();
  const { switchTo, current } = useWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = useState({ status: 'all', kind: '' });
  const [state, setState] = useState({ items: null, unread: 0, hasMore: false, error: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async ({ more = false } = {}) => {
      try {
        const before = more && state.items?.length ? state.items[state.items.length - 1].id : '';
        const res = await api.get(`/notifications${qs({ status: filter.status === 'unread' ? 'unread' : '', kind: filter.kind, before, limit: 30 })}`);
        setState((s) => ({ items: more ? [...(s.items ?? []), ...res.items] : res.items, unread: res.unread, hasMore: res.has_more, error: null }));
        reloadBell();
      } catch (error) {
        setState((s) => ({ ...s, error }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter.status, filter.kind],
  );
  useEffect(() => {
    load();
  }, [load, version]);

  const patch = (id, fn) => setState((s) => ({ ...s, items: s.items.map((n) => (n.id === id ? fn(n) : n)) }));

  async function mark(n, read) {
    try {
      await api.post(`/notifications/${n.id}/${read ? 'read' : 'unread'}`);
      patch(n.id, (x) => ({ ...x, read_at: read ? new Date().toISOString() : null }));
      setState((s) => ({ ...s, unread: Math.max(0, s.unread + (read ? -1 : 1)) }));
      reloadBell();
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function remove(n) {
    try {
      await api.del(`/notifications/${n.id}`);
      setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== n.id), unread: n.read_at ? s.unread : Math.max(0, s.unread - 1) }));
      reloadBell();
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function readAll() {
    setBusy(true);
    try {
      await api.post('/notifications/read-all');
      await load();
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  }
  async function clearRead() {
    if (!window.confirm(t('Delete all notifications you have already read?'))) return;
    setBusy(true);
    try {
      const r = await api.del('/notifications');
      notify(tn(r.deleted, '{n} notification deleted', '{n} notifications deleted'));
      await load();
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  }
  async function checkNow() {
    setBusy(true);
    try {
      const r = await api.post('/notifications/refresh');
      await load();
      notify(r.created ? tn(r.created, '{n} new notification', '{n} new notifications') : t('Nothing new right now'));
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  }

  function open(n) {
    if (!n.read_at) mark(n, true);
    if (!n.link) return;
    // payment and forecast links only make sense inside the budget they are about; the People page works from anywhere
    if (n.data?.workspace_id && n.data.workspace_id !== current.id && !n.link.startsWith('/people')) switchTo(n.data.workspace_id);
    navigate(n.link);
  }

  async function markPaid(n) {
    try {
      await api.in(n.data.workspace_id).patch(`/transactions/${n.data.transaction_id}/status`, { status: 'paid' });
      notify(n.data.type === 'income' ? t('Marked as received') : t('Marked as paid'));
      await load();
    } catch (e) {
      notify(e.message, 'error');
      await load();
    }
  }

  if (state.error && !state.items) return <ErrorBox error={state.error} />;
  if (!state.items) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label={t('Show')}>
          {[
            ['all', t('All')],
            ['unread', t('Unread{value}', { value: state.unread ? ` (${state.unread})` : '' })],
          ].map(([value, label]) => (
            <button key={value} className={`chip${filter.status === value ? ' active' : ''}`} onClick={() => setFilter((f) => ({ ...f, status: value }))}>
              {label}
            </button>
          ))}
        </div>
        <Select
          variant="inline"
          label={t('Type of notification')}
          value={filter.kind}
          onChange={(kind) => setFilter((f) => ({ ...f, kind }))}
          options={KIND_FILTERS.map(([v, l]) => ({ value: v, label: t(l) }))}
        />
        <span className="spacer" />
        <button className="btn sm" onClick={checkNow} disabled={busy} title={t('Look for newly due payments right now')}>
          <Icon name="repeat" size={14} /> {t('Check now')}
        </button>
        <button className="btn sm" onClick={readAll} disabled={busy || state.unread === 0}>
          <Icon name="check" size={14} /> {t('Mark all read')}
        </button>
        <button className="btn sm" onClick={clearRead} disabled={busy}>
          <Icon name="trash" size={14} /> {t('Clear read')}
        </button>
      </div>

      {state.items.length === 0 ? (
        <Empty title={filter.status === 'unread' ? t('All caught up. Go do something fun.') : t('No notifications yet')}>
          {filter.status === 'unread' ? t('Nothing unread.') : t('Reminders for upcoming payments and requests from other people will show up here. You can choose what you get under Settings.')}
        </Empty>
      ) : (
        <ul className="notif-list" aria-label={t('Notifications')}>
          {state.items.map((n) => (
            <li key={n.id} className={`notif${n.read_at ? '' : ' unread'} ${KIND_TONE[n.kind] ?? ''}`}>
              <span className={`notif-icon ${KIND_TONE[n.kind] ?? ''}`} aria-hidden="true">
                <Icon name={KIND_ICON[n.kind] ?? 'bell'} size={18} />
              </span>
              <div className="notif-main">
                <div className="notif-title">
                  {!n.read_at && <span className="unread-dot" role="img" aria-label={t('Unread')} />}
                  <strong>{n.title}</strong>
                  <time className="muted small" dateTime={n.created_at} title={new Date(n.created_at).toLocaleString(localeOf())}>
                    {timeAgo(n.created_at)}
                  </time>
                </div>
                {n.body && <p className="notif-body">{n.body}</p>}
                {workspaceName(n.data) && <span className="badge">{workspaceName(n.data)}</span>}
                {(n.kind === 'payment_due' || n.kind === 'payment_overdue') && !n.actionable && <span className="badge ok">{t('Settled — no longer due')}</span>}
                <div className="notif-actions">
                  {n.actionable && n.data?.transaction_id && (
                    <button className="btn sm primary-soft" onClick={() => markPaid(n)}>
                      <Icon name="check" size={14} /> {n.data.type === 'income' ? t('Mark received') : t('Mark paid')}
                    </button>
                  )}
                  {n.link && (
                    <button className="btn sm" onClick={() => open(n)}>
                      {n.kind === 'connection_request' || n.kind === 'group_invite' ? t('Review') : t('Open')}
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => mark(n, !n.read_at)}>
                    {n.read_at ? t('Mark unread') : t('Mark read')}
                  </button>
                  <button className="btn icon ghost danger-hover" onClick={() => remove(n)} aria-label={t('Delete notification: {title}', { title: n.title })} title={t('Delete')}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {state.hasMore && (
        <div className="center">
          <button className="btn" onClick={() => load({ more: true })}>
            {t('Show older')}
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ upcoming & alerts */

const MODE_OPTIONS = [
  ['default', N_('Default')],
  ['on', N_('Always')],
  ['off', N_('Never')],
];

function Upcoming() {
  const { notify } = useApp();
  const [state, setState] = useState({ data: null, overrides: [], error: null });
  const [alertsOnly, setAlertsOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, overrides] = await Promise.all([api.get('/alerts/upcoming?days=60'), api.get('/alerts/overrides')]);
      setState({ data, overrides, error: null });
    } catch (error) {
      setState((s) => ({ ...s, error }));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function setMode(item, mode) {
    try {
      await saveAlertChoice('transaction', item.id, { mode, days: item.own_days != null && mode === 'on' ? String(item.own_days) : '' });
      await load();
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function removeOverride(o) {
    try {
      await api.del(`/alerts/${o.target_type}/${o.target_id}`);
      await load();
      notify(t('Alert rule removed'));
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  const money = useMemo(() => new Map(), []);
  const fmt = (item) => {
    if (!money.has(item.currency)) money.set(item.currency, makeMoney(item.currency));
    return money.get(item.currency)(item.amount);
  };

  if (state.error && !state.data) return <ErrorBox error={state.error} />;
  if (!state.data) return <Loading />;
  const { defaults, items } = state.data;
  const shown = alertsOnly ? items.filter((i) => i.mode === 'on') : items;
  const today = todayYMD();

  return (
    <>
      {defaults.paused && (
        <div className="banner warn" role="status">
          <Icon name="bellOff" />
          <div>
            {t('Alerts are paused, so nothing below will notify you until you resume.')} <Link to="/notifications?tab=settings">{t('Change in settings')}</Link>
          </div>
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <h2>{t('Payments in the next 60 days')}</h2>
          <label className="check inline">
            <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} />
            <span>{t('Only ones that alert me')}</span>
          </label>
        </div>
        <p className="muted small">
          {t(defaults.include_income ? 'By default you are reminded {when} for every payment you still have to pay and every expected income.' : 'By default you are reminded {when} for every payment you still have to pay.', { when: defaults.lead_days === 0 ? t('on the day') : tn(defaults.lead_days, '{n} day before', '{n} days before') })}{' '}
          {t('Change that for a single payment here, or for a whole recurring item, installment plan or category from their own forms and lists.')}
        </p>
        {shown.length === 0 ? (
          <Empty title={t('Nothing to show')}>{alertsOnly ? t('No upcoming payment is set to alert you.') : t('You have no pending payments in this period.')}</Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('Upcoming payments and their alerts (scrolls sideways on small screens)')}>
            <table className="table alerts-table">
              <thead>
                <tr>
                  <th scope="col">{t('Due')}</th>
                  <th scope="col">{t('Payment')}</th>
                  <th scope="col" className="r">
                    {t('Amount')}
                  </th>
                  <th scope="col">{t('Alert')}</th>
                  <th scope="col">{t('Change')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{dateLabel(i.date)}</strong>
                      <div className={i.date < today ? 'neg small' : 'muted small'}>{relativeDay(i.date)}</div>
                    </td>
                    <td>
                      <div>{i.description}</div>
                      <div className="muted small tx-meta">
                        {i.category_name && <CategoryDot color={i.category_color} name={i.category_name} />}
                        {i.workspace_kind === 'group' && <span className="badge">{i.workspace}</span>}
                      </div>
                    </td>
                    <td className={`right num ${i.type === 'income' ? 'pos' : ''}`}>
                      {i.type === 'income' ? '+' : '−'}
                      {fmt(i)}
                    </td>
                    <td>
                      <span className={`badge ${i.mode === 'on' ? 'accent' : ''}`}>
                        <Icon name={i.mode === 'on' ? 'bell' : 'bellOff'} size={12} /> {describeAlert({ mode: i.mode, days: i.days, source: i.source_of_rule })}
                      </span>
                    </td>
                    <td>
                      <Select
                        variant="inline"
                        label={t('Alert for {description} on {date}', { description: i.description, date: i.date })}
                        value={i.own_mode ?? 'default'}
                        onChange={(v) => setMode(i, v)}
                        options={MODE_OPTIONS.map(([v, l]) => ({ value: v, label: t(l) }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Your alert rules')}</h2>
        </div>
        {state.overrides.length === 0 ? (
          <p className="muted">{t('You have not changed any alerts yet. Everything follows your default.')}</p>
        ) : (
          <ul className="rule-list">
            {state.overrides.map((o) => (
              <li key={`${o.target_type}:${o.target_id}`}>
                <span>
                  <strong>{o.label}</strong>
                  <span className="muted small"> · {{ transaction: t('one payment'), recurring: t('recurring item'), installment: t('installment plan'), category: 'category' }[o.target_type]}</span>
                </span>
                <span className={`badge ${o.mode === 'on' ? 'accent' : ''}`}>{o.mode === 'off' ? t('Never') : o.days != null ? tn(o.days, '{n} day before', '{n} days before') : t('Always')}</span>
                <button className="btn sm ghost" onClick={() => removeOverride(o)} aria-label={t('Remove the alert rule for {label}', { label: o.label })}>
                  {t('Reset')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
