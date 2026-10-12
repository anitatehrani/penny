import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import it_ from '../src/i18n/it.js';
import { activate, t } from '../src/i18n/translate.js';
import { SRC, extractKeys, placeholders } from './helpers/i18nKeys.js';

// The Italian dictionary against the code that uses it (docs/DESIGN.md section 46): complete, nothing left over, the same pieces on both sides.
afterEach(() => activate('en', null));
const { keys, dynamic } = extractKeys();

// words that are the same in Italian (names, codes, units, words both languages use)
const SAME_AS_ENGLISH = new Set(['{m} min', '{h} h {value} min', 'Admin', 'Google', 'Password', 'Idea', 'Account', 'Ctrl J', 'Avatar', 'No', 'Email', 'PDF', 'File', 'Budget: {name}', '{round} KB', '{toFixed} MB', '{titleFor} · Penny', 'Penny', 'Ctrl', 'Database', 'Node', 'Privacy', 'Nov', 'Feb', 'Mar', 'Apr', 'Esselunga', 'Zara', 'Netflix', 'Uber', 'Budget', 'Tour', 'Fitness', '© {getFullYear} Penny', '{title} · Penny', 'Partner']);

const formsOf = (v) => (typeof v === 'string' ? [v] : [v.one, v.other]);

describe('the Italian dictionary', () => {
  it('has every sentence the app passes to the translator', () => {
    const missing = [...keys.keys()].filter((k) => !(k in it_));
    assert.deepEqual(missing.map((k) => `${k.slice(0, 80)}  (${keys.get(k).where[0]})`), []);
  });

  it('has nothing the app no longer uses', () => {
    const unused = Object.keys(it_).filter((k) => !keys.has(k));
    assert.deepEqual(unused.map((k) => k.slice(0, 80)), []);
  });

  it('gives a count its two forms, and a plain sentence a plain string', () => {
    for (const [k, v] of Object.entries(it_)) {
      const used = keys.get(k);
      if (!used) continue;
      if (used.plural) {
        assert.ok(v && typeof v === 'object' && typeof v.one === 'string' && typeof v.other === 'string', `a count needs one and other: ${k.slice(0, 70)}`);
      } else {
        assert.equal(typeof v, 'string', `a plain sentence is a string: ${k.slice(0, 70)}`);
      }
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

  it('has no empty entries, and keeps the spaces at the two ends that the English has (they sit between pieces)', () => {
    for (const [k, v] of Object.entries(it_)) {
      for (const form of formsOf(v)) {
        assert.ok(form.trim().length > 0, `empty: ${k.slice(0, 70)}`);
        assert.equal(/^\s/.test(form), /^\s/.test(k), `space at the start differs: ${JSON.stringify(k.slice(0, 40))}`);
        assert.equal(/\s$/.test(form), /\s$/.test(k), `space at the end differs: ${JSON.stringify(k.slice(-40))}`);
      }
    }
  });

  it('is not just a copy of the English, except for the few things that are the same in both', () => {
    const copies = Object.entries(it_).filter(([k, v]) => formsOf(v).every((f) => f === k) && !SAME_AS_ENGLISH.has(k)).map(([k]) => k);
    assert.deepEqual(copies, []);
  });

  it('uses the same quotation marks and apostrophes everywhere (’ and “ ”, not the typewriter ones)', () => {
    for (const v of Object.values(it_)) for (const f of formsOf(v)) assert.ok(!/['"]/.test(f), `typewriter quote in: ${f.slice(0, 80)}`);
  });

  it('uses no English-only words in the places an Italian reader sees', () => {
    // a few words that were easy to leave behind
    const bad = /\b(Settings|Payments|Dashboard|Installments?|Recurring|Overdue|Sign in|Sign out|Forecast)\b/;
    for (const [k, v] of Object.entries(it_)) for (const f of formsOf(v)) assert.ok(!bad.test(f), `English left in: ${f.slice(0, 80)}  (${k.slice(0, 40)})`);
  });
});

describe('the code', () => {
  it('only passes a variable to t() where a label kept in a constant is shown', () => {
    // each of these shows a sentence marked with N_ (or a word list in a constant); a new one must be looked at on purpose
    const files = [...new Set(dynamic.map((d) => d.split(':')[0]))].sort();
    assert.deepEqual(files, [
      'assistant/AiAnswers.jsx',
      'assistant/AssistantPanel.jsx',
      'categoryNames.js',
      'command/command.jsx',
      'components/AppearanceSettings.jsx',
      'components/ImportDialog.jsx',
      'components/NotificationSettings.jsx',
      'components/ui.jsx',
      'dashboard/WidgetFrame.jsx',
      'pages/Admin.jsx',
      'pages/Landing.jsx',
      'pages/Notifications.jsx',
      'pages/People.jsx',
      'pages/Settings.jsx',
      'pages/Transactions.jsx',
    ]);
  });

  it('never formats a date or a number in one fixed language', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'i18n') walk(p);
        } else if (/\.(jsx?|mjs)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          const re = /(toLocale(?:Date|Time)?String|NumberFormat|DateTimeFormat|PluralRules|RelativeTimeFormat)\(\s*(['"`])([a-z]{2}(?:-[A-Za-z]{2})?)\2/g;
          for (const m of src.matchAll(re)) offenders.push(`${path.relative(SRC, p)}: ${m[0]}`);
          if (/toLocale(?:Date|Time)?String\(\s*undefined/.test(src)) offenders.push(`${path.relative(SRC, p)}: formats with the browser's language, not the chosen one`);
        }
      }
    };
    walk(SRC);
    // the legal pages write a date in a fixed English style on purpose? No: they follow the language too.
    assert.deepEqual(offenders, []);
  });
});

describe('Italian in use', () => {
  it('turns the navigation, dates and rules of repetition into Italian', async () => {
    activate('it', it_);
    const { NAV } = await import('../src/layout/nav.js');
    assert.equal(NAV[0].label, 'Home');
    assert.equal(NAV.find((n) => n.id === 'payments').label, 'Pagamenti');
    assert.equal(NAV.find((n) => n.id === 'budget').label, 'Budget mensile');
    const { describeRule, monthLabel, ordinal, relativeDay, todayYMD } = await import('../src/format.js');
    assert.equal(monthLabel('2026-10'), 'ottobre 2026');
    assert.equal(ordinal(15), '15');
    assert.equal(describeRule({ frequency: 'monthly', interval_count: 1, start_date: '2026-10-15' }), 'Ogni mese il giorno 15');
    assert.equal(describeRule({ frequency: 'monthly', interval_count: 3, start_date: '2026-10-05' }), 'Ogni trimestre il giorno 5');
    assert.equal(relativeDay(todayYMD()), 'Oggi');
    const { makeMoney } = await import('../src/format.js');
    assert.match(makeMoney('EUR')(1234.5).replace(/\s/g, ' '), /^1\.234,50 €$/);
  });

  it('goes back to English completely', async () => {
    activate('it', it_);
    activate('en', null);
    const { NAV } = await import('../src/layout/nav.js');
    assert.equal(NAV[0].label, 'Dashboard');
    assert.equal(t('Add a payment'), 'Add a payment');
  });
});
