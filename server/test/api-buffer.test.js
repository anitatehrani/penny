import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { buildForecast } from '../src/lib/forecast.js';
import { daysFromToday, fails, ok, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('buffer');
});
after(async () => {
  await shutdown(srv);
});

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const person = async () => {
  const p = await signup(srv);
  ok(await p.client.put('/notifications/settings', { timezone: LOCAL_TZ, balance_warning: true, forecast_warning: true, ai_insights: false, weekly_summary: false, monthly_summary: false }));
  return p;
};
const setBuffer = async (c, min_balance) => {
  const s = ok(await c.get('/settings'));
  return ok(await c.put('/settings', { opening_balance: s.opening_balance, currency: s.currency, min_balance }));
};
const scan = async (p) => ok(await p.client.post('/notifications/refresh'));
const notes = async (p, kind) => ok(await p.client.get('/notifications')).items.filter((n) => n.kind === kind);
const ask = async (p, question) => ok(await p.client.post('/assistant/ask', { question }));
const insights = async (p) => ok(await p.client.get('/insights'));
const M = thisMonth();

describe('the safety buffer setting', () => {
  it('is 0 to start with, can be set, is kept when a save does not mention it, and is never negative', async () => {
    const { client: c } = await signup(srv);
    assert.equal(ok(await c.get('/settings')).min_balance, 0);
    assert.equal((await setBuffer(c, 200)).min_balance, 200);
    assert.equal(ok(await c.put('/settings', { opening_balance: 5, currency: 'EUR' })).min_balance, 200, 'saving something else keeps it');
    assert.equal((await setBuffer(c, 0)).min_balance, 0, 'it can be turned off again');
    fails(await c.put('/settings', { opening_balance: 0, currency: 'EUR', min_balance: -1 }), 400);
    fails(await c.put('/settings', { opening_balance: 0, currency: 'EUR', min_balance: 'lots' }), 400);
  });

  it('is rounded to cents, and belongs to one budget', async () => {
    const a = (await signup(srv)).client;
    const b = (await signup(srv)).client;
    assert.equal((await setBuffer(a, 99.999)).min_balance, 100);
    assert.equal(ok(await b.get('/settings')).min_balance, 0);
  });
});

describe('the forecast with a buffer', () => {
  const NEXT = addMonthsYM(M, 1);
  async function withBill(buffer) {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 500, currency: 'EUR' }));
    await setBuffer(p.client, buffer);
    await tx(p.client, { description: 'Rent', amount: 400, date: `${NEXT}-05`, status: 'pending' });
    return p;
  }

  it('calls a month "negative" only when it is below zero when there is no buffer', async () => {
    const p = await withBill(0);
    const f = ok(await p.client.get('/forecast?past=0&months=3&estimateExpenses=0'));
    assert.equal(f.minBalance, 0);
    assert.equal(f.insights.firstNegativeMonth, null, 'the balance ends at 100: fine without a buffer');
    assert.equal(f.insights.negativeMonths, 0);
  });

  it('calls it too low when it dips below the buffer, though still above zero', async () => {
    const p = await withBill(200);
    const f = ok(await p.client.get('/forecast?past=0&months=3&estimateExpenses=0'));
    assert.equal(f.minBalance, 200);
    assert.deepEqual(f.insights.firstNegativeMonth, { month: NEXT, balance: 100 });
    assert.ok(f.insights.negativeMonths >= 1);
    assert.equal(f.insights.minBalance, 200);
  });

  it('a balance exactly at the buffer is fine', async () => {
    const p = await withBill(100);
    assert.equal(ok(await p.client.get('/forecast?past=0&months=3&estimateExpenses=0')).insights.firstNegativeMonth, null);
  });
});

describe('buildForecast with a buffer', () => {
  const rows = [{ month: '2031-02', type: 'expense', status: 'pending', cents: 40000 }];
  const base = { rows, manualPaidRows: [], openingCents: 50000, currentMonth: '2031-01', past: 0, months: 3, estimateExpenses: false };
  it('uses the buffer instead of zero for the first low month and the count of low months', () => {
    const none = buildForecast({ ...base });
    const some = buildForecast({ ...base, minCents: 20000 });
    assert.equal(none.insights.firstNegativeMonth, null);
    assert.equal(some.insights.firstNegativeMonth.month, '2031-02');
    assert.equal(some.insights.negativeMonths, 3, 'February and the two months after, which stay at 100');
    assert.equal(some.minBalance, 200);
  });
  it('still reports the lowest point the same way', () => {
    assert.deepEqual(buildForecast({ ...base, minCents: 20000 }).insights.lowest, buildForecast({ ...base }).insights.lowest);
  });
});

describe('alerts with a buffer', () => {
  it('warns when the balance is under the buffer but above zero, once a month', async () => {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 150, currency: 'EUR' }));
    await setBuffer(p.client, 200);
    await tx(p.client, { description: 'Small bill', amount: 10, date: daysFromToday(3), status: 'pending' }); // a budget needs something pending
    await scan(p);
    const n = (await notes(p, 'balance_warning'))[0];
    assert.match(n.title, /below your safety buffer/);
    assert.equal(n.data.balance, 150);
    assert.equal(n.data.buffer, 200);
    assert.equal((await scan(p)).created, 0, 'not repeated');
  });

  it('says "below zero", not "below the buffer", when the balance is negative', async () => {
    const p = await person();
    await setBuffer(p.client, 200);
    await tx(p.client, { description: 'Overspent', amount: 50, date: today(), status: 'paid' });
    await tx(p.client, { description: 'Pending', amount: 10, date: daysFromToday(3), status: 'pending' });
    await scan(p);
    assert.match((await notes(p, 'balance_warning'))[0].title, /below zero/);
  });

  it('warns about a dip ahead in the right words: negative, or below the buffer', async () => {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    await setBuffer(p.client, 300);
    const M3 = addMonthsYM(M, 3);
    await tx(p.client, { description: 'Big bill', amount: 800, date: `${M3}-10`, status: 'pending' }); // ends at 200: above zero, under the buffer
    await scan(p);
    const n = (await notes(p, 'forecast_warning'))[0];
    assert.match(n.title, /projected to go below your safety buffer in /);
    assert.equal(n.data.balance, 200);

    const q = await person();
    ok(await q.client.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    await setBuffer(q.client, 300);
    await tx(q.client, { description: 'Huge bill', amount: 2000, date: `${M3}-10`, status: 'pending' }); // ends below zero
    await scan(q);
    assert.match((await notes(q, 'forecast_warning'))[0].title, /projected to go negative in /);
  });

  it('does nothing extra with no buffer', async () => {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 150, currency: 'EUR' }));
    await tx(p.client, { description: 'Small bill', amount: 10, date: daysFromToday(3), status: 'pending' });
    await scan(p);
    assert.deepEqual(await notes(p, 'balance_warning'), []);
  });
});

describe('the assistant and the insights with a buffer', () => {
  it('answers "Will I go negative?" in terms of the buffer', async () => {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 150, currency: 'EUR' }));
    await setBuffer(p.client, 200);
    await tx(p.client, { description: 'Small bill', amount: 10, date: daysFromToday(3), status: 'pending' });
    assert.match((await ask(p, 'Will I go negative?')).answer, /below your safety buffer of /);

    const q = await person();
    ok(await q.client.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    await setBuffer(q.client, 300);
    await tx(q.client, { description: 'Big bill', amount: 800, date: `${addMonthsYM(M, 2)}-10`, status: 'pending' });
    assert.match((await ask(q, 'Will I go negative?')).answer, /first drops below your safety buffer of /);

    const r = await person();
    ok(await r.client.put('/settings', { opening_balance: 5000, currency: 'EUR' }));
    await setBuffer(r.client, 300);
    await tx(r.client, { description: 'Small bill', amount: 10, date: daysFromToday(3), status: 'pending' });
    assert.match((await ask(r, 'Will I go negative?')).answer, /stays above your safety buffer of /);
  });

  it('keeps the old words when there is no buffer', async () => {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    await tx(p.client, { description: 'Huge bill', amount: 5000, date: `${addMonthsYM(M, 2)}-10`, status: 'pending' });
    assert.match((await ask(p, 'Will I go negative?')).answer, /first drops below zero/);
  });

  it('has an insight for a balance under the buffer, and not a second one for the same thing ahead', async () => {
    const p = await person();
    ok(await p.client.put('/settings', { opening_balance: 150, currency: 'EUR' }));
    await setBuffer(p.client, 200);
    await tx(p.client, { description: 'Small bill', amount: 10, date: daysFromToday(3), status: 'pending' });
    const types = (await insights(p)).insights.map((i) => i.type);
    assert.ok(types.includes('below-buffer'), types.join());
    assert.ok(!types.includes('forecast-negative'), 'no second warning about the same shortfall');
  });
});
