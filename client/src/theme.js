import { useEffect, useState } from 'react';

const KEY = 'theme'; // 'light' | 'dark' | 'system'

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
  else root.removeAttribute('data-theme');
}

export function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice just lasts for this page view */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event('theme-change'));
}

/** What the page actually looks like right now. */
export function effectiveTheme() {
  const pref = getThemePref();
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [pref, setPref] = useState(getThemePref);
  useEffect(() => {
    const sync = () => setPref(getThemePref());
    window.addEventListener('theme-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('theme-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [pref, setThemePref];
}
