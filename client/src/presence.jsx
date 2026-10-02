import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

const Ctx = createContext({});

/** Who is around right now ({ username: { online, last_seen } }), refreshed once a minute while the tab is visible. */
export function PresenceProvider({ children }) {
  const { user } = useAuth();
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    const load = () => document.visibilityState === 'visible' && api.get('/presence').then((m) => alive && setMap(m)).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [user]);
  const value = useMemo(() => map, [map]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 'online' when that person is active right now and lets others see it, otherwise null. */
export function usePresenceOf(username) {
  const map = useContext(Ctx);
  return username && map[username]?.online ? 'online' : null;
}
