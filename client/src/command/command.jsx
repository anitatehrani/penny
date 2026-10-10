import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAssistant } from '../assistant/assistant.jsx';
import { api, qs } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { useFocusTrap } from '../components/ds/hooks.js';
import { Icon } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { dateLabel } from '../format.js';
import { useNotifications } from '../notifications.jsx';
import { ACCENTS, usePrefs } from '../prefs.jsx';
import { useQuick } from '../quick.jsx';
import { useAuth } from '../auth.jsx';
import { useTheme } from '../theme.js';
import { rank } from './fuzzy.js';

const Ctx = createContext({ openPalette: () => {} });
export const useCommand = () => useContext(Ctx);

/** Ctrl/⌘ + K opens the palette from anywhere. */
export function CommandProvider({ children }) {
  const [state, setState] = useState(null); // null | { query }
  const openPalette = useCallback((query = '') => setState({ query }), []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setState((s) => (s ? null : { query: '' }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ openPalette }), [openPalette]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {state && <Palette initialQuery={state.query} onClose={() => setState(null)} />}
    </Ctx.Provider>
  );
}

const GROUP_ORDER = ['Suggested', 'Payments', 'People', 'Actions', 'Go to', 'Appearance', 'Account', 'Ask'];

function Highlight({ text, indexes }) {
  if (!indexes?.length) return text;
  const set = new Set(indexes);
  return [...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch));
}

function Palette({ initialQuery, onClose }) {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { money } = useApp();
  const [theme, setTheme] = useTheme();
  const { prefs, setPrefs } = usePrefs();
  const { openAddPayment } = useQuick();
  const { openAssistant } = useAssistant();
  const { unread, reload } = useNotifications();

  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [people, setPeople] = useState([]);
  const [found, setFound] = useState([]); // payments matching the query
  const box = useRef(null);
  const input = useRef(null);
  const listId = useId();
  useFocusTrap(box, true);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    api
      .get('/connections')
      .then((c) => setPeople((c.accepted ?? []).map((x) => x.user)))
      .catch(() => {});
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const go = (to) => () => navigate(to);
  const commands = useMemo(
    () => [
      { id: 'add', group: 'Suggested', label: 'Add payment', icon: 'plus', keywords: 'new expense income create record spend', run: () => openAddPayment() },
      { id: 'ask', group: 'Suggested', label: 'Ask the assistant', icon: 'signal', keywords: 'ai question insight help chat', hint: 'Ctrl J', run: () => openAssistant() },
      { id: 'add-recurring', group: 'Actions', label: 'Add recurring payment', icon: 'repeat', keywords: 'subscription rent salary monthly weekly', run: go('/recurring?new=1') },
      { id: 'add-debt', group: 'Actions', label: 'Add a debt', icon: 'debt', keywords: 'owe loan borrowed friend pay back', run: go('/debts?new=1') },
      { id: 'add-owed-to-me', group: 'Actions', label: 'Someone owes me money', icon: 'debt', keywords: 'lent loan lend friend owes me pay me back reimburse', run: go('/debts?show=lent&new=1') },
      { id: 'add-installment', group: 'Actions', label: 'Add installment plan', icon: 'card', keywords: 'loan split pay later', run: go('/installments?new=1') },
      { id: 'customize', group: 'Actions', label: 'Customise dashboard', icon: 'layout', keywords: 'widgets rearrange hide resize layout', run: go('/?customize=1') },
      ...(unread > 0
        ? [
            {
              id: 'read-all',
              group: 'Actions',
              label: `Mark ${unread} notification${unread === 1 ? '' : 's'} as read`,
              icon: 'check',
              keywords: 'clear inbox',
              run: () => api.post('/notifications/read-all').then(reload).catch(() => {}),
            },
          ]
        : []),
      { id: 'g-dashboard', group: 'Go to', label: 'Dashboard', icon: 'home', keywords: 'home overview', run: go('/') },
      { id: 'g-payments', group: 'Go to', label: 'Payments', icon: 'list', keywords: 'transactions history', run: go('/payments') },
      { id: 'g-budget', group: 'Go to', label: 'Monthly budget', icon: 'target', keywords: 'budget limits spending plan categories how much left month over under', run: go('/budget') },
      { id: 'g-recurring', group: 'Go to', label: 'Recurring payments', icon: 'repeat', keywords: 'regular repeat', run: go('/recurring') },
      { id: 'g-subs', group: 'Go to', label: 'View subscriptions', icon: 'repeat', keywords: 'netflix spotify streaming recurring', run: go('/recurring') },
      { id: 'g-debts', group: 'Go to', label: 'Debts', icon: 'debt', keywords: 'owe loans borrowed lent owed to me', run: go('/debts') },
      { id: 'g-installments', group: 'Go to', label: 'Installments', icon: 'card', keywords: 'plans loans', run: go('/installments') },
      { id: 'g-forecast', group: 'Go to', label: 'Open forecast', icon: 'trend', keywords: 'future predict balance outlook projection', run: go('/forecast') },
      { id: 'g-people', group: 'Go to', label: 'People & shared budgets', icon: 'users', keywords: 'friends partner family groups connections', run: go('/people') },
      { id: 'g-settings', group: 'Go to', label: 'Settings', icon: 'gear', keywords: 'categories currency balance preferences', run: go('/settings') },
      ...(user?.is_admin ? [{ id: 'g-admin', group: 'Go to', label: 'Admin dashboard', icon: 'shield', keywords: 'admin users people sign-ups activity system health backups suspend', run: go('/admin') }] : []),
      { id: 'g-notif', group: 'Go to', label: 'Notifications', icon: 'bell', keywords: 'inbox alerts', run: go('/notifications') },
      { id: 'g-notif-settings', group: 'Go to', label: 'Notification settings', icon: 'bell', keywords: 'email alerts reminders preferences', run: go('/settings?tab=notifications') },
      { id: 'g-profile', group: 'Go to', label: 'Your profile', icon: 'user', keywords: 'avatar username share', run: go('/profile') },
      ...[
        ['light', 'Light', 'sun'],
        ['dark', 'Dark', 'moon'],
        ['system', 'System', 'monitor'],
      ].map(([v, l, icon]) => ({ id: `theme-${v}`, group: 'Appearance', label: `Theme: ${l}`, icon, keywords: 'change mode colour scheme', run: () => setTheme(v), current: theme === v })),
      { id: 'density', group: 'Appearance', label: prefs.density === 'compact' ? 'Use comfortable layout' : 'Use compact layout', icon: 'sliders', keywords: 'density spacing', run: () => setPrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' }) },
      { id: 'sidebar', group: 'Appearance', label: prefs.sidebar_collapsed ? 'Expand sidebar' : 'Collapse sidebar', icon: 'sidebar', keywords: 'navigation menu', run: () => setPrefs({ sidebar_collapsed: !prefs.sidebar_collapsed }) },
      ...ACCENTS.filter(([id]) => id !== prefs.accent).map(([id, name]) => ({ id: `accent-${id}`, group: 'Appearance', label: `Accent colour: ${name}`, icon: 'palette', keywords: 'color personalise', run: () => setPrefs({ accent: id }) })),
      { id: 'logout', group: 'Account', label: 'Sign out', icon: 'logout', keywords: 'log out exit', run: logout },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unread, theme, prefs.density, prefs.sidebar_collapsed, prefs.accent, user?.is_admin],
  );

  const q = query.trim();

  // payments that match what was typed (after a short pause)
  useEffect(() => {
    if (q.length < 2) {
      setFound([]);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .get(`/transactions${qs({ q, status: '' })}`)
        .then((rows) => alive && setFound(rows.slice(0, 5)))
        .catch(() => alive && setFound([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const results = useMemo(() => {
    const ranked = rank(q, commands).map((r) => ({ ...r.item, indexes: r.indexes }));
    let items;
    if (!q) {
      items = ranked;
    } else {
      const peopleHits = rank(q, people.map((p) => ({ label: p.name, keywords: p.username, person: p })))
        .slice(0, 4)
        .map((r) => ({ id: `person-${r.item.person.username}`, group: 'People', label: r.item.person.name, indexes: r.indexes, person: r.item.person, run: () => navigate(`/u/${r.item.person.username}`) }));
      const payHits = found.map((t) => ({
        id: `tx-${t.id}`,
        group: 'Payments',
        label: t.description,
        indexes: [],
        sub: `${dateLabel(t.date)} · ${t.type === 'income' ? '+' : '−'}${money(t.amount)}`,
        icon: 'list',
        run: () => navigate(`/payments${qs({ q: t.description, month: t.date.slice(0, 7), status: '' })}`),
      }));
      const search = { id: 'search', group: 'Payments', label: `Search payments for “${q}”`, icon: 'search', indexes: [], run: () => navigate(`/payments${qs({ q, status: '' })}`) };
      const askIt = { id: 'ask-q', group: 'Ask', label: `Ask the assistant: “${q}”`, icon: 'signal', indexes: [], run: () => openAssistant({ ask: q }) };
      const questionish = /\?$|^(how|what|why|when|will|can|do|am|is|where|which|give|show|tell)\b/i.test(q);
      items = questionish ? [askIt, ...ranked, ...peopleHits, ...payHits, search] : [...ranked, ...peopleHits, ...payHits, search, ...(q.length >= 4 && q.includes(' ') ? [askIt] : [])];
    }
    // group, keeping the order of first appearance when searching and the fixed order when browsing
    const byGroup = new Map();
    for (const it of items) byGroup.set(it.group, [...(byGroup.get(it.group) ?? []), it]);
    const order = q ? [...byGroup.keys()] : GROUP_ORDER.filter((g) => byGroup.has(g));
    return order.flatMap((g) => byGroup.get(g).map((it, i) => ({ ...it, first: i === 0 })));
  }, [q, commands, people, found, money, navigate, openAssistant]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const run = (item) => {
    if (!item) return;
    onClose();
    // let the palette close (and give focus back) before the action opens something else
    setTimeout(item.run, 0);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Home' && e.ctrlKey) setActive(0);
    else if (e.key === 'End' && e.ctrlKey) setActive(results.length - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    }
  };

  return createPortal(
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" ref={box} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search payments, people, pages… or ask a question"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search or run a command"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="palette-list" id={listId} role="listbox" aria-label="Results">
          {results.length === 0 && (
            <li className="palette-empty" role="presentation">
              Nothing matches “{q}”. Press Enter to ask the assistant instead.
            </li>
          )}
          {results.map((r, i) => (
            <li key={r.id} role="presentation">
              {r.first && (
                <div className="palette-group eyebrow" role="presentation">
                  {r.group}
                </div>
              )}
              <div id={`${listId}-${i}`} role="option" aria-selected={i === active} className={`palette-item${i === active ? ' active' : ''}`} onMouseMove={() => i !== active && setActive(i)} onClick={() => run(r)}>
                {r.person ? <Avatar user={r.person} size={22} showStatus={false} /> : <Icon name={r.icon ?? 'tag'} size={16} />}
                <span className="palette-label">
                  <span>
                    <Highlight text={r.label} indexes={r.indexes} />
                  </span>
                  {r.sub && <span className="muted small">{r.sub}</span>}
                </span>
                {r.current && <Icon name="check" size={14} />}
                {r.hint && <kbd className="kbd">{r.hint}</kbd>}
                {i === active && <Icon name="right" size={14} />}
              </div>
            </li>
          ))}
        </ul>
        <div className="palette-foot muted small">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to run
          </span>
          <span className="spacer" />
          <span>Tip: type a question to ask the assistant</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
