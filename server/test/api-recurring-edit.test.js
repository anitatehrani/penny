import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { ok, shutdown, signup, startServer, thisMonth } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('recurringedit');
});
after(async () => {
  await shutdown(srv);
});

const M = thisMonth();
const fresh = async () => (await signup(srv)).client;
const body = (over = {}) => ({ type: 'expense', description: 'Rent', amount: 1000, frequency: 'monthly', interval_count: 1, start_date: `${M}-15`, active: true, ...over });
const mine = async (c, ruleId) => ok(await c.get('/transactions?from=2000-01-01&to=2100-01-01&status=&limit=1000')).filter((t) => t.recurring_id === ruleId).sort((a, b) => a.date.localeCompare(b.date));
const day = (t) => t.date.slice(8);

describe('changing a recurring item on the Recurring page changes every month still to come', () => {
  it('a new day of the month reaches every unpaid payment', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body()), 201);
    const before = (await mine(c, rule.id)).filter((t) => t.status === 'pending');
    assert.ok(before.length >= 24, 'two years ahead');
    assert.ok(before.every((t) => day(t) === '15'));
    ok(await c.put(`/recurring/${rule.id}`, body({ start_date: `${M}-20` })));
    const after = (await mine(c, rule.id)).filter((t) => t.status === 'pending');
    assert.equal(after.length, before.length, 'the same number of months');
    assert.ok(after.every((t) => day(t) === '20'), 'every one is on the 20th now: ' + [...new Set(after.map(day))]);
    assert.deepEqual(after.map((t) => t.date.slice(0, 7)), before.map((t) => t.date.slice(0, 7)), 'in the same months');
  });

  it('a new amount reaches every unpaid payment too', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body()), 201);
    ok(await c.put(`/recurring/${rule.id}`, body({ amount: 1200 })));
    const after = (await mine(c, rule.id)).filter((t) => t.status === 'pending');
    assert.ok(after.every((t) => t.amount === 1200));
  });

  it('what was already paid stays as it was, on its own day and amount', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body({ start_date: `${addMonthsYM(M, -2)}-15` })), 201);
    const list = await mine(c, rule.id);
    const first = list.find((t) => t.date >= `${M}-01`);
    ok(await c.patch(`/transactions/${first.id}/status`, { status: 'paid' }));
    ok(await c.put(`/recurring/${rule.id}`, body({ start_date: `${M}-25`, amount: 1100 })));
    const paid = (await mine(c, rule.id)).filter((t) => t.status === 'paid');
    assert.deepEqual(paid.map((t) => [t.date, t.amount]), [[first.date, 1000]]);
  });

  it('the month that is already paid does not get a second payment when the day changes', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body({ start_date: `${M}-01` })), 201);
    const thisMonths = (await mine(c, rule.id)).find((t) => t.date.startsWith(M));
    ok(await c.patch(`/transactions/${thisMonths.id}/status`, { status: 'paid' }));
    ok(await c.put(`/recurring/${rule.id}`, body({ start_date: `${M}-20` })));
    const inThisMonth = (await mine(c, rule.id)).filter((t) => t.date.startsWith(M));
    assert.equal(inThisMonth.length, 1, 'one rent this month, the one already paid: ' + inThisMonth.map((t) => `${t.date} ${t.status}`).join(', '));
    const later = (await mine(c, rule.id)).filter((t) => t.status === 'pending');
    assert.ok(later.every((t) => day(t) === '20'), 'the months to come are on the new day');
  });
});

describe('changing one month on the Payments page changes only that month', () => {
  it('a new day and amount for one payment leaves the other months and the recurring item alone', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body()), 201);
    const before = await mine(c, rule.id);
    const third = before[2];
    const moved = ok(await c.put(`/transactions/${third.id}`, { type: 'expense', description: 'Rent', amount: 777, date: `${third.date.slice(0, 7)}-03` }));
    assert.deepEqual([moved.date.slice(8), moved.amount], ['03', 777]);
    const after = await mine(c, rule.id);
    assert.equal(after.length, before.length, 'no month was added or lost');
    for (let i = 0; i < before.length; i++) {
      if (i === 2) continue;
      assert.deepEqual([after[i].date, after[i].amount], [before[i].date, before[i].amount], `month ${i + 1} is untouched`);
    }
    const r = ok(await c.get('/recurring')).find((x) => x.id === rule.id);
    assert.deepEqual([r.start_date, r.amount, r.description], [`${M}-15`, 1000, 'Rent'], 'the recurring item is as it was');
  });

  it('the changed month is still tied to its own slot: it is not made again later', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body()), 201);
    const before = await mine(c, rule.id);
    const second = before[1];
    ok(await c.put(`/transactions/${second.id}`, { type: 'expense', description: 'Rent', amount: 1000, date: `${second.date.slice(0, 7)}-28` }));
    // the same rule saved again without changes makes the same slots: the moved month keeps being that month's payment
    const rows = await mine(c, rule.id);
    assert.equal(rows.filter((t) => t.date.startsWith(second.date.slice(0, 7))).length, 1, 'one payment in that month');
  });

  it('marking one month paid, skipping it or deleting it does not touch the others either', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body()), 201);
    const before = await mine(c, rule.id);
    ok(await c.patch(`/transactions/${before[1].id}/status`, { status: 'paid' }));
    ok(await c.del(`/transactions/${before[2].id}`)); // skips that month
    const after = await mine(c, rule.id); // the list does not show a skipped month
    assert.equal(after.length, before.length - 1, 'only the skipped month is gone from the list');
    assert.deepEqual(after.map((t) => t.date).slice(0, 3), [before[0].date, before[1].date, before[3].date]);
    assert.equal(after[1].status, 'paid');
    assert.ok(after.filter((t) => t.status === 'pending').every((t) => day(t) === '15' && t.amount === 1000));
  });
});

describe('a month that is already settled is not made again when the day changes', () => {
  it('a skipped month stays skipped when the rule moves to another day', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body()), 201);
    const before = await mine(c, rule.id);
    const skippedMonth = before[2].date.slice(0, 7);
    ok(await c.del(`/transactions/${before[2].id}`));
    ok(await c.put(`/recurring/${rule.id}`, body({ start_date: `${M}-20` })));
    const after = await mine(c, rule.id);
    assert.equal(after.filter((t) => t.date.startsWith(skippedMonth)).length, 0, 'still no payment in the month that was skipped');
    assert.ok(after.length >= before.length - 1);
  });

  it('a yearly item already paid this year is not made a second time in the year when its date moves', async () => {
    const c = await fresh();
    const year = M.slice(0, 4);
    const rule = ok(await c.post('/recurring', body({ frequency: 'yearly', description: 'Insurance', amount: 400, start_date: `${year}-${M.slice(5)}-01` })), 201);
    const thisYears = (await mine(c, rule.id)).find((t) => t.date.startsWith(year));
    ok(await c.patch(`/transactions/${thisYears.id}/status`, { status: 'paid' }));
    ok(await c.put(`/recurring/${rule.id}`, body({ frequency: 'yearly', description: 'Insurance', amount: 400, start_date: `${year}-${M.slice(5)}-20` })));
    const rows = await mine(c, rule.id);
    assert.equal(rows.filter((t) => t.date.startsWith(year)).length, 1, 'one this year: ' + rows.map((t) => `${t.date} ${t.status}`).join(', '));
    assert.ok(rows.filter((t) => t.status === 'pending').every((t) => day(t) === '20'));
  });

  it('a weekly item is not affected (it has several payments a month)', async () => {
    const c = await fresh();
    const rule = ok(await c.post('/recurring', body({ frequency: 'weekly', description: 'Market', amount: 30, start_date: `${M}-01` })), 201);
    ok(await c.put(`/recurring/${rule.id}`, body({ frequency: 'weekly', description: 'Market', amount: 30, start_date: `${M}-02` })));
    const inMonth = (await mine(c, rule.id)).filter((t) => t.date.startsWith(M));
    assert.ok(inMonth.length >= 4, 'weekly keeps its several payments a month');
  });
});
