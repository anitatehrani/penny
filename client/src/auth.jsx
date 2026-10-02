import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, googleClientId: null, error: null });

  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/auth/config'), api.get('/auth/me').catch(() => null)])
      .then(([config, me]) => alive && setState({ loading: false, user: me?.user ?? null, googleClientId: config.googleClientId, error: null }))
      .catch((error) => alive && setState((s) => ({ ...s, loading: false, error })));
    const expired = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener('auth:expired', expired);
    return () => {
      alive = false;
      window.removeEventListener('auth:expired', expired);
    };
  }, []);

  const setUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  const value = useMemo(
    () => ({
      ...state,
      setUser,
      login: async (email, password) => setUser((await api.post('/auth/login', { email, password })).user),
      signup: async (fields) => setUser((await api.post('/auth/signup', fields)).user),
      loginWithGoogle: async (credential) => setUser((await api.post('/auth/google', { credential })).user),
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        setUser(null);
      },
    }),
    [state, setUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
