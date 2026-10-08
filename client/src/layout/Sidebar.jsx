import { NavLink } from 'react-router-dom';
import { Tooltip } from '../components/ds/Tooltip.jsx';
import { LogoMark, Wordmark } from '../components/Logo.jsx';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher.jsx';
import { Icon } from '../components/ui.jsx';
import { useInsights } from '../assistant/insights.jsx';
import { usePrefs } from '../prefs.jsx';
import { useWorkspace } from '../workspace.jsx';
import { useAuth } from '../auth.jsx';
import { ADMIN_NAV, NAV, navById } from './nav.js';
import UserMenu from './UserMenu.jsx';

/** The Admin link: only for admins, set apart under the other destinations, and not pinnable. */
function AdminItem({ collapsed }) {
  const link = (
    <NavLink to={ADMIN_NAV.to} className="nav-link" data-nav={ADMIN_NAV.icon} aria-label={collapsed ? ADMIN_NAV.label : undefined}>
      <span className="nav-icon">
        <Icon name={ADMIN_NAV.icon} size={18} />
      </span>
      {!collapsed && <span className="nav-label">{ADMIN_NAV.label}</span>}
    </NavLink>
  );
  return (
    <li className="nav-item">
      {collapsed ? (
        <Tooltip label={ADMIN_NAV.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

/** A small contextual marker on a nav item: a count, or a dot with a meaning. */
function Marker({ count, dot, tone, label }) {
  if (count > 0) {
    return (
      <span className={`nav-marker count ${tone ?? ''}`} aria-label={label}>
        {count > 99 ? '99+' : count}
      </span>
    );
  }
  if (dot) return <span className={`nav-marker dot ${tone ?? ''}`} role="img" aria-label={label} />;
  return null;
}

function NavItem({ item, collapsed, marker, pinned, onPin }) {
  const link = (
    <NavLink to={item.to} end={item.end} className="nav-link" data-nav={item.icon} aria-label={collapsed ? item.label : undefined}>
      <span className="nav-icon">
        <Icon name={item.icon} size={18} />
        {collapsed && marker}
      </span>
      {!collapsed && <span className="nav-label">{item.label}</span>}
      {!collapsed && marker}
    </NavLink>
  );
  return (
    <li className={`nav-item${pinned ? ' pinned' : ''}`}>
      {collapsed ? (
        <Tooltip label={item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        <>
          {link}
          <button className={`nav-pin${pinned ? ' on' : ''}`} onClick={() => onPin(item.id)} aria-pressed={pinned} aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label} to the top`} title={pinned ? 'Unpin' : 'Pin to top'}>
            <Icon name="star" size={13} />
          </button>
        </>
      )}
    </li>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  const { badge } = useWorkspace();
  const { user } = useAuth();
  const { overdueCount, hasForecastWarning } = useInsights();
  const { prefs, setPrefs } = usePrefs();
  const pinnedIds = prefs.favorites;

  const markerFor = (id) => {
    if (id === 'payments') return <Marker count={overdueCount} tone="neg" label={`${overdueCount} overdue payment${overdueCount === 1 ? '' : 's'}`} />;
    if (id === 'forecast') return <Marker dot={hasForecastWarning} tone="warn" label="The forecast shows a warning" />;
    if (id === 'people') return <Marker count={badge} tone="accent" label={`${badge} waiting`} />;
    return null;
  };
  const togglePin = (id) => setPrefs({ favorites: pinnedIds.includes(id) ? pinnedIds.filter((x) => x !== id) : [...pinnedIds, id] });
  const pinned = pinnedIds.map((id) => navById[id]).filter(Boolean);
  const rest = NAV.filter((n) => !pinnedIds.includes(n.id));

  const renderItem = (n, isPinned) => <NavItem key={n.id} item={n} collapsed={collapsed} marker={markerFor(n.id)} pinned={isPinned} onPin={togglePin} />;

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      <div className="brand">
        {collapsed ? <LogoMark size={30} /> : <Wordmark height={24} />}
        <span className="sr-only brand-name">Penny</span>
      </div>
      <WorkspaceSwitcher compact={collapsed} />
      <nav className="nav" aria-label="Main">
        {pinned.length > 0 && (
          <>
            {!collapsed && <div className="nav-heading eyebrow">Pinned</div>}
            <ul className="nav-list">{pinned.map((n) => renderItem(n, true))}</ul>
            <div className="nav-rule" role="presentation" />
          </>
        )}
        <ul className="nav-list">{rest.map((n) => renderItem(n, false))}</ul>
        {user?.is_admin && (
          <>
            <div className="nav-rule" role="presentation" />
            <ul className="nav-list" aria-label="Administration">
              <AdminItem collapsed={collapsed} />
            </ul>
          </>
        )}
      </nav>
      <div className="sidebar-foot">
        <Tooltip label={collapsed ? 'Expand sidebar' : ''} side="right">
          <button className="collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
            <Icon name={collapsed ? 'panelRight' : 'panelLeft'} size={18} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </Tooltip>
        <UserMenu variant="chip" collapsed={collapsed} />
      </div>
    </aside>
  );
}
