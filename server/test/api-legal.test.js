import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { errorHandler, HttpError } from '../src/lib/http.js';
import { TERMS_VERSION } from '../src/lib/legal.js';
import { Client, connect, eventually, fails, ok, PNG, PW, shutdown, signup, startServer, tx, uid, upload } from './helpers.js';

let srv;
let googleSrv;
let accounts;
const fileUrl = (rel) => pathToFileURL(new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
const q = (sql, params) => srv.db.query(sql, params);

before(async () => {
  srv = await startServer('legal', { OPERATOR_NAME: 'Test Operator', CONTACT_EMAIL: 'privacy@example.test' });
  googleSrv = await startServer('legalg', { GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com' });
  process.env.DATABASE_URL = srv.dbUrl;
  accounts = await import(fileUrl('../src/lib/accounts.js'));
});
after(async () => {
  await (await import(fileUrl('../src/db.js'))).pool.end();
  await shutdown(srv, googleSrv);
});

const admin = async () => {
  const p = await signup(srv);
  await q('UPDATE users SET is_admin = true WHERE id = $1', [p.user.id]);
  return p;
};
const previewMail = (to) => {
  if (!fs.existsSync(srv.mailDir)) return [];
  return fs
    .readdirSync(srv.mailDir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => fs.readFileSync(path.join(srv.mailDir, f), 'utf8'))
    .filter((t) => t.startsWith(`To: ${to}\n`));
};
const remove = (client, body) => client.post('/auth/account/delete', body);
const count = async (table, where, params) => (await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;

describe('accepting the terms', () => {
  it('is needed to sign up: without it (or with anything but true) no account is made', async () => {
    const n = uid();
    const body = { name: 'No Terms', email: `nt${n}@example.com`, username: `nt${n}`, password: PW };
    for (const extra of [{}, { accept_terms: false }, { accept_terms: 'yes' }, { accept_terms: 1 }, { accept_terms: null }]) {
      const r = fails(await new Client(srv.base).post('/auth/signup', { ...body, ...extra }), 400);
      assert.match(r.error, /accept the terms and the privacy policy/);
    }
    assert.equal(await count('users', 'email = $1', [body.email]), 0);
  });

  it('is kept: when and which version, and the page is told the person has accepted', async () => {
    const p = await signup(srv);
    assert.equal(p.user.terms_accepted, true);
    const row = (await q('SELECT terms_accepted_at, terms_version FROM users WHERE id = $1', [p.user.id])).rows[0];
    assert.ok(row.terms_accepted_at);
    assert.equal(row.terms_version, TERMS_VERSION);
    assert.equal(ok(await p.client.get('/auth/me')).user.terms_accepted, true);
  });

  it('is asked once of a person who signed up before the terms existed, and then remembered', async () => {
    const p = await signup(srv);
    await q('UPDATE users SET terms_accepted_at = NULL, terms_version = NULL WHERE id = $1', [p.user.id]);
    assert.equal(ok(await p.client.get('/auth/me')).user.terms_accepted, false);
    const r = ok(await p.client.post('/auth/terms/accept'));
    assert.equal(r.user.terms_accepted, true);
    assert.equal((await q('SELECT terms_version FROM users WHERE id = $1', [p.user.id])).rows[0].terms_version, TERMS_VERSION);
    assert.equal((await q(`SELECT 1 FROM audit_events WHERE kind = 'terms_accepted' AND user_id = $1`, [p.user.id])).rowCount, 1);
    // an older version counts as not accepted
    await q(`UPDATE users SET terms_version = '2020-01-01' WHERE id = $1`, [p.user.id]);
    assert.equal(ok(await p.client.get('/auth/me')).user.terms_accepted, false);
    assert.equal((await new Client(srv.base).post('/auth/terms/accept')).status, 401, 'only for a signed-in person');
  });

  it('is needed to open an account through Google, and the page can tell why', async () => {
    const profile = () => ({ sub: `g-${uid()}`, email: `g${uid()}@example.com`, email_verified: true, name: 'Gina' });
    const db = { query: (...a) => srv.db.query(...a) };
    const p = profile();
    await assert.rejects(accounts.signInWithGoogleProfile(p, db), (e) => e.status === 400 && e.code === 'terms_required' && /accept the terms/.test(e.message));
    assert.equal(await count('users', 'google_id = $1', [p.sub]), 0, 'nothing was created');
    const made = await accounts.signInWithGoogleProfile(p, { ...db, acceptTerms: true });
    assert.equal(made.created, true);
    assert.equal(made.user.terms_version, TERMS_VERSION);
    // signing in to an account that exists needs no acceptance
    const again = await accounts.signInWithGoogleProfile(p, db);
    assert.equal(again.created, false);
  });

  it('is told to the page with the code, so it can ask and try again', () => {
    let sent;
    const res = { status: (s) => ({ json: (b) => (sent = { s, b }) }) };
    errorHandler(new HttpError(400, 'Please accept.', 'terms_required'), {}, res, () => {});
    assert.deepEqual(sent, { s: 400, b: { error: 'Please accept.', code: 'terms_required' } });
    errorHandler(new HttpError(404, 'Nope'), {}, res, () => {});
    assert.deepEqual(sent, { s: 404, b: { error: 'Nope' } }, 'no code when there is none');
  });

  it('says who runs the site, from the settings, in the config the pages read', async () => {
    assert.deepEqual(ok(await new Client(srv.base).get('/auth/config')).legal, { operatorName: 'Test Operator', contactEmail: 'privacy@example.test', termsVersion: TERMS_VERSION });
  });
});

describe('downloading your data', () => {
  it('is a file with what the person has, and nothing else: no password, no other person’s details, no files', async () => {
    const friend = await signup(srv, { name: 'Friend Fran' });
    const me = await signup(srv, { name: 'Me Myself', phone: '+49 170 5550101' });
    await connect(me, friend);
    // some budget data: a payment with a receipt, and a shared budget the friend is in
    const made = ok(await tx(me.client, { description: 'Rent for the flat', amount: 800 }), 201);
    ok(await upload(me.client, 'POST', `/transactions/${made.id}/receipts`, PNG, 'image/png', { 'x-filename': 'rent.png' }), 201);
    const group = ok(await me.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await me.client.post(`/workspaces/${group.id}/invites`, { username: friend.user.username }), 201);
    ok(await friend.client.post(`/workspace-invites/${ok(await friend.client.get('/inbox')).group_invites[0].id}/accept`));
    friend.client.ws = group.id;
    ok(await tx(friend.client, { description: 'Groceries for the flat', amount: 55 }), 201);

    const r = await me.client.get('/auth/account/export');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="penny-data-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const data = r.json;
    assert.equal(data.profile.email, me.body.email);
    assert.equal(data.profile.phone, '+491705550101');
    assert.equal(data.profile.has_password, true);
    const text = r.text;
    assert.ok(!/password_hash|token_hash|"google_id"/.test(text), 'no secrets');
    assert.ok(!text.includes(friend.body.email), 'the other member’s e-mail address is not in it');
    assert.ok(!text.includes(friend.body.password ?? 'zzz-none'));
    const personal = data.budgets.find((b) => b.kind === 'personal');
    assert.ok(personal.transactions.some((t) => t.description === 'Rent for the flat'));
    assert.equal(personal.receipts.length, 1);
    assert.equal(personal.receipts[0].filename, 'rent.png');
    assert.ok(!('data' in personal.receipts[0]), 'the receipt is listed, its bytes are not included');
    const shared = data.budgets.find((b) => b.kind === 'group');
    assert.deepEqual(shared.members.map((m) => m.username).sort(), [friend.user.username, me.user.username].sort());
    assert.ok(shared.members.every((m) => Object.keys(m).sort().join() === 'name,role,username'), 'other members: name and username only');
    assert.ok(shared.transactions.some((t) => t.description === 'Groceries for the flat'), 'what is in the shared budget, which the person can already see');
    assert.equal(data.connections.length, 1);
    assert.equal(data.connections[0].other_username, friend.user.username);
    assert.equal((await q(`SELECT 1 FROM audit_events WHERE kind = 'data_exported' AND user_id = $1`, [me.user.id])).rowCount, 1);
  });

  it('is only about the person asking: someone else’s budgets are not in it', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    ok(await tx(b.client, { description: 'Only for B, secret' }), 201);
    const r = await a.client.get('/auth/account/export');
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes('Only for B, secret'));
    assert.ok(!r.text.includes(b.body.email));
  });

  it('needs a signed-in person, is limited (6 an hour), and is not possible while an admin is only viewing the account', async () => {
    assert.equal((await new Client(srv.base).get('/auth/account/export')).status, 401);
    const p = await signup(srv);
    for (let i = 0; i < 6; i++) ok(await p.client.get('/auth/account/export'));
    fails(await p.client.get('/auth/account/export'), 429);

    const a = await admin();
    const person = await signup(srv);
    ok(await a.client.post(`/admin/users/${person.user.id}/view-as`, { reason: 'checking something for them', password: PW }));
    fails(await a.client.get('/auth/account/export'), 403);
  });
});

describe('deleting your own account', () => {
  it('needs DELETE to be typed and the password, and a wrong one deletes nothing', async () => {
    const p = await signup(srv);
    ok(await tx(p.client, { description: 'Still here' }), 201);
    fails(await remove(p.client, { password: PW }), 400);
    fails(await remove(p.client, { confirm: 'delete', password: PW }), 400);
    fails(await remove(p.client, { confirm: 'DELETE' }), 401);
    fails(await remove(p.client, { confirm: 'DELETE', password: 'Wrong-Password-1!' }), 401);
    assert.equal(await count('users', 'id = $1', [p.user.id]), 1);
    assert.equal(ok(await p.client.get('/transactions?status=')).length, 1, 'and still signed in');
    assert.equal((await new Client(srv.base).post('/auth/account/delete', { confirm: 'DELETE', password: PW })).status, 401, 'only for a signed-in person');
  });

  it('deletes everything the person has, signs them out, says goodbye by e-mail, and logs it without a name', async () => {
    const p = await signup(srv, { name: 'Goodbye Gus' });
    const other = await signup(srv, { name: 'Bystander Bo' });
    const mine = ok(await tx(p.client, { description: 'My payment' }), 201);
    ok(await upload(p.client, 'POST', `/transactions/${mine.id}/receipts`, PNG, 'image/png', { 'x-filename': 'r.png' }), 201);
    ok(await upload(p.client, 'PUT', '/profile/avatar', PNG, 'image/png'));
    ok(await tx(other.client, { description: 'Bo keeps this' }), 201);
    await q(`INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'system', 'hello')`, [p.user.id]);
    const phone = new Client(srv.base); // a second device, signed in
    ok(await phone.post('/auth/login', { identifier: p.body.email, password: PW }));

    const r = await remove(p.client, { confirm: 'DELETE', password: PW });
    assert.deepEqual(ok(r), { ok: true });
    assert.ok(p.client.lastSetCookie.some((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)), 'the cookie is cleared');
    assert.equal((await p.client.get('/auth/me')).status, 401);
    assert.equal((await phone.get('/auth/me')).status, 401, 'every device is signed out');
    assert.equal((await new Client(srv.base).post('/auth/login', { identifier: p.body.email, password: PW })).status, 401, 'cannot sign in again');

    for (const [table, where] of [
      ['users', 'id = $1'],
      ['sessions', 'user_id = $1'],
      ['workspaces', 'owner_id = $1'],
      ['workspace_members', 'user_id = $1'],
      ['user_avatars', 'user_id = $1'],
      ['notifications', 'user_id = $1'],
      ['email_log', 'user_id = $1'],
      ['transactions', 'user_id = $1'],
      ['receipts', 'uploaded_by = $1'],
    ]) assert.equal(await count(table, where, [p.user.id]), 0, table);
    assert.equal(await count('transactions', 'description = $1', ['My payment']), 0);
    assert.equal(ok(await other.client.get('/transactions?status=')).length, 1, 'somebody else’s data is untouched');

    const ev = (await q(`SELECT user_id, detail FROM audit_events WHERE kind = 'account_deleted' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(ev.user_id, null, 'the event does not point at the person any more');
    assert.ok(!(ev.detail ?? '').includes(p.body.email) && !(ev.detail ?? '').includes('Gus'));
    const mail = await eventually(() => previewMail(p.body.email).find((t) => /Your Penny account was deleted/.test(t)), { what: 'the goodbye e-mail' });
    assert.match(mail, /backups/i);
  });

  it('is refused for an admin (the site is never left without one), and nothing is deleted', async () => {
    const a = await admin();
    const r = fails(await remove(a.client, { confirm: 'DELETE', password: PW }), 409);
    assert.match(r.error, /admin/i);
    assert.equal(await count('users', 'id = $1', [a.user.id]), 1);
  });

  it('is refused while the person is in a budget with other people, and works after they leave', async () => {
    const owner = await signup(srv, { name: 'Owner Olive' });
    const member = await signup(srv, { name: 'Member Mo' });
    await connect(owner, member);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: member.user.username }), 201);
    ok(await member.client.post(`/workspace-invites/${ok(await member.client.get('/inbox')).group_invites[0].id}/accept`));
    const r = fails(await remove(member.client, { confirm: 'DELETE', password: PW }), 409);
    assert.match(r.error, /share 1 budget with other people/);
    fails(await remove(owner.client, { confirm: 'DELETE', password: PW }), 409);
    assert.equal(await count('users', 'id = ANY($1)', [[owner.user.id, member.user.id]]), 2);
    ok(await member.client.post(`/workspaces/${group.id}/leave`), 204);
    ok(await remove(member.client, { confirm: 'DELETE', password: PW }));
    assert.equal(await count('users', 'id = $1', [member.user.id]), 0);
    ok(await remove(owner.client, { confirm: 'DELETE', password: PW }), 200); // alone in the shared budget now: that is fine
    assert.equal(await count('workspaces', 'id = $1', [group.id]), 0);
  });

  it('is limited: after six tries in a quarter of an hour it stops answering', async () => {
    const p = await signup(srv);
    for (let i = 0; i < 6; i++) fails(await remove(p.client, { confirm: 'DELETE', password: 'Wrong-Password-1!' }), 401);
    fails(await remove(p.client, { confirm: 'DELETE', password: PW }), 429);
    assert.equal(await count('users', 'id = $1', [p.user.id]), 1, 'even the right password is refused for now, and nothing was deleted');
  });

  it('is not possible while an admin is viewing the account', async () => {
    const a = await admin();
    const person = await signup(srv);
    ok(await a.client.post(`/admin/users/${person.user.id}/view-as`, { reason: 'checking something for them', password: PW }));
    fails(await remove(a.client, { confirm: 'DELETE', password: PW }), 403);
    assert.equal(await count('users', 'id = ANY($1)', [[a.user.id, person.user.id]]), 2);
  });

  it('for an account that only uses Google, asks for a fresh Google sign-in instead of a password', async () => {
    const p = await signup(googleSrv);
    await googleSrv.db.query(`UPDATE users SET password_hash = NULL, google_id = $2 WHERE id = $1`, [p.user.id, `g-${uid()}`]);
    const none = await remove(p.client, { confirm: 'DELETE' });
    assert.equal(none.status, 401);
    assert.equal(none.json.code, 'google_required');
    const bad = await remove(p.client, { confirm: 'DELETE', credential: 'x'.repeat(40) });
    assert.equal(bad.status, 401, 'a credential Google does not vouch for');
    assert.equal((await googleSrv.db.query('SELECT 1 FROM users WHERE id = $1', [p.user.id])).rowCount, 1);
  });
});
