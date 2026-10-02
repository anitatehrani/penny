import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Debounced "is this username free?" check for sign-up and profile forms. */
export function useUsernameCheck(username, current = null) {
  const [state, setState] = useState({ checking: false, available: true, reason: null });
  useEffect(() => {
    const u = username.trim().toLowerCase().replace(/^@/, '');
    if (!u || u === current) {
      setState({ checking: false, available: u === current, reason: null });
      return undefined;
    }
    setState((s) => ({ ...s, checking: true }));
    const t = setTimeout(() => {
      api
        .get(`/auth/username-available?u=${encodeURIComponent(u)}`)
        .then((r) => setState({ checking: false, available: r.available, reason: r.reason }))
        .catch(() => setState({ checking: false, available: true, reason: null }));
    }, 350);
    return () => clearTimeout(t);
  }, [username, current]);
  return state;
}

/** Run an async loader whenever `deps` change; keeps previous data while reloading. */
export function useFetch(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loaderRef
      .current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
