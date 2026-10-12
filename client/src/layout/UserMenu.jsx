import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar.jsx';
import AvatarPicker from '../components/avatar/AvatarPicker.jsx';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../components/ds/Menu.jsx';
import { Icon } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { LANGUAGES } from '../i18n/core.js';
import { useLang } from '../i18n/react.jsx';
import { usePrefs } from '../prefs.jsx';
import { useTheme } from '../theme.js';
import { t } from '../i18n/translate.js';

/**
 * The person menu: who you are, quick routes to profile / account / preferences / settings, theme, avatar, sign out.
 * `variant="avatar"` is the round button in the top bar; `variant="chip"` is the name + status row at the bottom of the sidebar.
 */
export default function UserMenu({ variant = 'avatar', collapsed = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const { prefs, setPrefs } = usePrefs();
  const { lang } = useLang();
  const [picking, setPicking] = useState(false);

  return (
    <>
      <Menu
        label={t('Your account')}
        align={variant === 'chip' ? 'start' : 'end'}
        placement={variant === 'chip' ? 'top' : 'bottom'}
        width={272}
        header={
          <>
            <div className="menu-profile">
              <Avatar user={user} size={44} status="online" />
              <div>
                <strong>{user.name}</strong>
                <div className="muted small">@{user.username}</div>
                <div className="menu-status">
                  <span className="dot-live" aria-hidden="true" /> {t('Active now')}
                </div>
              </div>
            </div>
            <div className="menu-sep" role="presentation" />
          </>
        }
        trigger={(props, open) =>
          variant === 'chip' ? (
            <button {...props} className={`user-chip-btn${open ? ' open' : ''}`} aria-label={t('Account menu for {name}', { name: user.name })}>
              <Avatar user={user} size={32} status="online" />
              {!collapsed && (
                <span className="user-chip-text">
                  <strong>{user.name}</strong>
                  <span className="muted small">@{user.username}</span>
                </span>
              )}
              {!collapsed && <Icon name="chevron" size={14} />}
            </button>
          ) : (
            <button {...props} className={`avatar-btn${open ? ' open' : ''}`} aria-label={t('Account menu for {name}', { name: user.name })}>
              <Avatar user={user} size={34} status="online" />
            </button>
          )
        }
      >
        <MenuItem icon="user" onSelect={() => navigate('/profile')}>
          {t('Profile')}
        </MenuItem>
        <MenuItem icon="shield" onSelect={() => navigate('/settings?tab=account')}>
          {t('Account')}
        </MenuItem>
        <MenuItem icon="sliders" onSelect={() => navigate('/settings?tab=appearance')}>
          {t('Preferences')}
        </MenuItem>
        <MenuItem icon="gear" onSelect={() => navigate('/settings')}>
          {t('Settings')}
        </MenuItem>
        <MenuItem icon="camera" onSelect={() => setPicking(true)}>
          {t('Change avatar')}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{t('Theme')}</MenuLabel>
        {[
          ['light', t('Light'), 'sun'],
          ['dark', t('Dark'), 'moon'],
          ['system', t('System'), 'monitor'],
        ].map(([value, label, icon]) => (
          <MenuItem key={value} icon={icon} role="menuitemradio" checked={theme === value} onSelect={() => setTheme(value)}>
            {label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>{t('Language')}</MenuLabel>
        {LANGUAGES.map((l) => (
          <MenuItem key={l.code} icon="globe" role="menuitemradio" checked={(prefs.language ?? lang) === l.code} onSelect={() => setPrefs({ language: l.code })}>
            {l.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon="logout" danger onSelect={logout}>
          {t('Sign out')}
        </MenuItem>
      </Menu>
      {picking && <AvatarPicker onClose={() => setPicking(false)} />}
    </>
  );
}
