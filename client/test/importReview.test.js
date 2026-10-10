import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commitRows, defaultAction, flipType, includeNotBooked, needsLook, previewLines, sameMerchant, setAction, setCategory, setSection, span, startReview, summary, visible } from '../src/importReview.js';

const GROCERIES = { id: 1, name: 'Groceries', kind: 'expense' };
const CLOTHING = { id: null, name: 'Clothing', kind: 'expense', isNew: true };
const line = (over = {}) => ({ id: '0:0', section: 0, line: 2, date: '2026-10-01', description: 'Shop', note: '', amount: 10, type: 'expense', status: 'booked', bankCategory: '', reference: '', ...over });
const answer = (over = {}) => ({ ref: 'fp:abc', merchant: 'shop', category: GROCERIES, source: 'known', confidence: 0.92, review: null, reason: '', transfer: false, duplicate: null, ...over });
const review = (pairs, on) => startReview(pairs.map((p) => p[0]), pairs.map((p) => p[1]), on);

describe('what is sent to be previewed', () => {
  it('only what the server needs', () => {
    const [p] = previewLines([line({ bankCategory: 'Cash', reference: 'X1', balance: 5, status: 'booked' })]);
    assert.deepEqual(p, { i: 0, date: '2026-10-01', description: 'Shop', note: '', amount: 10, type: 'expense', bank_category: 'Cash', reference: 'X1' });
  });
});

describe('what is on and what is left out to begin with', () => {
  it('booked lines are imported; pending, cancelled, duplicates and switched-off parts are not, each with a reason', () => {
    const rows = review([
      [line({ id: 'a' }), answer()],
      [line({ id: 'b', status: 'pending' }), answer()],
      [line({ id: 'c', status: 'reverted' }), answer()],
      [line({ id: 'd' }), answer({ duplicate: { kind: 'same', action: 'skip', tx: { id: 7 } } })],
      [line({ id: 'e' }), answer({ duplicate: { kind: 'scheduled', action: 'settle', tx: { id: 9 } } })],
      [line({ id: 'f' }), answer({ duplicate: { kind: 'similar', action: 'import', tx: { id: 3 } } })],
      [line({ id: 'g', section: 1 }), answer()],
    ], { 0: true, 1: false });
    assert.deepEqual(rows.map((r) => [r.action, r.why]), [['import', null], ['skip', 'notbooked'], ['skip', 'reverted'], ['skip', 'duplicate'], ['settle', null], ['import', null], ['skip', 'section']]);
    assert.equal(rows[4].settleId, 9);
  });
  it('the first guess is kept next to what the person may change', () => {
    const [r] = review([[line({ description: 'Pagamento POS SHOP' }), answer()]]);
    assert.equal(r.original, 'Pagamento POS SHOP');
    assert.deepEqual(r.suggested, GROCERIES);
  });
  it('turning a part of the statement on or off changes its rows but not what the person decided', () => {
    let rows = review([[line({ id: 'a' }), answer()], [line({ id: 'b' }), answer()], [line({ id: 'c', section: 1, status: 'pending' }), answer()]], { 0: true, 1: true });
    rows = setAction(rows, [0], 'skip');
    rows = setSection(rows, 0, false);
    assert.deepEqual(rows.map((r) => [r.action, r.why]), [['skip', 'you'], ['skip', 'section'], ['skip', 'notbooked']]);
    rows = setSection(rows, 0, true);
    assert.deepEqual(rows.map((r) => r.action), ['skip', 'import', 'skip']);
  });
  it('one click brings in the lines the bank has not booked', () => {
    const rows = includeNotBooked(review([[line({ status: 'pending' }), answer()], [line({ status: 'reverted' }), answer()]]));
    assert.deepEqual(rows.map((r) => r.action), ['import', 'skip']);
  });
});

describe('which lines need a look', () => {
  it('no category, or a guess that was marked, until the person chooses', () => {
    let rows = review([[line(), answer()], [line(), answer({ category: null, review: 'none' })], [line(), answer({ review: 'check' })], [line({ status: 'pending' }), answer({ review: 'check' })]]);
    assert.deepEqual(rows.map(needsLook), [false, true, true, false], 'a line that is left out needs nothing');
    rows = setCategory(rows, [1, 2], GROCERIES);
    assert.deepEqual(rows.map(needsLook), [false, false, false, false]);
  });
  it('the summary counts them, the money, the transfers and the new categories', () => {
    const rows = review([
      [line({ amount: 10 }), answer()],
      [line({ amount: 5.5, type: 'income' }), answer({ category: null, review: 'none' })],
      [line({ amount: 20 }), answer({ category: CLOTHING, review: 'check', transfer: false })],
      [line({ amount: 30 }), answer({ transfer: true, review: 'check' })],
      [line({ status: 'pending' }), answer()],
    ]);
    const s = summary(rows);
    assert.deepEqual([s.total, s.importing, s.skipped, s.none, s.check, s.transfers, s.notBooked, s.in, s.out], [5, 4, 1, 1, 2, 1, 1, 5.5, 60]);
    assert.deepEqual(s.newCategories.map((c) => c.name), ['Clothing']);
  });
});

describe('looking at part of the list', () => {
  const rows = review([
    [line({ description: 'Esselunga' }), answer()],
    [line({ description: 'Mystery', amount: 3 }), answer({ category: null, review: 'none' })],
    [line({ description: 'Old', status: 'pending' }), answer()],
    [line({ description: 'Dup' }), answer({ duplicate: { kind: 'same', action: 'skip', tx: { id: 1 } } })],
    [line({ description: 'Transfer' }), answer({ transfer: true, review: 'check' })],
  ]);
  it('each view', () => {
    const names = (v) => visible(rows, v).map((r) => r.description);
    assert.deepEqual(names({}), ['Esselunga', 'Mystery', 'Old', 'Dup', 'Transfer']);
    assert.deepEqual(names({ view: 'check' }), ['Mystery', 'Transfer']);
    assert.deepEqual(names({ view: 'skipped' }), ['Old', 'Dup']);
    assert.deepEqual(names({ view: 'duplicates' }), ['Dup']);
    assert.deepEqual(names({ view: 'transfers' }), ['Transfer']);
  });
  it('a search looks at the words, the note, the category and the amount', () => {
    assert.deepEqual(visible(rows, { q: 'esse' }).map((r) => r.description), ['Esselunga']);
    assert.deepEqual(visible(rows, { q: 'groceries' }).length, 4);
    assert.deepEqual(visible(rows, { q: '3' }).map((r) => r.description), ['Mystery']);
    assert.deepEqual(visible(rows, { q: 'nothing' }), []);
  });
});

describe('editing several lines at once', () => {
  it('sets a category and leaves out or brings back lines', () => {
    let rows = review([[line(), answer()], [line(), answer()], [line(), answer()]]);
    rows = setCategory(rows, [0, 2], CLOTHING);
    assert.deepEqual(rows.map((r) => r.category.name), ['Clothing', 'Groceries', 'Clothing']);
    rows = setAction(rows, [1], 'skip');
    assert.deepEqual([rows[1].action, rows[1].why], ['skip', 'you']);
    rows = setAction(rows, [1], 'import');
    assert.deepEqual([rows[1].action, rows[1].why], ['import', null]);
  });
  it('flipping money out to money in takes the category away, since it no longer fits', () => {
    let rows = review([[line(), answer()]]);
    rows = flipType(rows, [0]);
    assert.deepEqual([rows[0].type, rows[0].category, needsLook(rows[0])], ['income', null, true]);
    rows = flipType(rows, [0]);
    assert.equal(rows[0].type, 'expense');
  });
  it('finds the other lines of the same merchant that the person has not decided about', () => {
    let rows = review([[line(), answer({ merchant: 'zara' })], [line(), answer({ merchant: 'zara' })], [line(), answer({ merchant: 'zara', category: null })], [line(), answer({ merchant: 'lidl' })], [line({ type: 'income' }), answer({ merchant: 'zara' })]]);
    rows = setCategory(rows, [0], CLOTHING);
    assert.deepEqual(sameMerchant(rows, rows[0]), [1, 2]);
    rows = setCategory(rows, [1], CLOTHING);
    assert.deepEqual(sameMerchant(rows, rows[0]), [2]);
  });
});

describe('what is saved', () => {
  it('leaves out what is left out, sends categories by id or by new name, and marks what the person taught', () => {
    let rows = review([
      [line({ description: 'A' }), answer()],
      [line({ description: 'B' }), answer({ category: null, review: 'none', merchant: 'bee' })],
      [line({ description: 'C', status: 'pending' }), answer()],
      [line({ description: 'D' }), answer({ duplicate: { kind: 'scheduled', action: 'settle', tx: { id: 44 } } })],
    ]);
    rows = setCategory(rows, [1], CLOTHING);
    rows = setCategory(rows, [0], GROCERIES); // chosen, but the same as the suggestion
    const sent = commitRows(rows);
    assert.deepEqual(sent.map((r) => r.description), ['A', 'B', 'D']);
    assert.deepEqual(sent.map((r) => r.taught), [false, true, false]);
    assert.deepEqual(sent[0].category_id, 1);
    assert.deepEqual(sent[1].new_category, { name: 'Clothing' });
    assert.equal(sent[1].category_id, undefined);
    assert.deepEqual([sent[2].action, sent[2].settle_id], ['settle', 44]);
    assert.equal(sent[1].key, 'bee');
    assert.equal(sent[0].ref, 'fp:abc');
  });
  it('a renamed line keeps the bank\'s reference; a flipped one does not', () => {
    let rows = review([[line(), answer()], [line(), answer()]]);
    rows = setText(rows, 0, { description: 'My name for it' });
    rows = flipType(rows, [1]);
    const sent = commitRows(rows);
    assert.equal(sent[0].description, 'My name for it');
    assert.equal(sent[0].ref, 'fp:abc');
    assert.equal(sent[1].ref, undefined);
  });
  it('an empty name falls back to what the bank said', () => {
    const rows = review([[line({ description: 'Bank wording' }), answer()]]);
    rows[0].description = '   ';
    assert.equal(commitRows(rows)[0].description, 'Bank wording');
  });
  it('the stretch of time covered', () => {
    const rows = review([[line({ date: '2026-10-05' }), answer()], [line({ date: '2026-09-28' }), answer()], [line({ date: '2026-12-01', status: 'pending' }), answer()]]);
    assert.deepEqual(span(rows), { first: '2026-09-28', last: '2026-10-05' });
    assert.equal(span([]), null);
  });
  it('the default action of a line', () => {
    assert.deepEqual(defaultAction({ status: 'booked', duplicate: null }), { action: 'import', why: null });
  });
});

import { setText } from '../src/importReview.js';
