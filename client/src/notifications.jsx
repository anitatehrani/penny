import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { t } from './i18n/translate.js';

const Ctx = createContext({ unread: 0, reload: () => {}, version: 0, settings: null, setSettings: () => {} });
export const useNotifications = () => useContext(Ctx);

const POLL_MS = 60_000;

/** Browser notifications (only used when the person turned them on and the browser allowed them). */
export const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Keeps the unread count for the bell fresh (every minute while the tab is visible, and when it becomes visible again),
 * and shows a desktop notification for new items if the person enabled that.
 */
export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ unread: 0, latest_id: null, latest_title: null });
  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState(0); // bumps when the list may have changed, so open pages can reload
  const seen = useRef(null);
  const settingsRef = useRef(null);
  settingsRef.current = settings;

  const reload = useCallback(async () => {
    try {
      const s = await api.get('/notifications/summary');
      setSummary((prev) => (prev.unread === s.unread && prev.latest_id === s.latest_id ? prev : s));
      if (seen.current !== null && s.latest_id && Number(s.latest_id) > seen.current) {
        setVersion((v) => v + 1);
        if (settingsRef.current?.browser_push && pushSupported() && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          try {
            new Notification(t('Penny'), { body: s.latest_title ?? t('You have a new notification'), tag: 'penny' });
          } catch {
            /* some browsers only allow this from a service worker */
          }
        }
      }
      if (s.latest_id) seen.current = Math.max(seen.current ?? 0, Number(s.latest_id));
      else if (seen.current === null) seen.current = 0;
    } catch {
      /* offline or signed out: keep the last count */
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    reload();
    api.get('/notifications/settings').then(setSettings).catch(() => {});
    const tick = () => document.visibilityState === 'visible' && reload();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [user, reload]);

  const value = useMemo(() => ({ unread: summary.unread, reload, version, settings, setSettings }), [summary.unread, reload, version, settings]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
