import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { carryState, carryVisible, withCarry } from '../src/carryLogic.js';

const TODAY = '2031-02-15';
const carry = { enabled: true, month: '2031-03', from_month: '2031-02', amount: 645 };
const view = (over) => ({ carry, month: '2031-03', today: TODAY, ...over });

describe('the left-over line on the Payments page', () => {
  it('is expected while its month has not started, and settled once it has', () => {
    assert.equal(carryState('2031-03', TODAY), 'pending');
    assert.equal(carryState('2031-02', TODAY), 'paid', 'the current month has started');
    assert.equal(carryState('2030-12', TODAY), 'paid');
    assert.equal(carryState('2031-02', '2031-01-31'), 'pending');
  });

  it('shows by default, and not when switched off or when nothing was left', () => {
    assert.equal(carryVisible(view()), true);
    assert.equal(carryVisible(view({ carry: { ...carry, enabled: false } })), false);
    assert.equal(carryVisible(view({ carry: { ...carry, amount: 0 } })), false);
    assert.equal(carryVisible(view({ carry: null })), false);
    assert.equal(carryVisible(view({ carry: undefined })), false);
  });

  it('follows the status filter: All, or the state it is in', () => {
    assert.equal(carryVisible(view({ status: '' })), true);
    assert.equal(carryVisible(view({ status: 'pending' })), true, 'a month not started: still to come');
    assert.equal(carryVisible(view({ status: 'paid' })), false);
    assert.equal(carryVisible(view({ month: '2031-02', status: 'paid' })), true, 'a month that has begun: settled');
    assert.equal(carryVisible(view({ month: '2031-02', status: 'pending' })), false);
    assert.equal(carryVisible(view({ status: 'overdue' })), false);
    assert.equal(carryVisible(view({ status: 'skipped' })), false);
  });

  it('hides when the filters are not about income, or about something it does not belong to', () => {
    assert.equal(carryVisible(view({ type: 'income' })), true);
    assert.equal(carryVisible(view({ type: 'expense' })), false);
    assert.equal(carryVisible(view({ pay: 'credit_card' })), false);
    assert.equal(carryVisible(view({ category: '12' })), false);
    assert.equal(carryVisible(view({ member: 'mo' })), false);
    assert.equal(carryVisible(view({ search: 'rent' })), false);
    assert.equal(carryVisible(view({ search: '   ' })), true, 'blank search is no search');
  });

  it('adds the amount to income and net, in exact cents, and says how much was carried', () => {
    const t = withCarry({ income: 1500.1, expenses: 2873, net: -1372.9, onCard: 97, bought: 97 }, 645.2);
    assert.deepEqual(t, { income: 2145.3, expenses: 2873, net: -727.7, onCard: 97, bought: 97, carried: 645.2 });
  });

  it('changes nothing for an amount of nothing, or a missing one', () => {
    const base = { income: 10, expenses: 4, net: 6 };
    assert.deepEqual(withCarry(base, 0), { ...base, carried: 0 });
    assert.deepEqual(withCarry(base, undefined), { ...base, carried: 0 });
  });
});
