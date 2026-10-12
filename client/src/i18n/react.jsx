import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isLanguage, languageFromBrowser, splitLangPath, withLang } from './core.js';
import { activate, getLanguage, t } from './translate.js';

// Each language other than English is a separate file, fetched only when it is used.
const DICTIONARIES = { it: () => import('./it.js') };
const loaded = {};
async function dictionaryOf(code) {
  if (!DICTIONARIES[code]) return null;
  loaded[code] ??= (await DICTIONARIES[code]()).default;
  return loaded[code];
}

const KEY = 'lang';
export const rememberedLanguage = () => {
  try {
    const v = localStorage.getItem(KEY);
    return isLanguage(v) ? v : null;
  } catch {
    return null; // private mode: the choice lasts for this visit
  }
};
export const remember = (code) => {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
};
export const browserLanguage = () => languageFromBrowser(typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

/** Before anything is drawn: the address if it names a language, else what this browser remembers, else the browser's own. */
const firstLanguage = () => splitLangPath(window.location.pathname).lang ?? rememberedLanguage() ?? browserLanguage();

const Ctx = createContext({ lang: 'en', setLanguage: async () => {} });
export const useLang = () => useContext(Ctx);
/** The address of a public page in the language being shown: to('/terms') is '/it/terms' in Italian. */
export function useLocalPath() {
  const { lang } = useLang();
  return (path) => withLang(path, lang);
}

/**
 * Holds the language. Drawing waits for the dictionary (a blink, once, for Italian; nothing for English) so there is never a flash of English,
 * and changing the language draws everything below it again, so no part keeps the old words.
 */
export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const first = firstLanguage();
    return first === 'en' ? 'en' : null; // null: the dictionary is on its way
  });

  const setLanguage = useCallback(async (code, { save = true } = {}) => {
    if (!isLanguage(code)) return;
    const dict = await dictionaryOf(code);
    if (getLanguage() === code && lang === code) return;
    activate(code, dict);
    document.documentElement.lang = code;
    if (save) remember(code);
    setLang(code);
  }, [lang]);

  useEffect(() => {
    if (lang !== null) return;
    setLanguage(firstLanguage(), { save: false });
  }, [lang, setLanguage]);

  const value = useMemo(() => ({ lang: lang ?? 'en', setLanguage }), [lang, setLanguage]);
  if (lang === null) return null;
  // the key draws everything below again when the language changes
  return (
    <Ctx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </Ctx.Provider>
  );
}

/**
 * A translated sentence with pieces that are not text (a link, bold words): tRich('Read the {terms}.', { terms: <Link>terms</Link> }).
 * The pieces keep their place in the sentence whatever the language puts first.
 */
export function tRich(text, parts) {
  return t(text).split(/(\{\w+\})/).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return <Fragment key={i}>{m && parts && m[1] in parts ? parts[m[1]] : piece}</Fragment>;
  });
}
