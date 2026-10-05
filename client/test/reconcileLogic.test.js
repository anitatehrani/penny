import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcilePreview } from '../src/reconcileLogic.js';

describe('what matching the bank balance would do', () => {
  it('is nothing to say until a balance is typed, or when it is not a number', () => {
    for (const bank of ['', null, undefined, 'abc', Infinity, NaN]) assert.deepEqual(reconcilePreview({ penny: 100, bank }), { state: 'empty' }, String(bank));
  });

  it('says they match, in whole cents', () => {
    assert.deepEqual(reconcilePreview({ penny: 100, bank: '100' }), { state: 'match', diff: 0 });
    assert.equal(reconcilePreview({ penny: 0.1 + 0.2, bank: '0.3' }).state, 'match', 'floating point noise is not a difference');
    assert.equal(reconcilePreview({ penny: 100, bank: '100.004' }).state, 'match', 'less than a cent is no difference');
  });

  it('adds an income when the bank has more', () => {
    assert.deepEqual(reconcilePreview({ penny: 100, bank: '150.5' }), { state: 'more', diff: 50.5, amount: 50.5, type: 'income' });
  });

  it('adds an expense when the bank has less', () => {
    assert.deepEqual(reconcilePreview({ penny: 100, bank: '40' }), { state: 'less', diff: -60, amount: 60, type: 'expense' });
  });

  it('works with negative balances on either side', () => {
    assert.deepEqual(reconcilePreview({ penny: -250.5, bank: '-300.05' }), { state: 'less', diff: -49.55, amount: 49.55, type: 'expense' });
    assert.deepEqual(reconcilePreview({ penny: -10, bank: '5' }), { state: 'more', diff: 15, amount: 15, type: 'income' });
    assert.equal(reconcilePreview({ penny: 5, bank: '0' }).type, 'expense', 'an empty bank account is a real balance of zero');
  });

  it('takes a number as well as the text of one', () => {
    assert.equal(reconcilePreview({ penny: 10, bank: 12 }).amount, 2);
  });
});
