// The translator. Text in the code is English: t('Add payment'). The dictionary of the active language maps the English sentence to its translation;
// a sentence that is not in it is shown as written, so a missing translation is English, never a blank or a code (docs/DESIGN.md section 46).
import { LANGUAGES } from './core.js';

let lang = 'en';
let dict = null;
let rules = new Intl.PluralRules('en');

/** Make a language the active one. `dictionary` is null for English. */
export function activate(code, dictionary = null) {
  lang = code;
  dict = dictionary;
  rules = new Intl.PluralRules(code);
}
export const getLanguage = () => lang;
/** What dates and money are formatted with (undefined = the browser's own, for English). */
export const localeOf = () => LANGUAGES.find((l) => l.code === lang)?.locale;

const has = (text) => dict !== null && Object.hasOwn(dict, text);
const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

/** Translate a sentence. `{name}` marks a piece that changes: t('Hello {name}', { name }). */
export function t(text, vars) {
  const hit = has(text) ? dict[text] : text;
  return fill(typeof hit === 'string' ? hit : text, vars);
}

/**
 * Translate a count: tn(n, 'One payment', '{n} payments'). English uses the two forms; another language finds its own forms
 * in the dictionary under the second sentence, as { one, other } (some languages have more). {n} is always filled in.
 */
export function tn(n, one, other, vars) {
  const all = { n, ...vars };
  const entry = has(other) ? dict[other] : null;
  if (entry && typeof entry === 'object') return fill(entry[rules.select(n)] ?? entry.other ?? other, all);
  if (typeof entry === 'string') return fill(entry, all);
  return fill(n === 1 ? one : other, all);
}

/** Marks a sentence to be translated later (a label kept in a constant): it returns the English, and the tests see it. Show it with t(label). */
export const N_ = (text) => text;
