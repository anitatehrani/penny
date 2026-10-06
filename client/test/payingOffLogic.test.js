import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { payingOff } from '../src/payingOffLogic.js';

const TODAY = '2031-02-15';
const debt = (over) => ({ id: 1, name: 'Faeze', status: 'active', count_in_budget: true, total_amount: 600, paid: 0, remaining: 600, next_due: null, next_amount: null, ...over });
const plan = (over) => ({ id: 1, description: 'Laptop', installment_count: 6, first_due_date: '2031-01-10', total_amount: 600, paid_count: 2, remaining_count: 4, remaining_total: 400, next_due: '2031-03-10', ...over });

describe('the dashboard "Paying off" rows', () => {
  it('is empty when nothing is active', () => {
    const r = payingOff([debt({ status: 'settled' })], [plan({ remaining_count: 0 })], TODAY);
    assert.deepEqual([r.count, r.items.length, r.total, r.more], [0, 0, 0, 0]);
  });
  it('adds up what is left in the budget: counted debts and plans, not the debts left out of the budget', () => {
    const r = payingOff([debt({ remaining: 100.1 }), debt({ id: 2, remaining: 520, count_in_budget: false })], [plan({ remaining_total: 200.2 })], TODAY);
    assert.equal(r.total, 300.3, 'cents add exactly');
    assert.equal(r.count, 3, 'but the uncounted debt is still listed');
    assert.equal(r.items.find((x) => x.id === 2 && x.kind === 'debt').counted, false);
  });
  it('leaves out money owed TO the person: it is not something to pay off, and not part of the total', () => {
    const r = payingOff([debt({ remaining: 100 }), debt({ id: 2, name: 'Sam', direction: 'lent', remaining: 300 }), debt({ id: 3, name: 'Old', direction: 'owe', remaining: 50 })], [], TODAY);
    assert.deepEqual(r.items.map((x) => x.name).sort(), ['Faeze', 'Old']);
    assert.equal(r.total, 150);
    assert.equal(r.count, 2);
  });
  it('puts overdue first, then the soonest payment, then those with nothing scheduled', () => {
    const r = payingOff(
      [debt({ id: 1, name: 'Open', next_due: null }), debt({ id: 2, name: 'Late', next_due: '2031-02-01', next_amount: 50 }), debt({ id: 3, name: 'Later', next_due: '2031-04-01', next_amount: 50 })],
      [plan({ id: 9, description: 'Soon', next_due: '2031-02-20' })],
      TODAY,
    );
    assert.deepEqual(r.items.map((x) => x.name), ['Late', 'Soon', 'Later', 'Open']);
    assert.equal(r.overdue, 1);
    assert.equal(r.items[0].overdue, true);
    assert.equal(r.items[1].overdue, false);
  });
  it('treats a payment due today as still to come', () => {
    assert.equal(payingOff([debt({ next_due: TODAY, next_amount: 10 })], [], TODAY).items[0].overdue, false);
  });
  it('shows steps for an installment plan, a percentage for a debt, and the amount of each installment', () => {
    const r = payingOff([debt({ paid: 150, remaining: 450 })], [plan()], TODAY);
    const d = r.items.find((x) => x.kind === 'debt');
    const p = r.items.find((x) => x.kind === 'plan');
    assert.equal(d.pct, 25);
    assert.equal(d.segments, null);
    assert.deepEqual(p.segments, ['paid', 'paid', 'next', 'later', 'later', 'later']);
    assert.equal(p.paidText, '2 of 6 paid');
    assert.equal(p.nextAmount, 100);
  });
  it('shows only the first few, and says how many more there are', () => {
    const debts = Array.from({ length: 8 }, (_, i) => debt({ id: i + 1, name: 'D' + i, next_due: `2031-03-0${i + 1}`, next_amount: 5 }));
    const r = payingOff(debts, [], TODAY, 5);
    assert.deepEqual([r.items.length, r.more, r.count], [5, 3, 8]);
  });
  it('copes with missing lists and a zero total', () => {
    assert.deepEqual(payingOff(undefined, undefined, TODAY).items, []);
    assert.equal(payingOff([debt({ total_amount: 0, paid: 0, remaining: 0 })], [], TODAY).items[0].pct, 0);
  });
});
