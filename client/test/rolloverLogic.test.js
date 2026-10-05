import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planRollover as serverPlan } from '../../server/src/lib/rollover.js';
import { laterBillMonths, planRollover, summarizeRollover } from '../src/rolloverLogic.js';

const item = (id, description, amount, movable = true) => ({ id, description, amount, charged_on: '2031-12-01', movable });
const bill = (items = [item(1, 'Klarna', 8), item(2, 'IKEA', 89), item(3, 'Shoes', 138)]) => {
  const c = (list) => list.reduce((s, i) => s + Math.round(i.amount * 100), 0) / 100;
  return { items, total: c(items), movable: c(items.filter((i) => i.movable)), fixed: c(items.filter((i) => !i.movable)) };
};

describe('the preview picks the same purchases as the server', () => {
  it('for many bills and many amounts, step for step', () => {
    const lists = [
      [{ id: 1, cents: 8000 }, { id: 2, cents: 8900 }, { id: 3, cents: 5000 }],
      [{ id: 7, cents: 1 }, { id: 8, cents: 2 }, { id: 9, cents: 3 }],
      [{ id: 4, cents: 123456 }],
      [],
    ];
    for (const items of lists) {
      for (const rest of [0, 1, 2, 3, 6, 7, 99, 8000, 8001, 16900, 21900, 123456, 123457, 999999]) {
        assert.deepEqual(planRollover(items, rest), serverPlan(items, rest), JSON.stringify(items) + ' rest ' + rest);
      }
    }
  });
});

describe('what the dialog shows', () => {
  it('is nothing for a bill with nothing on it', () => {
    assert.equal(summarizeRollover({ bill: { items: [], total: 0, movable: 0, fixed: 0 }, payNow: '', interest: '' }), null);
    assert.equal(summarizeRollover({ bill: null, payNow: '', interest: '' }), null);
  });

  it('says what each bill becomes, and which purchases move or split', () => {
    const s = summarizeRollover({ bill: bill(), payNow: '100', interest: '6.5' });
    assert.deepEqual([s.valid, s.thisBill, s.rest, s.interest, s.nextBill], [true, 100, 135, 6.5, 141.5]);
    assert.deepEqual(s.moves.map((m) => [m.description, m.action, m.part, m.of]), [['Klarna', 'move', 8, 8], ['IKEA', 'move', 89, 89], ['Shoes', 'split', 38, 138]]);
  });

  it('treats an empty "pay now" as paying everything, which leaves nothing to roll over', () => {
    assert.deepEqual(summarizeRollover({ bill: bill(), payNow: '', interest: '' }), { valid: false, reason: 'whole' });
    assert.deepEqual(summarizeRollover({ bill: bill(), payNow: '235', interest: '' }), { valid: false, reason: 'whole' });
    assert.deepEqual(summarizeRollover({ bill: bill(), payNow: '500', interest: '' }), { valid: false, reason: 'whole' });
  });

  it('allows paying nothing now, and a blank interest', () => {
    const s = summarizeRollover({ bill: bill(), payNow: '0', interest: '' });
    assert.deepEqual([s.valid, s.thisBill, s.rest, s.nextBill], [true, 0, 235, 235]);
    assert.equal(s.moves.length, 3);
  });

  it('refuses negative amounts', () => {
    assert.deepEqual(summarizeRollover({ bill: bill(), payNow: '-1', interest: '' }), { valid: false, reason: 'negative' });
    assert.deepEqual(summarizeRollover({ bill: bill(), payNow: '50', interest: '-2' }), { valid: false, reason: 'negative' });
  });

  it('says how much can move when fixed payments stay, and the least that has to be paid', () => {
    const b = bill([item(1, 'Klarna', 8), item(2, 'IKEA', 89), item(3, 'Sofa (1/3)', 100, false)]);
    assert.deepEqual(summarizeRollover({ bill: b, payNow: '50', interest: '' }), { valid: false, reason: 'toomuch', movable: 97, minPay: 100 });
    const ok = summarizeRollover({ bill: b, payNow: '100', interest: '' });
    assert.deepEqual([ok.valid, ok.rest], [true, 97]);
    assert.ok(ok.moves.every((m) => m.description !== 'Sofa (1/3)'), 'the fixed installment never moves');
  });

  it('adds in whole cents', () => {
    const b = bill([item(1, 'A', 0.1), item(2, 'B', 0.2)]);
    const s = summarizeRollover({ bill: b, payNow: '0.1', interest: '0.2' });
    assert.deepEqual([s.rest, s.nextBill], [0.2, 0.4]);
  });
});

describe('the months the rest can move to', () => {
  it('are the twelve after the bill, starting with the next', () => {
    const m = laterBillMonths('2031-11');
    assert.equal(m.length, 12);
    assert.deepEqual([m[0].value, m[1].value, m[11].value], ['2031-12', '2032-01', '2032-11']);
    assert.ok(m.every((x) => typeof x.label === 'string' && x.label.length > 0));
  });
});
