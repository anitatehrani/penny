import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installmentDates, splitInstallments } from '../../server/src/lib/schedule.js';
import { budgetStatus, describePlan, previewPlan, splitCents, timelineSteps } from '../src/debtLogic.js';

const long = (d) => `<${d}>`;

describe('splitting an amount over months', () => {
  it('shares it equally, with the odd cents on the first payments', () => {
    assert.deepEqual(splitCents(10000, 3), [3334, 3333, 3333]);
    assert.deepEqual(splitCents(30000, 3), [10000, 10000, 10000]);
    assert.deepEqual(splitCents(5, 3), [2, 2, 1]);
  });
  it('always adds back up to the total, and agrees with the server', () => {
    for (const total of [1, 2, 3, 99, 10000, 52000, 123457]) {
      for (const n of [1, 2, 3, 7, 12, 120]) {
        if (n > total) continue;
        const mine = splitCents(total, n);
        assert.equal(mine.reduce((a, b) => a + b, 0), total);
        assert.deepEqual(mine, splitInstallments(total, n), `${total} over ${n}`);
      }
    }
  });
});

describe('the preview of a repayment plan', () => {
  it('is nothing when there is no plan, nothing owed, or no date', () => {
    assert.equal(previewPlan({ plan: 'none', owed: 300, firstDate: '2031-01-10' }), null);
    assert.equal(previewPlan({ plan: 'once', owed: 0, firstDate: '2031-01-10' }), null);
    assert.equal(previewPlan({ plan: 'once', owed: 300, firstDate: '' }), null);
    assert.equal(previewPlan({ plan: 'monthly', owed: 300, firstDate: '2031-01-10', count: '' }), null);
    assert.equal(previewPlan({ plan: 'monthly', owed: 300, firstDate: '2031-01-10', count: 1 }), null, 'one payment is "all in one go"');
  });
  it('one payment of everything on the day', () => {
    assert.deepEqual(previewPlan({ plan: 'once', owed: 300, firstDate: '2031-01-10' }), { count: 1, first: '2031-01-10', last: '2031-01-10', each: 300, eachLast: 300, even: true });
  });
  it('monthly: how many, how much, and when the last one falls', () => {
    const p = previewPlan({ plan: 'monthly', owed: 300, firstDate: '2031-01-10', count: '3' });
    assert.deepEqual([p.count, p.each, p.eachLast, p.even, p.first, p.last], [3, 100, 100, true, '2031-01-10', '2031-03-10']);
    const odd = previewPlan({ plan: 'monthly', owed: 100, firstDate: '2031-01-10', count: 3 });
    assert.deepEqual([odd.each, odd.eachLast, odd.even], [33.34, 33.33, false]);
  });
  it('the dates match the server, including the 31st', () => {
    for (const first of ['2031-01-31', '2031-01-10', '2032-01-30']) {
      for (const n of [2, 3, 12]) {
        const p = previewPlan({ plan: 'monthly', owed: 1200, firstDate: first, count: n });
        assert.equal(p.last, installmentDates(first, n).at(-1), `${first} x${n}`);
      }
    }
  });
  it('never plans a payment of nothing: very little owed means fewer payments', () => {
    assert.equal(previewPlan({ plan: 'monthly', owed: 0.03, firstDate: '2031-01-10', count: 5 }).count, 3);
  });
  it('accepts amounts typed as text', () => {
    assert.equal(previewPlan({ plan: 'once', owed: '45.50', firstDate: '2031-01-10' }).each, 45.5);
  });
});

describe('describing a debt', () => {
  it('says what the plan is', () => {
    assert.equal(describePlan({ plan: 'none' }, long), 'Not scheduled yet');
    assert.equal(describePlan({ plan: 'once', first_due_date: '2031-01-10' }, long), 'All in one go on <2031-01-10>');
    assert.equal(describePlan({ plan: 'monthly', first_due_date: '2031-01-10', installment_count: 3 }, long), '3 monthly payments from <2031-01-10>');
  });
  it('says how it relates to the budget', () => {
    assert.deepEqual(budgetStatus({ status: 'settled', count_in_budget: true, scheduled_count: 0 }), { tone: 'ok', label: 'Settled' });
    assert.equal(budgetStatus({ status: 'active', count_in_budget: false, scheduled_count: 0 }).label, 'Not counted');
    assert.equal(budgetStatus({ status: 'active', count_in_budget: false, scheduled_count: 2 }).label, 'Not counted', 'off wins, whatever is left over');
    assert.equal(budgetStatus({ status: 'active', count_in_budget: true, scheduled_count: 2 }).label, 'In your forecast');
    assert.equal(budgetStatus({ status: 'active', count_in_budget: true, scheduled_count: 0 }).label, 'Counted · no plan yet');
  });
});

describe('the repayment timeline', () => {
  const TODAY = '2031-02-15';
  const pay = (id, date, amount, status) => ({ id, date, amount, status });
  const debt = (payments, over = {}) => ({ status: 'active', remaining: 300, payments, ...over });

  it('marks paid, the next pending one, and the later ones', () => {
    const { steps, debtFree } = timelineSteps(
      debt([pay(1, '2031-01-10', 100, 'paid'), pay(2, '2031-03-10', 100, 'pending'), pay(3, '2031-04-10', 100, 'pending')], { remaining: 200 }),
      TODAY,
    );
    assert.deepEqual(steps.map((s) => s.state), ['paid', 'next', 'later']);
    assert.equal(debtFree, '2031-04-10');
  });

  it('calls a pending payment whose day has passed overdue, and the next one is the first not overdue', () => {
    const { steps } = timelineSteps(debt([pay(1, '2031-01-10', 100, 'pending'), pay(2, '2031-02-20', 100, 'pending'), pay(3, '2031-03-20', 100, 'pending')]), TODAY);
    assert.deepEqual(steps.map((s) => s.state), ['overdue', 'next', 'later']);
  });

  it('treats today as still to come, not overdue', () => {
    assert.equal(timelineSteps(debt([pay(1, TODAY, 300, 'pending')]), TODAY).steps[0].state, 'next');
  });

  it('adds an open step for what no payment covers, and is not debt-free yet', () => {
    const { steps, debtFree } = timelineSteps(debt([pay(1, '2031-03-10', 100, 'pending')]), TODAY);
    assert.deepEqual(steps.map((s) => [s.state, s.amount]), [['next', 100], ['open', 200]]);
    assert.equal(debtFree, null);
  });

  it('is a single open step when nothing is scheduled', () => {
    const { steps, debtFree } = timelineSteps(debt([]), TODAY);
    assert.deepEqual(steps, [{ key: 'open', state: 'open', date: null, amount: 300 }]);
    assert.equal(debtFree, null);
  });

  it('counts cents exactly (no float drift) when deciding what is covered', () => {
    const { steps, debtFree } = timelineSteps(debt([pay(1, '2031-03-10', 0.1, 'pending'), pay(2, '2031-04-10', 0.2, 'pending')], { remaining: 0.3 }), TODAY);
    assert.equal(steps.some((s) => s.state === 'open'), false);
    assert.equal(debtFree, '2031-04-10');
  });

  it('shows only what was paid for a settled debt, with no open step and no debt-free line', () => {
    const { steps, debtFree } = timelineSteps(debt([pay(1, '2031-01-10', 300, 'paid')], { status: 'settled', remaining: 0 }), TODAY);
    assert.deepEqual(steps.map((s) => s.state), ['paid']);
    assert.equal(debtFree, null);
  });

  it('copes with a debt that has no payments list', () => {
    assert.deepEqual(timelineSteps({ status: 'settled', remaining: 0 }, TODAY), { steps: [], debtFree: null });
  });
});
