import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { addMonthsYM, dateLabel, daysFromToday, describeRule, makeMoney, monthLabel, ordinal, relativeDay, todayYMD } from '../src/format.js';

describe('formatting', () => {
  it('money: signs, currency and compact form', () => {
    const m = makeMoney('USD');
    assert.equal(m(1234.5).replace(/ /g, ' '), '$1,234.50');
    assert.match(m(-5), /^−\$5\.00$/, 'a real minus sign');
    assert.match(m(0), /^\$0\.00$/);
    assert.equal(m(5, { signed: true }), '+$5.00');
    assert.equal(m(-5, { signed: true }), '−$5.00');
    assert.equal(m(0, { signed: true }), '$0.00');
    assert.equal(m.compact(2300), '$2.3K');
    assert.equal(m.compact(-1500), '−$1.5K');
    assert.equal(m.compact(0), '$0');
    assert.equal(m.compact(999), '$999');
    assert.equal(m.compact(1_000_000), '$1M');
    assert.equal(m(-0.004), '$0.00', 'rounds to zero, so no minus sign');
    assert.equal(m(0.004, { signed: true }), '$0.00', 'and no plus sign');
    assert.equal(m(-0.006), '−$0.01');
    assert.match(makeMoney('EUR')(1), /€/);
    assert.match(makeMoney('JPY')(1500), /¥|JP¥|JPY/);
  });

  it('ordinals', () => {
    const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31, 101, 111].map(ordinal);
    assert.deepEqual(got, ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th', '31st', '101st', '111th']);
  });

  it('month arithmetic crosses years both ways', () => {
    assert.equal(addMonthsYM('2026-12', 1), '2027-01');
    assert.equal(addMonthsYM('2026-01', -1), '2025-12');
    assert.equal(addMonthsYM('2026-05', 0), '2026-05');
    assert.equal(addMonthsYM('2026-05', 24), '2028-05');
    assert.equal(addMonthsYM('2026-05', -17), '2024-12');
  });

  it('describes recurring rules in plain words', () => {
    const r = (o) => ({ frequency: 'monthly', interval_count: 1, start_date: '2026-10-05', ...o });
    assert.equal(describeRule(r({})), 'Monthly on the 5th');
    assert.equal(describeRule(r({ start_date: '2026-10-22' })), 'Monthly on the 22nd');
    assert.equal(describeRule(r({ interval_count: 3 })), 'Every quarter on the 5th');
    assert.equal(describeRule(r({ interval_count: 2 })), 'Every 2 months on the 5th');
    assert.equal(describeRule(r({ frequency: 'weekly' })), `Weekly on ${new Date(2026, 9, 5).toLocaleDateString(undefined, { weekday: 'long' })}`);
    assert.match(describeRule(r({ frequency: 'weekly', interval_count: 2 })), /^Every 2 weeks on /);
    assert.match(describeRule(r({ frequency: 'yearly', start_date: '2026-12-14' })), /^Yearly on /);
    assert.match(describeRule(r({ frequency: 'yearly', interval_count: 2 })), /^Every 2 years on /);
  });

  it('dates are shown in local terms without timezone shifts', () => {
    assert.match(dateLabel('2026-01-01'), /1/);
    assert.match(monthLabel('2026-03'), /2026/);
    assert.notEqual(dateLabel('2026-03-01'), dateLabel('2026-02-28'));
  });

  it('relative days', () => {
    const shift = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    assert.equal(todayYMD(), shift(0));
    assert.equal(relativeDay(shift(0)), 'Today');
    assert.equal(relativeDay(shift(1)), 'Tomorrow');
    assert.equal(relativeDay(shift(-1)), 'Yesterday');
    assert.equal(relativeDay(shift(5)), 'In 5 days');
    assert.equal(relativeDay(shift(-5)), '5 days overdue');
    assert.equal(daysFromToday(shift(3)), 3);
    assert.equal(daysFromToday(shift(-30)), -30);
  });
});

describe('theme preference', () => {
  let store;
  let attrs;
  let events;
  beforeEach(() => {
    store = {};
    attrs = {};
    events = [];
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] };
    globalThis.document = {
      documentElement: {
        setAttribute: (k, v) => (attrs[k] = v),
        removeAttribute: (k) => delete attrs[k],
        get dataset() {
          return new Proxy({}, { set: (_, k, v) => ((attrs[`data-${k}`] = v), true), get: (_, k) => attrs[`data-${k}`] });
        },
      },
    };
    globalThis.window = { dispatchEvent: (e) => events.push(e.type), matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {} };
    globalThis.Event = class { constructor(type) { this.type = type; } };
  });
  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.document;
    delete globalThis.window;
  });

  it('defaults to following the system, remembers light/dark, and clears on system', async () => {
    const t = await import('../src/theme.js');
    assert.equal(t.getThemePref(), 'system');
    t.setThemePref('dark');
    assert.equal(store.theme, 'dark');
    assert.equal(attrs['data-theme'], 'dark');
    assert.equal(t.getThemePref(), 'dark');
    assert.equal(t.effectiveTheme(), 'dark');
    t.setThemePref('light');
    assert.equal(attrs['data-theme'], 'light');
    assert.equal(t.effectiveTheme(), 'light');
    t.setThemePref('system');
    assert.equal(store.theme, undefined);
    assert.equal(attrs['data-theme'], undefined, 'attribute removed so the OS preference applies');
    assert.equal(t.effectiveTheme(), 'dark', 'matchMedia says dark');
    assert.deepEqual(events, ['theme-change', 'theme-change', 'theme-change']);
  });

  it('ignores garbage in storage', async () => {
    const t = await import('../src/theme.js');
    for (const junk of ['blue', '', 'DARK', '1', 'null']) {
      store.theme = junk;
      assert.equal(t.getThemePref(), 'system', junk);
    }
  });

  it('survives storage being unavailable', async () => {
    const t = await import('../src/theme.js');
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    assert.equal(t.getThemePref(), 'system');
    t.setThemePref('dark');
    assert.equal(attrs['data-theme'], 'dark', 'still applies for this page view');
  });
});
