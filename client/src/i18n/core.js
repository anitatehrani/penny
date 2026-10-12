// Which languages Penny speaks, and the rules that choose one. Plain code with no React, so it can be tested on its own (docs/DESIGN.md section 46).

/** `locale` is what dates and money are formatted with; English keeps the browser's own format, as it always did. `switchTo` is said in the language it names. */
export const LANGUAGES = [
  { code: 'en', name: 'English', locale: undefined, switchTo: 'Switch to English' },
  { code: 'it', name: 'Italiano', locale: 'it-IT', switchTo: 'Passa all’italiano' },
];
export const CODES = LANGUAGES.map((l) => l.code);
export const isLanguage = (c) => typeof c === 'string' && CODES.includes(c);
/** The languages that have their own address prefix (/it/...). English has none. */
const PREFIXED = CODES.filter((c) => c !== 'en');

/** The first language in the browser's list that Penny speaks; English when none is. */
export function languageFromBrowser(list) {
  for (const raw of list ?? []) {
    const base = String(raw).toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** "/it/terms" is Italian "/terms"; "/it" is Italian "/". Anything else is English. */
export function splitLangPath(pathname) {
  const m = new RegExp(`^/(${PREFIXED.join('|')})(?=/|$)`).exec(pathname ?? '');
  if (!m) return { lang: null, path: pathname || '/' };
  return { lang: m[1], path: pathname.slice(m[0].length) || '/' };
}

/** The address of a page in a language: "/terms" is "/it/terms" in Italian. Only for the public pages, which have an address per language. */
export function withLang(path, lang) {
  if (!PREFIXED.includes(lang)) return path;
  if (path === '/') return `/${lang}`;
  if (/^\/[?#]/.test(path)) return `/${lang}${path.slice(1)}`;
  return `/${lang}${path}`;
}

/** The pages anybody can read without signing in: they have one address per language, and the address decides the language. */
export function isPublicPath(path) {
  return path === '/' || path === '/terms' || path === '/privacy' || path === '/contact' || path === '/guides' || path.startsWith('/guides/');
}

/**
 * The language to show.
 * - Signed in: the saved choice, else what this browser remembers, else the browser's language.
 * - A public page, signed out: the address decides (/it is Italian, the rest is English), so each address always has the same words.
 * - Any other page, signed out: the address if it says, else what this browser remembers, else the browser's language.
 */
export function wantedLanguage({ pathname, signedIn, saved, remembered, browser }) {
  const { lang: fromAddress, path } = splitLangPath(pathname);
  if (signedIn) return [saved, remembered, browser].find(isLanguage) ?? 'en';
  if (isPublicPath(path)) return fromAddress ?? 'en';
  return [fromAddress, remembered, browser].find(isLanguage) ?? 'en';
}
