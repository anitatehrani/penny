import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { LANGUAGES, isLanguage, isPublicPath, languageFromBrowser, splitLangPath, wantedLanguage, withLang } from '../src/i18n/core.js';
import it_ from '../src/i18n/it.js';
import { N_, activate, getLanguage, localeOf, t, tn } from '../src/i18n/translate.js';

// The rules that choose and speak a language (docs/DESIGN.md section 46).
afterEach(() => activate('en', null));

describe('which language the browser asks for', () => {
  it('picks the first language Penny speaks, otherwise English', () => {
    assert.equal(languageFromBrowser(['it-IT', 'en']), 'it');
    assert.equal(languageFromBrowser(['fr-FR', 'it', 'en']), 'it');
    assert.equal(languageFromBrowser(['IT_it']), 'it');
    assert.equal(languageFromBrowser(['de-DE', 'fr']), 'en');
    assert.equal(languageFromBrowser([]), 'en');
    assert.equal(languageFromBrowser(undefined), 'en');
  });
  it('knows its languages', () => {
    assert.deepEqual(LANGUAGES.map((l) => l.code), ['en', 'it']);
    assert.ok(isLanguage('it') && isLanguage('en'));
    assert.ok(!isLanguage('fr') && !isLanguage('') && !isLanguage(null) && !isLanguage(undefined) && !isLanguage('IT'));
  });
});

describe('addresses with a language', () => {
  it('splits /it off the front, only when it is a whole part', () => {
    assert.deepEqual(splitLangPath('/it'), { lang: 'it', path: '/' });
    assert.deepEqual(splitLangPath('/it/'), { lang: 'it', path: '/' });
    assert.deepEqual(splitLangPath('/it/terms'), { lang: 'it', path: '/terms' });
    assert.deepEqual(splitLangPath('/it/guides/can-i-afford-it'), { lang: 'it', path: '/guides/can-i-afford-it' });
    assert.deepEqual(splitLangPath('/terms'), { lang: null, path: '/terms' });
    assert.deepEqual(splitLangPath('/'), { lang: null, path: '/' });
    assert.deepEqual(splitLangPath('/italy'), { lang: null, path: '/italy' }, 'a word that only starts with it');
    assert.deepEqual(splitLangPath('/items/it'), { lang: null, path: '/items/it' });
    assert.deepEqual(splitLangPath(undefined), { lang: null, path: '/' });
  });
  it('puts it back', () => {
    assert.equal(withLang('/', 'it'), '/it');
    assert.equal(withLang('/terms', 'it'), '/it/terms');
    assert.equal(withLang('/guides/x', 'it'), '/it/guides/x');
    assert.equal(withLang('/?a=1', 'it'), '/it?a=1');
    assert.equal(withLang('/terms', 'en'), '/terms', 'English has no prefix');
    assert.equal(withLang('/terms', 'xx'), '/terms');
    // and back again
    for (const p of ['/', '/terms', '/privacy', '/contact', '/guides', '/guides/can-i-afford-it']) assert.equal(splitLangPath(withLang(p, 'it')).path, p);
  });
  it('says which pages are public', () => {
    for (const p of ['/', '/terms', '/privacy', '/contact', '/guides', '/guides/can-i-afford-it']) assert.ok(isPublicPath(p), p);
    for (const p of ['/payments', '/login', '/settings', '/u/anita', '/reset-password']) assert.ok(!isPublicPath(p), p);
  });
});

describe('the language to show', () => {
  const base = { signedIn: false, saved: undefined, remembered: null, browser: 'en' };
  it('a public page follows its address, whatever the browser says', () => {
    assert.equal(wantedLanguage({ ...base, pathname: '/', browser: 'it', remembered: 'it' }), 'en');
    assert.equal(wantedLanguage({ ...base, pathname: '/terms', browser: 'it' }), 'en');
    assert.equal(wantedLanguage({ ...base, pathname: '/it', browser: 'en' }), 'it');
    assert.equal(wantedLanguage({ ...base, pathname: '/it/privacy', browser: 'en', remembered: 'en' }), 'it');
  });
  it('another page, signed out: the address, else what was remembered, else the browser', () => {
    assert.equal(wantedLanguage({ ...base, pathname: '/login', browser: 'it' }), 'it');
    assert.equal(wantedLanguage({ ...base, pathname: '/login', browser: 'it', remembered: 'en' }), 'en');
    assert.equal(wantedLanguage({ ...base, pathname: '/it/login', remembered: 'en' }), 'it');
    assert.equal(wantedLanguage({ ...base, pathname: '/login' }), 'en');
  });
  it('signed in: the saved choice, else what was remembered, else the browser', () => {
    const s = { ...base, signedIn: true };
    assert.equal(wantedLanguage({ ...s, pathname: '/', saved: 'it', remembered: 'en', browser: 'en' }), 'it');
    assert.equal(wantedLanguage({ ...s, pathname: '/', remembered: 'it', browser: 'en' }), 'it');
    assert.equal(wantedLanguage({ ...s, pathname: '/payments', browser: 'it' }), 'it');
    assert.equal(wantedLanguage({ ...s, pathname: '/it/payments', browser: 'en' }), 'en', 'the app has no address per language');
    assert.equal(wantedLanguage({ ...s, pathname: '/', saved: 'xx', remembered: 'zz', browser: 'xx' }), 'en');
  });
});

describe('t: the translator', () => {
  it('is the English itself until a language is active', () => {
    assert.equal(t('Add payment'), 'Add payment');
    assert.equal(t('Hello {name}', { name: 'Sam' }), 'Hello Sam');
    assert.equal(t('{a} and {b}', { a: 1, b: 2 }), '1 and 2');
    assert.equal(t('{missing} stays', {}), '{missing} stays');
    assert.equal(t('No pieces {here}'), 'No pieces {here}');
    assert.equal(getLanguage(), 'en');
    assert.equal(localeOf(), undefined, 'English keeps the browser’s own formats');
  });
  it('uses the dictionary, and shows the English for a sentence it does not have', () => {
    activate('it', { 'Add payment': 'Aggiungi un pagamento', 'Hello {name}': 'Ciao {name}' });
    assert.equal(t('Add payment'), 'Aggiungi un pagamento');
    assert.equal(t('Hello {name}', { name: 'Sam' }), 'Ciao Sam');
    assert.equal(t('Not translated yet'), 'Not translated yet');
    assert.equal(getLanguage(), 'it');
    assert.equal(localeOf(), 'it-IT');
  });
  it('is not fooled by words that every object has', () => {
    activate('it', { x: 'y' });
    for (const w of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) assert.equal(t(w), w);
  });
  it('does not use a plural entry as a plain sentence', () => {
    activate('it', { '{n} payments': { one: 'Un pagamento', other: '{n} pagamenti' } });
    assert.equal(t('{n} payments', { n: 3 }), '3 payments', 'the English is shown, filled in');
  });
  it('N_ marks a sentence without changing it', () => {
    assert.equal(N_('Blue'), 'Blue');
    activate('it', { Blue: 'Blu' });
    assert.equal(N_('Blue'), 'Blue');
    assert.equal(t(N_('Blue')), 'Blu', 'translated where it is shown');
  });
});

describe('tn: counts', () => {
  it('English uses one for 1 and the other form for everything else', () => {
    assert.equal(tn(1, '{n} payment', '{n} payments'), '1 payment');
    assert.equal(tn(0, '{n} payment', '{n} payments'), '0 payments');
    assert.equal(tn(2, '{n} payment', '{n} payments'), '2 payments');
    assert.equal(tn(5, '{n} payment of {x}', '{n} payments of {x}', { x: 'A' }), '5 payments of A');
  });
  it('Italian finds its forms in the dictionary under the English "other" sentence', () => {
    activate('it', { '{n} payments': { one: '{n} pagamento', other: '{n} pagamenti' } });
    assert.equal(tn(1, '{n} payment', '{n} payments'), '1 pagamento');
    assert.equal(tn(0, '{n} payment', '{n} payments'), '0 pagamenti');
    assert.equal(tn(7, '{n} payment', '{n} payments'), '7 pagamenti');
    assert.equal(tn(1000000, '{n} payment', '{n} payments'), '1000000 pagamenti', 'a form the language has but the dictionary does not falls back to "other"');
  });
  it('falls back to English when the dictionary has no entry', () => {
    activate('it', {});
    assert.equal(tn(1, '{n} thing', '{n} things'), '1 thing');
    assert.equal(tn(3, '{n} thing', '{n} things'), '3 things');
  });
});

describe('the Italian dictionary is usable by the translator', () => {
  it('translates a few known sentences, with their pieces', () => {
    activate('it', it_);
    assert.equal(t('Add a payment'), 'Aggiungi un pagamento');
    assert.equal(t('{d} days ago', { d: 3 }), '3 giorni fa');
    assert.equal(tn(1, '{n} payment', '{n} payments'), '1 pagamento');
    assert.equal(tn(4, '{n} payment', '{n} payments'), '4 pagamenti');
    assert.equal(t('Hello nobody'), 'Hello nobody');
  });
});
