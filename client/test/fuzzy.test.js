import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fuzzyMatch, rank } from '../src/command/fuzzy.js';

describe('fuzzy matching for the command palette', () => {
  it('matches letters in order and returns which ones, for highlighting', () => {
    const m = fuzzyMatch('adpay', 'Add payment');
    assert.ok(m);
    assert.equal(m.indexes.map((i) => 'Add payment'[i]).join('').toLowerCase(), 'adpay');
  });

  it('is case and space insensitive', () => {
    assert.ok(fuzzyMatch('ADD PAY', 'add payment'));
    assert.ok(fuzzyMatch('forecast', 'Open Forecast'));
  });

  it('rejects text that does not contain the letters in order', () => {
    assert.equal(fuzzyMatch('xyz', 'Add payment'), null);
    assert.equal(fuzzyMatch('tap', 'pat'), null);
    assert.equal(fuzzyMatch('aaaa', 'aaa'), null);
  });

  it('an empty query matches everything with no highlights', () => {
    assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, indexes: [] });
    assert.deepEqual(fuzzyMatch('   ', 'anything'), { score: 0, indexes: [] });
  });

  it('prefers matches that start words and sit together', () => {
    const good = fuzzyMatch('set', 'Settings');
    const scattered = fuzzyMatch('set', 'A sad evening, then tea');
    assert.ok(good.score > scattered.score);
    assert.deepEqual(good.indexes, [0, 1, 2]);
  });

  it('picks the best way to lay the query over the text, not just the first', () => {
    const m = fuzzyMatch('pay', 'Pay the payments');
    assert.deepEqual(m.indexes, [0, 1, 2], 'the word start wins over a later partial');
  });

  it('ranks a close, short label above a long one', () => {
    const items = [{ label: 'Go to payments page now' }, { label: 'Payments' }, { label: 'Pay later' }];
    const out = rank('pay', items).map((r) => r.item.label);
    assert.equal(out[0], 'Payments');
    assert.equal(out.length, 3);
  });

  it('falls back to hidden keywords, below real label matches', () => {
    const items = [{ label: 'Open forecast', keywords: 'future predict balance' }, { label: 'Predictions page' }];
    const out = rank('predict', items).map((r) => r.item.label);
    assert.deepEqual(out, ['Predictions page', 'Open forecast']);
    assert.deepEqual(rank('predict', items)[1].indexes, [], 'nothing to highlight for a keyword hit');
  });

  it('keeps the given order when nothing is typed, and drops non-matches when something is', () => {
    const items = [{ label: 'B' }, { label: 'A' }];
    assert.deepEqual(rank('', items).map((r) => r.item.label), ['B', 'A']);
    assert.deepEqual(rank('z', items), []);
  });

  it('copes with long and odd input without throwing', () => {
    assert.equal(fuzzyMatch('a'.repeat(100), 'a'.repeat(10)), null);
    assert.ok(fuzzyMatch('é', 'café'));
    assert.doesNotThrow(() => fuzzyMatch('.*+?^${}()|[]\\', 'regex chars are plain text'));
  });
});
