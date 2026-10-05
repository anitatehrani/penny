import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installmentDates } from '../../server/src/lib/schedule.js';
import { MAX_SEGMENTS, planFacts } from '../src/installmentLogic.js';

const plan = (over) => ({ installment_count: 6, first_due_date: '2031-01-10', total_amount: 720, paid_count: 3, ...over });

describe('what an installment plan card shows', () => {
  it('marks the paid ones, the one due next, and the rest', () => {
    assert.deepEqual(planFacts(plan()).segments, ['paid', 'paid', 'paid', 'next', 'later', 'later']);
    assert.deepEqual(planFacts(plan({ paid_count: 0 })).segments, ['next', 'later', 'later', 'later', 'later', 'later']);
  });
  it('has no next one when everything is paid, and says it is finished', () => {
    const f = planFacts(plan({ paid_count: 6 }));
    assert.deepEqual(f.segments, ['paid', 'paid', 'paid', 'paid', 'paid', 'paid']);
    assert.equal(f.finished, true);
    assert.equal(f.pct, 100);
  });
  it('works out the share paid and the average payment', () => {
    const f = planFacts(plan());
    assert.equal(f.pct, 50);
    assert.equal(f.each, 120);
    assert.equal(planFacts(plan({ total_amount: 100, installment_count: 3 })).each, 33.33);
  });
  it('keeps the continuous bar (no segments) for a plan too long to draw as steps', () => {
    assert.equal(planFacts(plan({ installment_count: MAX_SEGMENTS })).segments.length, MAX_SEGMENTS);
    assert.equal(planFacts(plan({ installment_count: MAX_SEGMENTS + 1 })).segments, null);
  });
  it('never lets the paid count run past the plan, or below nothing', () => {
    assert.equal(planFacts(plan({ paid_count: 99 })).paid, 6);
    assert.equal(planFacts(plan({ paid_count: -2 })).paid, 0);
  });
  it('copes with an empty plan', () => {
    assert.deepEqual(planFacts({ installment_count: 0, total_amount: 0, paid_count: 0 }), { count: 0, paid: 0, pct: 0, segments: null, each: 0, lastDue: null, finished: false });
  });
  it('ends on the same last day as the server schedule, including short months', () => {
    for (const first of ['2031-01-10', '2031-01-31', '2032-02-29', '2031-12-30']) {
      for (const n of [1, 2, 6, 12, 36]) {
        assert.equal(planFacts(plan({ first_due_date: first, installment_count: n, paid_count: 0 })).lastDue, installmentDates(first, n).at(-1), `${first} x${n}`);
      }
    }
  });
});
