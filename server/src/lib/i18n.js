// The words the server writes for people, in their language (docs/DESIGN.md section 46).
// Same idea as the client: the text in the code is English, t('Nothing is overdue.'), and the dictionary of the language maps it to its translation;
// a sentence that is not in it is shown as written. The language is not passed around: a request carries it (the X-Language header the app sends),
// and anything done for a person in the background (an e-mail, an alert) runs in that person's language with runWithLanguage().
import { AsyncLocalStorage } from 'node:async_hooks';
import it from '../i18n/it.js';

export const LANGUAGES = ['en', 'it'];
export const isLanguage = (c) => typeof c === 'string' && LANGUAGES.includes(c);
const DICTIONARIES = { it };
const LOCALES = { en: 'en-US', it: 'it-IT' };
const store = new AsyncLocalStorage();

export const currentLanguage = () => store.getStore()?.lang ?? 'en';
/** Run `fn` (and everything it waits for) in a language. */
export const runWithLanguage = (lang, fn) => store.run({ lang: isLanguage(lang) ? lang : 'en' }, fn);
/** What dates and money are formatted with. */
export const localeOf = () => LOCALES[currentLanguage()];

const dict = () => DICTIONARIES[currentLanguage()] ?? null;
const has = (d, text) => d !== null && Object.hasOwn(d, text);
const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

/** Translate a sentence. `{name}` marks a piece that changes: t('Hello {name}', { name }). */
export function t(text, vars) {
  const d = dict();
  const hit = has(d, text) ? d[text] : text;
  return fill(typeof hit === 'string' ? hit : text, vars);
}

/** A count: tn(n, 'One payment', '{n} payments'). English uses the two forms; another language finds its own under the second sentence. */
export function tn(n, one, other, vars) {
  const all = { n, ...vars };
  const d = dict();
  const entry = has(d, other) ? d[other] : null;
  if (entry && typeof entry === 'object') return fill(entry[new Intl.PluralRules(currentLanguage()).select(n)] ?? entry.other ?? other, all);
  if (typeof entry === 'string') return fill(entry, all);
  return fill(n === 1 ? one : other, all);
}

/** Marks a sentence that is translated later (kept in a constant): returns it unchanged. Show it with t(label). */
export const N_ = (text) => text;

/** The language a request asks for (the app sends X-Language), English when it does not say. */
export function languageOfRequest(req) {
  const h = req.get?.('x-language') ?? req.headers?.['x-language'];
  return isLanguage(h) ? h : 'en';
}

const remembered = new Map(); // userId -> { lang, until }: a scan writes many alerts for the same people
/** The language a person chose, for what is written for them while they are not looking (e-mails, alerts); English until they choose. */
export async function languageOfUser(userId) {
  if (!userId) return 'en';
  const hit = remembered.get(userId);
  if (hit && hit.until > Date.now()) return hit.lang;
  const { query } = await import('../db.js'); // loaded here, not at the top: the pieces that only need t() must not open a database connection just by being imported
  const { rows } = await query(`SELECT data->>'language' AS language FROM user_preferences WHERE user_id = $1`, [userId]);
  const lang = isLanguage(rows[0]?.language) ? rows[0].language : 'en';
  remembered.set(userId, { lang, until: Date.now() + 60_000 });
  return lang;
}
/** A person changed their language (or reset their choices): the next alert for them uses it at once. */
export const rememberLanguage = (userId, lang) => remembered.set(userId, { lang: isLanguage(lang) ? lang : 'en', until: Date.now() + 60_000 });

/** Run something for a person in their own language. */
export async function runForUser(userId, fn) {
  return runWithLanguage(await languageOfUser(userId), fn);
}

/** A question typed or chosen in another language, put back into the English the rules understand (the buttons are translated sentences). */
export function toEnglish(text) {
  const d = dict();
  if (!d) return text;
  const wanted = String(text).trim();
  for (const [en, v] of Object.entries(d)) if (v === wanted) return en;
  return text;
}

// ---- public addresses (/it/terms is the Italian /terms) ----
const PREFIXED = LANGUAGES.filter((c) => c !== 'en');
/** "/it/terms" is Italian "/terms"; "/it" is Italian "/". Anything else is English. */
export function splitLangPath(pathname) {
  const m = new RegExp(`^/(${PREFIXED.join('|')})(?=/|$)`).exec(pathname ?? '');
  if (!m) return { lang: 'en', path: pathname || '/' };
  return { lang: m[1], path: pathname.slice(m[0].length) || '/' };
}
/** The address of a public page in a language. */
export function withLang(path, lang) {
  if (!PREFIXED.includes(lang)) return path;
  return path === '/' ? `/${lang}` : `/${lang}${path}`;
}
