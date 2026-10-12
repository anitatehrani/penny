import { useLocation } from 'react-router-dom';
import { useAssistant } from '../assistant/assistant.jsx';
import { useCommand } from '../command/command.jsx';
import { Tooltip } from '../components/ds/Tooltip.jsx';
import { LanguageQuick } from '../components/LanguageSwitch.jsx';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher.jsx';
import { Icon } from '../components/ui.jsx';
import NotificationCenter from '../notifications/NotificationCenter.jsx';
import { titleFor } from './nav.js';
import UserMenu from './UserMenu.jsx';
import { N_, t } from '../i18n/translate.js';

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : N_('Ctrl');

/**
 * The strip across the top: where you are, a single place to search / jump / run anything (Ctrl or ⌘ K),
 * the assistant, notifications and your account.
 */
export default function TopBar() {
  const { pathname } = useLocation();
  const { openPalette } = useCommand();
  const { openAssistant } = useAssistant();
  return (
    <header className="topbar">
      <div className="topbar-mobile-switcher">
        <WorkspaceSwitcher />
      </div>
      <span className="topbar-title eyebrow">{titleFor(pathname)}</span>
      <button className="search-trigger" onClick={() => openPalette()} aria-label={t('Search or run a command ({MOD} K)', { MOD })} aria-keyshortcuts="Control+K Meta+K">
        <Icon name="search" size={16} />
        <span className="search-text">{t('Search or run a command…')}</span>
        <span className="search-keys" aria-hidden="true">
          <kbd className="kbd">{MOD}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <div className="topbar-actions">
        <Tooltip label={t('Ask about my finances')} side="bottom">
          <button className="ask-btn" onClick={() => openAssistant()} aria-label={t('Ask about my finances')} aria-keyshortcuts="Control+J Meta+J">
            <Icon name="signal" size={18} />
            <span className="ask-label">{t('Ask')}</span>
          </button>
        </Tooltip>
        <LanguageQuick />
        <NotificationCenter />
        <UserMenu variant="avatar" />
      </div>
    </header>
  );
}
