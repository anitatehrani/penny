import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyse, buildBudgetView, niceBudget } from '../src/lib/budget.js';

const cats = [
  { id: 1, name: 'Groceries', color: '#0a0' },
  { id: 2, name: 'Dining', color: '#a00' },
  { id: 3, name: 'Pets', color: '#00a' },
  { id: 4, name: 'Transport', color: '#aa0' },
];
const spend = (spent, planned = 0, variablePaid = spent) => ({ spent, planned, variablePaid });
const view = (over = {}) =>
  buildBudgetView({
    month: '2026-10',
    today: '2026-10-10',
    categories: cats,
    budgets: new Map([[1, 300], [2, 100], [4, 80]]),
    current: new Map([[1, spend(120, 60)], [2, spend(130)], [3, spend(20)], [4, spend(10)], [0, spend(15)]]),
    history: new Map([[1, { prev: 280, avg3: 270, avgVariable3: 200 }], [3, { prev: 0, avg3: 0, avgVariable3: 0 }]]),
    income: { expected: 1000, received: 400 },
    ...over,
  });
const byName = (v, name) => v.lines.find((l) => l.name === name);

describe('niceBudget', () => {
  it('rounds a typical amount up to a figure a person would choose', () => {
    assert.equal(niceBudget(0), null);
    assert.equal(niceBudget(-5), null);
    assert.equal(niceBudget(undefined), null);
    assert.equal(niceBudget(12.5), 15);
    assert.equal(niceBudget(40), 40);
    assert.equal(niceBudget(173), 180);
    assert.equal(niceBudget(612), 650);
    assert.equal(niceBudget(2310), 2400);
  });
});

describe('where the month stands', () => {
  const v = view();
  it('knows the phase of the month and how many days are left (today counts)', () => {
    assert.deepEqual([v.phase, v.day, v.days, v.remainingDays], ['current', 10, 31, 22]);
    assert.equal(view({ today: '2026-11-20' }).phase, 'past');
    assert.equal(view({ today: '2026-09-20' }).phase, 'future');
  });

  it('gives each budgeted category what it may use, what is spent, planned and left', () => {
    const g = byName(v, 'Groceries');
    assert.deepEqual([g.budget, g.spent, g.planned, g.left, g.leftAfterPlanned, g.percent], [300, 120, 60, 180, 120, 40]);
    assert.equal(g.perDay, 5.45); // (300 - 120 - 60) / 22 days
    assert.equal(g.suggested, 270); // 270 typical is already a round figure
    assert.equal(g.lastMonth, 280);
  });

  it('reads the month at its pace: everyday spending so far, carried to the end, on top of what is paid and planned', () => {
    const g = byName(v, 'Groceries');
    assert.equal(g.expected, 432); // 120 paid + 60 planned + (120 / 10 days * 31 - 120) still to come
    assert.equal(g.status, 'heading-over');
  });

  it('calls a category over its budget only when more than the budget is spent', () => {
    assert.equal(byName(v, 'Dining').status, 'over');
    assert.equal(byName(v, 'Dining').left, -30);
    assert.equal(byName(v, 'Dining').percent, 130);
    // exactly the budget is not "over"; but at that pace (100 in 10 days) the month would end far above it
    assert.equal(byName(view({ current: new Map([[2, spend(100)]]) }), 'Dining').status, 'heading-over');
    assert.equal(byName(view({ today: '2026-10-31', current: new Map([[2, spend(100)]]) }), 'Dining').status, 'close');
  });

  it('says close once 80% is used, and ok before', () => {
    const close = view({ today: '2026-10-28', current: new Map([[4, spend(70, 0, 0)]]) });
    assert.equal(byName(close, 'Transport').status, 'close');
    const fine = view({ current: new Map([[4, spend(10, 0, 0)]]) });
    assert.equal(byName(fine, 'Transport').status, 'ok');
  });

  it('is slow to judge early in the month: before day 5 the usual spending of the last months is used instead of a few days', () => {
    const early = view({ today: '2026-10-03', current: new Map([[1, spend(20, 0, 20)]]) });
    const g = byName(early, 'Groceries');
    assert.equal(g.expected, 200); // 20 + (200 usual everyday spending - 20)
    assert.equal(g.status, 'ok'); // 200 is inside 300
    const noHistory = view({ today: '2026-10-03', current: new Map([[4, spend(60, 0, 60)]]), history: new Map() });
    assert.equal(byName(noHistory, 'Transport').expected, 60);
  });

  it('shows categories with no budget, and the uncategorized spending, apart from the totals of what is budgeted', () => {
    assert.equal(byName(v, 'Pets').budget, null);
    assert.equal(byName(v, 'Pets').status, 'none');
    assert.equal(byName(v, 'Uncategorized').status, 'none');
    assert.equal(v.unbudgetedCount, 2);
    assert.equal(v.totals.unbudgetedSpent, 35);
    assert.deepEqual([v.totals.budget, v.totals.spent, v.totals.planned], [480, 260, 60]);
    assert.equal(v.totals.left, 220);
    assert.equal(v.totals.percent, 54);
  });

  it('keeps a category with nothing in it, so a budget can still be set for it', () => {
    const idle = view({ current: new Map() });
    assert.equal(byName(idle, 'Pets').status, 'idle');
    assert.equal(idle.lines.length, cats.length);
  });

  it('puts the budgeted categories first, the most spent first', () => {
    assert.deepEqual(v.lines.map((l) => l.name), ['Dining', 'Groceries', 'Transport', 'Pets', 'Uncategorized']);
  });

  it('sets the budgets against the income expected', () => {
    assert.equal(v.totals.unallocated, 520);
    assert.equal(v.totals.income, 1000);
  });

  it('a budget of zero means nothing may be spent', () => {
    const z = view({ budgets: new Map([[3, 0]]) });
    assert.equal(byName(z, 'Pets').status, 'over');
    assert.equal(byName(z, 'Pets').percent, null);
    assert.equal(byName(view({ budgets: new Map([[3, 0]]), current: new Map() }), 'Pets').status, 'ok');
  });

  it('a month that is over: what was spent and what was left unpaid, and no pace', () => {
    const past = view({ today: '2026-11-20' });
    const g = byName(past, 'Groceries');
    assert.equal(g.expected, 180);
    assert.equal(g.status, 'ok');
    assert.equal(g.perDay, null);
    assert.equal(byName(past, 'Dining').status, 'over');
  });

  it('a month to come: only what is planned', () => {
    const next = view({ today: '2026-09-20', current: new Map([[1, spend(0, 350, 0)]]) });
    assert.equal(byName(next, 'Groceries').expected, 350);
    assert.equal(byName(next, 'Groceries').status, 'heading-over');
    assert.equal(next.day, 0);
  });
});

describe('what is worth saying', () => {
  const texts = (v) => analyse(v, 'EUR').map((f) => f.text);
  it('puts the overspending first, then the pace, and says it plainly', () => {
    const f = analyse(view(), 'EUR');
    assert.equal(f[0].severity, 'alert');
    assert.equal(f[0].text, 'Dining is over its budget by €30: €130 spent of €100 (130%).');
    assert.ok(f.some((x) => x.severity === 'watch' && /^Groceries: what is spent and already planned comes to|^At this pace Groceries/.test(x.text)));
  });

  it('says what the pace means when the planned payments alone are not the problem', () => {
    const v = view({ current: new Map([[1, spend(120, 0, 120)]]) });
    assert.ok(texts(v).includes('At this pace Groceries will end the month around €372, about €72 over its budget of €300.'));
  });

  it('mentions the categories with no budget and the budgets against the income', () => {
    const t = texts(view({ income: { expected: 400, received: 0 } }));
    assert.ok(t.some((x) => /^€35 is going on categories with no budget: Pets and Uncategorized\.$/.test(x)), t.join('\n'));
    assert.ok(t.includes('Your budgets add up to €480, which is €80 more than the income you expect in October (€400).'));
    assert.ok(texts(view()).includes('€520 of the income you expect in October is not in any budget yet.'));
  });

  it('is calm when all is well', () => {
    const calm = view({ budgets: new Map([[1, 500], [4, 80]]), current: new Map([[1, spend(50, 0, 0)], [4, spend(5, 0, 0)]]) });
    const t = texts(calm);
    assert.ok(t.some((x) => /^All 2 budgeted categories are on track, with €525 left of €580 and 22 days to go\.$/.test(x)), t.join('\n'));
    assert.ok(!analyse(calm, 'EUR').some((f) => f.severity === 'alert' || f.severity === 'watch'));
  });

  it('reviews a month that is over', () => {
    const t = texts(view({ today: '2026-11-20' }));
    assert.ok(t.some((x) => x.startsWith('You stayed within budget in 2 of 3 categories in October. In all you spent €260 of €480, €220 less than planned.')), t.join('\n'));
  });

  it('has nothing to say when nothing is budgeted, and uses the currency of the budget', () => {
    assert.deepEqual(analyse(view({ budgets: new Map() }), 'EUR'), []);
    assert.ok(analyse(view(), 'USD')[0].text.includes('$130'));
  });

  it('warns about planned payments in a month to come', () => {
    const next = view({ today: '2026-09-20', current: new Map([[1, spend(0, 350, 0)]]) });
    assert.ok(texts(next).includes('Groceries: the payments already planned for October come to €350, more than its budget of €300.'));
  });
});

describe('the calendar', () => {
  const on = (today, month, over = {}) => buildBudgetView({ month, today, categories: [{ id: 1, name: 'Food', color: '#0a0' }], budgets: new Map([[1, 300]]), current: new Map([[1, { spent: 30, planned: 0, variablePaid: 30 }]]), history: new Map([[1, { prev: 0, avg3: 0, avgVariable3: 0 }]]), income: { expected: 0, received: 0 }, ...over });
  it('counts the days of every kind of month, leap years included', () => {
    assert.equal(on('2028-02-10', '2028-02').days, 29);
    assert.equal(on('2027-02-10', '2027-02').days, 28);
    assert.equal(on('2026-04-10', '2026-04').days, 30);
    assert.equal(on('2026-12-10', '2026-12').days, 31);
  });
  it('knows a month is over, current or to come across the turn of a year', () => {
    assert.equal(on('2027-01-02', '2026-12').phase, 'past');
    assert.equal(on('2026-12-31', '2027-01').phase, 'future');
    assert.equal(on('2026-12-31', '2026-12').phase, 'current');
  });
  it('on the last day only today is left, and on the first day the whole month', () => {
    const last = on('2026-10-31', '2026-10');
    assert.deepEqual([last.remainingDays, last.elapsed], [1, 1]);
    assert.equal(last.lines[0].perDay, 270); // all that is left may go today
    const first = on('2026-10-01', '2026-10');
    assert.deepEqual([first.day, first.remainingDays], [1, 31]);
    assert.ok(first.elapsed > 0 && first.elapsed < 0.05);
  });
  it('February in a leap year: the pace is worked out over 29 days', () => {
    const v = on('2028-02-10', '2028-02', { current: new Map([[1, { spent: 100, planned: 0, variablePaid: 100 }]]) });
    assert.equal(v.lines[0].expected, 290); // 100 / 10 days * 29
  });
  it('a month with no days elapsed yet has no pace and nothing spent', () => {
    const v = on('2026-09-20', '2026-10', { current: new Map() });
    assert.deepEqual([v.day, v.elapsed, v.lines[0].spent, v.lines[0].status], [0, 0, 0, 'ok']);
    assert.equal(v.lines[0].perDay, null);
  });
});

describe('the sentences, more closely', () => {
  const base = (over = {}) => ({
    month: '2026-10',
    today: '2026-10-28',
    categories: [{ id: 1, name: 'Food', color: '#0a0' }, { id: 2, name: 'Fun', color: '#a00' }, { id: 3, name: 'Pets', color: '#00a' }, { id: 4, name: 'Gifts', color: '#aa0' }, { id: 5, name: 'Trips', color: '#0aa' }, { id: 6, name: 'Cars', color: '#a0a' }],
    budgets: new Map([[1, 100]]),
    current: new Map([[1, { spent: 85, planned: 0, variablePaid: 0 }]]),
    history: new Map(),
    income: { expected: 0, received: 0 },
    ...over,
  });
  const texts = (v) => analyse(v, 'EUR').map((f) => f.text);
  it('says "last day" for one day left and "days" for more', () => {
    assert.ok(texts(buildBudgetView(base({ today: '2026-10-31' }))).some((t) => /€15 left for 1 more day\./.test(t)));
    assert.ok(texts(buildBudgetView(base())).some((t) => /€15 left for 4 more days\./.test(t)));
  });
  it('lists at most four categories with no budget and counts the rest', () => {
    const spend = ([id]) => [id, { spent: 10, planned: 0, variablePaid: 0 }];
    const v = buildBudgetView(base({ current: new Map([...[1, 2, 3, 4, 5, 6].map((id) => spend([id]))]) }));
    const t = texts(v).find((x) => x.includes('no budget'));
    assert.match(t, /^€50 is going on categories with no budget: Cars, Fun, Gifts, Pets and 1 more\.$/);
  });
  it('names the category with the most left over in a finished month, and only when nothing went over', () => {
    const v = buildBudgetView(base({ today: '2026-11-15', budgets: new Map([[1, 100], [2, 80]]), current: new Map([[1, { spent: 60, planned: 0, variablePaid: 0 }], [2, { spent: 70, planned: 0, variablePaid: 0 }]]) }));
    const t = texts(v);
    assert.ok(t.includes('The most left over was in Food: €40.'), t.join('\n'));
    assert.ok(t.some((x) => x.startsWith('You stayed within budget in 2 of 2 categories')));
    const over = buildBudgetView(base({ today: '2026-11-15', budgets: new Map([[1, 50]]) }));
    assert.ok(!texts(over).some((x) => x.startsWith('The most left over')));
  });
  it('says nothing about income when none is expected', () => {
    assert.ok(!texts(buildBudgetView(base())).some((x) => /income/.test(x)));
  });
  it('a single budgeted category is spoken of in the singular', () => {
    const v = buildBudgetView(base({ today: '2026-10-05', current: new Map([[1, { spent: 5, planned: 0, variablePaid: 0 }]]) }));
    assert.ok(texts(v).some((x) => x.startsWith('Your budgeted category is on track')));
  });
  it('severity decides the order: over, then watch, then information, then good news', () => {
    const v = buildBudgetView(base({ budgets: new Map([[1, 100], [2, 5]]), current: new Map([[1, { spent: 85, planned: 0, variablePaid: 0 }], [2, { spent: 9, planned: 0, variablePaid: 0 }], [3, { spent: 4, planned: 0, variablePaid: 0 }]]), income: { expected: 1000, received: 0 } }));
    const order = analyse(v, 'EUR').map((f) => f.severity);
    assert.deepEqual(order, [...order].sort((a, b) => ({ alert: 0, watch: 1, info: 2, good: 3 })[a] - ({ alert: 0, watch: 1, info: 2, good: 3 })[b]));
    assert.equal(order[0], 'alert');
  });
});
