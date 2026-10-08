import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { Client, connect, fails, ok, shutdown, signup, startServer, today, tx, uid } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('security');
});
after(async () => {
  await shutdown(srv);
});

/** Everything user A owns, that an attacker must never be able to touch. */
async function victimData() {
  const a = await signup(srv, { name: 'Victim Vera' });
  const friend = await signup(srv);
  await connect(a, friend);
  const group = ok(await a.client.post('/workspaces', { name: 'Vera group' }), 201);
  const t = ok(await tx(a.client, { description: 'Victim payment', amount: 10, participants: [{ username: friend.user.username, share: 3 }] }), 201);
  const cat = ok(await a.client.post('/categories', { name: 'Victim cat', kind: 'expense', color: '#123456' }), 201);
  const rule = ok(await a.client.post('/recurring', { type: 'expense', description: 'Victim rule', amount: 5, frequency: 'monthly', start_date: today() }), 201);
  const plan = ok(await a.client.post('/installments', { description: 'Victim plan', total_amount: 30, installment_count: 3, first_due_date: today() }), 201);
  const invitee = await signup(srv);
  await connect(a, invitee);
  ok(await a.client.post(`/workspaces/${group.id}/invites`, { username: invitee.user.username }), 201);
  const invite = ok(await a.client.get(`/workspaces/${group.id}/invites`))[0];
  const conn = ok(await a.client.get('/connections')).accepted[0];
  const pendingTo = await signup(srv);
  ok(await a.client.post('/connections', { username: pendingTo.user.username }), 201);
  const pendingConn = ok(await a.client.get('/connections')).outgoing[0];
  return { a, friend, group, t, cat, rule, plan, invite, conn, pendingConn, invitee, pendingTo };
}

describe('other people\'s data (IDOR)', () => {
  it('an attacker cannot read, change or delete anything that belongs to someone else', async () => {
    const v = await victimData();
    const x = await signup(srv, { name: 'Mallory' });
    const calls = [
      ['PUT', `/transactions/${v.t.id}`, { type: 'expense', description: 'pwned', amount: 1, date: today() }],
      ['PATCH', `/transactions/${v.t.id}/status`, { status: 'pending' }],
      ['DELETE', `/transactions/${v.t.id}`],
      ['PUT', `/categories/${v.cat.id}`, { name: 'pwned', kind: 'expense', color: '#000000' }],
      ['DELETE', `/categories/${v.cat.id}`],
      ['PUT', `/recurring/${v.rule.id}`, { type: 'expense', description: 'pwned', amount: 1, frequency: 'monthly', start_date: today(), active: true }],
      ['DELETE', `/recurring/${v.rule.id}`],
      ['PUT', `/installments/${v.plan.id}`, { description: 'pwned' }],
      ['DELETE', `/installments/${v.plan.id}`],
      ['POST', `/connections/${v.pendingConn.id}/accept`, {}],
      ['POST', `/connections/${v.pendingConn.id}/decline`, {}],
      ['PUT', `/connections/${v.conn.id}`, { relation: 'other' }],
      ['DELETE', `/connections/${v.conn.id}`],
      ['DELETE', `/connections/${v.pendingConn.id}`],
      ['DELETE', `/workspace-invites/${v.invite.id}`],
      ['POST', `/workspace-invites/${v.invite.id}/accept`, {}],
      ['POST', `/workspace-invites/${v.invite.id}/decline`, {}],
      ['PUT', `/workspaces/${v.group.id}`, { name: 'pwned' }],
      ['DELETE', `/workspaces/${v.group.id}`],
      ['POST', `/workspaces/${v.group.id}/leave`, {}],
      ['POST', `/workspaces/${v.group.id}/transfer`, { username: x.user.username }],
      ['POST', `/workspaces/${v.group.id}/invites`, { username: x.user.username }],
      ['GET', `/workspaces/${v.group.id}/invites`],
      ['DELETE', `/workspaces/${v.group.id}/members/${v.a.user.username}`],
      ['POST', `/shared/${v.t.id}/import`, {}],
    ];
    for (const [m, p, body] of calls) {
      const r = await x.client.call(m, p, body);
      assert.ok([400, 403, 404].includes(r.status), `${m} ${p} → ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
    }
    // even when pointing at the victim's budget via the header
    for (const [m, p, body] of [['GET', '/transactions'], ['GET', '/summary'], ['GET', '/categories'], ['GET', '/settings'], ['POST', '/transactions', { type: 'expense', description: 'x', amount: 1, date: today() }]]) {
      const r = await x.client.call(m, p, body, { 'x-workspace': String(v.group.id) });
      assert.equal(r.status, 403, `${m} ${p} with the victim's workspace header`);
    }
    // nothing changed
    const t = ok(await v.a.client.get('/transactions?status=')).find((p) => p.id === v.t.id);
    assert.deepEqual([t.description, t.amount, t.status], ['Victim payment', 10, 'paid']);
    assert.equal(ok(await v.a.client.get('/categories')).find((c) => c.id === v.cat.id).name, 'Victim cat');
    assert.equal(ok(await v.a.client.get('/recurring')).find((r) => r.id === v.rule.id).description, 'Victim rule');
    assert.equal(ok(await v.a.client.get('/installments')).find((p) => p.id === v.plan.id).description, 'Victim plan');
    assert.equal(ok(await v.a.client.get('/connections')).accepted.length, 2);
    assert.equal(ok(await v.a.client.get(`/workspaces/${v.group.id}/invites`)).length, 1);
    assert.equal(ok(await v.invitee.client.get('/inbox')).group_invites.length, 1, 'the invitee still has their invitation');
    assert.equal(ok(await v.a.client.get('/workspaces')).find((w) => w.id === v.group.id).name, 'Vera group');
    assert.equal(ok(await x.client.get('/transactions?status=')).length, 0);
  });

  it('the attacker\'s own listings never contain the victim\'s rows', async () => {
    const v = await victimData();
    const x = await signup(srv);
    for (const path of ['/transactions?status=', '/categories', '/recurring', '/installments', '/connections', '/inbox', '/workspaces', '/shared', '/summary', '/forecast', '/transactions/export.csv?status=']) {
      const text = (await x.client.get(path)).text;
      assert.ok(!/Victim|Vera/.test(text), `${path} leaked something`);
    }
    assert.ok(v);
  });
});

describe('ids that are not ids', () => {
  const ids = ['abc', '0', '-1', '1.5', '2147483648', '99999999999999999999', '1e3', '%20', '%00', '0x10', 'NaN', 'null', '1;DROP', '１２'];
  const routes = [
    ['PUT', '/transactions/:id', { type: 'expense', description: 'x', amount: 1, date: '2025-01-01' }],
    ['PATCH', '/transactions/:id/status', { status: 'paid' }],
    ['DELETE', '/transactions/:id'],
    ['PUT', '/categories/:id', { name: 'x', kind: 'expense', color: '#000000' }],
    ['DELETE', '/categories/:id'],
    ['PUT', '/recurring/:id', { type: 'expense', description: 'x', amount: 1, frequency: 'monthly', start_date: '2025-01-01' }],
    ['DELETE', '/recurring/:id'],
    ['PUT', '/installments/:id', { description: 'x' }],
    ['DELETE', '/installments/:id'],
    ['POST', '/connections/:id/accept', {}],
    ['POST', '/connections/:id/decline', {}],
    ['PUT', '/connections/:id', { relation: 'friend' }],
    ['DELETE', '/connections/:id'],
    ['DELETE', '/workspace-invites/:id'],
    ['POST', '/workspace-invites/:id/accept', {}],
    ['POST', '/workspace-invites/:id/decline', {}],
    ['PUT', '/workspaces/:id', { name: 'x' }],
    ['DELETE', '/workspaces/:id'],
    ['GET', '/workspaces/:id/invites'],
    ['POST', '/workspaces/:id/invites', { username: 'someone' }],
    ['POST', '/workspaces/:id/leave', {}],
    ['POST', '/workspaces/:id/transfer', { username: 'someone' }],
    ['DELETE', '/workspaces/:id/members/someone'],
    ['POST', '/shared/:id/import', {}],
  ];

  it('always answer 400 or 404 — never 200 and never a server error', async () => {
    const { client } = await signup(srv);
    for (const [m, p, body] of routes) {
      for (const id of ids) {
        const r = await client.call(m, p.replace(':id', id), body);
        assert.ok(r.status === 400 || r.status === 404, `${m} ${p} with id ${JSON.stringify(id)} → ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
      }
    }
  });
});

describe('mass assignment', () => {
  it('ignores ownership and bookkeeping fields sent by the client', async () => {
    const a = await signup(srv);
    const victim = await signup(srv);
    const victimWs = ok(await victim.client.get('/workspaces'))[0].id;
    const evil = { user_id: victim.user.id, workspace_id: victimWs, member_id: victim.user.id, id: 987654, source: 'recurring', recurring_id: 1, installment_plan_id: 1, created_at: '2000-01-01', owner_id: victim.user.id, is_admin: true, role: 'owner' };
    const t = ok(await tx(a.client, evil), 201);
    assert.notEqual(t.id, 987654);
    assert.equal(t.source, 'manual');
    assert.equal(t.member_id, a.user.id);
    assert.equal(ok(await a.client.get('/transactions?status=')).length, 1);
    assert.equal(ok(await victim.client.get('/transactions?status=')).length, 0, 'nothing landed in the victim\'s budget');
    ok(await a.client.put(`/transactions/${t.id}`, { type: 'expense', description: 'edit', amount: 1, date: today(), ...evil }));
    assert.equal(ok(await victim.client.get('/transactions?status=')).length, 0);
    const cat = ok(await a.client.post('/categories', { name: 'Mine', kind: 'expense', color: '#123456', ...evil }), 201);
    assert.ok(!ok(await victim.client.get('/categories')).some((c) => c.id === cat.id));
    const rule = ok(await a.client.post('/recurring', { type: 'expense', description: 'r', amount: 1, frequency: 'monthly', start_date: today(), ...evil }), 201);
    assert.ok(!ok(await victim.client.get('/recurring')).some((r) => r.id === rule.id));
    ok(await a.client.put('/settings', { opening_balance: 5, currency: 'USD', ...evil }));
    assert.equal(ok(await victim.client.get('/settings')).opening_balance, 0);
    const me = ok(await a.client.put('/profile', { name: 'A', username: a.user.username, phone: null, discoverable: true, find_by_email: true, find_by_phone: true, ...evil })).user;
    assert.equal(me.id, a.user.id);
    assert.equal(me.email, a.user.email);
    const g = ok(await a.client.post('/workspaces', { name: 'G', ...evil }), 201);
    assert.equal(g.members[0].username, a.user.username);
  });
});

describe('hostile text is stored and returned literally', () => {
  const payloads = [
    "Robert'); DROP TABLE transactions;--",
    "' OR '1'='1",
    '"; DELETE FROM users; --',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '{{7*7}} ${7*7} #{7*7}',
    '\\u0000 \u0000 null byte',
    '𝕳𝖊𝖑𝖑𝖔 🎉 日本語 ✓',
    '   spaced   out   ',
    '%s %d %n',
  ];

  it('payment descriptions, notes, categories and names survive unchanged', async () => {
    const { client } = await signup(srv);
    for (const p of payloads) {
      const description = p.replace('\u0000', '');
      const r = await tx(client, { description, note: description });
      if (r.status === 201) assert.equal(r.json.description, description.trim(), `payload ${JSON.stringify(p)}`);
      else assert.ok(r.status === 400, `payload ${JSON.stringify(p)} → ${r.status}`);
    }
    const all = ok(await client.get('/transactions?status=&limit=500'));
    assert.ok(all.length >= 8, 'most payloads were accepted');
    assert.ok(all.some((t) => t.description === payloads[0]), 'SQL text stored as plain text');
    const found = ok(await client.get(`/transactions?q=${encodeURIComponent("' OR '1'='1")}`));
    assert.ok(found.length >= 1 && found.every((t) => t.description.includes("' OR '1'='1")), 'searching with quotes is safe');
    ok(await client.get('/transactions?status=')); // tables still exist
  });

  it('responses are JSON, never HTML', async () => {
    const { client } = await signup(srv);
    ok(await tx(client, { description: '<script>alert(1)</script>' }), 201);
    const r = await client.get('/transactions?status=');
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.ok(r.text.includes('<script>'), 'returned as data');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  it('names and usernames with markup are accepted as names but never as usernames', async () => {
    const n = uid();
    const c = new Client(srv.base.replace(/\/api$/, ''));
    ok(await c.post('/auth/signup', { accept_terms: true, name: '<b>Bold</b> "Q"', email: `${n}@example.com`, username: `x${n}`, password: 'Tr1cky-Horse!Battery' }), 201);
    const bad = new Client(srv.base.replace(/\/api$/, ''));
    fails(await bad.post('/auth/signup', { accept_terms: true, name: 'x', email: `y${n}@example.com`, username: '<script>', password: 'Tr1cky-Horse!Battery' }), 400);
    fails(await bad.post('/auth/signup', { accept_terms: true, name: 'x', email: `z${n}@example.com`, username: "bob'--", password: 'Tr1cky-Horse!Battery' }), 400);
  });
});

describe('the web app and static files', () => {
  const raw = (path) =>
    new Promise((resolve, reject) => {
      const u = new URL(srv.base);
      http.get({ host: u.hostname, port: u.port, path }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
      }).on('error', reject);
    });

  it('serves the app and falls back to it for client-side routes', async () => {
    for (const p of ['/', '/payments', '/people', '/u/someone', '/login', '/anything/else']) {
      const r = await raw(p);
      assert.equal(r.status, 200, p);
      assert.match(r.text, /<div id="root">/, p);
    }
    assert.match((await raw('/')).headers['content-type'], /text\/html/);
  });

  it('API paths never fall back to the app: signed-out is a JSON 401, signed-in a JSON 404', async () => {
    const r = await raw('/api/does-not-exist');
    assert.equal(r.status, 401);
    assert.match(r.headers['content-type'], /application\/json/);
    const { client } = await signup(srv);
    const known = await client.get('/does-not-exist');
    assert.equal(known.status, 404);
    assert.equal(known.json.error, 'Not found');
  });

  it('cannot be tricked into serving server files', async () => {
    for (const p of ['/../.env', '/%2e%2e/.env', '/..%2f..%2fserver%2f.env', '/assets/../../server/.env', '/%2e%2e%2f%2e%2e%2fserver%2fsrc%2findex.js', '/.env', '/server/.env', '/..\\..\\server\\.env', '/%00', '/assets/%2e%2e/%2e%2e/package.json']) {
      const r = await raw(p);
      assert.ok(!/DATABASE_URL|GOOGLE_CLIENT_ID|createUser|express/.test(r.text), `${p} exposed a file`);
      assert.ok(r.status < 500, `${p} → ${r.status}`);
    }
  });

  it('every response carries the safety headers', async () => {
    for (const p of ['/', '/api/health', '/api/auth/config']) {
      const r = await raw(p);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
      assert.equal(r.headers['x-frame-options'], 'DENY', p);
      assert.ok(r.headers['referrer-policy'], p);
      assert.equal(r.headers['x-powered-by'], undefined, p);
    }
  });
});

describe('sessions cannot be fixed or shared', () => {
  it('every login issues a fresh token and the old one stays dead after logout', async () => {
    const { body } = await signup(srv);
    const root = srv.base.replace(/\/api$/, '');
    const c = new Client(root);
    ok(await c.post('/auth/login', { email: body.email, password: body.password }));
    const first = c.jar.sid;
    ok(await c.post('/auth/login', { email: body.email, password: body.password }));
    assert.notEqual(c.jar.sid, first);
    await c.post('/auth/logout');
    const replay = new Client(root);
    replay.jar.sid = first;
    assert.equal((await replay.get('/auth/me')).status, 200, 'the earlier login is a separate session and is still valid');
    await replay.post('/auth/logout');
    assert.equal((await replay.get('/auth/me')).status, 401);
  });

  it('a client-supplied session id is never adopted', async () => {
    const root = srv.base.replace(/\/api$/, '');
    const c = new Client(root);
    c.jar.sid = 'attacker-chosen-token';
    const n = uid();
    ok(await c.post('/auth/signup', { accept_terms: true, name: 'F', email: `${n}@example.com`, username: `f${n}`, password: 'Tr1cky-Horse!Battery' }), 201);
    assert.notEqual(c.jar.sid, 'attacker-chosen-token');
    const attacker = new Client(root);
    attacker.jar.sid = 'attacker-chosen-token';
    assert.equal((await attacker.get('/auth/me')).status, 401);
  });
});

describe('races', () => {
  const race = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  const root = () => srv.base.replace(/\/api$/, '');

  it('8 simultaneous sign-ups with one email create exactly one account', async () => {
    const n = uid();
    const rs = await race(8, (i) => new Client(root()).post('/auth/signup', { accept_terms: true, name: 'R', email: `race${n}@example.com`, username: `race${n}${i}`, password: 'Tr1cky-Horse!Battery' }));
    assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join());
    assert.ok(rs.every((r) => [201, 409].includes(r.status)));
    assert.equal((await srv.db.query('SELECT count(*)::int n FROM users WHERE email = $1', [`race${n}@example.com`])).rows[0].n, 1);
  });

  it('8 simultaneous sign-ups for one username (and one phone) create exactly one account each', async () => {
    const n = uid();
    const rs = await race(8, (i) => new Client(root()).post('/auth/signup', { accept_terms: true, name: 'R', email: `u${i}${n}@example.com`, username: `same${n}`, password: 'Tr1cky-Horse!Battery' }));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.ok(rs.every((r) => [201, 409].includes(r.status)));
    const ps = await race(6, (i) => new Client(root()).post('/auth/signup', { accept_terms: true, name: 'P', email: `p${i}${n}@example.com`, username: `ph${i}${n}`, phone: '+49 170 9990000', password: 'Tr1cky-Horse!Battery' }));
    assert.equal(ps.filter((r) => r.status === 201).length, 1);
    assert.ok(ps.every((r) => [201, 409].includes(r.status)));
  });

  it('importing a shared payment from several tabs at once adds it exactly once', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    const t = ok(await tx(a.client, { amount: 100, participants: [{ username: b.user.username, share: 30 }] }), 201);
    const rs = await race(8, () => b.client.post(`/shared/${t.id}/import`, {}));
    assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join());
    assert.ok(rs.every((r) => [201, 409].includes(r.status)));
    assert.equal(ok(await b.client.get('/transactions?status=')).length, 1);
  });

  it('answering one invitation or request from several places only counts once', async () => {
    const o = await signup(srv);
    const f = await signup(srv);
    await connect(o, f);
    const g = ok(await o.client.post('/workspaces', { name: 'G' }), 201);
    const inv = await race(5, () => o.client.post(`/workspaces/${g.id}/invites`, { username: f.user.username }));
    assert.equal(inv.filter((r) => r.status === 201).length, 1, inv.map((r) => r.status).join());
    assert.ok(inv.every((r) => [201, 409].includes(r.status)));
    const id = ok(await f.client.get('/inbox')).group_invites[0].id;
    const acc = await race(6, () => f.client.post(`/workspace-invites/${id}/accept`));
    assert.equal(acc.filter((r) => r.status === 200).length, 1, acc.map((r) => r.status).join());
    assert.ok(acc.every((r) => [200, 404].includes(r.status)));
    assert.equal(ok(await f.client.get('/workspaces')).find((w) => w.id === g.id).members.length, 2);

    const x = await signup(srv);
    const y = await signup(srv);
    ok(await x.client.post('/connections', { username: y.user.username }), 201);
    const cid = ok(await y.client.get('/connections')).incoming[0].id;
    const ca = await race(6, () => y.client.post(`/connections/${cid}/accept`, {}));
    assert.equal(ca.filter((r) => r.status === 200).length, 1);
    assert.ok(ca.every((r) => [200, 404].includes(r.status)));
  });

  it('two people requesting each other at the same moment end up connected exactly once', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const rs = await Promise.all([a.client.post('/connections', { username: b.user.username }), b.client.post('/connections', { username: a.user.username })]);
    assert.ok(rs.every((r) => [200, 201, 409].includes(r.status)), rs.map((r) => r.status).join());
    const rows = (await srv.db.query('SELECT status FROM connections WHERE requester_id IN ($1,$2) AND addressee_id IN ($1,$2)', [a.user.id, b.user.id])).rows;
    assert.equal(rows.length, 1, 'one row per pair');
    // whatever state it ended in, a follow-up request resolves it cleanly
    const again = await a.client.post('/connections', { username: b.user.username });
    assert.ok([200, 201, 409].includes(again.status));
  });

  it('many payments added at once all arrive; many edits of one recurring item never crash', async () => {
    const { client } = await signup(srv);
    const rs = await race(30, (i) => tx(client, { description: `Parallel ${i}`, amount: 1 + i }));
    assert.ok(rs.every((r) => r.status === 201));
    assert.equal(ok(await client.get('/transactions?status=')).length, 30);
    const rule = ok(await client.post('/recurring', { type: 'expense', description: 'Race', amount: 5, frequency: 'monthly', start_date: today() }), 201);
    const edits = await race(8, (i) => client.put(`/recurring/${rule.id}`, { type: 'expense', description: 'Race', amount: 10 + i, frequency: 'monthly', start_date: today(), active: true }));
    assert.ok(edits.every((r) => r.status === 200), `statuses ${edits.map((r) => r.status).join()}`);
    const dates = ok(await client.get('/transactions?status=pending&limit=500')).filter((t) => t.recurring_id === rule.id).map((t) => t.date);
    assert.equal(new Set(dates).size, dates.length, 'no duplicate occurrences after concurrent edits');
  });
});

describe('load', () => {
  it('stays fast with a few hundred payments', async () => {
    const { client } = await signup(srv);
    await Promise.all(Array.from({ length: 300 }, (_, i) => tx(client, { description: `Bulk ${i}`, amount: 1 + (i % 50), date: `2025-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}` })));
    const started = Date.now();
    const list = ok(await client.get('/transactions?status=&limit=1000'));
    const sum = ok(await client.get('/summary?month=2025-03'));
    const fc = ok(await client.get('/forecast'));
    const csv = await client.get('/transactions/export.csv?status=');
    const took = Date.now() - started;
    assert.equal(list.length, 300);
    assert.ok(sum && fc && csv.text.split('\n').length === 301);
    assert.ok(took < 3000, `listing, summary, forecast and CSV took ${took}ms`);
  });
});
