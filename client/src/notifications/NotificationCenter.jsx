import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState } from '../components/ds/States.jsx';
import { useDismiss, useFocusTrap, useMedia } from '../components/ds/hooks.js';
import { Sheet } from '../components/ds/Sheet.jsx';
import { Tooltip } from '../components/ds/Tooltip.jsx';
import { GROUPS, KIND_ICON, KIND_TONE, groupOf } from '../components/notifMeta.js';
import { Icon, Skeleton } from '../components/ui.jsx';
import { timeAgo } from '../format.js';
import { useNotifications } from '../notifications.jsx';
import { useWorkspace } from '../workspace.jsx';
import { usePlain } from '../prefs.jsx';
import { localeOf, t } from '../i18n/translate.js';

const SHOW_FIRST = 3; // notifications per group before "Show more"

/** Bell + panel. A popover under the bell on large screens, a bottom sheet on phones. */
export default function NotificationCenter() {
  const { unread } = useNotifications();
  const small = useMedia('(max-width: 820px)');
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const root = useRef(null);
  const button = useRef(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useDismiss(root, open && !small, (why) => close(why === 'escape'));

  const label = unread ? t('Notifications, {unread} unread', { unread }) : t('Notifications');
  return (
    <div className="nc-root" ref={root}>
      <Tooltip label={t('Notifications')} side="bottom" disabled={open}>
        <button ref={button} className={`bell-btn${open ? ' open' : ''}${unread ? ' has-unread' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={label}>
          <Icon name="bell" size={20} />
          {unread > 0 && (
            <span className="bell-count" aria-hidden="true">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </Tooltip>
      {open && !small && (
        <div className="nc-panel" role="dialog" aria-label={t('Notifications')}>
          <CenterBody onClose={close} />
        </div>
      )}
      {open && small && (
        <Sheet title={t('Notifications')} label={t('Notifications')} onClose={() => close()} width={420}>
          <CenterBody onClose={close} inSheet />
        </Sheet>
      )}
    </div>
  );
}

function CenterBody({ onClose, inSheet }) {
  const { unread, reload, version } = useNotifications();
  const { switchTo, current } = useWorkspace();
  const plain = usePlain();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ items: null, error: false });
  const [expanded, setExpanded] = useState(() => new Set());
  const ref = useRef(null);
  useFocusTrap(ref, !inSheet);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/notifications?limit=40${filter === 'unread' ? '&status=unread' : ''}`);
      setState({ items: res.items, error: false });
      reload();
    } catch {
      setState((s) => ({ ...s, error: true }));
    }
  }, [filter, reload]);
  useEffect(() => {
    load();
  }, [load, version]);
  useEffect(() => {
    ref.current?.querySelector('.nc-tabs button')?.focus();
  }, []);

  const groups = useMemo(() => {
    if (!state.items) return [];
    return GROUPS.map((g) => ({ ...g, items: state.items.filter((n) => groupOf(n.kind) === g.id) }))
      .filter((g) => g.items.length)
      .sort((a, b) => b.items[0].id - a.items[0].id); // the group with the newest item first
  }, [state.items]);

  const patch = (id, fn) => setState((s) => ({ ...s, items: s.items.map((n) => (n.id === id ? fn(n) : n)) }));

  async function openItem(n) {
    try {
      if (!n.read_at) await api.post(`/notifications/${n.id}/read`);
    } catch {
      /* still go there */
    }
    reload();
    onClose(false);
    if (!n.link) return;
    if (n.data?.workspace_id && n.data.workspace_id !== current.id && !n.link.startsWith('/people')) switchTo(n.data.workspace_id);
    navigate(n.link);
  }
  async function toggleRead(n) {
    try {
      await api.post(`/notifications/${n.id}/${n.read_at ? 'unread' : 'read'}`);
      patch(n.id, (x) => ({ ...x, read_at: x.read_at ? null : new Date().toISOString() }));
      reload();
    } catch {
      /* the list stays as it was */
    }
  }
  async function remove(n) {
    try {
      await api.del(`/notifications/${n.id}`);
      setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== n.id) }));
      reload();
    } catch {
      /* ignore */
    }
  }
  async function markAll() {
    try {
      await api.post('/notifications/read-all');
      await load();
    } catch {
      /* ignore */
    }
  }
  async function markGroupRead(g) {
    await Promise.all(g.items.filter((n) => !n.read_at).map((n) => api.post(`/notifications/${n.id}/read`).catch(() => {})));
    await load();
  }

  return (
    <div className="nc" ref={ref}>
      <div className="nc-head">
        <div className="nc-title">
          <strong>{t('Notifications')}</strong>
          {unread > 0 && <span className="nc-unread-pill">{t('{unread} new', { unread })}</span>}
        </div>
        <div className="nc-tabs" role="group" aria-label={t('Show')}>
          {[
            ['all', t('All')],
            ['unread', t('Unread')],
          ].map(([v, l]) => (
            <button key={v} className={filter === v ? 'active' : ''} aria-pressed={filter === v} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="nc-body">
        {state.error && !state.items ? (
          <EmptyState art="offline" title={t('Could not load notifications')} compact>
            {t('Try again in a moment.')}
          </EmptyState>
        ) : !state.items ? (
          <div className="nc-skel" aria-busy="true" aria-label={t('Loading notifications')}>
            {[0, 1, 2, 3].map((i) => (
              <div className="nc-item" key={i}>
                <Skeleton w={32} h={32} r="50%" />
                <div className="nc-skel-text">
                  <Skeleton w="72%" />
                  <Skeleton w="45%" h={10} />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState art={filter === 'unread' ? 'calm' : 'bell'} title={filter === 'unread' ? (plain ? t('You are all caught up') : t('All caught up. Go do something fun.')) : t('Nothing here yet')} compact>
            {filter === 'unread' ? t('No unread notifications. Nice.') : t('Payment reminders, warnings and insights will gather here.')}
          </EmptyState>
        ) : (
          groups.map((g) => {
            const open = expanded.has(g.id);
            const shown = open ? g.items : g.items.slice(0, SHOW_FIRST);
            const groupUnread = g.items.filter((n) => !n.read_at).length;
            return (
              <section key={g.id} className="nc-group" aria-label={g.label}>
                <header className="nc-group-head">
                  <span className="eyebrow">{g.label}</span>
                  {groupUnread > 0 && <span className="nc-group-count">{groupUnread}</span>}
                  <span className="spacer" />
                  {groupUnread > 0 && (
                    <button className="nc-link" onClick={() => markGroupRead(g)}>
                      {t('Mark read')}
                    </button>
                  )}
                </header>
                <ul className="nc-list">
                  {shown.map((n) => (
                    <li key={n.id} className={`nc-row${n.read_at ? '' : ' unread'}`}>
                      <button className="nc-item" onClick={() => openItem(n)}>
                        <span className={`notif-icon sm ${KIND_TONE[n.kind] ?? ''}`} aria-hidden="true">
                          <Icon name={KIND_ICON[n.kind] ?? 'bell'} size={16} />
                        </span>
                        <span className="nc-text">
                          <span className="nc-item-title">
                            {!n.read_at && <span className="unread-dot" role="img" aria-label={t('Unread')} />}
                            {n.title}
                          </span>
                          {n.body && <span className="nc-item-body">{n.body}</span>}
                          <time className="nc-time" dateTime={n.created_at} title={new Date(n.created_at).toLocaleString(localeOf())}>
                            {timeAgo(n.created_at)}
                          </time>
                        </span>
                      </button>
                      <span className="nc-actions">
                        <button className="btn icon sm ghost" onClick={() => toggleRead(n)} aria-label={n.read_at ? t('Mark “{title}” as unread', { title: n.title }) : t('Mark “{title}” as read', { title: n.title })} title={n.read_at ? t('Mark unread') : t('Mark read')}>
                          <Icon name={n.read_at ? 'eyeOff' : 'check'} size={14} />
                        </button>
                        <button className="btn icon sm ghost danger-hover" onClick={() => remove(n)} aria-label={t('Delete “{title}”', { title: n.title })} title={t('Delete')}>
                          <Icon name="trash" size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {g.items.length > SHOW_FIRST && (
                  <button
                    className="nc-more"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((set) => {
                        const next = new Set(set);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      })
                    }
                  >
                    {open ? t('Show less') : t('Show {value} more', { value: g.items.length - SHOW_FIRST })}
                    <Icon name="chevron" size={14} />
                  </button>
                )}
              </section>
            );
          })
        )}
      </div>

      <div className="nc-foot">
        <button className="btn sm ghost" onClick={markAll} disabled={!unread}>
          <Icon name="check" size={14} /> {t('Mark all read')}
        </button>
        <span className="spacer" />
        <Link to="/settings?tab=notifications" className="btn icon sm ghost" aria-label={t('Notification settings')} title={t('Notification settings')} onClick={() => onClose(false)}>
          <Icon name="gear" size={16} />
        </Link>
        <Link to="/notifications" className="btn sm primary-soft" onClick={() => onClose(false)}>
          {t('View all')}
        </Link>
      </div>
    </div>
  );
}
