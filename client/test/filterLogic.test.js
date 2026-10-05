import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activeFilterCount, categoryOptions, filterOptions, fold, groupOptions, labelOf, moveHighlight } from '../src/filterLogic.js';

const cats = [
  { id: 1, name: 'Groceries', kind: 'expense', color: '#0a0' },
  { id: 2, name: 'Café & coffee', kind: 'expense', color: null },
  { id: 3, name: 'Salary', kind: 'income', color: '#00f' },
  { id: 4, name: 'Gifts received', kind: 'income', color: '#f0f' },
];
const options = categoryOptions(cats);

describe('fold', () => {
  it('ignores capitals, accents and stray spaces', () => {
    assert.equal(fold('  Café  '), 'cafe');
    assert.equal(fold(null), '');
    assert.equal(fold(undefined), '');
  });
});

describe('filterOptions', () => {
  it('keeps everything when nothing (or only spaces) is typed', () => {
    assert.equal(filterOptions(options, ''), options);
    assert.equal(filterOptions(options, '   '), options);
    assert.equal(filterOptions(options, undefined), options);
  });
  it('finds a label from part of it, ignoring capitals', () => {
    assert.deepEqual(filterOptions(options, 'GRO').map((o) => o.label), ['Groceries']);
  });
  it('ignores accents in both directions', () => {
    assert.deepEqual(filterOptions(options, 'cafe').map((o) => o.label), ['Café & coffee']);
    assert.deepEqual(filterOptions(options, 'café').map((o) => o.label), ['Café & coffee']);
  });
  it('needs every word typed, in any order', () => {
    assert.deepEqual(filterOptions(options, 'received gifts').map((o) => o.label), ['Gifts received']);
    assert.deepEqual(filterOptions(options, 'gifts salary'), []);
  });
  it('also matches the group name, so typing "income" lists the income categories', () => {
    assert.deepEqual(filterOptions(options, 'income').map((o) => o.label), ['Salary', 'Gifts received']);
  });
  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(filterOptions(options, 'zzz'), []);
  });
  it('does not treat what is typed as a pattern', () => {
    assert.deepEqual(filterOptions(options, '.*'), []);
    assert.deepEqual(filterOptions(options, '('), []);
    assert.deepEqual(filterOptions(options, '&').map((o) => o.label), ['Café & coffee']);
  });
});

describe('groupOptions', () => {
  it('puts neighbours with the same group together, keeping the order', () => {
    const runs = groupOptions(options);
    assert.deepEqual(runs.map((r) => [r.group, r.options.length]), [['', 2], ['Expenses', 2], ['Income', 2]]);
  });
  it('starts a new run when a group comes back later', () => {
    const runs = groupOptions([{ label: 'a', group: 'X' }, { label: 'b', group: 'Y' }, { label: 'c', group: 'X' }]);
    assert.deepEqual(runs.map((r) => r.group), ['X', 'Y', 'X']);
  });
  it('copes with an empty list', () => {
    assert.deepEqual(groupOptions([]), []);
  });
});

describe('moveHighlight', () => {
  it('moves down and up', () => {
    assert.equal(moveHighlight(0, 1, 5), 1);
    assert.equal(moveHighlight(3, -1, 5), 2);
  });
  it('wraps at both ends', () => {
    assert.equal(moveHighlight(4, 1, 5), 0);
    assert.equal(moveHighlight(0, -1, 5), 4);
  });
  it('starts at the first (going down) or the last (going up) when nothing is highlighted', () => {
    assert.equal(moveHighlight(-1, 1, 5), 0);
    assert.equal(moveHighlight(-1, -1, 5), 4);
  });
  it('highlights nothing in an empty list', () => {
    assert.equal(moveHighlight(0, 1, 0), -1);
    assert.equal(moveHighlight(-1, -1, 0), -1);
  });
  it('stays put in a list of one', () => {
    assert.equal(moveHighlight(0, 1, 1), 0);
    assert.equal(moveHighlight(0, -1, 1), 0);
  });
});

describe('categoryOptions', () => {
  it('starts with "all" and "uncategorized", then expenses, then income, each with its colour', () => {
    assert.deepEqual(options.map((o) => o.label), ['All categories', 'Uncategorized', 'Groceries', 'Café & coffee', 'Salary', 'Gifts received']);
    assert.deepEqual(options.map((o) => o.value), ['', 'none', '1', '2', '3', '4']);
    assert.equal(options[2].dot, '#0a0');
    assert.equal(options[3].dot, null, 'a category with no colour still gets a dot (grey)');
    assert.equal(options[0].dot, undefined, '"all" has no dot');
    assert.equal(options[1].dot, null, 'uncategorized has a grey dot');
  });
  it('can say something other than "All categories"', () => {
    assert.equal(categoryOptions([], { allLabel: 'Any category' })[0].label, 'Any category');
  });
  it('works with no categories', () => {
    assert.deepEqual(categoryOptions([]).map((o) => o.value), ['', 'none']);
  });
});

describe('labelOf', () => {
  it('names the chosen option, taking the value as text or number', () => {
    assert.equal(labelOf(options, '3'), 'Salary');
    assert.equal(labelOf(options, 3), 'Salary');
    assert.equal(labelOf(options, 'none'), 'Uncategorized');
  });
  it('falls back to the first option for no value or one that is gone', () => {
    assert.equal(labelOf(options, ''), 'All categories');
    assert.equal(labelOf(options, null), 'All categories');
    assert.equal(labelOf(options, '999'), 'All categories');
  });
  it('is empty with no options', () => {
    assert.equal(labelOf([], 'x'), '');
  });
});

describe('activeFilterCount', () => {
  it('counts only what is switched on', () => {
    assert.equal(activeFilterCount({ type: '', pay: '', category: '', member: '', search: '' }), 0);
    assert.equal(activeFilterCount({ type: 'expense', pay: '', category: '5', member: '', search: '' }), 2);
    assert.equal(activeFilterCount({ type: 'expense', pay: 'cash', category: '5', member: 'mo', search: 'rent' }), 5);
  });
  it('does not count a search of only spaces', () => {
    assert.equal(activeFilterCount({ search: '   ' }), 0);
  });
  it('copes with missing values', () => {
    assert.equal(activeFilterCount({}), 0);
  });
});
