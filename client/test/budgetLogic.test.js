import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barParts, daysLeftText, headline, parseBudget, statusOf } from '../src/budgetLogic.js';

const line = (over = {}) => ({ budget: 100, spent: 40, planned: 20, ...over });
const money = (n) => `€${n}`;

describe('the bar of a category', () => {
  it('shows what is spent, then what is planned after it, against the budget', () => {
    const b = barParts(line());
    assert.deepEqual([b.spent, b.planned, b.budgetMark, b.over], [40, 20, null, false]);
  });

  it('marks the pace: where an even spread over the month would have you today', () => {
    assert.equal(barParts(line(), 0.5).paceMark, 50);
    assert.equal(barParts(line(), 0).paceMark, null); // before the month
    assert.equal(barParts(line(), 1).paceMark, null); // after it
  });

  it('once over the budget the bar fills up and a mark shows where the budget was', () => {
    const b = barParts(line({ spent: 150, planned: 0 }));
    assert.equal(b.spent, 100);
    assert.equal(b.over, true);
    assert.ok(Math.abs(b.budgetMark - 66.667) < 0.01);
    assert.ok(b.spent + b.planned <= 100.0001);
  });

  it('planned payments that break the budget show the mark, but it is not "over" until it is spent', () => {
    const b = barParts(line({ spent: 60, planned: 90 }));
    assert.equal(b.over, false);
    assert.ok(b.budgetMark > 0 && b.budgetMark < 100);
    assert.ok(Math.abs(b.spent + b.planned - 100) < 0.0001);
  });

  it('copes with no budget, a budget of zero and nothing spent', () => {
    const none = barParts({ budget: null, spent: 20, planned: 0 });
    assert.deepEqual([none.spent, none.budgetMark, none.paceMark, none.over], [100, null, null, false]);
    const zero = barParts({ budget: 0, spent: 5, planned: 0 });
    assert.equal(zero.over, true);
    assert.deepEqual(barParts({ budget: 50, spent: 0, planned: 0 }), { spent: 0, planned: 0, budgetMark: null, paceMark: null, over: false });
  });
});

describe('what a state is called', () => {
  it('uses words, and different words for a month that is over or still to come', () => {
    assert.equal(statusOf('over', 'current').label, 'Over budget');
    assert.equal(statusOf('heading-over', 'current').label, 'On track to go over');
    assert.equal(statusOf('ok', 'current').label, 'On track');
    assert.equal(statusOf('ok', 'past').label, 'Within budget');
    assert.equal(statusOf('ok', 'future').label, 'Planned');
    assert.equal(statusOf('over', 'past').label, 'Over budget');
    assert.equal(statusOf('mystery', 'current').label, 'No budget');
    for (const s of ['over', 'heading-over', 'close', 'ok', 'none', 'idle']) assert.ok(statusOf(s, 'current').tone);
  });
});

describe('a budget typed by a person', () => {
  it('reads a plain number with a point or a comma', () => {
    assert.equal(parseBudget('120'), 120);
    assert.equal(parseBudget(' 120.5 '), 120.5);
    assert.equal(parseBudget('120,50'), 120.5);
    assert.equal(parseBudget('1 200'), 1200);
    assert.equal(parseBudget('0'), 0);
  });
  it('means "no budget" when empty, and refuses anything else', () => {
    assert.equal(parseBudget(''), null);
    assert.equal(parseBudget('   '), null);
    assert.equal(parseBudget(null), null);
    for (const bad of ['abc', '-5', '12.345', '1e3', '€50', '5..2', '99999999999']) assert.ok(Number.isNaN(parseBudget(bad)), bad);
  });
});

describe('the summary of a month', () => {
  const view = (over = {}) => ({ phase: 'current', remainingDays: 10, totals: { budget: 500, left: 200, leftAfterPlanned: 120 }, ...over });
  it('says how many days are left', () => {
    assert.equal(daysLeftText(view()), '10 days left');
    assert.equal(daysLeftText(view({ remainingDays: 1 })), 'last day of the month');
    assert.equal(daysLeftText(view({ phase: 'past' })), '');
  });
  it('leads with what is left, or by how much it is over', () => {
    assert.deepEqual(headline(view(), money), { label: 'Left to spend', value: '€200', tone: 'good' });
    assert.equal(headline(view({ totals: { budget: 500, left: 200, leftAfterPlanned: -30 } }), money).tone, 'warn');
    assert.deepEqual(headline(view({ totals: { budget: 500, left: -45, leftAfterPlanned: -90 } }), money), { label: 'Over budget by', value: '€45', tone: 'bad' });
    assert.deepEqual(headline(view({ phase: 'past' }), money), { label: 'Left over', value: '€200', tone: 'good' });
    assert.deepEqual(headline(view({ phase: 'future' }), money), { label: 'Budgeted', value: '€500', tone: 'good' });
  });
});

import { normalizeLayout } from '../src/prefsLogic.js';
import { NAV, titleFor } from '../src/layout/nav.js';

describe('where it sits in the app', () => {
  it('an old dashboard layout gets the budget widget added at the end, and keeps what the person chose', () => {
    const out = normalizeLayout({ order: ['spending', 'hero'], hidden: ['hero'], sizes: { hero: 's' } });
    assert.equal(out.order[0], 'spending');
    assert.ok(out.order.includes('budget'));
    assert.deepEqual(out.hidden, ['hero'], 'the new widget is shown, not hidden');
    assert.equal(out.sizes.hero, 's');
    assert.equal(out.sizes.budget, 'm');
  });

  it('is in the menu between Payments and Recurring, under a name that does not clash with "shared budget"', () => {
    const ids = NAV.map((n) => n.id);
    assert.equal(ids.indexOf('budget'), ids.indexOf('payments') + 1);
    assert.equal(NAV.find((n) => n.id === 'budget').label, 'Monthly budget');
    assert.equal(titleFor('/budget'), 'Monthly budget');
  });
});
