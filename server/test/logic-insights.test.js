import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCompare, buildInsights, buildSummary, makeFmt, monthName } from '../src/lib/insights.js';

/** Facts for a plain mid-month budget; each test changes only what it is about. */
const facts = (over = {}) => ({
  today: '2026-10-15',
  month: '2026-10',
  prevMonth: '2026-09',
  dayOfMonth: 15,
  daysInMonth: 31,
  currency: 'USD',
  isEmpty: false,
  categories: [],
  totals: { expenseCur: 0, expensePaidCur: 0, expensePrev: 0, mtdExpenseCur: 0, mtdExpensePrev: 0, paidCount: 0, incomeCur: 0, incomePaidCur: 0, incomePrev: 0 },
  subscriptions: { cur: 0, prev: 0, items: [], monthlyTotal: 0 },
  upcoming: [],
  overdue: { count: 0, total: 0, items: [] },
  balance: { current: 1000, endOfMonth: 900, firstNegative: null, lowest: null },
  ...over,
});
const cat = (name, o = {}) => ({ id: 1, name, color: '#123456', cur: 0, curPaid: 0, prev: 0, mtdCur: 0, mtdPrev: 0, avg3: 0, history: {}, ...o });
const types = (f) => buildInsights(f).map((i) => i.type);

describe('money wording', () => {
  it('drops cents on whole or large amounts and keeps them on small odd ones', () => {
    const f = makeFmt('USD');
    assert.equal(f(0), '$0');
    assert.equal(f(90), '$90');
    assert.equal(f(12.4), '$12.40');
    assert.equal(f(1240.5), '$1,241');
    assert.equal(f(-487.28), '−$487'.replace('−', '-'));
    assert.equal(makeFmt('EUR')(38), '€38');
    assert.equal(makeFmt('NOPE!')(5), '5 NOPE!', 'a bad currency code falls back to plain text instead of throwing');
  });
  it('names months', () => {
    assert.equal(monthName('2027-02'), 'February');
    assert.equal(monthName('2027-02', { year: true }), 'February 2027');
  });
});

describe('spending pace', () => {
  const pace = (cur, prev, day = 15) => buildInsights(facts({ dayOfMonth: day, totals: { ...facts().totals, mtdExpenseCur: cur, mtdExpensePrev: prev }, categories: [cat('Dining', { mtdCur: cur, mtdPrev: prev })] })).find((i) => i.type === 'spend-pace');

  it('reports spending that is higher than at this point last month', () => {
    const i = pace(560, 500);
    assert.equal(i.title, 'Your spending is 12% higher than last month');
    assert.equal(i.severity, 'watch');
    assert.match(i.body, /\$560/);
    assert.match(i.body, /\$500/);
    assert.equal(i.details[0].label, 'Dining');
    assert.equal(i.details[0].tone, 'neg');
  });
  it('is good news when spending is lower', () => {
    const i = pace(400, 500);
    assert.equal(i.title, 'You are spending 20% less than last month');
    assert.equal(i.severity, 'good');
  });
  it('stays quiet for small differences, tiny bases and the first days of a month', () => {
    assert.equal(pace(520, 500), undefined, '4% is noise');
    assert.equal(pace(90, 40), undefined, 'last month too small to compare');
    assert.equal(pace(900, 500, 3), undefined, 'too early in the month');
  });
});

describe('forecast and balance', () => {
  it('warns about the first negative month, with a rising urgency when it is close', () => {
    const near = buildInsights(facts({ balance: { current: 300, endOfMonth: 100, firstNegative: { month: '2026-12', balance: -150 }, lowest: { month: '2027-01', balance: -400 } } })).find((i) => i.type === 'forecast-negative');
    assert.equal(near.title, 'You may run below $0 in December');
    assert.equal(near.severity, 'alert');
    assert.match(near.body, /bottoms out at -\$400 in January/);
    const far = buildInsights(facts({ balance: { current: 300, endOfMonth: 100, firstNegative: { month: '2027-06', balance: -150 }, lowest: { month: '2027-06', balance: -150 } } })).find((i) => i.type === 'forecast-negative');
    assert.equal(far.severity, 'watch');
    assert.match(far.title, /June 2027/);
  });
  it('talks about now, not the future, when already below zero', () => {
    const list = buildInsights(facts({ balance: { current: -50, endOfMonth: -80, firstNegative: { month: '2026-10', balance: -50 }, lowest: null } }));
    assert.deepEqual(list.map((i) => i.type), ['below-zero']);
    assert.equal(list[0].severity, 'alert');
  });
  it('has nothing to say when all is well', () => {
    assert.deepEqual(types(facts()), []);
  });
});

describe('the week ahead', () => {
  const up = (n, amount = 40) => Array.from({ length: n }, (_, i) => ({ id: i, description: `Bill ${i}`, amount, date: `2026-10-${16 + i}` }));
  it('groups three or more payments, using words for small counts', () => {
    const i = buildInsights(facts({ upcoming: up(3) })).find((x) => x.type === 'week-ahead');
    assert.equal(i.title, 'Three upcoming payments ($120) may affect your balance next week');
    assert.equal(i.severity, 'info');
    assert.equal(i.details.length, 3);
  });
  it('escalates when the balance would go negative or most of it goes', () => {
    const neg = buildInsights(facts({ balance: { current: 100, endOfMonth: 0, firstNegative: null, lowest: null }, upcoming: up(3) })).find((x) => x.type === 'week-ahead');
    assert.equal(neg.severity, 'alert');
    assert.match(neg.body, /would be -\$20/);
    const watch = buildInsights(facts({ balance: { current: 300, endOfMonth: 0, firstNegative: null, lowest: null }, upcoming: up(3) })).find((x) => x.type === 'week-ahead');
    assert.equal(watch.severity, 'watch');
  });
  it('speaks up for a single payment only when it would overdraw', () => {
    assert.equal(types(facts({ upcoming: up(1, 40) })).includes('week-ahead'), false);
    assert.equal(types(facts({ balance: { current: 30, endOfMonth: 0, firstNegative: null, lowest: null }, upcoming: up(1, 40) })).includes('week-ahead'), true);
  });
  it('ignores payments further out than seven days', () => {
    const far = [{ id: 1, description: 'a', amount: 10, date: '2026-10-29' }, { id: 2, description: 'b', amount: 10, date: '2026-10-29' }, { id: 3, description: 'c', amount: 10, date: '2026-10-29' }];
    assert.equal(types(facts({ upcoming: far })).includes('week-ahead'), false);
  });
});

describe('subscriptions, spikes and savings', () => {
  it('flags subscriptions that grew by a noticeable amount only', () => {
    const grew = buildInsights(facts({ subscriptions: { cur: 78, prev: 40, items: [{ description: 'Video', amount: 20, monthly: 20 }], monthlyTotal: 78 } })).find((i) => i.type === 'subscriptions');
    assert.equal(grew.title, 'Your subscriptions increased by $38 this month');
    assert.equal(types(facts({ subscriptions: { cur: 42, prev: 40, items: [], monthlyTotal: 42 } })).includes('subscriptions'), false);
    assert.equal(types(facts({ subscriptions: { cur: 50, prev: 0, items: [], monthlyTotal: 50 } })).includes('subscriptions'), false, 'a first month is not an increase');
  });
  it('finds one category far above its usual level', () => {
    const i = buildInsights(facts({ categories: [cat('Shopping', { mtdCur: 300, avg3: 150 }), cat('Rent', { mtdCur: 900, avg3: 900 })] })).find((x) => x.type === 'category-spike');
    assert.equal(i.title, 'Shopping is 100% above your usual');
    assert.equal(types(facts({ categories: [cat('Shopping', { mtdCur: 170, avg3: 150 })] })).includes('category-spike'), false);
  });
  it('estimates savings from everyday categories only, never essentials, and labels it an estimate', () => {
    const i = buildInsights(facts({ categories: [cat('Dining & leisure', { avg3: 400 }), cat('Rent / Mortgage', { avg3: 1500 }), cat('Shopping', { avg3: 100 }), cat('Health', { avg3: 200 })] })).find((x) => x.type === 'savings');
    assert.equal(i.title, 'You could save about $75 a month');
    assert.deepEqual(i.details.map((d) => d.label), ['Dining & leisure', 'Shopping']);
    assert.match(i.body, /estimate/);
    assert.equal(types(facts({ categories: [cat('Dining', { avg3: 40 })] })).includes('savings'), false, 'too small to bother');
  });
  it('celebrates a month where a tenth or more of income was kept', () => {
    const i = buildInsights(facts({ totals: { ...facts().totals, incomePrev: 3000, expensePrev: 2250 } })).find((x) => x.type === 'saved');
    assert.equal(i.title, 'You kept 25% of your income in September');
    assert.equal(i.severity, 'good');
    assert.equal(types(facts({ totals: { ...facts().totals, incomePrev: 3000, expensePrev: 2900 } })).includes('saved'), false);
  });
});

describe('ordering and keys', () => {
  it('puts the most urgent first and gives each insight a stable month-scoped key', () => {
    const f = facts({
      overdue: { count: 2, total: 80, items: [{ description: 'Rent', amount: 80, date: '2026-10-01' }] },
      subscriptions: { cur: 90, prev: 40, items: [], monthlyTotal: 90 },
      totals: { ...facts().totals, incomePrev: 3000, expensePrev: 2000 },
    });
    const list = buildInsights(f);
    assert.deepEqual(list.map((i) => i.severity), ['alert', 'watch', 'good']);
    assert.equal(list[0].key, 'overdue:2026-10');
    assert.equal(JSON.stringify(buildInsights(f)), JSON.stringify(list), 'deterministic');
    assert.match(list[0].title, /^Two overdue payments/);
  });
});

describe('the month summary', () => {
  it('tells an empty budget what to do', () => {
    assert.match(buildSummary(facts({ isEmpty: true })).text, /nothing in this budget yet/i);
  });
  it('reads as a short paragraph with the figures', () => {
    const s = buildSummary(
      facts({
        totals: { ...facts().totals, expenseCur: 1500, expensePaidCur: 900, mtdExpenseCur: 900, mtdExpensePrev: 750, paidCount: 14, incomeCur: 3000, incomePaidCur: 3000 },
        categories: [cat('Rent', { cur: 800 })],
        balance: { current: 2000, endOfMonth: 1500, firstNegative: null, lowest: null },
      }),
    );
    assert.equal(s.title, 'October so far');
    assert.match(s.text, /spent \$900 across 14 payments, 20% more than at this point last month/);
    assert.match(s.text, /\$3,000 of \$3,000 expected income has arrived/);
    assert.match(s.text, /\$600 is still to pay/);
    assert.match(s.text, /Rent is the biggest category at \$800/);
    assert.match(s.text, /end the month at \$1,500/);
    assert.deepEqual(s.stats.map((x) => x.label), ['Spent', 'Still to pay', 'Income received', 'Expected month end']);
  });
  it('says so when the month will end below zero', () => {
    const s = buildSummary(facts({ totals: { ...facts().totals, expenseCur: 500, expensePaidCur: 100, paidCount: 1 }, balance: { current: 50, endOfMonth: -350, firstNegative: null, lowest: null } }));
    assert.match(s.text, /below zero/);
    assert.equal(s.stats.at(-1).tone, 'neg');
  });
});

describe('comparison data for charts', () => {
  it('lists categories largest first, skips empty ones, and carries both months', () => {
    const c = buildCompare(
      facts({
        categories: [cat('Small', { cur: 10, prev: 30 }), cat('Big', { cur: 500, prev: 450, avg3: 400 }), cat('Gone', { cur: 0, prev: 0 }), cat('Stopped', { cur: 0, prev: 80 })],
        totals: { ...facts().totals, expenseCur: 510, expensePrev: 560, incomeCur: 3000, incomePrev: 2900 },
      }),
    );
    assert.deepEqual(c.categories.map((x) => x.name), ['Big', 'Small', 'Stopped']);
    assert.deepEqual(c.categories[0], { category_id: 1, name: 'Big', color: '#123456', current: 500, previous: 450, average: 400 });
    assert.equal(c.totals.expenses, 510);
    assert.equal(c.totals.expensesPrevious, 560);
    assert.equal(c.month, '2026-10');
  });
});
