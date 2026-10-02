import { useEffect, useRef, useState } from 'react';

/** True while the media query matches (e.g. useMedia('(max-width: 820px)')). */
export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

/** Are we connected? Follows the browser's online/offline events. */
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** Call `handler` when a mousedown happens outside the element(s) held in `ref`, or Escape is pressed. */
export function useDismiss(ref, active, handler) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) h.current('outside');
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        h.current('escape');
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active]);
}

/** Keep Tab inside `ref` while it is open, and put focus back where it was when it closes. */
export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const opener = document.activeElement;
    const node = ref.current;
    const focusable = () => [...node.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (!node.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [ref, active]);
}
