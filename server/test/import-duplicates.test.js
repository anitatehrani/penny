import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDuplicates, similarity } from '../src/lib/importDuplicates.js';

const line = (i, date, amount, description, over = {}) => ({ i, date, amount, type: 'expense', description, ref: `fp:${i}`, ...over });
const tx = (id, date, amount, description, over = {}) => ({ id, date, amount, type: 'expense', description, status: 'paid', source: 'manual', import_ref: null, ...over });
const kinds = (found) => Object.fromEntries([...found].map(([i, d]) => [i, d.kind]));

describe('how alike two descriptions are', () => {
  it('shares words, ignoring the words of the payment itself', () => {
    assert.ok(similarity('Esselunga', 'Pagamento POS ESSELUNGA MILANO 0123') >= 0.9);
    assert.ok(similarity('Netflix', 'PAYPAL *NETFLIX 12345678901') >= 0.9);
    assert.equal(similarity('Rent', 'Esselunga'), 0);
    assert.equal(similarity('', 'Esselunga'), 0);
  });
});

describe('finding what is already there', () => {
  it('the same bank reference is a line imported before', () => {
    const f = findDuplicates([line(0, '2026-10-01', 5, 'Anything', { ref: 'id:abc123' })], [tx(1, '2026-09-01', 99, 'Different', { import_ref: 'id:abc123' })]);
    assert.deepEqual(kinds(f), { 0: 'imported' });
  });
  it('the same amount and kind within a day or two with a similar description is a payment typed by hand', () => {
    const f = findDuplicates([line(0, '2026-10-02', 12.5, 'Pagamento POS ESSELUNGA MILANO')], [tx(1, '2026-10-01', 12.5, 'Esselunga')]);
    assert.equal(f.get(0).kind, 'same');
    assert.equal(f.get(0).tx.id, 1);
  });
  it('the same amount with an unrelated description is only similar', () => {
    const f = findDuplicates([line(0, '2026-10-02', 12.5, 'Zara')], [tx(1, '2026-10-02', 12.5, 'Dentist')]);
    assert.equal(f.get(0).kind, 'similar');
  });
  it('a different amount, kind or a week apart is not a duplicate', () => {
    const existing = [tx(1, '2026-10-01', 12.51, 'Esselunga'), tx(2, '2026-10-01', 12.5, 'Esselunga', { type: 'income' }), tx(3, '2026-09-20', 12.5, 'Esselunga')];
    assert.equal(findDuplicates([line(0, '2026-10-02', 12.5, 'Esselunga')], existing).size, 0);
  });
  it('a payment that is still waiting is offered as scheduled', () => {
    const f = findDuplicates([line(0, '2026-10-13', 12.99, 'NETFLIX.COM')], [tx(1, '2026-10-12', 12.99, 'Netflix', { status: 'pending', source: 'recurring' })]);
    assert.equal(f.get(0).kind, 'scheduled');
  });
  it('a waiting bill with a slightly different amount is still found when the name matches', () => {
    const f = findDuplicates([line(0, '2026-10-13', 83.12, 'ENEL ENERGIA')], [tx(1, '2026-10-12', 80, 'Enel energia', { status: 'pending', source: 'recurring' })]);
    assert.equal(f.get(0).kind, 'scheduled');
    assert.equal(f.get(0).amount_differs, true);
    const far = findDuplicates([line(0, '2026-10-13', 200, 'ENEL ENERGIA')], [tx(1, '2026-10-12', 80, 'Enel energia', { status: 'pending', source: 'recurring' })]);
    assert.equal(far.size, 0, 'a very different amount is not the same bill');
  });
  it('each payment matches one line only: two identical withdrawals stay two lines', () => {
    const lines = [line(0, '2026-10-08', 50, 'Prelievo BANCOMAT'), line(1, '2026-10-08', 50, 'Prelievo BANCOMAT')];
    const one = findDuplicates(lines, [tx(1, '2026-10-08', 50, 'Prelievo BANCOMAT')]);
    assert.equal(one.size, 1);
    const two = findDuplicates(lines, [tx(1, '2026-10-08', 50, 'Prelievo BANCOMAT'), tx(2, '2026-10-08', 50, 'Prelievo BANCOMAT')]);
    assert.equal(two.size, 2);
    assert.notEqual(two.get(0).tx.id, two.get(1).tx.id);
  });
  it('the closest payment is matched first', () => {
    const f = findDuplicates([line(0, '2026-10-05', 10, 'Coffee')], [tx(1, '2026-10-02', 10, 'Coffee'), tx(2, '2026-10-05', 10, 'Coffee')]);
    assert.equal(f.get(0).tx.id, 2);
  });
});
