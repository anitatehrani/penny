import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setActiveWorkspace } from './api.js';
import { useAuth } from './auth.jsx';
import { useFetch } from './hooks.js';
import { t } from './i18n/translate.js';

const Ctx = createContext(null);
export const useWorkspace = () => useContext(Ctx);

const storageKey = (userId) => `workspace:${userId}`;
const readSaved = (userId) => {
  try {
    return Number(localStorage.getItem(storageKey(userId))) || null;
  } catch {
    return null;
  }
};

const EMPTY_INBOX = { connection_requests: [], group_invites: [], shared_waiting: 0 };

/**
 * Knows every budget the user belongs to (personal + shared groups) and which one is open.
 * Switching changes the data every page loads and flips the UI into "shared budget" mode.
 */
export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const spaces = useFetch(() => api.get('/workspaces'), []);
  const inbox = useFetch(() => api.get('/inbox'), []);
  const [savedId, setSavedId] = useState(() => readSaved(user.id));

  // Keep the inbox badge and the list of budgets (new members, invitations accepted elsewhere) fresh.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      inbox.reload();
      spaces.reload();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = spaces.data ?? [];
  const current = list.find((w) => w.id === savedId) ?? list.find((w) => w.kind === 'personal') ?? null;
  const isGroup = current?.kind === 'group';

  setActiveWorkspace(current?.id ?? null); // idempotent; must be set before children fetch

  useEffect(() => {
    document.documentElement.dataset.mode = isGroup ? 'group' : 'personal';
    return () => {
      document.documentElement.dataset.mode = 'personal';
    };
  }, [isGroup]);

  const switchTo = useCallback(
    (id) => {
      try {
        localStorage.setItem(storageKey(user.id), String(id));
      } catch {
        /* ignore */
      }
      setSavedId(id);
    },
    [user.id],
  );

  const value = useMemo(
    () => ({
      spaces: list,
      current,
      isGroup,
      members: current?.members ?? [],
      switchTo,
      reloadSpaces: spaces.reload,
      inbox: inbox.data ?? EMPTY_INBOX,
      reloadInbox: inbox.reload,
      badge: (inbox.data?.connection_requests.length ?? 0) + (inbox.data?.group_invites.length ?? 0),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces.data, inbox.data, current?.id, switchTo],
  );

  if (spaces.error) return <div className="loading">{t('Cannot reach the server: {message}', { message: spaces.error.message })}</div>;
  if (!current) return <div className="loading">{t('Counting the pennies…')}</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
