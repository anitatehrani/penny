import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonthsYM } from '../src/lib/dates.js';
import { categoryId, connect, daysFromToday, fails, ok, personalId, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('groups');
});
after(async () => {
  await shutdown(srv);
});

/** Owner + any number of connected friends, plus a group everyone has joined. */
async function household(names = ['member']) {
  const owner = await signup(srv, { name: 'Owner Olive' });
  const members = [];
  for (const n of names) {
    const m = await signup(srv, { name: `${n} Person` });
    await connect(owner, m);
    members.push(m);
  }
  const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
  for (const m of members) {
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: m.user.username }), 201);
    const inv = ok(await m.client.get('/inbox')).group_invites[0];
    ok(await m.client.post(`/workspace-invites/${inv.id}/accept`));
    m.client.ws = group.id;
  }
  owner.client.ws = group.id;
  return { owner, members, group };
}

describe('creating groups', () => {
  it('a group starts with its own categories, settings and a single owner member', async () => {
    const o = await signup(srv, { name: 'Olive Owner' });
    ok(await o.client.put('/settings', { opening_balance: 50, currency: 'GBP' }));
    const g = ok(await o.client.post('/workspaces', { name: '  Home  ' }), 201);
    assert.equal(g.name, 'Home');
    assert.equal(g.kind, 'group');
    assert.equal(g.role, 'owner');
    assert.equal(g.currency, 'GBP', 'inherits the creator\'s currency');
    assert.deepEqual(g.members.map((m) => [m.username, m.role]), [[o.user.username, 'owner']]);
    await o.client.inWorkspace(g.id, async () => {
      assert.equal(ok(await o.client.get('/categories')).length, 14);
      assert.deepEqual(ok(await o.client.get('/settings')), { opening_balance: 0, currency: 'GBP' }, 'balance starts at zero, not the personal one');
      assert.equal(ok(await o.client.get('/transactions?status=')).length, 0);
    });
  });

  it('lists personal first, then groups alphabetically, and validates names', async () => {
    const o = await signup(srv);
    ok(await o.client.post('/workspaces', { name: 'Zoo' }), 201);
    ok(await o.client.post('/workspaces', { name: 'Apartment' }), 201);
    const list = ok(await o.client.get('/workspaces'));
    assert.deepEqual(list.map((w) => w.kind === 'personal' ? 'personal' : w.name), ['personal', 'Apartment', 'Zoo']);
    for (const name of ['', '   ', 'x'.repeat(61), undefined, 5]) fails(await o.client.post('/workspaces', { name }), 400);
    assert.equal(ok(await o.client.get('/workspaces')).length, 3);
  });

  it('a person can be in several groups with separate money, categories and settings', async () => {
    const { owner, group } = await household([]);
    const second = ok(await owner.client.post('/workspaces', { name: 'Trip' }), 201);
    owner.client.ws = group.id;
    ok(await tx(owner.client, { description: 'Home thing', amount: 10 }), 201);
    ok(await owner.client.post('/categories', { name: 'Same Name', kind: 'expense', color: '#123456' }), 201);
    ok(await owner.client.put('/settings', { opening_balance: 5, currency: 'EUR' }));
    owner.client.ws = second.id;
    assert.equal(ok(await owner.client.get('/transactions?status=')).length, 0);
    ok(await owner.client.post('/categories', { name: 'Same Name', kind: 'expense', color: '#123456' }), 201); // no clash across groups
    assert.equal(ok(await owner.client.get('/settings')).currency, 'USD');
    assert.equal(ok(await owner.client.get('/summary')).balance, 0);
    owner.client.ws = null;
    assert.equal(ok(await owner.client.get('/transactions?status=')).length, 0, 'personal untouched');
  });

  it('personal budgets cannot be renamed, deleted, left or invited to', async () => {
    const o = await signup(srv);
    const f = await signup(srv);
    await connect(o, f);
    const pid = await personalId(o.client);
    fails(await o.client.put(`/workspaces/${pid}`, { name: 'Nope' }), 400);
    fails(await o.client.del(`/workspaces/${pid}`), 400);
    fails(await o.client.post(`/workspaces/${pid}/leave`), 400);
    fails(await o.client.post(`/workspaces/${pid}/invites`, { username: f.user.username }), 400);
    fails(await o.client.post(`/workspaces/${pid}/transfer`, { username: f.user.username }), 400);
    assert.equal(ok(await o.client.get('/workspaces')).length, 1);
  });
});

describe('selecting a budget (X-Workspace)', () => {
  it('defaults to personal, honours the header and the ?ws= link form', async () => {
    const { owner, group } = await household([]);
    const pid = await personalId(owner.client);
    ok(await owner.client.inWorkspace(group.id, () => tx(owner.client, { description: 'In group' })), 201);
    owner.client.ws = null;
    assert.equal(ok(await owner.client.get('/transactions?status=')).length, 0, 'no header = personal');
    assert.equal(ok(await owner.client.get('/transactions?status=', { 'x-workspace': String(group.id) })).length, 1);
    assert.equal(ok(await owner.client.get(`/transactions?status=&ws=${group.id}`)).length, 1);
    assert.equal(ok(await owner.client.get('/transactions?status=', { 'x-workspace': String(pid) })).length, 0);
    assert.equal((await owner.client.get(`/transactions/export.csv?ws=${group.id}`)).text.includes('In group'), true);
    assert.equal((await owner.client.get('/transactions/export.csv')).text.includes('In group'), false);
  });

  it('refuses budgets you are not in, and malformed ids, with a clean error', async () => {
    const { owner, group } = await household([]);
    const outsider = await signup(srv);
    const otherPersonal = await personalId(owner.client);
    for (const [value, status] of [[String(group.id), 403], [String(otherPersonal), 403], ['999999', 403], ['abc', 400], ['0', 400], ['-1', 400], ['1.5', 400], ['1 OR 1=1', 400], ["1; DROP TABLE users", 400], ['99999999999', 403], ['1e3', 403]]) {
      const r = await outsider.client.get('/transactions', { 'x-workspace': value });
      assert.ok(r.status === status || (status === 403 && r.status === 400), `X-Workspace ${JSON.stringify(value)} → ${r.status}`);
      assert.ok(r.status !== 200 && r.status !== 500);
    }
    assert.equal((await outsider.client.get(`/transactions?ws=${group.id}`)).status, 403);
    assert.equal((await outsider.client.get('/transactions?ws=abc')).status, 400);
    // writes are refused too
    fails(await outsider.client.post('/transactions', { type: 'expense', description: 'x', amount: 1, date: today() }, { 'x-workspace': String(group.id) }), 403);
    fails(await outsider.client.put('/settings', { opening_balance: 1, currency: 'USD' }, { 'x-workspace': String(group.id) }), 403);
    assert.equal(ok(await owner.client.get('/transactions?status=')).length, 0, 'nothing was written');
  });
});

describe('invitations', () => {
  it('only connections can be invited, only by the owner, and only once at a time', async () => {
    const o = await signup(srv);
    const friend = await signup(srv);
    const stranger = await signup(srv);
    const g = ok(await o.client.post('/workspaces', { name: 'G' }), 201);
    await connect(o, friend);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: stranger.user.username }), 400);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: 'nobodyxyz' }), 400);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: o.user.username }), 400);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: '' }), 400);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, {}), 400);
    ok(await o.client.post(`/workspaces/${g.id}/invites`, { username: friend.user.username }), 201);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: friend.user.username }), 409);
    // a pending request is not a connection
    const pending = await signup(srv);
    ok(await o.client.post('/connections', { username: pending.user.username }), 201);
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: pending.user.username }), 400);
    // non-members cannot invite or even see the group
    fails(await friend.client.post(`/workspaces/${g.id}/invites`, { username: o.user.username }), 404);
    fails(await stranger.client.get(`/workspaces/${g.id}/invites`), 404);
    assert.equal(ok(await o.client.get(`/workspaces/${g.id}/invites`)).length, 1);
  });

  it('the invitee sees it, can accept or decline once, and only they can answer', async () => {
    const o = await signup(srv);
    const f = await signup(srv, { name: 'Faye Friend' });
    const x = await signup(srv);
    await connect(o, f);
    const g = ok(await o.client.post('/workspaces', { name: 'Our place' }), 201);
    ok(await o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 201);
    const inbox = ok(await f.client.get('/inbox'));
    assert.equal(inbox.group_invites.length, 1);
    assert.deepEqual([inbox.group_invites[0].workspace.name, inbox.group_invites[0].workspace.member_count, inbox.group_invites[0].inviter.username], ['Our place', 1, o.user.username]);
    const id = inbox.group_invites[0].id;
    fails(await x.client.post(`/workspace-invites/${id}/accept`), 404);
    fails(await x.client.post(`/workspace-invites/${id}/decline`), 404);
    fails(await o.client.post(`/workspace-invites/${id}/accept`), 404, 'the inviter cannot accept for them');
    fails(await f.client.get('/transactions', { 'x-workspace': String(g.id) }), 403, 'not a member yet');
    assert.equal(ok(await f.client.post(`/workspace-invites/${id}/accept`)).workspace_id, g.id);
    fails(await f.client.post(`/workspace-invites/${id}/accept`), 404, 'cannot accept twice');
    fails(await f.client.post(`/workspace-invites/${id}/decline`), 404);
    assert.equal(ok(await f.client.get('/inbox')).group_invites.length, 0);
    const mine = ok(await f.client.get('/workspaces')).find((w) => w.id === g.id);
    assert.deepEqual(mine.members.map((m) => [m.name, m.role]), [[o.user.name, 'owner'], ['Faye Friend', 'member']]);
    ok(await f.client.get('/transactions', { 'x-workspace': String(g.id) }));
    fails(await o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 409, 'already a member');
  });

  it('declining keeps them out, and they can be invited again', async () => {
    const o = await signup(srv);
    const f = await signup(srv);
    await connect(o, f);
    const g = ok(await o.client.post('/workspaces', { name: 'G' }), 201);
    ok(await o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 201);
    const first = ok(await f.client.get('/inbox')).group_invites[0].id;
    assert.equal((await f.client.post(`/workspace-invites/${first}/decline`)).status, 204);
    assert.equal(ok(await o.client.get(`/workspaces/${g.id}/invites`)).length, 0, 'no longer pending');
    fails(await f.client.get('/transactions', { 'x-workspace': String(g.id) }), 403);
    ok(await o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 201);
    assert.equal(ok(await f.client.get('/inbox')).group_invites.length, 1);
  });

  it('the owner can cancel an invitation, which then cannot be accepted', async () => {
    const o = await signup(srv);
    const f = await signup(srv);
    const other = await signup(srv);
    await connect(o, f);
    const g = ok(await o.client.post('/workspaces', { name: 'G' }), 201);
    ok(await o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 201);
    const inv = ok(await o.client.get(`/workspaces/${g.id}/invites`))[0];
    fails(await f.client.del(`/workspace-invites/${inv.id}`), 404, 'the invitee cannot cancel');
    fails(await other.client.del(`/workspace-invites/${inv.id}`), 404);
    assert.equal((await o.client.del(`/workspace-invites/${inv.id}`)).status, 204);
    fails(await f.client.post(`/workspace-invites/${inv.id}/accept`), 404);
    assert.equal(ok(await f.client.get('/inbox')).group_invites.length, 0);
    fails(await o.client.del(`/workspace-invites/${inv.id}`), 404);
  });

  it('removing the connection afterwards does not break a pending invitation', async () => {
    const o = await signup(srv);
    const f = await signup(srv);
    await connect(o, f);
    const g = ok(await o.client.post('/workspaces', { name: 'G' }), 201);
    ok(await o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }), 201);
    const cid = ok(await o.client.get('/connections')).accepted[0].id;
    ok(await o.client.del(`/connections/${cid}`), 204);
    const inv = ok(await f.client.get('/inbox')).group_invites[0];
    assert.ok(inv, 'still shown');
    assert.equal((await f.client.post(`/workspace-invites/${inv.id}/accept`)).status, 200);
  });
});

describe('shared money', () => {
  it('pools everyone\'s income into one balance and breaks it down by member', async () => {
    const { owner, members, group } = await household(['Marco']);
    const [marco] = members;
    const M = thisMonth();
    ok(await tx(owner.client, { type: 'income', description: 'Olive pay', amount: 2000, date: `${M}-01`, paid_by: owner.user.username }), 201);
    ok(await tx(marco.client, { type: 'income', description: 'Marco pay', amount: 1500, date: `${M}-01`, paid_by: marco.user.username }), 201);
    ok(await tx(marco.client, { description: 'Rent', amount: 900, date: `${M}-02` }), 201); // defaults to the creator
    ok(await tx(owner.client, { description: 'Groceries', amount: 100, date: `${M}-02`, paid_by: marco.user.username }), 201);
    ok(await tx(owner.client, { description: 'Pending bill', amount: 50, date: `${M}-28`, status: 'pending', paid_by: owner.user.username }), 201);
    const s = ok(await owner.client.get(`/summary?month=${M}`));
    assert.equal(s.balance, 3500 - 1000);
    assert.equal(s.totals.incomePaid, 3500);
    assert.equal(s.totals.expensePending, 50);
    const by = Object.fromEntries(s.byMember.map((m) => [m.username, m]));
    assert.deepEqual([by[owner.user.username].income, by[owner.user.username].expenses, by[owner.user.username].expenses_paid], [2000, 50, 0]);
    assert.deepEqual([by[marco.user.username].income, by[marco.user.username].expenses, by[marco.user.username].expenses_paid], [1500, 1000, 1000]);
    assert.equal(s.byMember[0].username, owner.user.username, 'owner first');
    // the other member sees exactly the same numbers
    assert.deepEqual(ok(await marco.client.get(`/summary?month=${M}`)).totals, s.totals);
    assert.equal(ok(await marco.client.get(`/summary?month=${M}`)).balance, s.balance);
    assert.ok(group);
  });

  it('every member can add, edit, pay and delete shared payments', async () => {
    const { owner, members } = await household(['Pat']);
    const [pat] = members;
    const t = ok(await tx(owner.client, { description: 'By owner', amount: 10, paid_by: owner.user.username }), 201);
    const edited = ok(await pat.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'Edited by Pat', amount: 25, date: today() }));
    assert.equal(edited.description, 'Edited by Pat');
    assert.equal(edited.member_username, owner.user.username, 'paid_by is kept when the editor does not send it');
    const moved = ok(await pat.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 25, date: today(), paid_by: pat.user.username }));
    assert.equal(moved.member_username, pat.user.username);
    ok(await pat.client.patch(`/transactions/${t.id}/status`, { status: 'pending' }));
    assert.equal((await pat.client.del(`/transactions/${t.id}`)).status, 200);
    assert.equal(ok(await owner.client.get('/transactions?status=')).length, 0);
  });

  it('"paid by" must be a member of this budget', async () => {
    const { owner } = await household(['A']);
    const outsider = await signup(srv);
    for (const paid_by of [outsider.user.username, 'nobodyxyz', 'AB', 'has space', '']) {
      const r = await tx(owner.client, { paid_by });
      assert.ok([400].includes(r.status), `paid_by ${JSON.stringify(paid_by)} → ${r.status}`);
    }
    ok(await tx(owner.client, { paid_by: null }), 201);
    ok(await tx(owner.client, { paid_by: owner.user.username.toUpperCase() }), 201);
  });

  it('filters and exports by member', async () => {
    const { owner, members } = await household(['Quinn']);
    const [q] = members;
    ok(await tx(owner.client, { description: 'Olive item', paid_by: owner.user.username }), 201);
    ok(await tx(q.client, { description: 'Quinn item' }), 201);
    const list = (member) => ok(owner.client.get(`/transactions?status=&member=${member}`) && null) ?? null;
    assert.deepEqual(ok(await owner.client.get(`/transactions?member=${q.user.username}`)).map((t) => t.description), ['Quinn item']);
    assert.deepEqual(ok(await owner.client.get(`/transactions?member=${owner.user.username}`)).map((t) => t.description), ['Olive item']);
    assert.equal(ok(await owner.client.get('/transactions')).length, 2);
    const csv = (await owner.client.get('/transactions/export.csv')).text;
    assert.equal(csv.split('\n')[0], 'date,type,description,category,amount,status,member,with,receipts,note');
    assert.ok(csv.includes('Quinn Person'));
    assert.ok(list);
  });

  it('recurring items and installments can belong to a member', async () => {
    const { owner, members } = await household(['Rae']);
    const [rae] = members;
    const rule = ok(await owner.client.post('/recurring', { type: 'income', description: 'Rae salary', amount: 1000, frequency: 'monthly', start_date: today(), paid_by: rae.user.username }), 201);
    assert.equal(rule.member_username, rae.user.username);
    const occ = ok(await owner.client.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id);
    assert.ok(occ.length > 20 && occ.every((t) => t.member_username === rae.user.username));
    // edit the owner of the rule: future occurrences follow
    const upd = ok(await owner.client.put(`/recurring/${rule.id}`, { type: 'income', description: 'Rae salary', amount: 1000, frequency: 'monthly', start_date: today(), active: true, paid_by: owner.user.username }));
    assert.equal(upd.member_username, owner.user.username);
    assert.ok(ok(await owner.client.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id).every((t) => t.member_username === owner.user.username));
    // omitting paid_by keeps it
    const kept = ok(await owner.client.put(`/recurring/${rule.id}`, { type: 'income', description: 'Rae salary', amount: 1000, frequency: 'monthly', start_date: today(), active: true }));
    assert.equal(kept.member_username, owner.user.username);
    fails(await owner.client.post('/recurring', { type: 'income', description: 'x', amount: 1, frequency: 'monthly', start_date: today(), paid_by: 'nobodyxyz' }), 400);
    const plan = ok(await owner.client.post('/installments', { description: 'Sofa', total_amount: 300, installment_count: 3, first_due_date: today(), paid_by: rae.user.username }), 201);
    assert.equal(plan.member_username, rae.user.username);
    assert.ok(ok(await owner.client.get('/transactions?q=Sofa')).every((t) => t.member_username === rae.user.username));
    fails(await owner.client.post('/installments', { description: 'x', total_amount: 30, installment_count: 3, first_due_date: today(), paid_by: 'nobodyxyz' }), 400);
  });

  it('forecast, categories and settings are the group\'s own', async () => {
    const { owner, members, group } = await household(['Sam']);
    const [sam] = members;
    ok(await owner.client.put('/settings', { opening_balance: 1000, currency: 'EUR' }));
    const M2 = addMonthsYM(thisMonth(), 2);
    ok(await tx(sam.client, { amount: 300, date: `${M2}-01`, status: 'pending' }), 201);
    const f = ok(await sam.client.get('/forecast?past=0&months=3&estimateExpenses=0'));
    assert.equal(f.currentBalance, 1000);
    assert.equal(f.months.find((m) => m.month === M2).endBalance, 700);
    owner.client.ws = null;
    assert.equal(ok(await owner.client.get('/forecast?past=0&months=3&estimateExpenses=0')).currentBalance, 0, 'personal forecast is separate');
    assert.equal(ok(await owner.client.get('/summary')).currency, 'USD');
    owner.client.ws = group.id;
    assert.equal(ok(await owner.client.get('/summary')).currency, 'EUR');
    const cat = ok(await sam.client.post('/categories', { name: 'Shared only', kind: 'expense', color: '#abcdef' }), 201);
    assert.ok(ok(await owner.client.get('/categories')).some((c) => c.id === cat.id), 'members share categories');
    owner.client.ws = null;
    assert.ok(!ok(await owner.client.get('/categories')).some((c) => c.id === cat.id));
    fails(await owner.client.post('/transactions', { type: 'expense', description: 'x', amount: 1, date: today(), category_id: cat.id }), 400, 'a group category cannot be used in the personal budget');
  });
});

describe('membership', () => {
  it('the owner can remove a member, who immediately loses access', async () => {
    const { owner, members, group } = await household(['Tom', 'Uma']);
    const [tom, uma] = members;
    ok(await tx(tom.client, { description: 'Tom spent' }), 201);
    fails(await uma.client.del(`/workspaces/${group.id}/members/${tom.user.username}`), 403, 'members cannot remove each other');
    fails(await owner.client.del(`/workspaces/${group.id}/members/${owner.user.username}`), 400);
    fails(await owner.client.del(`/workspaces/${group.id}/members/nobodyxyz`), 404);
    assert.equal((await owner.client.del(`/workspaces/${group.id}/members/${tom.user.username}`)).status, 204);
    fails(await tom.client.get('/transactions'), 403);
    assert.ok(!ok(await tom.client.get('/workspaces', { 'x-workspace': '' })).some((w) => w.id === group.id));
    assert.equal(ok(await owner.client.get('/workspaces')).find((w) => w.id === group.id).members.length, 2);
    assert.ok(ok(await owner.client.get('/transactions')).some((t) => t.description === 'Tom spent'), 'what they entered stays');
    assert.equal(ok(await owner.client.get('/transactions')).find((t) => t.description === 'Tom spent').member_name, tom.user.name);
  });

  it('members can leave; the owner cannot leave while others remain', async () => {
    const { owner, members, group } = await household(['Vic']);
    const [vic] = members;
    fails(await owner.client.post(`/workspaces/${group.id}/leave`), 400);
    assert.equal((await vic.client.post(`/workspaces/${group.id}/leave`)).status, 204);
    fails(await vic.client.get('/transactions'), 403);
    fails(await vic.client.post(`/workspaces/${group.id}/leave`), 404, 'already out');
    assert.equal(ok(await owner.client.get('/workspaces')).find((w) => w.id === group.id).members.length, 1);
    // a former member can be invited back
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: vic.user.username }), 201);
  });

  it('ownership can be transferred, after which the old owner is a normal member', async () => {
    const { owner, members, group } = await household(['Wes', 'Xan']);
    const [wes, xan] = members;
    const outsider = await signup(srv);
    fails(await wes.client.post(`/workspaces/${group.id}/transfer`, { username: wes.user.username }), 403, 'only the owner transfers');
    fails(await owner.client.post(`/workspaces/${group.id}/transfer`, { username: owner.user.username }), 400);
    fails(await owner.client.post(`/workspaces/${group.id}/transfer`, { username: outsider.user.username }), 400);
    fails(await owner.client.post(`/workspaces/${group.id}/transfer`, { username: 'nobodyxyz' }), 400);
    assert.equal((await owner.client.post(`/workspaces/${group.id}/transfer`, { username: wes.user.username })).status, 204);
    const roles = Object.fromEntries(ok(await owner.client.get('/workspaces')).find((w) => w.id === group.id).members.map((m) => [m.username, m.role]));
    assert.deepEqual(roles, { [wes.user.username]: 'owner', [owner.user.username]: 'member', [xan.user.username]: 'member' });
    fails(await owner.client.put(`/workspaces/${group.id}`, { name: 'Mine' }), 403);
    fails(await owner.client.del(`/workspaces/${group.id}`), 403);
    fails(await owner.client.post(`/workspaces/${group.id}/invites`, { username: xan.user.username }), 403);
    ok(await wes.client.put(`/workspaces/${group.id}`, { name: 'Wes\'s home' }));
    assert.equal((await owner.client.post(`/workspaces/${group.id}/leave`)).status, 204, 'the old owner can now leave');
  });

  it('the last person to leave takes the group with them', async () => {
    const o = await signup(srv);
    const g = ok(await o.client.post('/workspaces', { name: 'Solo' }), 201);
    o.client.ws = g.id;
    ok(await tx(o.client, { description: 'x' }), 201);
    o.client.ws = null;
    assert.equal((await o.client.post(`/workspaces/${g.id}/leave`)).status, 204);
    assert.equal((await srv.db.query('SELECT 1 FROM workspaces WHERE id = $1', [g.id])).rowCount, 0);
    assert.equal((await srv.db.query('SELECT 1 FROM transactions WHERE workspace_id = $1', [g.id])).rowCount, 0);
  });

  it('only the owner can rename or delete; deleting wipes everything for everyone', async () => {
    const { owner, members, group } = await household(['Yan']);
    const [yan] = members;
    const rule = ok(await owner.client.post('/recurring', { type: 'expense', description: 'r', amount: 1, frequency: 'monthly', start_date: today() }), 201);
    ok(await owner.client.post('/installments', { description: 'p', total_amount: 30, installment_count: 3, first_due_date: today() }), 201);
    ok(await tx(yan.client, { description: 'shared', participants: [{ username: owner.user.username, share: 4 }] }), 201);
    fails(await yan.client.put(`/workspaces/${group.id}`, { name: 'Hijack' }), 403);
    fails(await yan.client.del(`/workspaces/${group.id}`), 403);
    fails(await owner.client.put(`/workspaces/${group.id}`, { name: '' }), 400);
    assert.equal(ok(await owner.client.put(`/workspaces/${group.id}`, { name: 'Renamed' })).name, 'Renamed');
    assert.equal(ok(await yan.client.get('/workspaces')).find((w) => w.id === group.id).name, 'Renamed');
    const count = async (t) => (await srv.db.query(`SELECT count(*)::int n FROM ${t} WHERE workspace_id = $1`, [group.id])).rows[0].n;
    assert.ok((await count('transactions')) > 0 && (await count('categories')) === 14);
    assert.equal((await owner.client.del(`/workspaces/${group.id}`)).status, 204);
    for (const t of ['transactions', 'categories', 'recurring_rules', 'installment_plans', 'workspace_members', 'workspace_settings']) assert.equal(await count(t), 0, `${t} wiped`);
    assert.equal((await srv.db.query('SELECT count(*)::int n FROM transaction_participants p JOIN users u ON u.id = p.user_id WHERE u.id = $1', [owner.user.id])).rows[0].n, 0, 'participants wiped with their payments');
    fails(await yan.client.get('/transactions'), 403);
    fails(await owner.client.del(`/workspaces/${group.id}`), 404);
    assert.ok(rule);
    // personal budgets are untouched
    assert.equal(ok(await owner.client.get('/workspaces', { 'x-workspace': '' })).length, 1);
  });

  it('non-members cannot see, rename, delete, leave or inspect a group', async () => {
    const { group } = await household(['Zoe']);
    const outsider = await signup(srv);
    fails(await outsider.client.put(`/workspaces/${group.id}`, { name: 'x' }), 404);
    fails(await outsider.client.del(`/workspaces/${group.id}`), 404);
    fails(await outsider.client.post(`/workspaces/${group.id}/leave`), 404);
    fails(await outsider.client.get(`/workspaces/${group.id}/invites`), 404);
    fails(await outsider.client.post(`/workspaces/${group.id}/transfer`, { username: outsider.user.username }), 404);
    fails(await outsider.client.del(`/workspaces/${group.id}/members/someone`), 404);
    for (const id of ['abc', '0', '-3', '99999999999']) {
      const r = await outsider.client.put(`/workspaces/${id}`, { name: 'x' });
      assert.ok(r.status === 400 || r.status === 404, `id ${id} → ${r.status}`);
    }
  });
});

describe('leaving a group closes its shared payments', () => {
  it('a member who leaves (or is removed) no longer sees the group payments they were tagged in', async () => {
    const { owner, members, group } = await household(['Ann', 'Ben']);
    const [ann, ben] = members;
    ok(await tx(owner.client, { description: 'Group dinner', amount: 90, participants: [{ username: ann.user.username, share: 30 }, { username: ben.user.username, share: 30 }] }), 201);
    ann.client.ws = null;
    ben.client.ws = null;
    assert.equal(ok(await ann.client.get('/shared')).length, 1);
    assert.equal(ok(await ben.client.get('/shared')).length, 1);
    assert.equal((await ann.client.post(`/workspaces/${group.id}/leave`)).status, 204);
    assert.equal(ok(await ann.client.get('/shared')).length, 0, 'left → no more access');
    assert.equal((await owner.client.del(`/workspaces/${group.id}/members/${ben.user.username}`)).status, 204);
    assert.equal(ok(await ben.client.get('/shared')).length, 0, 'removed → no more access');
  });

  it('what they already added to their own budget stays', async () => {
    const { owner, members, group } = await household(['Cat']);
    const [cat] = members;
    ok(await tx(owner.client, { description: 'Shared trip', amount: 60, participants: [{ username: cat.user.username, share: 20 }] }), 201);
    cat.client.ws = null;
    const shared = ok(await cat.client.get('/shared'))[0];
    const imported = ok(await cat.client.post(`/shared/${shared.id}/import`, {}), 201);
    ok(await cat.client.post(`/workspaces/${group.id}/leave`), 204);
    assert.ok(ok(await cat.client.get('/transactions?status=')).some((t) => t.id === imported.transaction_id));
  });
});

describe('categories used across budgets', () => {
  it('a personal category cannot be used in a group and vice versa', async () => {
    const { owner } = await household([]);
    owner.client.ws = null;
    const personalCat = await categoryId(owner.client, 'Groceries');
    owner.client.ws = (ok(await owner.client.get('/workspaces')).find((w) => w.kind === 'group')).id;
    fails(await tx(owner.client, { category_id: personalCat }), 400);
    fails(await owner.client.put(`/categories/${personalCat}`, { name: 'x', kind: 'expense', color: '#000000' }), 404);
    fails(await owner.client.del(`/categories/${personalCat}`), 404);
    fails(await owner.client.post('/recurring', { type: 'expense', description: 'r', amount: 1, frequency: 'monthly', start_date: today(), category_id: personalCat }), 400);
    fails(await owner.client.post('/installments', { description: 'p', total_amount: 3, installment_count: 3, first_due_date: today(), category_id: personalCat }), 400);
    assert.ok(daysFromToday);
  });
});
