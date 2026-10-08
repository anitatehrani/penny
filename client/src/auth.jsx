import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, impersonating: null, googleClientId: null, signupsOpen: true, error: null });

  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/auth/config'), api.get('/auth/me').catch(() => null)])
      .then(([config, me]) => alive && setState({ loading: false, user: me?.user ?? null, impersonating: me?.impersonating ?? null, googleClientId: config.googleClientId, signupsOpen: config.signupsOpen !== false, error: null }))
      .catch((error) => alive && setState((s) => ({ ...s, loading: false, error })));
    const expired = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener('auth:expired', expired);
    return () => {
      alive = false;
      window.removeEventListener('auth:expired', expired);
    };
  }, []);

  const setUser = useCallback((user) => setState((s) => ({ ...s, user, impersonating: null })), []);

  const value = useMemo(
    () => ({
      ...state,
      setUser,
      login: async (identifier, password) => setUser((await api.post('/auth/login', { identifier, password })).user),
      signup: async (fields) => setUser((await api.post('/auth/signup', fields)).user),
      loginWithGoogle: async (credential) => setUser((await api.post('/auth/google', { credential })).user),
      // An admin who is viewing as somebody goes back to their own account (the server does the same for "sign out").
      stopViewing: async () => {
        await api.post('/auth/impersonation/stop').catch(() => {}); // already over (it lasts 30 minutes): the reload shows the admin again
        window.location.assign('/admin?tab=people');
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        if (state.impersonating) return window.location.assign('/admin?tab=people');
        setUser(null);
      },
    }),
    [state, setUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
