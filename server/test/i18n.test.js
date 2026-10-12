import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractKeys, placeholders } from '../../client/test/helpers/i18nKeys.js';
import it_ from '../src/i18n/it.js';
import { currentLanguage, isLanguage, languageOfRequest, localeOf, N_, runWithLanguage, t, tn } from '../src/lib/i18n.js';

// The words the server writes (docs/DESIGN.md section 46): the translator, and the Italian dictionary against the code that uses it.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const { keys, dynamic } = extractKeys(SRC);
const formsOf = (v) => (typeof v === 'string' ? [v] : [v.one, v.other]);
// the same in both languages
const SAME_AS_ENGLISH = new Set(['Idea', 'Fitness', 'Privacy', '{sign}{amount} in {name}']);

describe('the translator', () => {
  it('is English outside a request, and in a language only inside what runs in it', async () => {
    assert.equal(currentLanguage(), 'en');
    assert.equal(t('Not found'), 'Not found');
    await runWithLanguage('it', async () => {
      assert.equal(currentLanguage(), 'it');
      await new Promise((r) => setTimeout(r, 5)); // across a wait
      assert.equal(t('Not found'), 'Non trovato');
      assert.equal(localeOf(), 'it-IT');
    });
    assert.equal(currentLanguage(), 'en');
    assert.equal(localeOf(), 'en-US');
  });

  it('keeps two things that run at the same time in their own languages', async () => {
    const out = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        runWithLanguage(i % 2 ? 'it' : 'en', async () => {
          await new Promise((r) => setTimeout(r, (i * 7) % 11));
          return t('Not found');
        }),
      ),
    );
    out.forEach((s, i) => assert.equal(s, i % 2 ? 'Non trovato' : 'Not found'));
  });

  it('shows the English for a sentence it does not have, fills in the pieces, and is not fooled by words every object has', () => {
    runWithLanguage('it', () => {
      assert.equal(t('A sentence nobody translated, {n}', { n: 3 }), 'A sentence nobody translated, 3');
      for (const w of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(t(w), w);
    });
  });

  it('counts: English has two forms, Italian its own', () => {
    assert.equal(tn(1, '{n} payment', '{n} payments'), '1 payment');
    assert.equal(tn(0, '{n} payment', '{n} payments'), '0 payments');
    runWithLanguage('it', () => {
      assert.equal(tn(1, '{n} payment is overdue, {total} in total.', '{n} payments are overdue, {total} in total.', { total: '€5' }), '1 pagamento è in ritardo, €5 in tutto.');
      assert.equal(tn(3, '{n} payment is overdue, {total} in total.', '{n} payments are overdue, {total} in total.', { total: '€5' }), '3 pagamenti sono in ritardo, €5 in tutto.');
    });
  });

  it('N_ marks a sentence without changing it', () => {
    assert.equal(N_('Salary'), 'Salary');
    runWithLanguage('it', () => assert.equal(t(N_('Salary')), 'Stipendio'));
  });

  it('knows which languages it speaks, and reads the request header strictly', () => {
    assert.ok(isLanguage('it') && isLanguage('en') && !isLanguage('fr') && !isLanguage('IT') && !isLanguage(undefined));
    const req = (v) => ({ get: (n) => (n === 'x-language' ? v : undefined) });
    assert.equal(languageOfRequest(req('it')), 'it');
    assert.equal(languageOfRequest(req('en')), 'en');
    for (const bad of [undefined, '', 'fr', 'it-IT', 'IT', 'it, en', 'it\r\nx: y', '<script>']) assert.equal(languageOfRequest(req(bad)), 'en', String(bad));
  });
});

describe('the Italian dictionary of the server', () => {
  it('has every sentence the server writes', () => {
    const missing = [...keys.keys()].filter((k) => !(k in it_));
    assert.deepEqual(missing.map((k) => `${k.slice(0, 80)}  (${keys.get(k).where[0]})`), []);
  });

  it('has nothing the server no longer uses', () => {
    assert.deepEqual(Object.keys(it_).filter((k) => !keys.has(k)).map((k) => k.slice(0, 80)), []);
  });

  it('gives a count its two forms, and a plain sentence a plain string', () => {
    for (const [k, v] of Object.entries(it_)) {
      if (keys.get(k)?.plural) assert.ok(v && typeof v.one === 'string' && typeof v.other === 'string', `a count needs one and other: ${k.slice(0, 70)}`);
      else assert.equal(typeof v, 'string', `a plain sentence is a string: ${k.slice(0, 70)}`);
    }
  });

  it('keeps the same {pieces} as the English (a singular may leave out {n})', () => {
    for (const [k, v] of Object.entries(it_)) {
      const want = placeholders(k);
      formsOf(v).forEach((form, i) => {
        const got = placeholders(form);
        const isOne = typeof v !== 'string' && i === 0;
        for (const p of want) if (!(got.has(p) || (isOne && p === 'n'))) assert.fail(`{${p}} is missing in: ${form.slice(0, 80)}`);
        for (const p of got) if (!want.has(p)) assert.fail(`{${p}} does not exist in the English of: ${form.slice(0, 80)}`);
      });
    }
  });

  it('keeps the line breaks and the spaces at the ends that the English has (they matter in an e-mail and between pieces)', () => {
    for (const [k, v] of Object.entries(it_)) {
      for (const form of formsOf(v)) {
        assert.ok(form.trim().length > 0, `empty: ${k.slice(0, 70)}`);
        assert.equal((form.match(/\n/g) ?? []).length, (k.match(/\n/g) ?? []).length, `line breaks differ: ${k.slice(0, 50)}`);
        assert.equal(/^\s/.test(form), /^\s/.test(k), `space at the start differs: ${JSON.stringify(k.slice(0, 40))}`);
        assert.equal(/\s$/.test(form), /\s$/.test(k) && !/\n$/.test(k) ? true : /\s$/.test(k) && /\n$/.test(k), `space at the end differs: ${JSON.stringify(k.slice(-40))}`);
      }
    }
  });

  it('is not just a copy of the English, and leaves no English words behind in the usual places', () => {
    const copies = Object.entries(it_).filter(([k, v]) => formsOf(v).every((f) => f === k) && !SAME_AS_ENGLISH.has(k)).map(([k]) => k);
    assert.deepEqual(copies, []);
    const bad = /\b(Settings|Payments|Installments?|Overdue|Sign in|Forecast|your|you)\b/;
    for (const [k, v] of Object.entries(it_)) for (const f of formsOf(v)) assert.ok(!bad.test(f), `English left in: ${f.slice(0, 80)}`);
  });

  it('only passes a variable to t() in the few places that show a marked sentence', () => {
    assert.deepEqual([...new Set(dynamic.map((d) => d.split(':')[0]))].sort(), ['lib/accounts.js', 'lib/assistant.js', 'lib/categoryNames.js', 'lib/guidePages.js', 'lib/http.js', 'lib/seo.js', 'routes/auth.js', 'routes/insights.js']);
  });
});
