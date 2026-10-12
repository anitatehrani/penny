import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_LAYOUT } from '../src/prefsLogic.js';
import { layoutForGoals, nudgeSettings, villainCategory } from '../src/welcomeLogic.js';

describe('the dashboard for somebody who chose goals', () => {
  it('keeps the greeting and insights on top, then puts what they asked for', () => {
    const { order } = layoutForGoals(['debts', 'budget']);
    assert.deepEqual(order.slice(0, 5), ['hero', 'insights', 'paying', 'budget', 'spending']);
  });

  it('never loses or repeats a widget', () => {
    for (const goals of [[], ['forecast'], ['budget', 'import'], ['together'], ['forecast', 'budget', 'bills', 'debts', 'together', 'import']]) {
      const { order } = layoutForGoals(goals);
      assert.deepEqual([...order].sort(), [...DEFAULT_LAYOUT.order].sort(), goals.join());
    }
  });

  it('is the usual order when nothing was chosen, and keeps the hidden widgets and sizes', () => {
    assert.deepEqual(layoutForGoals([]).order, DEFAULT_LAYOUT.order);
    const kept = layoutForGoals(['forecast'], { hidden: ['recurring'], sizes: { outlook: 'l' } });
    assert.deepEqual(kept.hidden, ['recurring']);
    assert.equal(kept.sizes.outlook, 'l');
    assert.equal(kept.order[2], 'outlook');
  });
});

describe('the alert settings for each nudge', () => {
  it('maps each choice to days ahead and the weekly summary', () => {
    assert.deepEqual(nudgeSettings('urgent'), { lead_days: 1, weekly_summary: false });
    assert.deepEqual(nudgeSettings('weekly'), { lead_days: 3, weekly_summary: true });
    assert.deepEqual(nudgeSettings('early'), { lead_days: 7, weekly_summary: true });
  });
  it('changes nothing for no answer', () => {
    assert.equal(nudgeSettings(undefined), null);
    assert.equal(nudgeSettings('bogus'), null);
  });
});

describe('the budget villain', () => {
  it('points at one of the categories every account starts with', () => {
    assert.equal(villainCategory('dining'), 'Dining & leisure');
    assert.equal(villainCategory('subscriptions'), 'Subscriptions');
    assert.equal(villainCategory('none'), null);
    assert.equal(villainCategory(undefined), null);
  });
});
