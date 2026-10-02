import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, connect, daysFromToday, fails, ok, shutdown, signup, startServer, thisMonth, today, todayIn, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('notifications');
});
after(async () => {
  await shutdown(srv);
});

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const list = async (p, qs = '') => ok(await p.client.get(`/notifications${qs}`));
const kinds = async (p, qs = '') => (await list(p, qs)).items.map((n) => n.kind);
const unread = async (p) => (await list(p)).unread;
const scan = async (p) => ok(await p.client.post('/notifications/refresh'));
const setPrefs = async (p, body) => ok(await p.client.put('/notifications/settings', body));
/** A fresh account whose "today" matches the server's, so date arithmetic in the tests is exact. */
const person = async (over) => {
  const p = await signup(srv, over);
  await setPrefs(p, { timezone: LOCAL_TZ, balance_warning: false, forecast_warning: false, ai_insights: false }); // those alerts have their own tests
  return p;
};
const pay = (c, ahead, over = {}) => tx(c, { description: `Pay ${ahead}`, amount: 25, date: daysFromToday(ahead), status: 'pending', ...over });
const titles = async (p, kind) => (await list(p)).items.filter((n) => !kind || n.kind === kind).map((n) => n.title);

async function household(extra = 1) {
  const owner = await person();
  const members = [];
  for (let i = 0; i < extra; i++) {
    const m = await person();
    await connect(owner, m);
    members.push(m);
  }
  const g = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
  for (const m of members) {
    ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: m.user.username }), 201);
    ok(await m.client.post(`/workspace-invites/${ok(await m.client.get('/inbox')).group_invites.at(-1).id}/accept`));
    m.client.ws = g.id;
  }
  owner.client.ws = g.id;
  return { owner, members, g };
}

describe('notifications from people and groups', () => {
  it('a connection request notifies the person asked, and its answer notifies the asker', async () => {
    const a = await person();
    const b = await person();
    ok(await a.client.post('/connections', { username: b.user.username, relation: 'partner' }), 201);
    const n = (await list(b)).items;
    assert.equal(n.length, 1);
    assert.equal(n[0].kind, 'connection_request');
    assert.equal(n[0].data.from.username, a.user.username);
    assert.equal(n[0].data.relation, 'partner');
    assert.equal(n[0].link, '/people');
    assert.ok(!JSON.stringify(n[0]).includes(a.user.email), 'no e-mail address in a notification');
    assert.equal(await unread(b), 1);
    assert.equal(await unread(a), 0, 'the sender is not notified of their own request');
    const reqId = ok(await b.client.get('/connections')).incoming[0].id;
    ok(await b.client.post(`/connections/${reqId}/accept`));
    assert.equal(await unread(b), 0, 'answering resolves the request notification');
    assert.equal((await list(b)).items[0].read_at !== null, true);
    assert.deepEqual(await kinds(a), ['connection_accepted']);
    assert.match((await titles(a))[0], new RegExp(`${b.user.name} accepted`));
  });

  it('declining is quiet, withdrawing removes it, and crossing requests resolve cleanly', async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    assert.equal((await b.client.post(`/connections/${ok(await b.client.get('/connections')).incoming[0].id}/decline`)).status, 204);
    assert.equal(await unread(b), 0);
    assert.deepEqual(await kinds(a), [], 'the sender is not told about a decline');
    // withdrawn request disappears from the other person's list
    ok(await a.client.post('/connections', { username: c.user.username }), 201);
    assert.equal((await list(c)).items.length, 1);
    await a.client.del(`/connections/${ok(await a.client.get('/connections')).outgoing.find((x) => x.user.username === c.user.username).id}`);
    assert.equal((await list(c)).items.length, 0);
    // crossing requests: both end up connected, nobody is left with a stale request
    const d = await person();
    const e = await person();
    ok(await d.client.post('/connections', { username: e.user.username }), 201);
    ok(await e.client.post('/connections', { username: d.user.username }));
    assert.equal(await unread(e), 0);
    assert.deepEqual(await kinds(d), ['connection_accepted']);
  });

  it('group invitations, answers and membership changes notify the right people', async () => {
    const owner = await person({ name: 'Olive Owner' });
    const f1 = await person({ name: 'Faye One' });
    const f2 = await person({ name: 'Finn Two' });
    const f3 = await person({ name: 'Fern Three' });
    for (const f of [f1, f2, f3]) await connect(owner, f);
    const g = ok(await owner.client.post('/workspaces', { name: 'Flat' }), 201);
    const invite = async (f) => ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 201);
    for (const f of [f1, f2, f3]) await invite(f);
    for (const f of [f1, f2, f3]) {
      const n = (await list(f)).items.find((x) => x.kind === 'group_invite');
      assert.ok(n, 'invitation notification');
      assert.equal(n.data.workspace.name, 'Flat');
      assert.match(n.title, /Olive Owner invited you to "Flat"/);
    }
    // cancel one: gone for the invitee
    const pending = ok(await owner.client.get(`/workspaces/${g.id}/invites`)).find((i) => i.user.username === f3.user.username);
    await owner.client.del(`/workspace-invites/${pending.id}`);
    assert.equal((await list(f3, '?kind=group_invite')).items.length, 0);
    // accept / decline
    ok(await f1.client.post(`/workspace-invites/${ok(await f1.client.get('/inbox')).group_invites[0].id}/accept`));
    assert.equal((await f2.client.post(`/workspace-invites/${ok(await f2.client.get('/inbox')).group_invites[0].id}/decline`)).status, 204);
    assert.equal(await unread(f1), 0);
    assert.equal(await unread(f2), 0);
    const ownerTitles = await titles(owner, 'group_change');
    assert.ok(ownerTitles.some((t) => /Faye One joined "Flat"/.test(t)));
    assert.ok(ownerTitles.some((t) => /Finn Two declined/.test(t)));
    // membership changes
    await owner.client.del(`/workspaces/${g.id}/members/${f1.user.username}`);
    assert.ok((await titles(f1, 'group_change')).some((t) => /removed from "Flat"/.test(t)));
    ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: f1.user.username }), 201);
    ok(await f1.client.post(`/workspace-invites/${ok(await f1.client.get('/inbox')).group_invites[0].id}/accept`));
    assert.equal((await owner.client.post(`/workspaces/${g.id}/transfer`, { username: f1.user.username })).status, 204);
    assert.ok((await titles(f1, 'group_change')).some((t) => /now the owner of "Flat"/.test(t)));
    assert.equal((await owner.client.post(`/workspaces/${g.id}/leave`)).status, 204);
    assert.ok((await titles(f1, 'group_change')).some((t) => /Olive Owner left "Flat"/.test(t)), 'the new owner hears that someone left');
    assert.equal((await f1.client.del(`/workspaces/${g.id}`)).status, 204);
    assert.equal((await list(owner)).items.filter((n) => /deleted/.test(n.title)).length, 0, 'someone who already left is not told about the deletion');
  });

  it('deleting a shared budget tells the members who are still in it', async () => {
    const { owner, members } = await household(2);
    assert.equal((await owner.client.del(`/workspaces/${owner.client.ws}`)).status, 204);
    for (const m of members) assert.ok((await titles(m, 'group_change')).some((t) => /"Home" was deleted/.test(t)));
  });

  it('adding someone to a payment notifies them once, with their share', async () => {
    const a = await person({ name: 'Ann Payer' });
    const b = await person();
    await connect(a, b);
    const t = ok(await tx(a.client, { description: 'Dinner', amount: 80, participants: [{ username: b.user.username, share: 30 }] }), 201);
    const n = (await list(b, '?kind=payment_shared')).items;
    assert.equal(n.length, 1);
    assert.equal(n[0].kind, 'payment_shared');
    assert.match(n[0].title, /Ann Payer added you to "Dinner"/);
    assert.match(n[0].body, /\$30\.00 of \$80\.00/);
    assert.equal(n[0].link, '/people?tab=shared');
    // changing the share or the amount does not notify again
    ok(await a.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'Dinner', amount: 90, date: today(), participants: [{ username: b.user.username, share: 35 }] }));
    assert.equal((await list(b, '?kind=payment_shared')).items.length, 1);
    assert.deepEqual(await kinds(a, '?status=unread'), ['connection_accepted'], 'the payer is not notified about their own payment');
  });

  it('activity in a shared budget is off by default and can be switched on', async () => {
    const { owner, members } = await household(1);
    const [m] = members;
    ok(await tx(owner.client, { description: 'Quiet one' }), 201);
    assert.deepEqual(await kinds(m, '?kind=group_activity'), []);
    await setPrefs(m, { group_activity: true });
    ok(await tx(owner.client, { description: 'Loud one', amount: 42 }), 201);
    const n = (await list(m, '?kind=group_activity')).items;
    assert.equal(n.length, 1);
    assert.match(n[0].title, /added "Loud one"/);
    assert.match(n[0].body, /Home/);
    assert.deepEqual(await kinds(owner, '?kind=group_activity'), [], 'you are not told about your own payments');
    ok(await m.client.put(`/transactions/${ok(await m.client.get('/transactions?status=')).find((x) => x.description === 'Loud one').id}`, { type: 'expense', description: 'Loud one', amount: 43, date: today() }));
    assert.equal((await list(owner, '?kind=group_activity')).items.length, 0, 'edits are not reported');
  });

  it('switching a kind off stops those notifications (and only those)', async () => {
    const a = await person();
    const b = await person();
    await setPrefs(b, { friend_requests: false });
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    assert.equal((await list(b)).items.length, 0, 'no notification');
    assert.equal(ok(await b.client.get('/connections')).incoming.length, 1, 'but the request itself still exists');
    assert.equal(ok(await b.client.get('/inbox')).connection_requests.length, 1);
    await setPrefs(b, { friend_requests: true, shared_payments: false });
    const c = await person();
    ok(await c.client.post('/connections', { username: b.user.username }), 201);
    assert.deepEqual(await kinds(b), ['connection_request']);
  });
});

describe('the notification list', () => {
  it('lists newest first, filters by kind and unread, and paginates', async () => {
    const owner = await person();
    const friends = [];
    for (let i = 0; i < 7; i++) {
      const f = await person();
      await connect(owner, f);
      friends.push(f);
    }
    // 7 acceptances -> 7 notifications for the owner; plus one invitation-type of a different kind
    const g = ok(await friends[0].client.post('/workspaces', { name: 'Other' }), 201);
    ok(await friends[0].client.post(`/workspaces/${g.id}/invites`, { username: owner.user.username }), 201);
    const all = await list(owner);
    assert.equal(all.items.length, 8);
    assert.equal(all.unread, 8);
    assert.deepEqual(all.items.map((n) => n.id), [...all.items.map((n) => n.id)].sort((x, y) => y - x), 'newest first');
    assert.equal((await list(owner, '?kind=group_invite')).items.length, 1);
    assert.equal((await list(owner, '?kind=connection_accepted')).items.length, 7);
    const page1 = await list(owner, '?limit=3');
    assert.equal(page1.items.length, 3);
    assert.equal(page1.has_more, true);
    const page2 = await list(owner, `?limit=3&before=${page1.items.at(-1).id}`);
    assert.equal(page2.items.length, 3);
    assert.ok(page2.items[0].id < page1.items.at(-1).id);
    const page3 = await list(owner, `?limit=3&before=${page2.items.at(-1).id}`);
    assert.equal(page3.items.length, 2);
    assert.equal(page3.has_more, false);
    // read state
    const one = all.items[0];
    assert.equal((await owner.client.post(`/notifications/${one.id}/read`)).status, 204);
    assert.equal((await list(owner)).unread, 7);
    assert.equal((await list(owner, '?status=unread')).items.length, 7);
    assert.equal((await owner.client.post(`/notifications/${one.id}/unread`)).status, 204);
    assert.equal((await list(owner)).unread, 8);
    assert.equal(ok(await owner.client.post('/notifications/read-all')).updated, 8);
    assert.equal((await list(owner, '?status=unread')).items.length, 0);
    assert.equal(ok(await owner.client.del('/notifications')).deleted, 8, 'clear read');
    assert.equal((await list(owner)).items.length, 0);
  });

  it('is private: nobody can read, mark or delete someone else\'s notifications', async () => {
    const a = await person();
    const b = await person();
    ok(await b.client.post('/connections', { username: a.user.username }), 201);
    const n = (await list(a)).items[0];
    assert.equal((await b.client.post(`/notifications/${n.id}/read`)).status, 404);
    assert.equal((await b.client.post(`/notifications/${n.id}/unread`)).status, 404);
    assert.equal((await b.client.del(`/notifications/${n.id}`)).status, 404);
    assert.equal(await unread(a), 1);
    assert.equal((await list(b)).items.length, 0);
    assert.equal((await a.client.del(`/notifications/${n.id}`)).status, 204);
    fails(await a.client.del(`/notifications/${n.id}`), 404);
  });

  it('summary is cheap and accurate, and the bad ids/filters are refused cleanly', async () => {
    const a = await person();
    const b = await person();
    assert.deepEqual(ok(await a.client.get('/notifications/summary')), { unread: 0, latest_id: null, latest_title: null });
    ok(await b.client.post('/connections', { username: a.user.username }), 201);
    const s = ok(await a.client.get('/notifications/summary'));
    assert.equal(s.unread, 1);
    assert.match(s.latest_title, /wants to connect/);
    for (const id of ['abc', '0', '-1', '1.5']) {
      assert.equal((await a.client.post(`/notifications/${id}/read`)).status, 400, id);
      assert.equal((await a.client.del(`/notifications/${id}`)).status, 400, id);
    }
    assert.equal((await a.client.post('/notifications/99999999/read')).status, 404);
    assert.equal((await a.client.get('/notifications?kind=nonsense')).status, 400);
    assert.equal((await a.client.get('/notifications?before=abc')).status, 400);
    assert.equal(ok(await a.client.get('/notifications?limit=99999')).items.length, 1);
    assert.equal(ok(await a.client.get('/notifications?limit=0')).items.length, 1, 'a silly limit falls back to a sane one');
  });
});

describe('settings', () => {
  it('start with sensible defaults', async () => {
    const p = await signup(srv);
    const s = ok(await p.client.get('/notifications/settings'));
    assert.deepEqual(
      [s.due_soon, s.overdue, s.balance_warning, s.friend_requests, s.group_invites, s.shared_payments, s.group_activity, s.include_income, s.lead_days],
      [true, true, true, true, true, true, false, false, 3],
    );
    assert.deepEqual([s.email_enabled, s.email_frequency, s.email_hour, s.timezone, s.browser_push, s.paused], [false, 'daily', 8, 'UTC', false, false]);
    assert.deepEqual([s.email_due, s.email_overdue, s.email_balance, s.email_social, s.email_group_activity], [true, true, true, false, false]);
    assert.equal(s.email, p.user.email);
    assert.equal(s.email_verified, false);
    assert.equal(s.mail_mode, 'preview');
    assert.ok(!('user_id' in s) && !('last_digest_on' in s));
  });

  it('can be changed one piece at a time and are remembered', async () => {
    const p = await signup(srv);
    let s = await setPrefs(p, { lead_days: 10 });
    assert.equal(s.lead_days, 10);
    assert.equal(s.due_soon, true, 'other settings are untouched');
    s = await setPrefs(p, { due_soon: false, include_income: true, browser_push: true, email_frequency: 'instant', email_hour: 21, timezone: 'Europe/Berlin', email_social: true });
    assert.deepEqual([s.due_soon, s.include_income, s.browser_push, s.email_frequency, s.email_hour, s.timezone, s.email_social], [false, true, true, 'instant', 21, 'Europe/Berlin', true]);
    assert.deepEqual(ok(await p.client.get('/notifications/settings')), s);
    assert.deepEqual(await setPrefs(p, {}), s, 'an empty update changes nothing');
  });

  it('refuses invalid values and unknown fields', async () => {
    const p = await signup(srv);
    const before = ok(await p.client.get('/notifications/settings'));
    for (const bad of [
      { lead_days: -1 }, { lead_days: 61 }, { lead_days: 2.5 }, { lead_days: '3' }, { email_hour: 24 }, { email_hour: -1 }, { email_frequency: 'weekly' },
      { due_soon: 'yes' }, { timezone: 'Mars/Olympus_Mons' }, { timezone: '' }, { paused_until: 'tomorrow' }, { paused_until: '2026-13-45x' },
      { user_id: 1 }, { email_verified: true }, { mail_mode: 'smtp' }, { nonsense: true },
    ]) {
      const r = await p.client.put('/notifications/settings', bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.deepEqual(ok(await p.client.get('/notifications/settings')), before);
  });

  it('e-mail alerts can only be turned on once the address is confirmed', async () => {
    const p = await signup(srv);
    fails(await p.client.put('/notifications/settings', { email_enabled: true }), 400);
    await srv.db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [p.user.id]);
    const s = await setPrefs(p, { email_enabled: true });
    assert.equal(s.email_enabled, true);
    assert.equal(s.email_verified, true);
    assert.equal((await setPrefs(p, { email_enabled: false })).email_enabled, false, 'turning off always works');
  });

  it('can pause alerts until a date, and resume', async () => {
    const p = await person();
    const until = daysFromToday(2);
    const s = await setPrefs(p, { paused_until: until });
    assert.equal(s.paused, true);
    assert.equal(s.paused_until_date, until);
    const off = await setPrefs(p, { paused_until: null });
    assert.deepEqual([off.paused, off.paused_until_date], [false, null]);
    const past = await setPrefs(p, { paused_until: daysFromToday(-3) });
    assert.equal(past.paused, false, 'a date in the past is no pause');
  });
});

describe('due and overdue payment alerts', () => {
  it('alerts for payments due within the lead time, today, and overdue — not for the rest', async () => {
    const p = await person();
    const ids = {};
    for (const d of [0, 1, 3, 4, 20, -1, -10, -50]) ids[d] = ok(await pay(p.client, d), 201).id;
    const paid = ok(await tx(p.client, { description: 'Already paid', amount: 5, date: daysFromToday(1), status: 'paid' }), 201);
    const skipped = ok(await pay(p.client, 1, { description: 'Skipped one' }), 201);
    await p.client.patch(`/transactions/${skipped.id}/status`, { status: 'skipped' });
    ok(await tx(p.client, { description: 'Expected salary', type: 'income', amount: 1000, date: daysFromToday(1), status: 'pending' }), 201);
    assert.equal((await scan(p)).created, 5); // 3 due (today, tomorrow, in 3 days) + 2 overdue
    const items = (await list(p)).items;
    const byTx = Object.fromEntries(items.map((n) => [n.data.transaction_id, n]));
    for (const d of [0, 1, 3]) assert.equal(byTx[ids[d]].kind, 'payment_due', `due in ${d} days`);
    for (const d of [-1, -10]) assert.equal(byTx[ids[d]].kind, 'payment_overdue', `${-d} days late`);
    for (const d of [4, 20, -50]) assert.equal(byTx[ids[d]], undefined, `${d} is outside the window`);
    assert.equal(byTx[paid.id], undefined);
    assert.equal(byTx[skipped.id], undefined);
    assert.ok(!items.some((n) => /salary/i.test(n.title)), 'income is not alerted by default');
    assert.match(byTx[ids[0]].title, /Pay 0 is due today/);
    assert.match(byTx[ids[1]].title, /Pay 1 is due tomorrow/);
    assert.match(byTx[ids[3]].title, /Pay 3 is due on /);
    assert.match(byTx[ids[-1]].title, /Pay -1 is overdue/);
    assert.equal(byTx[ids[1]].body, '$25.00');
    assert.deepEqual([byTx[ids[1]].data.amount, byTx[ids[1]].data.date, byTx[ids[1]].data.currency, byTx[ids[1]].data.workspace], [25, daysFromToday(1), 'USD', null]);
    assert.equal(byTx[ids[1]].link, `/payments?month=${daysFromToday(1).slice(0, 7)}`);
  });

  it('marks a due alert as no longer actionable once the payment is paid, moved or deleted', async () => {
    const p = await person();
    const a = ok(await pay(p.client, 1, { description: 'Pay A' }), 201);
    const b = ok(await pay(p.client, 1, { description: 'Pay B' }), 201);
    const c = ok(await pay(p.client, 1, { description: 'Pay C' }), 201);
    await scan(p);
    const flags = async () => Object.fromEntries((await list(p)).items.map((n) => [n.data.description, n.actionable]));
    assert.deepEqual(await flags(), { 'Pay A': true, 'Pay B': true, 'Pay C': true });
    ok(await p.client.patch(`/transactions/${a.id}/status`, { status: 'paid' }));
    ok(await p.client.put(`/transactions/${b.id}`, { type: 'expense', description: 'Pay B', amount: 25, date: daysFromToday(-1) }));
    await p.client.del(`/transactions/${c.id}`);
    assert.deepEqual(await flags(), { 'Pay A': false, 'Pay B': false, 'Pay C': false }, 'paid, moved and deleted are all settled');
  });

  it('does not repeat itself, but alerts again when the due date moves', async () => {
    const p = await person();
    const t = ok(await pay(p.client, 2), 201);
    assert.equal((await scan(p)).created, 1);
    assert.equal((await scan(p)).created, 0);
    assert.equal((await scan(p)).created, 0);
    assert.equal((await list(p)).items.length, 1);
    await p.client.post(`/notifications/read-all`);
    assert.equal((await scan(p)).created, 0, 'reading it does not bring it back');
    // moved a day: the old alert is out of date, a new one appears
    ok(await p.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'Pay 2', amount: 25, date: daysFromToday(1) }));
    assert.equal((await scan(p)).created, 1);
    const unreadNow = await list(p, '?status=unread');
    assert.equal(unreadNow.items.length, 1);
    assert.equal(unreadNow.items[0].data.date, daysFromToday(1));
  });

  it('turns an upcoming alert into an overdue one when the date passes, as separate notifications', async () => {
    const p = await person();
    const t = ok(await pay(p.client, 1), 201);
    await scan(p);
    assert.deepEqual(await kinds(p), ['payment_due']);
    ok(await p.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'Pay 1', amount: 25, date: daysFromToday(-1) }));
    await scan(p);
    const k = await kinds(p, '?status=unread');
    assert.deepEqual(k, ['payment_overdue'], 'the stale "due" alert is resolved, the overdue one is new');
  });

  it('alerts that no longer apply (paid, deleted, skipped) clear themselves', async () => {
    const p = await person();
    const a = ok(await pay(p.client, 1, { description: 'Will be paid' }), 201);
    const b = ok(await pay(p.client, 2, { description: 'Will be deleted' }), 201);
    const c = ok(await pay(p.client, 3, { description: 'Will be skipped' }), 201);
    await scan(p);
    assert.equal(await unread(p), 3);
    await p.client.patch(`/transactions/${a.id}/status`, { status: 'paid' });
    assert.equal(await unread(p), 2, 'paying it resolves its alert right away');
    await p.client.del(`/transactions/${b.id}`);
    assert.equal(await unread(p), 1);
    await p.client.patch(`/transactions/${c.id}/status`, { status: 'skipped' });
    assert.equal(await unread(p), 0);
    assert.equal(ok(await p.client.get('/notifications/summary')).unread, 0);
  });

  it('respects the lead time setting (0 = only on the day, up to 60 days)', async () => {
    const p = await person();
    const near = ok(await pay(p.client, 0), 201);
    const week = ok(await pay(p.client, 7), 201);
    const far = ok(await pay(p.client, 45), 201);
    await setPrefs(p, { lead_days: 0 });
    await scan(p);
    assert.deepEqual((await list(p)).items.map((n) => n.data.transaction_id), [near.id]);
    await setPrefs(p, { lead_days: 7 });
    await scan(p);
    assert.deepEqual((await list(p)).items.map((n) => n.data.transaction_id).sort(), [near.id, week.id].sort());
    await setPrefs(p, { lead_days: 60 });
    await scan(p);
    assert.ok((await list(p)).items.some((n) => n.data.transaction_id === far.id));
  });

  it('income alerts are opt-in', async () => {
    const p = await person();
    const inc = ok(await tx(p.client, { description: 'Salary', type: 'income', amount: 3000, date: daysFromToday(1), status: 'pending' }), 201);
    await scan(p);
    assert.equal((await list(p)).items.length, 0);
    await setPrefs(p, { include_income: true });
    await scan(p);
    assert.equal((await list(p)).items.length, 1);
    assert.match((await list(p)).items[0].title, /Salary/);
    assert.ok(inc);
  });

  it('can be switched off per kind (due soon / overdue)', async () => {
    const p = await person();
    ok(await pay(p.client, 1, { description: 'Soon' }), 201);
    ok(await pay(p.client, -2, { description: 'Late' }), 201);
    await setPrefs(p, { due_soon: false });
    await scan(p);
    assert.deepEqual(await kinds(p), ['payment_overdue']);
    await setPrefs(p, { due_soon: true, overdue: false });
    await scan(p);
    assert.deepEqual((await kinds(p)).sort(), ['payment_due', 'payment_overdue'], 'the earlier overdue one stays, no new overdue ones');
    assert.equal((await list(p)).items.filter((n) => n.kind === 'payment_overdue').length, 1);
  });

  it('can be paused, and resume afterwards', async () => {
    const p = await person();
    ok(await pay(p.client, 1), 201);
    await setPrefs(p, { paused_until: daysFromToday(1) });
    assert.equal((await scan(p)).created, 0);
    assert.equal((await list(p)).items.length, 0);
    // social events still arrive while payment alerts are paused
    const friend = await person();
    ok(await friend.client.post('/connections', { username: p.user.username }), 201);
    assert.deepEqual(await kinds(p), ['connection_request']);
    await setPrefs(p, { paused_until: null });
    assert.equal((await scan(p)).created, 1);
  });

  it('uses the person\'s own time zone to decide what "today" is', async () => {
    const p = await signup(srv);
    const tz = 'Pacific/Kiritimati'; // UTC+14: often already "tomorrow" compared with the rest of the world
    await setPrefs(p, { timezone: tz });
    const there = todayIn(tz);
    const dueToday = ok(await tx(p.client, { description: 'There today', amount: 9, date: there, status: 'pending' }), 201);
    const yesterday = new Date(`${there}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const late = ok(await tx(p.client, { description: 'There yesterday', amount: 9, date: yesterday.toISOString().slice(0, 10), status: 'pending' }), 201);
    await scan(p);
    const byTx = Object.fromEntries((await list(p)).items.map((n) => [n.data.transaction_id, n]));
    assert.equal(byTx[dueToday.id].kind, 'payment_due');
    assert.match(byTx[dueToday.id].title, /due today/);
    assert.equal(byTx[late.id].kind, 'payment_overdue');
  });

  it('a shared budget alerts every member, each by their own rules', async () => {
    const { owner, members, g } = await household(1);
    const [m] = members;
    const t = ok(await pay(owner.client, 1, { description: 'Group bill' }), 201);
    await scan(owner);
    await scan(m);
    for (const who of [owner, m]) {
      const n = (await list(who)).items.find((x) => x.data.transaction_id === t.id);
      assert.ok(n, 'every member is alerted');
      assert.equal(n.data.workspace, 'Home');
      assert.equal(n.data.workspace_id, g.id);
      assert.match(n.body, /Home/);
    }
    // the member silences this payment: the owner is still alerted
    const t2 = ok(await pay(owner.client, 2, { description: 'Quiet for Sam' }), 201);
    ok(await m.client.put(`/alerts/transaction/${t2.id}`, { mode: 'off' }));
    await scan(owner);
    await scan(m);
    assert.ok((await list(owner)).items.some((x) => x.data.transaction_id === t2.id));
    assert.ok(!(await list(m)).items.some((x) => x.data.transaction_id === t2.id));
    // payments from one budget never alert people who are not in it
    const outsider = await person();
    await scan(outsider);
    assert.equal((await list(outsider)).items.length, 0);
  });
});

describe('choosing which payments alert you', () => {
  const put = (c, type, id, body) => c.put(`/alerts/${type}/${id}`, body);

  it('a single payment can be silenced, forced on, or given its own lead time', async () => {
    const p = await person();
    const quiet = ok(await pay(p.client, 1, { description: 'Quiet' }), 201);
    const loud = ok(await pay(p.client, 1, { description: 'Loud' }), 201);
    const early = ok(await pay(p.client, 9, { description: 'Early warning' }), 201);
    const income = ok(await tx(p.client, { description: 'Big refund', type: 'income', amount: 500, date: daysFromToday(1), status: 'pending' }), 201);
    ok(await put(p.client, 'transaction', quiet.id, { mode: 'off' }));
    ok(await put(p.client, 'transaction', early.id, { mode: 'on', days: 10 }));
    ok(await put(p.client, 'transaction', income.id, { mode: 'on' }));
    await scan(p);
    const ids = (await list(p)).items.map((n) => n.data.transaction_id);
    assert.ok(ids.includes(loud.id));
    assert.ok(!ids.includes(quiet.id), 'silenced');
    assert.ok(ids.includes(early.id), 'alerts 9 days ahead because of its own lead time');
    assert.ok(ids.includes(income.id), 'income that was switched on');
  });

  it('a whole recurring item, installment plan, or category can be silenced', async () => {
    const p = await person();
    const rent = await categoryId(p.client, 'Rent / Mortgage');
    const rule = ok(await p.client.post('/recurring', { type: 'expense', description: 'Gym', amount: 40, frequency: 'weekly', start_date: today() }), 201);
    const plan = ok(await p.client.post('/installments', { description: 'Sofa', total_amount: 300, installment_count: 3, first_due_date: today() }), 201);
    const catPay = ok(await pay(p.client, 1, { description: 'Rent-ish', category_id: rent }), 201);
    ok(await put(p.client, 'recurring', rule.id, { mode: 'off' }));
    ok(await put(p.client, 'installment', plan.id, { mode: 'off' }));
    ok(await put(p.client, 'category', rent, { mode: 'off' }));
    await scan(p);
    assert.deepEqual((await list(p)).items, [], 'nothing alerts');
    // removing the category rule brings that payment back
    await p.client.del(`/alerts/category/${rent}`);
    await scan(p);
    assert.deepEqual((await list(p)).items.map((n) => n.data.transaction_id), [catPay.id]);
    await p.client.del(`/alerts/recurring/${rule.id}`);
    await p.client.del(`/alerts/installment/${plan.id}`);
    await scan(p);
    assert.ok((await list(p)).items.some((n) => /Gym/.test(n.data.description)));
    assert.ok((await list(p)).items.some((n) => /Sofa/.test(n.data.description)));
  });

  it('the most specific rule wins: payment > recurring item > installment plan > category', async () => {
    const p = await person();
    const cat = await categoryId(p.client, 'Utilities');
    const rule = ok(await p.client.post('/recurring', { type: 'expense', description: 'Net', amount: 30, frequency: 'monthly', start_date: daysFromToday(1), category_id: cat }), 201);
    const occ = ok(await p.client.get('/transactions?status=pending&limit=50')).find((t) => t.recurring_id === rule.id);
    // category off, but the recurring item says on: the item wins
    ok(await put(p.client, 'category', cat, { mode: 'off' }));
    ok(await put(p.client, 'recurring', rule.id, { mode: 'on' }));
    assert.equal(ok(await p.client.get('/transactions?status=pending&limit=50')).find((t) => t.id === occ.id).alert.source, 'recurring item');
    await scan(p);
    assert.ok((await list(p)).items.some((n) => n.data.transaction_id === occ.id), 'recurring on beats category off');
    // payment off beats recurring on
    ok(await put(p.client, 'transaction', occ.id, { mode: 'off' }));
    const row = ok(await p.client.get('/transactions?status=pending&limit=50')).find((t) => t.id === occ.id);
    assert.deepEqual([row.alert.mode, row.alert.source], ['off', 'payment']);
    // lead time: the recurring item asks for 1 day, the payment for nothing -> inherits 1 day
    ok(await put(p.client, 'recurring', rule.id, { mode: 'on', days: 1 }));
    ok(await put(p.client, 'transaction', occ.id, { mode: 'on' }));
    assert.equal(ok(await p.client.get('/transactions?status=pending&limit=50')).find((t) => t.id === occ.id).alert.days, 1);
    await p.client.del(`/alerts/transaction/${occ.id}`);
    await p.client.del(`/alerts/recurring/${rule.id}`);
    const base = ok(await p.client.get('/transactions?status=pending&limit=50')).find((t) => t.id === occ.id);
    assert.deepEqual([base.alert.mode, base.alert.source, base.alert.days], ['off', 'category', 3], 'back to the category rule');
    await p.client.del(`/alerts/category/${cat}`);
    assert.deepEqual(
      (({ mode, source, days }) => ({ mode, source, days }))(ok(await p.client.get('/transactions?status=pending&limit=50')).find((t) => t.id === occ.id).alert),
      { mode: 'on', source: 'default', days: 3 },
    );
  });

  it('is personal: someone else\'s choice does not change yours', async () => {
    const a = await person();
    const b = await person();
    const t = ok(await pay(a.client, 1), 201);
    ok(await put(a.client, 'transaction', t.id, { mode: 'off' }));
    fails(await put(b.client, 'transaction', t.id, { mode: 'on' }), 404, "you can't set rules for someone else's payment");
    fails(await b.client.del(`/alerts/transaction/${t.id}`).then((r) => (r.status === 204 ? { status: 404, json: { error: 'x' } } : r)), 404);
    assert.equal(ok(await a.client.get('/alerts/overrides')).length, 1);
    assert.deepEqual(ok(await b.client.get('/alerts/overrides')), []);
  });

  it('validates what it is asked to store', async () => {
    const p = await person();
    const t = ok(await pay(p.client, 1), 201);
    for (const body of [{}, { mode: 'maybe' }, { mode: 'on', days: -1 }, { mode: 'on', days: 61 }, { mode: 'on', days: 1.5 }, { mode: 'on', days: '3' }, { days: 3 }, { mode: null }]) {
      assert.equal((await put(p.client, 'transaction', t.id, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await put(p.client, 'payment', t.id, { mode: 'on' })).status, 400, 'unknown target type');
    assert.equal((await put(p.client, 'transaction', 99999999, { mode: 'on' })).status, 404);
    for (const id of ['abc', '0', '-1', '99999999999']) assert.ok([400, 404].includes((await put(p.client, 'transaction', id, { mode: 'on' })).status), id);
    assert.deepEqual(ok(await put(p.client, 'transaction', t.id, { mode: 'on', days: 0 })), { target_type: 'transaction', target_id: t.id, mode: 'on', days: 0 });
    assert.equal(ok(await put(p.client, 'transaction', t.id, { mode: 'off' })).days, null, 'replacing resets the lead time');
    assert.equal(ok(await p.client.get('/alerts/overrides')).length, 1);
    assert.equal((await p.client.del(`/alerts/transaction/${t.id}`)).status, 204);
    assert.equal((await p.client.del(`/alerts/transaction/${t.id}`)).status, 204, 'removing nothing is fine');
  });

  it('lists upcoming payments across every budget, each with the rule that applies', async () => {
    const { owner, g } = await household(1);
    owner.client.ws = null;
    const own = ok(await pay(owner.client, 5, { description: 'Mine' }), 201);
    const grp = ok(await owner.client.inWorkspace(g.id, () => pay(owner.client, 6, { description: 'Shared' })), 201);
    const late = ok(await pay(owner.client, -3, { description: 'Late' }), 201);
    ok(await tx(owner.client, { description: 'Paid', date: daysFromToday(2), status: 'paid' }), 201);
    ok(await tx(owner.client, { description: 'Far away', amount: 5, date: daysFromToday(200), status: 'pending' }), 201);
    ok(await put(owner.client, 'transaction', own.id, { mode: 'off', days: 2 }));
    const r = ok(await owner.client.get('/alerts/upcoming?days=30'));
    assert.equal(r.defaults.lead_days, 3);
    assert.deepEqual(r.items.map((i) => i.description), ['Late', 'Mine', 'Shared'], 'sorted by date, no paid or far-away items');
    const by = Object.fromEntries(r.items.map((i) => [i.description, i]));
    assert.deepEqual([by.Mine.mode, by.Mine.source_of_rule, by.Mine.days, by.Mine.own_mode], ['off', 'payment', 2, 'off']);
    assert.deepEqual([by.Shared.mode, by.Shared.source_of_rule, by.Shared.workspace, by.Shared.workspace_kind], ['on', 'default', 'Home', 'group']);
    assert.equal(by.Shared.workspace_id, g.id);
    assert.equal(by.Late.mode, 'on');
    assert.ok(grp && late);
    assert.equal(ok(await owner.client.get('/alerts/upcoming?days=1000')).items.length, 4);
  });

  it('the payment list tells each row whether it will alert you', async () => {
    const p = await person();
    const t = ok(await pay(p.client, 10), 201);
    const get = async () => ok(await p.client.get('/transactions?status=pending')).find((x) => x.id === t.id).alert;
    assert.deepEqual(await get(), { mode: 'on', source: 'default', days: 3, own: null });
    ok(await put(p.client, 'transaction', t.id, { mode: 'on', days: 14 }));
    assert.deepEqual(await get(), { mode: 'on', source: 'payment', days: 14, own: { mode: 'on', days: 14 } });
  });

  it('overrides disappear with the thing they belong to', async () => {
    const p = await person();
    const t = ok(await pay(p.client, 1), 201);
    const cat = ok(await p.client.post('/categories', { name: 'Temp', kind: 'expense', color: '#123456' }), 201);
    ok(await put(p.client, 'transaction', t.id, { mode: 'off' }));
    ok(await put(p.client, 'category', cat.id, { mode: 'off' }));
    assert.equal(ok(await p.client.get('/alerts/overrides')).length, 2);
    await p.client.del(`/transactions/${t.id}`);
    await p.client.del(`/categories/${cat.id}`);
    assert.deepEqual(ok(await p.client.get('/alerts/overrides')), [], 'labels of deleted things are not listed');
  });
});

describe('balance warnings', () => {
  it('warns when the forecast goes negative, once per month it happens in', async () => {
    const p = await person();
    await setPrefs(p, { forecast_warning: true });
    await tx(p.client, { type: 'income', description: 'Paid in', amount: 100, date: today(), status: 'paid' });
    const M3 = addMonthsYM(thisMonth(), 3);
    await tx(p.client, { description: 'Big bill', amount: 5000, date: `${M3}-10`, status: 'pending' });
    assert.equal((await scan(p)).created, 1);
    const n = (await list(p)).items.find((x) => x.kind === 'forecast_warning');
    assert.match(n.title, /Your balance is projected to go negative in /);
    assert.equal(n.data.month, M3);
    assert.equal(n.data.balance, -4900);
    assert.equal(n.link, '/forecast');
    assert.equal((await scan(p)).created, 0, 'not repeated');
  });

  it('warns when the balance is already negative, once a month', async () => {
    const p = await person();
    await setPrefs(p, { balance_warning: true });
    await tx(p.client, { description: 'Overspent', amount: 200, date: today(), status: 'paid' });
    ok(await pay(p.client, 40, { description: 'Pending anyway' }), 201); // a budget needs something pending to be checked
    await scan(p);
    const n = (await list(p)).items.find((x) => x.kind === 'balance_warning');
    assert.match(n.title, /below zero/);
    assert.equal(n.data.balance, -200);
    assert.equal((await scan(p)).created, 0);
  });

  it('can be switched off, and a healthy budget gets none', async () => {
    const off = await person();
    await setPrefs(off, { balance_warning: false });
    await tx(off.client, { description: 'Overspent', amount: 200, date: today(), status: 'paid' });
    ok(await pay(off.client, 40), 201);
    await scan(off);
    assert.ok(!(await kinds(off)).includes('balance_warning'));
    const fine = await person();
    await setPrefs(fine, { balance_warning: true });
    await tx(fine.client, { type: 'income', description: 'Pay', amount: 9000, date: today(), status: 'paid' });
    ok(await pay(fine.client, 40), 201);
    await scan(fine);
    assert.ok(!(await kinds(fine)).includes('balance_warning'));
  });

  it('a shared budget warns every member who wants to know', async () => {
    const { owner, members } = await household(1);
    const [m] = members;
    await setPrefs(owner, { balance_warning: true });
    await setPrefs(m, { balance_warning: false });
    await tx(owner.client, { description: 'Overspent', amount: 700, date: today(), status: 'paid' });
    ok(await pay(owner.client, 40), 201);
    await scan(owner);
    await scan(m);
    const n = (await list(owner)).items.find((x) => x.kind === 'balance_warning');
    assert.match(n.title, /Home is below zero/);
    assert.ok(!(await kinds(m)).includes('balance_warning'));
  });
});

describe('refreshing', () => {
  it('is limited so the page cannot hammer the server', async () => {
    const p = await person();
    let last;
    for (let i = 0; i < 14; i++) last = await p.client.post('/notifications/refresh');
    assert.equal(last.status, 429);
  });
});
