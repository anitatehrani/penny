import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nthOccurrence as serverNth, occurrences } from '../../server/src/lib/schedule.js';
import { lastOccurrence, nthOccurrence } from '../src/recurrenceLogic.js';

const rules = [
  { frequency: 'monthly', interval_count: 1, start_date: '2031-01-10' },
  { frequency: 'monthly', interval_count: 1, start_date: '2031-01-31' },
  { frequency: 'monthly', interval_count: 3, start_date: '2031-05-15' },
  { frequency: 'weekly', interval_count: 1, start_date: '2031-01-01' },
  { frequency: 'weekly', interval_count: 2, start_date: '2031-12-20' },
  { frequency: 'yearly', interval_count: 1, start_date: '2032-02-29' },
  { frequency: 'yearly', interval_count: 2, start_date: '2031-07-04' },
];

describe('the date of the n-th payment', () => {
  it('is the start date for the first', () => {
    for (const r of rules) assert.equal(nthOccurrence(r, 1), r.start_date);
  });
  it('agrees with the server for every kind of rule', () => {
    for (const r of rules) for (const n of [1, 2, 3, 7, 12, 13, 36, 100]) assert.equal(nthOccurrence(r, n), serverNth(r, n), `${r.frequency} x${r.interval_count} ${r.start_date} #${n}`);
  });
  it('accepts the interval typed into a form field as text', () => {
    assert.equal(nthOccurrence({ frequency: 'monthly', interval_count: '2', start_date: '2031-01-10' }, 3), '2031-05-10');
  });
  it('shortens the 31st in short months and comes back to it', () => {
    const r = { frequency: 'monthly', interval_count: 1, start_date: '2031-01-31' };
    assert.deepEqual([2, 3, 4].map((n) => nthOccurrence(r, n)), ['2031-02-28', '2031-03-31', '2031-04-30']);
  });
});

describe('the last payment before an end date', () => {
  it('is the last slot on or before it, with how many payments that makes', () => {
    const r = { frequency: 'monthly', interval_count: 1, start_date: '2031-01-10' };
    assert.deepEqual(lastOccurrence(r, '2031-06-10'), { date: '2031-06-10', count: 6 });
    assert.deepEqual(lastOccurrence(r, '2031-06-09'), { date: '2031-05-10', count: 5 }, 'a day short: the one before');
    assert.deepEqual(lastOccurrence(r, '2031-01-10'), { date: '2031-01-10', count: 1 });
  });
  it('is nothing when the end is before the start, or missing', () => {
    const r = { frequency: 'monthly', interval_count: 1, start_date: '2031-01-10' };
    assert.equal(lastOccurrence(r, '2031-01-09'), null);
    assert.equal(lastOccurrence(r, ''), null);
    assert.equal(lastOccurrence(r, undefined), null);
  });
  it('agrees with the server about how many payments there are', () => {
    for (const r of rules) {
      for (const end of ['2031-03-01', '2031-12-31', '2033-06-15', '2040-01-01']) {
        const server = occurrences({ ...r, end_date: end }, '2000-01-01', '2100-01-01');
        const mine = lastOccurrence(r, end);
        if (!server.length) assert.equal(mine, null);
        else assert.deepEqual([mine.count, mine.date], [server.length, server.at(-1)], `${r.frequency} ${r.start_date} to ${end}`);
      }
    }
  });
  it('round-trips: ending after n payments, then asking for the last payment, gives n', () => {
    for (const r of rules) for (const n of [1, 4, 12]) assert.equal(lastOccurrence(r, nthOccurrence(r, n)).count, n);
  });
});
