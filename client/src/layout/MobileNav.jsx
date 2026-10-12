import { NavLink, useNavigate } from 'react-router-dom';
import { useAssistant } from '../assistant/assistant.jsx';
import { useInsights } from '../assistant/insights.jsx';
import { useCommand } from '../command/command.jsx';
import { Menu, MenuItem, MenuSeparator } from '../components/ds/Menu.jsx';
import { Icon } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useWorkspace } from '../workspace.jsx';
import { ADMIN_NAV, MOBILE_PRIMARY, NAV, navById } from './nav.js';
import { t } from '../i18n/translate.js';

/** Bottom tab bar for phones. The four most-used places, and "More" for the rest. */
export default function MobileNav() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { badge } = useWorkspace();
  const { overdueCount, hasForecastWarning } = useInsights();
  const { openAssistant } = useAssistant();
  const { openPalette } = useCommand();
  const marker = (id) => {
    if (id === 'payments' && overdueCount) return <span className="nav-marker count neg" aria-label={t('{overdueCount} overdue', { overdueCount })}>{overdueCount}</span>;
    if (id === 'people' && badge) return <span className="nav-marker count accent" aria-label={t('{badge} waiting', { badge })}>{badge}</span>;
    if (id === 'forecast' && hasForecastWarning) return <span className="nav-marker dot warn" role="img" aria-label={t('Forecast warning')} />;
    return null;
  };
  return (
    <nav className="mobile-nav" aria-label={t('Main')}>
      {MOBILE_PRIMARY.map((id) => {
        const n = navById[id];
        return (
          <NavLink key={id} to={n.to} end={n.end} className="mobile-tab">
            <span className="nav-icon">
              <Icon name={n.icon} size={22} />
              {marker(id)}
            </span>
            <span>{n.label}</span>
          </NavLink>
        );
      })}
      <Menu
        label={t('More')}
        align="end"
        placement="top"
        width={236}
        trigger={(props, open) => (
          <button {...props} className={`mobile-tab${open ? ' open' : ''}`} aria-label={t('More')}>
            <span className="nav-icon">
              <Icon name="grip" size={22} />
            </span>
            <span>{t('More')}</span>
          </button>
        )}
      >
        {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.id)).map((n) => (
          <MenuItem key={n.id} icon={n.icon} onSelect={() => navigate(n.to)}>
            {n.label}
          </MenuItem>
        ))}
        {user?.is_admin && (
          <MenuItem icon={ADMIN_NAV.icon} onSelect={() => navigate(ADMIN_NAV.to)}>
            {ADMIN_NAV.label}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon="bell" onSelect={() => navigate('/notifications')}>
          {t('All notifications')}
        </MenuItem>
        <MenuItem icon="signal" onSelect={() => openAssistant()}>
          {t('Ask about my finances')}
        </MenuItem>
        <MenuItem icon="search" onSelect={() => openPalette()}>
          {t('Search or run a command')}
        </MenuItem>
      </Menu>
    </nav>
  );
}
