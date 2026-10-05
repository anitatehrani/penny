import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeLine } from '../src/safeLogic.js';

const fmt = { money: (n) => `€${n.toFixed(2)}`, dateLabel: (d) => `<${d}>` };
const base = { until: '2031-03-20', until_kind: 'income', days: 11, balance: 1000, bills: 200, bills_count: 2, buffer: 0, available: 800, per_day: 72.72, short: 0, next_income: { date: '2031-03-21', description: 'Mo — salary', amount: 1500 } };

describe('the safe-to-spend line', () => {
  it('says how much a day for how long, until which income', () => {
    const l = safeLine(base, fmt);
    assert.equal(l.tone, 'ok');
    assert.equal(l.text, 'Safe to spend €72.72 a day for 11 days, until Mo — salary on <2031-03-21>');
  });

  it('says one day in the singular, and the end of the month when there is no income ahead', () => {
    const l = safeLine({ ...base, days: 1, until_kind: 'month-end', next_income: null }, fmt);
    assert.equal(l.text, 'Safe to spend €72.72 a day for 1 day, until the end of the month');
  });

  it('says how much is short, not a negative allowance', () => {
    const l = safeLine({ ...base, per_day: 0, short: 150, available: -150 }, fmt);
    assert.equal(l.tone, 'short');
    assert.equal(l.text, '€150.00 short before Mo — salary on <2031-03-21>');
  });

  it('says there is nothing spare when it comes out exactly even', () => {
    const l = safeLine({ ...base, per_day: 0, short: 0, available: 0 }, fmt);
    assert.deepEqual([l.tone, l.text], ['none', 'Nothing spare before Mo — salary on <2031-03-21>']);
  });

  it('shows the arithmetic, with the buffer only when there is one', () => {
    const a = safeLine(base, fmt).arithmetic;
    assert.deepEqual(a.map((r) => r[0]), ['Balance today', 'Still to pay until <2031-03-20> (2 payments)', 'Left to spend', 'Over 11 days']);
    assert.deepEqual(a.map((r) => r[1]), ['€1000.00', '−€200.00', '€800.00', '€72.72 a day']);
    const withBuffer = safeLine({ ...base, buffer: 100, available: 700 }, fmt).arithmetic;
    assert.ok(withBuffer.some((r) => r[0] === 'Safety buffer' && r[1] === '−€100.00'));
  });

  it('labels a shortfall as short, and does not say "0 payments"', () => {
    const a = safeLine({ ...base, bills_count: 0, bills: 0, available: -5, per_day: 0, short: 5 }, fmt).arithmetic;
    assert.equal(a[1][0], 'Still to pay until <2031-03-20>');
    assert.deepEqual(a.at(-2), ['Short', '€5.00']);
    assert.equal(a.at(-1)[1], '—');
  });

  it('is nothing without an answer', () => {
    assert.equal(safeLine(null, fmt), null);
    assert.equal(safeLine(undefined, fmt), null);
  });
});
