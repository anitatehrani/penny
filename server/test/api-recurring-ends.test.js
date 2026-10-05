import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { nthOccurrence, occurrences } from '../src/lib/schedule.js';
import { fails, ok, shutdown, signup, startServer, thisMonth } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('recurringends');
});
after(async () => {
  await shutdown(srv);
});

const M = thisMonth();
const NEXT = addMonthsYM(M, 1);
const fresh = async () => (await signup(srv)).client;
const rule = (c, over = {}) => c.post('/recurring', { type: 'expense', description: 'Gym', amount: 30, frequency: 'monthly', start_date: `${NEXT}-10`, ...over });
const pendingDates = async (c, id) => ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=pending&limit=500')).filter((t) => t.recurring_id === id).map((t) => t.date).sort();

describe('the date of the n-th payment', () => {
  it('is the start date for the first, and follows the schedule after that', () => {
    const monthly = { frequency: 'monthly', interval_count: 1, start_date: '2031-01-10' };
    assert.equal(nthOccurrence(monthly, 1), '2031-01-10');
    assert.equal(nthOccurrence(monthly, 2), '2031-02-10');
    assert.equal(nthOccurrence(monthly, 13), '2032-01-10');
    assert.equal(nthOccurrence({ ...monthly, interval_count: 3 }, 4), '2031-10-10', 'quarterly');
    assert.equal(nthOccurrence({ frequency: 'weekly', interval_count: 1, start_date: '2031-01-01' }, 5), '2031-01-29');
    assert.equal(nthOccurrence({ frequency: 'weekly', interval_count: 2, start_date: '2031-01-01' }, 3), '2031-01-29', 'every two weeks');
    assert.equal(nthOccurrence({ frequency: 'yearly', interval_count: 1, start_date: '2031-03-05' }, 3), '2033-03-05');
  });

  it('keeps the anchor day and shortens it in short months, like the schedule itself', () => {
    const r = { frequency: 'monthly', interval_count: 1, start_date: '2031-01-31' };
    assert.equal(nthOccurrence(r, 2), '2031-02-28');
    assert.equal(nthOccurrence(r, 3), '2031-03-31');
    assert.equal(nthOccurrence({ frequency: 'yearly', interval_count: 1, start_date: '2032-02-29' }, 2), '2033-02-28');
  });

  it('is exactly where the schedule stops: ending there gives n payments, one earlier gives n-1', () => {
    const rules = [
      { frequency: 'monthly', interval_count: 1, start_date: '2031-01-31' },
      { frequency: 'monthly', interval_count: 2, start_date: '2031-05-15' },
      { frequency: 'weekly', interval_count: 1, start_date: '2031-01-01' },
      { frequency: 'weekly', interval_count: 3, start_date: '2031-02-14' },
      { frequency: 'yearly', interval_count: 1, start_date: '2032-02-29' },
    ];
    for (const r of rules) {
      for (const n of [1, 2, 5, 12, 40]) {
        const end = nthOccurrence(r, n);
        assert.equal(occurrences({ ...r, end_date: end }, '2000-01-01', '2100-01-01').length, n, `${r.frequency} x${r.interval_count} from ${r.start_date}: ${n} payments`);
        if (n > 1) assert.equal(occurrences({ ...r, end_date: nthOccurrence(r, n - 1) }, '2000-01-01', '2100-01-01').length, n - 1);
      }
    }
  });
});

describe('stopping after a number of payments', () => {
  it('works out the end date and creates exactly that many payments', async () => {
    const c = await fresh();
    const r = ok(await rule(c, { ends_after: 4 }), 201);
    assert.equal(r.end_date, `${addMonthsYM(NEXT, 3)}-10`);
    assert.deepEqual(await pendingDates(c, r.id), [0, 1, 2, 3].map((i) => `${addMonthsYM(NEXT, i)}-10`));
  });

  it('a single payment is a one-off: it ends on its own start date', async () => {
    const c = await fresh();
    const r = ok(await rule(c, { ends_after: 1 }), 201);
    assert.equal(r.end_date, `${NEXT}-10`);
    assert.deepEqual(await pendingDates(c, r.id), [`${NEXT}-10`]);
  });

  it('counts weekly and yearly items on their own schedule', async () => {
    const c = await fresh();
    const w = ok(await rule(c, { frequency: 'weekly', start_date: `${NEXT}-01`, ends_after: 3 }), 201);
    assert.equal((await pendingDates(c, w.id)).length, 3);
    const y = ok(await rule(c, { frequency: 'yearly', start_date: `${NEXT}-05`, ends_after: 2 }), 201);
    assert.equal(y.end_date, `${Number(NEXT.slice(0, 4)) + 1}-${NEXT.slice(5)}-05`);
  });

  it('also works when editing, replacing the old ending', async () => {
    const c = await fresh();
    const r = ok(await rule(c, { end_date: `${addMonthsYM(NEXT, 10)}-10` }), 201);
    const body = { type: 'expense', description: 'Gym', amount: 30, frequency: 'monthly', start_date: `${NEXT}-10` };
    const shorter = ok(await c.put(`/recurring/${r.id}`, { ...body, ends_after: 2 }));
    assert.equal(shorter.end_date, `${addMonthsYM(NEXT, 1)}-10`);
    assert.equal((await pendingDates(c, r.id)).length, 2, 'the unpaid payments beyond it are gone');
    const never = ok(await c.put(`/recurring/${r.id}`, body));
    assert.equal(never.end_date, null, 'leaving the ending out means it never ends');
    assert.ok((await pendingDates(c, r.id)).length > 12);
  });

  it('refuses both an end date and a number of payments, and numbers that do not make sense', async () => {
    const c = await fresh();
    assert.match(fails(await rule(c, { ends_after: 3, end_date: `${addMonthsYM(NEXT, 5)}-10` }), 400).error, /either an end date or a number of payments/);
    for (const bad of [0, -1, 601, 2.5, '3', 'x', true]) fails(await rule(c, { ends_after: bad }), 400);
    assert.match(fails(await rule(c, { frequency: 'yearly', interval_count: 60, ends_after: 600 }), 400).error, /too far in the future/);
    assert.equal(ok(await c.get('/recurring')).length, 0, 'none of them were saved');
  });

  it('null means no limit, the same as leaving it out', async () => {
    const c = await fresh();
    assert.equal(ok(await rule(c, { ends_after: null }), 201).end_date, null);
    assert.equal(ok(await rule(c, { ends_after: null, end_date: null }), 201).end_date, null);
  });
});

describe('stopping on a date is unchanged', () => {
  it('ends on the given day, and is refused before the start', async () => {
    const c = await fresh();
    const r = ok(await rule(c, { end_date: `${addMonthsYM(NEXT, 2)}-10` }), 201);
    assert.equal((await pendingDates(c, r.id)).length, 3);
    fails(await rule(c, { end_date: `${NEXT}-09` }), 400);
    assert.equal(ok(await rule(c, { end_date: `${NEXT}-10` }), 201).end_date, `${NEXT}-10`, 'the same day is fine');
  });
});
