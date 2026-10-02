import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, connect, fails, ok, PW, shutdown, signup, startServer, uid } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('people');
});
after(async () => {
  await shutdown(srv);
});

const find = async (c, q) => ok(await c.get(`/people/lookup?q=${encodeURIComponent(q)}`));
const profileBody = (u, over = {}) => ({ name: u.name, username: u.username, phone: u.phone ?? '', discoverable: u.discoverable, find_by_email: u.find_by_email, find_by_phone: u.find_by_phone, ...over });
const save = async (p, over) => {
  const r = await p.client.put('/profile', profileBody(p.user, over));
  if (r.status === 200) p.user = r.json.user;
  return r;
};

describe('profile', () => {
  it('can change name, username, phone and visibility, and /auth/me follows', async () => {
    const p = await signup(srv, { phone: '+49 170 1111111' });
    const n = uid();
    const r = ok(await save(p, { name: '  New Name ', username: `@New.${n}`.toUpperCase(), phone: '0049 170 2222222', discoverable: false, find_by_email: false, find_by_phone: false }));
    assert.equal(r.user.name, 'New Name');
    assert.equal(r.user.username, `new.${n}`);
    assert.equal(r.user.phone, '+491702222222');
    assert.deepEqual([r.user.discoverable, r.user.find_by_email, r.user.find_by_phone], [false, false, false]);
    assert.deepEqual(ok(await p.client.get('/auth/me')).user, r.user);
    assert.ok(!JSON.stringify(r).includes('password_hash'));
  });

  it('can clear the phone number, and re-saving the same username is fine', async () => {
    const p = await signup(srv, { phone: '+49 170 3333333' });
    assert.equal(ok(await save(p, { phone: '' })).user.phone, null);
    assert.equal(ok(await save(p, { phone: null })).user.phone, null);
    ok(await save(p, {}));
    ok(await save(p, { username: p.user.username.toUpperCase() })); // same name, other casing
  });

  it('refuses taken or invalid values and changes nothing', async () => {
    const a = await signup(srv, { phone: '+49 170 4444444' });
    const b = await signup(srv, { phone: '+49 170 5555555' });
    fails(await save(b, { username: a.user.username }), 409);
    fails(await save(b, { username: a.user.username.toUpperCase() }), 409);
    fails(await save(b, { phone: '+49 170 4444444' }), 409);
    for (const bad of [{ name: '' }, { name: 'x'.repeat(81) }, { username: 'ab' }, { username: 'admin' }, { username: 'a b c' }, { phone: '12' }, { phone: '0170 5555555' }, { discoverable: 'yes' }, { find_by_email: null }]) {
      fails(await save(b, bad), 400);
    }
    const me = ok(await b.client.get('/auth/me')).user;
    assert.equal(me.username, b.user.username);
    assert.equal(me.phone, '+491705555555');
  });

  it('frees the old username for others and kills the old profile link', async () => {
    const a = await signup(srv);
    const viewer = await signup(srv);
    const old = a.user.username;
    ok(await viewer.client.get(`/people/${old}`));
    ok(await save(a, { username: `moved${uid()}` }));
    fails(await viewer.client.get(`/people/${old}`), 404);
    const taker = await signup(srv, { username: old });
    assert.equal(taker.user.username, old);
  });
});

describe('finding people', () => {
  let target;
  let searcher;
  before(async () => {
    target = await signup(srv, { name: 'Tina Target', phone: '+39 333 123 4567' });
    searcher = await signup(srv);
  });

  it('finds by username (any case, with @), email (any case) and phone (any format)', async () => {
    const u = target.user.username;
    for (const q of [u, `@${u}`, u.toUpperCase(), `  ${u}  `, target.user.email, target.user.email.toUpperCase(), '+39 333 123 4567', '+393331234567', '0039 333 123 4567', '+39-333-123-4567', '+39 (333) 123.4567']) {
      const r = await find(searcher.client, q);
      assert.equal(r.result?.username, u, `query ${JSON.stringify(q)}`);
    }
  });

  it('is exact only: no prefixes, substrings, partial emails or partial numbers', async () => {
    const u = target.user.username;
    for (const q of [u.slice(0, -1), u.slice(1), 'tina', target.user.email.split('@')[0], target.user.email.replace('@', ' @'), `x${target.user.email}`, '+39 333 123 456', '+39 333', '3331234567', 'Tina Target']) {
      assert.equal((await find(searcher.client, q)).result, null, `query ${JSON.stringify(q)} must not match`);
    }
  });

  it('returns only name, username, avatar and connection state — never email or phone', async () => {
    const r = await find(searcher.client, target.user.username);
    assert.deepEqual(Object.keys(r.result).sort(), ['avatar_url', 'connection', 'name', 'username']);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(target.user.email) && !text.includes('333'));
    const card = ok(await searcher.client.get(`/people/${target.user.username}`));
    assert.deepEqual(Object.keys(card.profile).sort(), ['avatar_url', 'connection', 'name', 'self', 'username']);
  });

  it('handles odd input without errors', async () => {
    const s = await signup(srv);
    for (const q of ['', '   ', '@', '@@', "' OR 1=1 --", '"; DROP TABLE users;--', '%', '_', '%%%', '\\', 'a'.repeat(500), '+'.repeat(30), '日本語', '😀', '<script>alert(1)</script>', 'a@b', '@x@y', '0'.repeat(40), '+0000000000', '123', '..', 'null', 'undefined']) {
      const r = await find(s.client, q);
      assert.equal(r.result, null, `query ${JSON.stringify(q).slice(0, 30)}`);
    }
    ok(await s.client.get('/people/lookup')); // no q at all
  });

  it('explains ambiguous phone numbers', async () => {
    const r = await find(searcher.client, '0333 1234567');
    assert.equal(r.result, null);
    assert.match(r.hint, /international format/);
  });

  it('never returns yourself', async () => {
    const r = await find(searcher.client, searcher.user.username);
    assert.equal(r.result, null);
    assert.match(r.hint, /your own/);
    assert.equal(ok(await searcher.client.get(`/people/${searcher.user.username}`)).profile.self, true);
  });

  it('respects each privacy switch', async () => {
    const p = await signup(srv, { phone: '+44 7700 900777' });
    const s = await signup(srv);
    const by = { u: p.user.username, e: p.user.email, ph: '+447700900777' };
    const visible = async (q) => (await find(s.client, q)).result !== null;
    assert.deepEqual([await visible(by.u), await visible(by.e), await visible(by.ph)], [true, true, true]);
    ok(await save(p, { find_by_email: false }));
    assert.deepEqual([await visible(by.u), await visible(by.e), await visible(by.ph)], [true, false, true]);
    ok(await save(p, { find_by_email: true, find_by_phone: false }));
    assert.deepEqual([await visible(by.u), await visible(by.e), await visible(by.ph)], [true, true, false]);
    ok(await save(p, { find_by_phone: true, discoverable: false }));
    assert.deepEqual([await visible(by.u), await visible(by.e), await visible(by.ph)], [false, false, false]);
    fails(await s.client.get(`/people/${by.u}`), 404);
    fails(await s.client.post('/connections', { username: by.u }), 404);
    assert.equal(ok(await p.client.get(`/people/${by.u}`)).profile.self, true, 'you can always see yourself');
    ok(await save(p, { discoverable: true }));
    assert.equal(await visible(by.u), true);
  });

  it('being hidden does not break existing connections', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    ok(await save(b, { discoverable: false }));
    assert.equal(ok(await a.client.get('/connections')).accepted.length, 1);
    assert.equal(ok(await a.client.get('/connections')).accepted[0].user.username, b.user.username);
  });

  it('profile cards: unknown, malformed and reserved names are 404', async () => {
    const s = await signup(srv);
    for (const name of ['nobodyhere', 'ab', 'UPPER_CASE_NOPE', 'admin', 'has%20space', '..', '%00', 'x'.repeat(40)]) {
      fails(await s.client.get(`/people/${name}`), 404);
    }
  });

  it('searches are rate limited per user', async () => {
    const s = await signup(srv);
    let last;
    for (let i = 0; i < 42; i++) last = await s.client.get('/people/lookup?q=nobody');
    assert.equal(last.status, 429);
    const other = await signup(srv);
    assert.equal((await other.client.get('/people/lookup?q=nobody')).status, 200, 'other users are not affected');
  });
});

describe('connection requests', () => {
  it('request → accept, with every visible side effect', async () => {
    const a = await signup(srv, { name: 'Alice Alpha' });
    const b = await signup(srv, { name: 'Bob Beta' });
    const r = ok(await a.client.post('/connections', { username: b.user.username, relation: 'partner' }), 201);
    assert.equal(r.status, 'request_sent');
    // sender view
    let ca = ok(await a.client.get('/connections'));
    assert.deepEqual([ca.accepted.length, ca.incoming.length, ca.outgoing.length], [0, 0, 1]);
    assert.equal(ca.outgoing[0].user.username, b.user.username);
    assert.equal((await find(a.client, b.user.username)).result.connection.status, 'request_sent');
    // receiver view
    const cb = ok(await b.client.get('/connections'));
    assert.deepEqual([cb.accepted.length, cb.incoming.length, cb.outgoing.length], [0, 1, 0]);
    assert.equal(cb.incoming[0].relation, 'partner');
    assert.equal((await find(b.client, a.user.username)).result.connection.status, 'request_received');
    const inbox = ok(await b.client.get('/inbox'));
    assert.equal(inbox.connection_requests.length, 1);
    assert.equal(inbox.connection_requests[0].user.username, a.user.username);
    assert.equal(ok(await a.client.get('/inbox')).connection_requests.length, 0, 'the sender has nothing waiting');
    // accept (and relabel)
    ok(await b.client.post(`/connections/${cb.incoming[0].id}/accept`, { relation: 'family' }));
    ca = ok(await a.client.get('/connections'));
    assert.deepEqual([ca.accepted.length, ca.incoming.length, ca.outgoing.length], [1, 0, 0]);
    assert.equal(ca.accepted[0].relation, 'family');
    assert.equal(ok(await b.client.get('/inbox')).connection_requests.length, 0);
    assert.equal((await find(a.client, b.user.username)).result.connection.status, 'connected');
    assert.equal((await find(b.client, a.user.username)).result.connection.status, 'connected');
  });

  it('only the addressee can accept or decline; strangers can do nothing', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const stranger = await signup(srv);
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    const id = ok(await b.client.get('/connections')).incoming[0].id;
    for (const who of [a, stranger]) {
      fails(await who.client.post(`/connections/${id}/accept`), 404);
      fails(await who.client.post(`/connections/${id}/decline`), 404);
      fails(await who.client.put(`/connections/${id}`, { relation: 'partner' }), 404);
    }
    fails(await stranger.client.del(`/connections/${id}`), 404);
    assert.equal(ok(await b.client.get('/connections')).incoming.length, 1, 'still pending');
    fails(await b.client.put(`/connections/${id}`, { relation: 'partner' }), 404); // not accepted yet
  });

  it('rejects impossible requests', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    fails(await a.client.post('/connections', { username: a.user.username }), 400);
    fails(await a.client.post('/connections', { username: 'nobodyxyz' }), 404);
    fails(await a.client.post('/connections', { username: 'a' }), 400);
    fails(await a.client.post('/connections', { username: '' }), 400);
    fails(await a.client.post('/connections', {}), 400);
    fails(await a.client.post('/connections', { username: b.user.username, relation: 'boss' }), 400);
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    fails(await a.client.post('/connections', { username: b.user.username }), 409, 'duplicate while pending');
  });

  it('relation defaults to friend and can be changed by either side once connected', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    const inc = ok(await b.client.get('/connections')).incoming[0];
    assert.equal(inc.relation, 'friend', 'default relation');
    ok(await b.client.post(`/connections/${inc.id}/accept`, {}));
    assert.equal(ok(await a.client.get('/connections')).accepted[0].relation, 'friend', 'accepting without a relation keeps the sender\'s');
    const cid = inc.id;
    for (const rel of ['partner', 'family', 'other', 'friend']) {
      assert.equal(ok(await b.client.put(`/connections/${cid}`, { relation: rel })).relation, rel);
      assert.equal(ok(await a.client.get('/connections')).accepted[0].relation, rel);
    }
    fails(await a.client.put(`/connections/${cid}`, { relation: 'enemy' }), 400);
    fails(await a.client.post('/connections', { username: b.user.username }), 409, 'already connected');
  });

  it('declining is quiet for the sender and cannot be bypassed by re-sending', async () => {
    const a = await signup(srv);
    const c = await signup(srv);
    ok(await a.client.post('/connections', { username: c.user.username }), 201);
    const id = ok(await c.client.get('/connections')).incoming[0].id;
    assert.equal((await c.client.post(`/connections/${id}/decline`)).status, 204);
    fails(await c.client.post(`/connections/${id}/accept`), 404); // no longer pending
    fails(await c.client.post(`/connections/${id}/decline`), 404);
    assert.equal(ok(await c.client.get('/connections')).incoming.length, 0);
    assert.equal(ok(await a.client.get('/connections')).outgoing.length, 1, 'sender still sees it as waiting');
    assert.equal((await find(a.client, c.user.username)).result.connection.status, 'request_sent');
    fails(await a.client.post('/connections', { username: c.user.username }), 409);
    // the decliner can still reach out later; that flips the direction and the original sender can then accept
    ok(await c.client.post('/connections', { username: a.user.username, relation: 'friend' }), 201);
    const flipped = ok(await a.client.get('/connections'));
    assert.equal(flipped.incoming.length, 1);
    assert.equal(flipped.outgoing.length, 0);
    ok(await a.client.post(`/connections/${flipped.incoming[0].id}/accept`, {}));
    assert.equal(ok(await c.client.get('/connections')).accepted.length, 1);
  });

  it('requests that cross are accepted automatically', async () => {
    const a = await signup(srv);
    const d = await signup(srv);
    ok(await a.client.post('/connections', { username: d.user.username }), 201);
    const r = ok(await d.client.post('/connections', { username: a.user.username, relation: 'partner' }));
    assert.equal(r.status, 'connected');
    for (const who of [a, d]) {
      const list = ok(await who.client.get('/connections'));
      assert.equal(list.accepted.length, 1);
      assert.equal(list.accepted[0].relation, 'partner');
      assert.equal(list.incoming.length + list.outgoing.length, 0);
    }
  });

  it('a request can be cancelled and sent again', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    const id = ok(await a.client.get('/connections')).outgoing[0].id;
    assert.equal((await a.client.del(`/connections/${id}`)).status, 204);
    assert.equal(ok(await b.client.get('/connections')).incoming.length, 0);
    fails(await a.client.del(`/connections/${id}`), 404);
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
  });

  it('either side can remove a connection, and then they can connect again', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    const id = ok(await b.client.get('/connections')).accepted[0].id;
    assert.equal((await b.client.del(`/connections/${id}`)).status, 204);
    for (const who of [a, b]) assert.deepEqual(Object.values(ok(await who.client.get('/connections'))).map((x) => x.length), [0, 0, 0]);
    await connect(b, a);
    assert.equal(ok(await a.client.get('/connections')).accepted.length, 1);
  });

  it('your list only contains your own relationships, sorted by name', async () => {
    const me = await signup(srv);
    const z = await signup(srv, { name: 'Zed' });
    const a = await signup(srv, { name: 'Abe' });
    const m = await signup(srv, { name: 'Mia' });
    const stranger = await signup(srv);
    for (const x of [z, a, m]) await connect(me, x);
    await connect(stranger, z);
    assert.deepEqual(ok(await me.client.get('/connections')).accepted.map((c) => c.user.name), ['Abe', 'Mia', 'Zed']);
    assert.equal(ok(await z.client.get('/connections')).accepted.length, 2);
  });

  it('nothing in any social response leaks an email address or phone number', async () => {
    const a = await signup(srv, { phone: '+49 170 8800001' });
    const b = await signup(srv, { phone: '+49 170 8800002' });
    await connect(a, b);
    for (const [who, other] of [[a, b], [b, a]]) {
      for (const path of ['/connections', '/inbox', '/workspaces', '/shared', `/people/${other.user.username}`, `/people/lookup?q=${other.user.username}`]) {
        const text = (await who.client.get(path)).text;
        assert.ok(!text.includes(other.user.email), `${path} leaked an email`);
        assert.ok(!text.includes('88000'), `${path} leaked a phone number`);
      }
    }
  });
});
