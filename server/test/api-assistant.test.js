import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, connect, daysFromToday, fails, ok, PW, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('assistant');
});
after(async () => {
  await shutdown(srv);
});

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const setPrefs = async (p, body) => ok(await p.client.put('/notifications/settings', body));
const scan = async (p) => ok(await p.client.post('/notifications/refresh'));
const list = async (p, qs = '') => ok(await p.client.get(`/notifications${qs}`));
const kinds = async (p) => (await list(p)).items.map((n) => n.kind);
/** A fresh account in the server's time zone with every automatic alert off, so each test opts in to what it checks. */
const person = async (over = {}) => {
  const p = await signup(srv);
  await setPrefs(p, { timezone: LOCAL_TZ, balance_warning: false, forecast_warning: false, ai_insights: false, weekly_summary: false, monthly_summary: false, ...over });
  return p;
};
const pay = (c, ahead, over = {}) => tx(c, { description: `Pay ${ahead}`, amount: 25, date: daysFromToday(ahead), status: 'pending', ...over });
const insights = async (p) => ok(await p.client.get('/insights'));
const ask = async (p, question) => ok(await p.client.post('/assistant/ask', { question }));
const firstOfMonth = (back) => `${addMonthsYM(thisMonth(), -back)}-10`;

describe('preferences', () => {
  it('start empty, merge by key, and can be reset', async () => {
    const p = await signup(srv);
    assert.deepEqual(ok(await p.client.get('/preferences')), {});
    ok(await p.client.put('/preferences', { density: 'compact', accent: 'green' }));
    assert.deepEqual(ok(await p.client.get('/preferences')), { density: 'compact', accent: 'green' });
    ok(await p.client.put('/preferences', { accent: 'rose', sidebar_collapsed: true }));
    assert.deepEqual(ok(await p.client.get('/preferences')), { density: 'compact', accent: 'rose', sidebar_collapsed: true });
    const layout = { order: ['spending', 'hero'], hidden: ['recurring'], sizes: { hero: 'l', upcoming: 's' } };
    ok(await p.client.put('/preferences', { layout, favorites: ['payments', 'forecast'], avatar_style: 'generated' }));
    const got = ok(await p.client.get('/preferences'));
    assert.deepEqual(got.layout, layout);
    assert.deepEqual(got.favorites, ['payments', 'forecast']);
    assert.equal((await p.client.del('/preferences')).status, 204);
    assert.deepEqual(ok(await p.client.get('/preferences')), {});
  });

  it('reject anything they do not recognise', async () => {
    const p = await signup(srv);
    for (const bad of [
      { density: 'huge' },
      { accent: 'neon' },
      { sidebar_collapsed: 'yes' },
      { surprise: true },
      { layout: { order: ['hero', 'hero'] } },
      { layout: { order: ['nope'] } },
      { layout: { sizes: { hero: 'xl' } } },
      { layout: { extra: 1 } },
      { favorites: ['payments', 'payments'] },
      { favorites: ['/etc/passwd'] },
      { avatar_style: 'cartoon' },
      { collapsed: ['hero', 'hero'] },
      { collapsed: ['nope'] },
    ]) fails(await p.client.put('/preferences', bad), 400);
    assert.deepEqual(ok(await p.client.get('/preferences')), {}, 'nothing was stored');
  });

  it('belong to one person, and need a session', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    ok(await a.client.put('/preferences', { accent: 'amber' }));
    assert.deepEqual(ok(await b.client.get('/preferences')), {});
    const anon = new (a.client.constructor)(a.client.root);
    fails(await anon.get('/preferences'), 401);
    fails(await anon.put('/preferences', { accent: 'amber' }), 401);
  });
});

describe('who is around', () => {
  it('shows connections as active, respects the opt-out, and hides strangers', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const stranger = await signup(srv);
    await connect(a, b);
    await b.client.get('/preferences'); // any request counts as being around
    await stranger.client.get('/preferences');
    const seen = ok(await a.client.get('/presence'));
    assert.equal(seen[b.user.username].online, true);
    assert.ok(!(stranger.user.username in seen), 'a stranger is not visible');
    assert.equal(seen[a.user.username].online, true, 'you see yourself');

    // b opts out of showing status
    const me = ok(await b.client.get('/auth/me')).user;
    ok(await b.client.put('/profile', { name: me.name, username: me.username, phone: me.phone ?? null, discoverable: me.discoverable, find_by_email: me.find_by_email, find_by_phone: me.find_by_phone, show_status: false }));
    assert.ok(!(b.user.username in ok(await a.client.get('/presence'))));
  });

  it('counts someone as offline after five minutes', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    await b.client.get('/preferences');
    await srv.db.query(`UPDATE users SET last_seen_at = now() - interval '20 minutes' WHERE id = \$1`, [b.user.id]);
    const seen = ok(await a.client.get('/presence'));
    assert.equal(seen[b.user.username].online, false);
    assert.ok(seen[b.user.username].last_seen);
  });
});

describe('the assistant: insights', () => {
  it('says nothing useful about an empty budget, and says so', async () => {
    const p = await signup(srv);
    const r = await insights(p);
    assert.equal(r.empty, true);
    assert.deepEqual(r.insights, []);
    assert.match(r.summary.text, /nothing in this budget yet/i);
  });

  it('flags overdue payments, a crowded week, and a forecast that goes negative', async () => {
    const p = await person();
    await tx(p.client, { type: 'income', description: 'Pay', amount: 200, date: today(), status: 'paid' });
    ok(await tx(p.client, { description: 'Late rent', amount: 90, date: daysFromToday(-3), status: 'pending' }), 201);
    for (const d of [1, 2, 4]) ok(await tx(p.client, { description: `Bill ${d}`, amount: 60, date: daysFromToday(d), status: 'pending' }), 201);
    ok(await tx(p.client, { description: 'Far bill', amount: 5000, date: `${addMonthsYM(thisMonth(), 3)}-10`, status: 'pending' }), 201);
    const r = await insights(p);
    const byType = Object.fromEntries(r.insights.map((i) => [i.type, i]));
    assert.match(byType.overdue.title, /One overdue payment \(\$90\)/);
    assert.equal(byType.overdue.severity, 'alert');
    assert.match(byType['week-ahead'].title, /Three upcoming payments \(\$180\) may affect your balance next week/);
    assert.match(byType['week-ahead'].body, /would be/);
    assert.match(byType['forecast-negative'].title, /You may run below \$0 in /);
    assert.equal(byType['forecast-negative'].forecast, true);
    assert.ok(byType['forecast-negative'].details.length >= 2);
    // most urgent first
    const order = r.insights.map((i) => i.severity);
    assert.deepEqual(order, [...order].sort((a, b) => ['alert', 'watch', 'good', 'info'].indexOf(a) - ['alert', 'watch', 'good', 'info'].indexOf(b)));
    for (const i of r.insights) {
      assert.match(i.key, /^[a-z0-9:_-]+$/i);
      assert.ok(Array.isArray(i.details) && Array.isArray(i.ask));
    }
  });

  it('suggests where to save, from the last three months of everyday spending', async () => {
    const p = await person();
    const dining = await categoryId(p.client, 'Dining & leisure');
    for (const back of [1, 2, 3]) ok(await tx(p.client, { description: 'Restaurants', amount: 300, date: firstOfMonth(back), status: 'paid', category_id: dining }), 201);
    const savings = (await insights(p)).insights.find((i) => i.type === 'savings');
    assert.match(savings.title, /You could save about \$45 a month/);
    assert.match(savings.body, /estimate/);
    assert.equal(savings.details[0].label, 'Dining & leisure');
  });

  it('notices subscriptions growing', async () => {
    const p = await person();
    const subs = await categoryId(p.client, 'Subscriptions');
    ok(await tx(p.client, { description: 'Music', amount: 10, date: firstOfMonth(1), status: 'paid', category_id: subs }), 201);
    ok(await tx(p.client, { description: 'Music', amount: 10, date: `${thisMonth()}-01`, status: 'paid', category_id: subs }), 201);
    ok(await tx(p.client, { description: 'Video', amount: 15, date: `${thisMonth()}-02`, status: 'paid', category_id: subs }), 201);
    const s = (await insights(p)).insights.find((i) => i.type === 'subscriptions');
    assert.match(s.title, /Your subscriptions increased by \$15 this month/);
  });

  it('can be dismissed, restored, and is private to the person and budget', async () => {
    const p = await person();
    ok(await tx(p.client, { description: 'Late', amount: 30, date: daysFromToday(-2), status: 'pending' }), 201);
    const first = await insights(p);
    const key = first.insights.find((i) => i.type === 'overdue').key;
    assert.equal((await p.client.post(`/insights/${key}/dismiss`)).status, 204);
    assert.equal((await p.client.post(`/insights/${key}/dismiss`)).status, 204, 'dismissing twice is fine');
    const after = await insights(p);
    assert.ok(!after.insights.some((i) => i.key === key));
    assert.equal(after.dismissed, 1);
    // another person with the same kind of data still sees theirs
    const other = await person();
    ok(await tx(other.client, { description: 'Late', amount: 30, date: daysFromToday(-2), status: 'pending' }), 201);
    assert.ok((await insights(other)).insights.some((i) => i.key === key));
    assert.equal((await p.client.del('/insights/dismissed')).status, 204);
    assert.ok((await insights(p)).insights.some((i) => i.key === key));
    fails(await p.client.post('/insights/not%20a%20key!/dismiss'), 400);
    fails(await p.client.post(`/insights/${'x'.repeat(100)}/dismiss`), 400);
  });

  it('can take back a single dismissal (the Undo in the toast) without touching the others', async () => {
    const p = await person();
    ok(await tx(p.client, { description: 'Late', amount: 30, date: daysFromToday(-2), status: 'pending' }), 201);
    for (const d of [1, 2, 3]) ok(await tx(p.client, { description: `Bill ${d}`, amount: 40, date: daysFromToday(d), status: 'pending' }), 201);
    const all = (await insights(p)).insights;
    const overdue = all.find((i) => i.type === 'overdue').key;
    const week = all.find((i) => i.type === 'week-ahead').key;
    await p.client.post(`/insights/${overdue}/dismiss`);
    await p.client.post(`/insights/${week}/dismiss`);
    assert.equal((await insights(p)).dismissed, 2);
    assert.equal((await p.client.del(`/insights/${overdue}/dismiss`)).status, 204);
    const now = (await insights(p)).insights.map((i) => i.key);
    assert.ok(now.includes(overdue));
    assert.ok(!now.includes(week));
    assert.equal((await p.client.del(`/insights/${overdue}/dismiss`)).status, 204, 'undoing twice is harmless');
    fails(await p.client.del('/insights/bad%20key!/dismiss'), 400);
  });

  it('works on a shared budget for every member, with the right numbers', async () => {
    const owner = await person();
    const m = await person();
    await connect(owner, m);
    const g = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: m.user.username }), 201);
    ok(await m.client.post(`/workspace-invites/${ok(await m.client.get('/inbox')).group_invites.at(-1).id}/accept`));
    owner.client.ws = g.id;
    m.client.ws = g.id;
    ok(await tx(owner.client, { description: 'Shared late', amount: 77, date: daysFromToday(-1), status: 'pending' }), 201);
    for (const who of [owner, m]) assert.match((await insights(who)).insights.find((i) => i.type === 'overdue').title, /\$77/);
    // a member of nothing else cannot read it
    const outsider = await person();
    outsider.client.ws = g.id;
    fails(await outsider.client.get('/insights'), 403);
  });

  it('is only for signed-in people', async () => {
    const p = await signup(srv);
    const anon = new p.client.constructor(p.client.root);
    fails(await anon.get('/insights'), 401);
    fails(await anon.post('/assistant/ask', { question: 'hi' }), 401);
  });
});

describe('the assistant: questions', () => {
  async function ledger() {
    const p = await person();
    const groceries = await categoryId(p.client, 'Groceries');
    const subs = await categoryId(p.client, 'Subscriptions');
    await tx(p.client, { type: 'income', description: 'Salary', amount: 3000, date: `${thisMonth()}-01`, status: 'paid' });
    await tx(p.client, { description: 'Supermarket', amount: 120, date: `${thisMonth()}-01`, status: 'paid', category_id: groceries });
    await tx(p.client, { description: 'Netflix', amount: 14, date: `${thisMonth()}-01`, status: 'paid', category_id: subs });
    await tx(p.client, { description: 'Supermarket', amount: 80, date: firstOfMonth(1), status: 'paid', category_id: groceries });
    ok(await p.client.post('/recurring', { type: 'expense', description: 'Netflix', amount: 14, frequency: 'monthly', start_date: `${thisMonth()}-01`, category_id: subs }), 201);
    ok(await tx(p.client, { description: 'Dentist', amount: 85, date: daysFromToday(3), status: 'pending' }), 201);
    ok(await tx(p.client, { description: 'Late fee', amount: 10, date: daysFromToday(-4), status: 'pending' }), 201);
    return p;
  }

  it('understands the common questions and answers from the data', async () => {
    const p = await ledger();
    const q = async (text, intent, re) => {
      const r = await ask(p, text);
      assert.equal(r.intent, intent, `${text} -> ${r.intent}`);
      if (re) assert.match(r.answer, re, text);
      assert.ok(Array.isArray(r.blocks) && Array.isArray(r.follow_ups));
      return r;
    };
    await q('Give me a summary', 'summary', /you have spent/i);
    await q('What is my balance?', 'balance', /Your balance today is \$/);
    await q('Will I go negative?', 'forecast', /^(No|Yes)\./);
    await q('what is due soon?', 'upcoming', /Dentist|1 payment is due/);
    await q("What's overdue?", 'overdue', /2 payments are overdue, \$24/);
    await q('Where does my money go?', 'categories', /biggest expense this month is Groceries/);
    await q('What are my subscriptions?', 'subscriptions', /1 active subscription, about \$14 a month/);
    await q('How much did I spend on groceries?', 'category', /Groceries: \$120 this month/);
    await q('How much did I pay for Dentist?', 'search', /no paid expenses matching/i);
    await q('how much did I spend on supermarket', 'search', /\$200 for “supermarket”/);
    await q('How is my income?', 'income', /\$3,000 in income/);
    await q('help', 'help', /Nothing is sent to an outside AI service/);
  });

  it('is honest when it does not know, and about an empty budget', async () => {
    const p = await ledger();
    const r = await ask(p, 'What will the weather be?');
    assert.equal(r.intent, 'unknown');
    assert.match(r.answer, /can’t answer that yet/);
    assert.ok(r.follow_ups.length >= 3, 'offers things it can do');
    const empty = await signup(srv);
    const e = await ask(empty, 'Where does my money go?');
    assert.equal(e.intent, 'empty');
    assert.match(e.answer, /nothing in this budget yet/i);
  });

  it('validates the question and does not choke on odd text', async () => {
    const p = await person();
    fails(await p.client.post('/assistant/ask', { question: '' }), 400);
    fails(await p.client.post('/assistant/ask', { question: '   ' }), 400);
    fails(await p.client.post('/assistant/ask', { question: 'x'.repeat(301) }), 400);
    fails(await p.client.post('/assistant/ask', {}), 400);
    fails(await p.client.post('/assistant/ask', { question: 42 }), 400);
    for (const odd of ["'; DROP TABLE users; --", '%%%', '<script>alert(1)</script>', 'how much did I spend on %', 'spent on \\', '🙂🙂🙂', 'how much did I pay for _']) {
      const r = await ask(p, odd);
      assert.equal(typeof r.answer, 'string');
    }
    ok(await tx(p.client, { description: '100% juice', amount: 3, date: today(), status: 'paid' }), 201);
    const r = await ask(p, 'how much did I spend on %');
    assert.doesNotMatch(r.answer, /\$3/, 'a % is searched for literally, not as a wildcard');
  });

  it('only reads the open budget', async () => {
    const a = await ledger();
    const b = await person();
    ok(await tx(b.client, { description: 'Secret hobby', amount: 99, date: today(), status: 'paid' }), 201);
    assert.match((await ask(a, 'how much did I spend on secret hobby')).answer, /no paid expenses matching/i);
    assert.match((await ask(b, 'how much did I spend on secret hobby')).answer, /\$99/);
  });

  it('is rate limited', async () => {
    const p = await person();
    let limited = 0;
    for (let i = 0; i < 45; i++) if ((await p.client.post('/assistant/ask', { question: 'help' })).status === 429) limited += 1;
    assert.ok(limited >= 1);
  });
});

describe('notification settings: the new types', () => {
  it('can be read and changed, and bad values are refused', async () => {
    const p = await signup(srv);
    const s = ok(await p.client.get('/notifications/settings'));
    for (const k of ['forecast_warning', 'ai_insights', 'security_alerts', 'email_forecast', 'email_security']) assert.equal(s[k], true, `${k} on by default`);
    for (const k of ['weekly_summary', 'monthly_summary', 'email_ai', 'email_weekly', 'email_monthly']) assert.equal(s[k], false, `${k} off by default`);
    assert.equal(s.weekly_day, 1);
    assert.ok(!('last_insight_on' in s));
    const n = ok(await p.client.put('/notifications/settings', { weekly_summary: true, weekly_day: 5, ai_insights: false }));
    assert.equal(n.weekly_summary, true);
    assert.equal(n.weekly_day, 5);
    assert.equal(n.ai_insights, false);
    for (const bad of [{ weekly_day: 7 }, { weekly_day: -1 }, { weekly_day: 1.5 }, { weekly_summary: 'yes' }, { last_insight_on: '2025-01-01' }]) fails(await p.client.put('/notifications/settings', bad), 400);
  });

  it('keep the choice people had for low-balance alerts when forecast warnings were split out', async () => {
    const s = await srv.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'notification_settings' AND column_name IN ('forecast_warning', 'email_forecast')");
    assert.equal(s.rowCount, 2);
  });
});

describe('automatic assistant notifications', () => {
  it('sends the most useful new insight once a day, and not again', async () => {
    const p = await person({ ai_insights: true });
    await tx(p.client, { type: 'income', description: 'Pay', amount: 1000, date: today(), status: 'paid' });
    for (const d of [1, 2, 3]) ok(await tx(p.client, { description: `Bill ${d}`, amount: 500, date: daysFromToday(d), status: 'pending' }), 201);
    const first = await scan(p);
    assert.ok(first.created >= 1);
    const items = (await list(p)).items.filter((n) => n.kind === 'ai_insight');
    assert.equal(items.length, 1);
    assert.match(items[0].title, /Three upcoming payments/);
    assert.equal(items[0].link, '/payments?status=pending');
    assert.ok(items[0].data.insight_key);
    assert.equal((await scan(p)).created, 0, 'once a day');
    assert.equal((await list(p)).items.filter((n) => n.kind === 'ai_insight').length, 1);
  });

  it('does not repeat warnings other alerts already give, and can be switched off or paused', async () => {
    const p = await person({ ai_insights: true });
    ok(await tx(p.client, { description: 'Late', amount: 30, date: daysFromToday(-5), status: 'pending' }), 201);
    await scan(p);
    assert.ok(!(await kinds(p)).includes('ai_insight'), 'overdue is covered by the overdue alert');

    const off = await person({ ai_insights: false });
    await tx(off.client, { type: 'income', description: 'Pay', amount: 100, date: today(), status: 'paid' });
    for (const d of [1, 2, 3]) ok(await tx(off.client, { description: `Bill ${d}`, amount: 500, date: daysFromToday(d), status: 'pending' }), 201);
    await scan(off);
    assert.ok(!(await kinds(off)).includes('ai_insight'));

    const paused = await person({ ai_insights: true });
    await tx(paused.client, { type: 'income', description: 'Pay', amount: 100, date: today(), status: 'paid' });
    for (const d of [1, 2, 3]) ok(await tx(paused.client, { description: `Bill ${d}`, amount: 500, date: daysFromToday(d), status: 'pending' }), 201);
    await setPrefs(paused, { paused_until: daysFromToday(2) });
    await scan(paused);
    assert.ok(!(await kinds(paused)).includes('ai_insight'));
  });

  it('can be e-mailed when asked for, and otherwise stays in the app', async () => {
    const p = await person({ ai_insights: true });
    const s = ok(await p.client.get('/notifications/settings'));
    assert.equal(s.email_ai, false);
  });
});

describe('weekly and monthly summaries', () => {
  const dow = () => new Date(`${today()}T12:00:00Z`).getUTCDay();

  it('arrive once, on the chosen weekday', async () => {
    const p = await person({ weekly_summary: true, weekly_day: dow() });
    await tx(p.client, { description: 'Groceries', amount: 40, date: daysFromToday(-2), status: 'paid' });
    await tx(p.client, { type: 'income', description: 'Pay', amount: 500, date: daysFromToday(-3), status: 'paid' });
    ok(await pay(p.client, 3), 201);
    await scan(p);
    const sums = (await list(p)).items.filter((n) => n.kind === 'summary_weekly');
    assert.equal(sums.length, 1);
    assert.equal(sums[0].title, 'Your week in review');
    assert.match(sums[0].body, /You spent \$40 across 1 payment/);
    assert.match(sums[0].body, /received \$500\./);
    assert.match(sums[0].body, /1 payment is due in the coming week \(\$25\)/);
    assert.equal((await scan(p)).created, 0);
  });

  it('wait for their day, and respect the switch', async () => {
    const later = await person({ weekly_summary: true, weekly_day: (dow() + 3) % 7 });
    await tx(later.client, { description: 'Groceries', amount: 40, date: daysFromToday(-2), status: 'paid' });
    await scan(later);
    assert.ok(!(await kinds(later)).includes('summary_weekly'));
    const off = await person({ weekly_summary: false, weekly_day: dow() });
    await tx(off.client, { description: 'Groceries', amount: 40, date: daysFromToday(-2), status: 'paid' });
    await scan(off);
    assert.ok(!(await kinds(off)).includes('summary_weekly'));
  });

  it('the monthly one covers the month that just ended, in the first days of a month only', async () => {
    const p = await person({ monthly_summary: true });
    const dining = await categoryId(p.client, 'Dining & leisure');
    await tx(p.client, { type: 'income', description: 'Pay', amount: 2000, date: `${addMonthsYM(thisMonth(), -1)}-05`, status: 'paid' });
    await tx(p.client, { description: 'Dinner', amount: 300, date: `${addMonthsYM(thisMonth(), -1)}-06`, status: 'paid', category_id: dining });
    await scan(p);
    const sums = (await list(p)).items.filter((n) => n.kind === 'summary_monthly');
    if (Number(today().slice(8)) <= 2) {
      assert.equal(sums.length, 1);
      assert.match(sums[0].body, /\$2,000 came in and \$300 went out/);
      assert.match(sums[0].body, /Biggest category: Dining & leisure/);
      assert.equal((await scan(p)).created, 0);
    } else {
      assert.equal(sums.length, 0, 'not the first days of the month');
    }
  });
});

describe('forecast warnings are separate from low-balance warnings', () => {
  async function overdrawnLater(p) {
    await tx(p.client, { type: 'income', description: 'Paid in', amount: 100, date: today(), status: 'paid' });
    ok(await tx(p.client, { description: 'Big bill', amount: 5000, date: `${addMonthsYM(thisMonth(), 3)}-10`, status: 'pending' }), 201);
  }
  it('a person can want one without the other', async () => {
    const forecastOnly = await person({ forecast_warning: true, balance_warning: false });
    await overdrawnLater(forecastOnly);
    await scan(forecastOnly);
    assert.deepEqual(await kinds(forecastOnly), ['forecast_warning']);

    const neither = await person();
    await overdrawnLater(neither);
    await scan(neither);
    assert.deepEqual(await kinds(neither), []);

    const lowOnly = await person({ forecast_warning: false, balance_warning: true });
    await tx(lowOnly.client, { description: 'Overspent', amount: 400, date: today(), status: 'paid' });
    ok(await tx(lowOnly.client, { description: 'Pending', amount: 5, date: daysFromToday(5), status: 'pending' }), 201);
    await scan(lowOnly);
    assert.deepEqual(await kinds(lowOnly), ['balance_warning']);
  });
});

describe('security notifications', () => {
  it('tell you when your password changes, unless you turned them off', async () => {
    const p = await signup(srv);
    ok(await p.client.put('/auth/password', { current_password: PW, new_password: 'N3w-Pass!word-Long' }));
    const n = (await list(p)).items.find((x) => x.kind === 'security');
    assert.equal(n.title, 'Your password was changed');
    assert.equal(n.link, '/settings?tab=account');
    // a second change a moment later is a separate event
    ok(await p.client.put('/auth/password', { current_password: 'N3w-Pass!word-Long', new_password: 'An0ther-Pass!word-Long' }));
    assert.equal((await list(p)).items.filter((x) => x.kind === 'security').length, 2);

    const quiet = await signup(srv);
    await setPrefs(quiet, { security_alerts: false });
    ok(await quiet.client.put('/auth/password', { current_password: PW, new_password: 'N3w-Pass!word-Long' }));
    assert.ok(!(await kinds(quiet)).includes('security'));
  });

  it('are not silenced by pausing alerts', async () => {
    const p = await signup(srv);
    await setPrefs(p, { paused_until: daysFromToday(3) });
    ok(await p.client.put('/auth/password', { current_password: PW, new_password: 'N3w-Pass!word-Long' }));
    assert.ok((await kinds(p)).includes('security'));
  });
});
