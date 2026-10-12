import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { DEFAULT_LAYOUT, normalizeLayout, WIDGETS } from './prefsLogic.js';
import { N_, t } from './i18n/translate.js';

export { DEFAULT_LAYOUT, normalizeLayout, WIDGETS };

/**
 * Per-person interface choices (dashboard layout, density, accent colour, sidebar, favourites, avatar style).
 * They are kept in the account so they follow the person to another device, mirrored in localStorage so the
 * page looks right on the very first paint, and applied to <html> as data attributes the design tokens react to.
 */
export const ACCENTS = [
  ['blue', N_('Blue')],
  ['green', N_('Green')],
  ['violet', N_('Violet')],
  ['amber', N_('Amber')],
  ['rose', N_('Rose')],
  ['graphite', N_('Graphite')],
];
const DEFAULTS = { density: 'comfortable', accent: 'blue', sidebar_collapsed: false, favorites: [], avatar_style: 'photo', assistant_intro_seen: false };

const Ctx = createContext({ prefs: DEFAULTS, layout: DEFAULT_LAYOUT, setPrefs: () => {}, resetPrefs: () => {}, ready: true });
export const usePrefs = () => useContext(Ctx);

const cacheKey = (id) => `prefs:${id}`;
const readCache = (id) => {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(id)) || '{}');
  } catch {
    return {};
  }
};
const writeCache = (id, data) => {
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify(data));
  } catch {
    /* private mode: the choice lasts for this visit */
  }
};

export function PreferencesProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState(() => (user ? readCache(user.id) : {}));
  const [ready, setReady] = useState(false);
  const pending = useRef({});
  const timer = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    api
      .get('/preferences')
      .then((remote) => {
        if (!alive) return;
        setData(remote);
        writeCache(user.id, remote);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [user]);

  const prefs = useMemo(() => ({ ...DEFAULTS, ...data }), [data]);
  const layout = useMemo(() => normalizeLayout(data.layout), [data.layout]);

  // data attributes the tokens read
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = prefs.density;
    root.dataset.accent = prefs.accent;
    return () => {
      delete root.dataset.density;
      delete root.dataset.accent;
    };
  }, [prefs.density, prefs.accent]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    try {
      await api.put('/preferences', patch);
    } catch {
      /* the local copy still applies; the next change tries again */
    }
  }, []);

  // a change waiting to be saved is saved when this goes away (the language change draws everything again at once)
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush();
    },
    [flush],
  );

  const setPrefs = useCallback(
    (patch) => {
      setData((d) => {
        const next = { ...d, ...patch };
        if (user) writeCache(user.id, next);
        return next;
      });
      pending.current = { ...pending.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500); // many quick changes (e.g. reordering) are one save
    },
    [flush, user],
  );

  const resetPrefs = useCallback(async () => {
    clearTimeout(timer.current);
    pending.current = {};
    setData({});
    if (user) writeCache(user.id, {});
    try {
      await api.del('/preferences');
    } catch {
      /* ignore */
    }
  }, [user]);

  const value = useMemo(() => ({ prefs, layout, setPrefs, resetPrefs, ready }), [prefs, layout, setPrefs, resetPrefs, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
