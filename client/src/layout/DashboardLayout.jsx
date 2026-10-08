import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { OfflineBanner } from '../components/ds/States.jsx';
import ViewingBanner from '../components/ViewingBanner.jsx';
import { Icon } from '../components/ui.jsx';
import { usePrefs } from '../prefs.jsx';
import { useWorkspace } from '../workspace.jsx';
import { titleFor } from './nav.js';
import MobileNav from './MobileNav.jsx';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import { AvatarStack } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

/**
 * The frame around every page: sidebar (collapsible), top bar, the page itself, and the bottom bar on phones.
 * It knows nothing about money; pages and widgets are passed in as children.
 */
export default function DashboardLayout({ children }) {
  const { prefs, setPrefs } = usePrefs();
  const { pathname } = useLocation();
  const { isGroup, current, members } = useWorkspace();
  const { user } = useAuth();
  const collapsed = prefs.sidebar_collapsed;

  useEffect(() => {
    document.title = `${titleFor(pathname)} · Penny`;
  }, [pathname]);

  const others = members.filter((m) => m.username !== user.username);
  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={() => setPrefs({ sidebar_collapsed: !collapsed })} />
      <div className="shell-main">
        <ViewingBanner />
        <OfflineBanner />
        <TopBar />
        <main className="main" id="main" tabIndex={-1}>
          {isGroup && (
            <div className="group-ribbon" role="status">
              <Icon name="users" size={16} />
              <span>
                Shared budget <strong>{current.name}</strong>. Everything here is shared with
              </span>
              <AvatarStack people={others} size={22} limit={5} />
              <span className="muted">{others.map((m) => m.name.split(' ')[0]).join(', ') || 'nobody else yet'}</span>
            </div>
          )}
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
