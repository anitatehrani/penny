import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { categoryId, connect, daysFromToday, fails, ok, shutdown, signup, startServer, today, tx } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('sharing');
});
after(async () => {
  await shutdown(srv);
});

/** alice is connected to bob and carol; dave is a stranger. */
async function circle() {
  const alice = await signup(srv, { name: 'Alice Alpha' });
  const bob = await signup(srv, { name: 'Bob Beta' });
  const carol = await signup(srv, { name: 'Carol Gamma' });
  const dave = await signup(srv, { name: 'Dave Delta' });
  await connect(alice, bob);
  await connect(alice, carol);
  return { alice, bob, carol, dave };
}
const withPeople = (...pairs) => pairs.map(([p, share]) => ({ username: p.user.username, share }));
const parts = (t) => t.participants.map((p) => [p.username, p.share]);

describe('adding people to a payment', () => {
  it('stores each person\'s share and lists them by name', async () => {
    const { alice, bob, carol } = await circle();
    const t = ok(await tx(alice.client, { amount: 100, participants: withPeople([carol, 30], [bob, 40]) }), 201);
    assert.deepEqual(parts(t), [[bob.user.username, 40], [carol.user.username, 30]], 'sorted by name');
    assert.deepEqual(Object.keys(t.participants[0]).sort(), ['avatar_url', 'name', 'share', 'username'], 'no email or phone');
    const listed = ok(await alice.client.get('/transactions?status='));
    assert.equal(listed[0].participants.length, 2);
  });

  it('shares may add up to exactly the amount, may be zero, and are rounded to cents', async () => {
    const { alice, bob, carol } = await circle();
    ok(await tx(alice.client, { amount: 100, participants: withPeople([bob, 60], [carol, 40]) }), 201);
    const zero = ok(await tx(alice.client, { amount: 50, participants: withPeople([bob, 0]) }), 201);
    assert.deepEqual(parts(zero), [[bob.user.username, 0]]);
    const rounded = ok(await tx(alice.client, { amount: 50, participants: withPeople([bob, 10.126]) }), 201);
    assert.deepEqual(parts(rounded), [[bob.user.username, 10.13]]);
  });

  it('refuses shares that exceed the amount, and bad share values', async () => {
    const { alice, bob, carol } = await circle();
    fails(await tx(alice.client, { amount: 100, participants: withPeople([bob, 60], [carol, 40.01]) }), 400);
    fails(await tx(alice.client, { amount: 100, participants: withPeople([bob, 100.01]) }), 400);
    for (const share of [-1, 'abc', null, undefined, {}, [], 1e11]) {
      fails(await tx(alice.client, { amount: 100, participants: [{ username: bob.user.username, share }] }), 400);
    }
    assert.equal(ok(await alice.client.get('/transactions?status=')).length, 0, 'nothing was saved');
  });

  it('only your accepted connections can be added', async () => {
    const { alice, bob, dave } = await circle();
    fails(await tx(alice.client, { participants: withPeople([dave, 1]) }), 400, 'a stranger');
    fails(await tx(alice.client, { participants: withPeople([alice, 1]) }), 400, 'yourself');
    fails(await tx(alice.client, { participants: [{ username: 'nobodyxyz', share: 1 }] }), 400, 'a username that does not exist');
    fails(await tx(alice.client, { participants: [{ username: 'ab', share: 1 }] }), 400, 'an invalid username');
    fails(await tx(alice.client, { participants: [{ username: bob.user.username, share: 1 }, { username: dave.user.username, share: 1 }] }), 400, 'one bad entry spoils the whole payment');
    // pending and declined requests are not connections
    const pending = await signup(srv);
    ok(await alice.client.post('/connections', { username: pending.user.username }), 201);
    fails(await tx(alice.client, { participants: withPeople([pending, 1]) }), 400);
    const decliner = await signup(srv);
    ok(await alice.client.post('/connections', { username: decliner.user.username }), 201);
    ok(await decliner.client.post(`/connections/${ok(await decliner.client.get('/connections')).incoming[0].id}/decline`), 204);
    fails(await tx(alice.client, { participants: withPeople([decliner, 1]) }), 400);
    assert.equal(ok(await alice.client.get('/transactions?status=')).length, 0);
  });

  it('allows at most 20 people and ignores duplicates', async () => {
    const { alice, bob } = await circle();
    const many = Array.from({ length: 21 }, (_, i) => ({ username: `fake${i}user`, share: 0 }));
    fails(await tx(alice.client, { participants: many }), 400);
    const dup = ok(await tx(alice.client, { amount: 100, participants: [{ username: bob.user.username, share: 10 }, { username: bob.user.username.toUpperCase(), share: 99 }] }), 201);
    assert.deepEqual(parts(dup), [[bob.user.username, 10]], 'the first entry wins');
  });

  it('a payment without participants has none, and an empty list clears them', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { amount: 100 }), 201);
    assert.deepEqual(t.participants, []);
    const withB = ok(await alice.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 100, date: today(), participants: withPeople([bob, 10]) }));
    assert.equal(withB.participants.length, 1);
    const cleared = ok(await alice.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 100, date: today(), participants: [] }));
    assert.deepEqual(cleared.participants, []);
    assert.equal(ok(await bob.client.get('/shared')).length, 0);
  });

  it('editing without a participants list leaves them alone, but the amount must still cover their shares', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { amount: 100, participants: withPeople([bob, 60]) }), 201);
    const body = { type: 'expense', description: 'Renamed', amount: 100, date: today() };
    assert.equal(ok(await alice.client.put(`/transactions/${t.id}`, body)).participants.length, 1);
    assert.equal(ok(await alice.client.put(`/transactions/${t.id}`, { ...body, amount: 200 })).participants[0].share, 60, 'raising the amount is fine');
    fails(await alice.client.put(`/transactions/${t.id}`, { ...body, amount: 50 }), 400);
    assert.equal(ok(await alice.client.get('/transactions?status=')).find((x) => x.id === t.id).amount, 200, 'refused edit changed nothing');
    ok(await alice.client.put(`/transactions/${t.id}`, { ...body, amount: 50, participants: withPeople([bob, 20]) })); // adjusting both is fine
  });

  it('changing someone\'s share keeps the fact that they already added it to their budget', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { amount: 100, participants: withPeople([bob, 30]) }), 201);
    ok(await bob.client.post(`/shared/${t.id}/import`, {}), 201);
    ok(await alice.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 100, date: today(), participants: withPeople([bob, 45]) }));
    const s = ok(await bob.client.get('/shared'))[0];
    assert.equal(s.my_share, 45);
    assert.equal(s.imported, true);
  });

  it('group members can be added to a group payment without being connections', async () => {
    const owner = await signup(srv);
    const m = await signup(srv);
    await connect(owner, m);
    const g = ok(await owner.client.post('/workspaces', { name: 'G' }), 201);
    ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: m.user.username }), 201);
    ok(await m.client.post(`/workspace-invites/${ok(await m.client.get('/inbox')).group_invites[0].id}/accept`));
    const third = await signup(srv);
    await connect(owner, third);
    ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: third.user.username }), 201);
    ok(await third.client.post(`/workspace-invites/${ok(await third.client.get('/inbox')).group_invites[0].id}/accept`));
    ok(await owner.client.del(`/connections/${ok(await owner.client.get('/connections')).accepted.find((c) => c.user.username === m.user.username).id}`), 204);
    owner.client.ws = g.id;
    third.client.ws = g.id;
    // owner and m are no longer connected, but are both in the group
    const t = ok(await tx(owner.client, { amount: 60, participants: withPeople([m, 20]) }), 201);
    assert.equal(t.participants.length, 1);
    // a third member (connected to nobody but the owner) can edit and keeps the list valid relative to the creator
    const edited = ok(await third.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'Edited', amount: 60, date: today(), participants: withPeople([m, 25]) }));
    assert.deepEqual(parts(edited), [[m.user.username, 25]]);
  });
});

describe('shared with me', () => {
  it('shows only what the person needs, newest first, and never their own payments', async () => {
    const { alice, bob } = await circle();
    const old = ok(await tx(alice.client, { description: 'Older', amount: 40, date: daysFromToday(-10), participants: withPeople([bob, 10]), note: 'private note', category_id: await categoryId(alice.client, 'Groceries') }), 201);
    ok(await tx(alice.client, { description: 'Newer', amount: 80, date: daysFromToday(-1), participants: withPeople([bob, 20]) }), 201);
    ok(await tx(bob.client, { description: 'Bob own', amount: 5 }), 201);
    const s = ok(await bob.client.get('/shared'));
    assert.deepEqual(s.map((x) => x.description), ['Newer', 'Older']);
    assert.deepEqual(Object.keys(s[1]).sort(), ['amount', 'date', 'description', 'id', 'imported', 'my_share', 'shared_by', 'status', 'type']);
    assert.deepEqual(Object.keys(s[1].shared_by).sort(), ['avatar_url', 'name', 'username']);
    assert.ok(!JSON.stringify(s).includes('private note'));
    assert.equal(s[1].my_share, 10);
    assert.equal(s[1].amount, 40);
    assert.equal(s[1].shared_by.username, alice.user.username);
    assert.equal(ok(await alice.client.get('/shared')).length, 0, 'the creator is not a participant');
    assert.ok(old);
  });

  it('follows later edits of the original payment', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { description: 'v1', amount: 100, participants: withPeople([bob, 25]) }), 201);
    ok(await alice.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'v2', amount: 120, date: daysFromToday(-2) }));
    const s = ok(await bob.client.get('/shared'))[0];
    assert.deepEqual([s.description, s.amount, s.date], ['v2', 120, daysFromToday(-2)]);
    ok(await alice.client.patch(`/transactions/${t.id}/status`, { status: 'pending' }));
    assert.equal(ok(await bob.client.get('/shared'))[0].status, 'pending');
  });

  it('counts what is waiting in the inbox', async () => {
    const { alice, bob } = await circle();
    assert.equal(ok(await bob.client.get('/inbox')).shared_waiting, 0);
    const a = ok(await tx(alice.client, { participants: withPeople([bob, 1]) }), 201);
    ok(await tx(alice.client, { participants: withPeople([bob, 2]) }), 201);
    assert.equal(ok(await bob.client.get('/inbox')).shared_waiting, 2);
    ok(await bob.client.post(`/shared/${a.id}/import`, {}), 201);
    assert.equal(ok(await bob.client.get('/inbox')).shared_waiting, 1);
  });

  it('disappears when the payment is deleted or the person is taken off it', async () => {
    const { alice, bob, carol } = await circle();
    const t = ok(await tx(alice.client, { amount: 90, participants: withPeople([bob, 30], [carol, 30]) }), 201);
    assert.equal(ok(await bob.client.get('/shared')).length, 1);
    ok(await alice.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'x', amount: 90, date: today(), participants: withPeople([carol, 30]) }));
    assert.equal(ok(await bob.client.get('/shared')).length, 0);
    assert.equal(ok(await carol.client.get('/shared')).length, 1);
    await alice.client.del(`/transactions/${t.id}`);
    assert.equal(ok(await carol.client.get('/shared')).length, 0);
  });

  it('removing the connection ends sharing in both directions', async () => {
    const { alice, bob } = await circle();
    ok(await tx(alice.client, { amount: 50, participants: withPeople([bob, 10]) }), 201);
    ok(await tx(bob.client, { amount: 50, participants: withPeople([alice, 10]) }), 201);
    assert.equal(ok(await bob.client.get('/shared')).length, 1);
    assert.equal(ok(await alice.client.get('/shared')).length, 1);
    ok(await alice.client.del(`/connections/${ok(await alice.client.get('/connections')).accepted.find((c) => c.user.username === bob.user.username).id}`), 204);
    assert.equal(ok(await bob.client.get('/shared')).length, 0);
    assert.equal(ok(await alice.client.get('/shared')).length, 0);
    assert.equal(ok(await alice.client.get('/transactions?status=')).find((t) => t.description === 'Test payment').participants.length, 0);
  });
});

describe('adding my share to my own budget', () => {
  it('copies the share into the personal budget with a clear description', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { description: 'Dinner', amount: 100, date: daysFromToday(-3), participants: withPeople([bob, 35]) }), 201);
    const r = ok(await bob.client.post(`/shared/${t.id}/import`, {}), 201);
    const copy = ok(await bob.client.get('/transactions?status=')).find((x) => x.id === r.transaction_id);
    assert.deepEqual([copy.description, copy.amount, copy.date, copy.type, copy.status, copy.source, copy.note], ['Dinner (with Alice Alpha)', 35, daysFromToday(-3), 'expense', 'paid', 'manual', 'Added from a shared payment']);
    assert.equal(copy.member_username, bob.user.username);
    assert.equal(ok(await bob.client.get('/shared'))[0].imported, true);
    // it is an independent payment
    ok(await bob.client.put(`/transactions/${copy.id}`, { type: 'expense', description: 'Mine now', amount: 36, date: copy.date }));
    assert.equal(ok(await bob.client.get('/shared'))[0].my_share, 35);
    assert.equal(ok(await alice.client.get('/transactions?status=')).find((x) => x.id === t.id).amount, 100);
  });

  it('future payments arrive as pending, and the status and category can be chosen', async () => {
    const { alice, bob } = await circle();
    const future = ok(await tx(alice.client, { description: 'Later', amount: 20, date: daysFromToday(10), status: 'pending', participants: withPeople([bob, 8]) }), 201);
    const r = ok(await bob.client.post(`/shared/${future.id}/import`, {}), 201);
    assert.equal(ok(await bob.client.get('/transactions?status=')).find((x) => x.id === r.transaction_id).status, 'pending');
    const past = ok(await tx(alice.client, { description: 'Earlier', amount: 20, date: daysFromToday(-4), participants: withPeople([bob, 8]) }), 201);
    const cat = await categoryId(bob.client, 'Dining & leisure');
    const r2 = ok(await bob.client.post(`/shared/${past.id}/import`, { status: 'pending', category_id: cat }), 201);
    const copy = ok(await bob.client.get('/transactions?status=')).find((x) => x.id === r2.transaction_id);
    assert.deepEqual([copy.status, copy.category_id], ['pending', cat]);
  });

  it('keeps the payment type (income stays income) and shortens very long descriptions', async () => {
    const { alice, bob } = await circle();
    const inc = ok(await tx(alice.client, { type: 'income', description: 'Refund', amount: 80, participants: withPeople([bob, 30]) }), 201);
    const r = ok(await bob.client.post(`/shared/${inc.id}/import`, {}), 201);
    assert.equal(ok(await bob.client.get('/transactions?status=')).find((x) => x.id === r.transaction_id).type, 'income');
    const long = ok(await tx(alice.client, { description: 'L'.repeat(200), amount: 10, participants: withPeople([bob, 5]) }), 201);
    const r2 = ok(await bob.client.post(`/shared/${long.id}/import`, {}), 201);
    assert.equal(ok(await bob.client.get('/transactions?status=')).find((x) => x.id === r2.transaction_id).description.length, 200);
  });

  it('works into a shared budget too, attributed to the importer', async () => {
    const { alice, bob } = await circle();
    const g = ok(await bob.client.post('/workspaces', { name: 'Bob home' }), 201);
    const t = ok(await tx(alice.client, { description: 'Gift', amount: 50, participants: withPeople([bob, 25]) }), 201);
    const r = ok(await bob.client.post(`/shared/${t.id}/import`, {}, { 'x-workspace': String(g.id) }), 201);
    const inGroup = ok(await bob.client.get('/transactions?status=', { 'x-workspace': String(g.id) }));
    assert.equal(inGroup.find((x) => x.id === r.transaction_id).member_username, bob.user.username);
    assert.equal(ok(await bob.client.get('/transactions?status=')).length, 0, 'not in the personal budget');
  });

  it('cannot be done twice, by outsiders, for a zero share, or with a foreign category', async () => {
    const { alice, bob, carol, dave } = await circle();
    const t = ok(await tx(alice.client, { amount: 100, participants: withPeople([bob, 30], [carol, 0]) }), 201);
    fails(await dave.client.post(`/shared/${t.id}/import`, {}), 404, 'not a participant');
    fails(await alice.client.post(`/shared/${t.id}/import`, {}), 404, 'the creator is not a participant either');
    fails(await carol.client.post(`/shared/${t.id}/import`, {}), 400, 'share is zero');
    const foreign = await categoryId(alice.client, 'Groceries');
    fails(await bob.client.post(`/shared/${t.id}/import`, { category_id: foreign }), 400);
    fails(await bob.client.post(`/shared/${t.id}/import`, { status: 'bogus' }), 400);
    ok(await bob.client.post(`/shared/${t.id}/import`, {}), 201);
    fails(await bob.client.post(`/shared/${t.id}/import`, {}), 409);
    assert.equal(ok(await bob.client.get('/transactions?status=')).length, 1, 'only one copy');
    fails(await bob.client.post('/shared/999999/import', {}), 404);
    fails(await bob.client.post('/shared/abc/import', {}), 400);
  });

  it('after deleting the copy it can be added again', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { amount: 100, participants: withPeople([bob, 30]) }), 201);
    const r = ok(await bob.client.post(`/shared/${t.id}/import`, {}), 201);
    await bob.client.del(`/transactions/${r.transaction_id}`);
    assert.equal(ok(await bob.client.get('/shared'))[0].imported, false);
    ok(await bob.client.post(`/shared/${t.id}/import`, {}), 201);
  });

  it('keeps the copy when the original is deleted or the person is removed from it', async () => {
    const { alice, bob } = await circle();
    const t = ok(await tx(alice.client, { amount: 100, participants: withPeople([bob, 30]) }), 201);
    const r = ok(await bob.client.post(`/shared/${t.id}/import`, {}), 201);
    await alice.client.del(`/transactions/${t.id}`);
    assert.ok(ok(await bob.client.get('/transactions?status=')).some((x) => x.id === r.transaction_id));
    assert.equal(ok(await bob.client.get('/shared')).length, 0);
  });
});
