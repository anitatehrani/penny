import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, eventually, fails, ok, PW, shutdown, signup, startFakeSmtp, startServer, uid } from './helpers.js';

let preview; // no mail server: e-mails are written to a folder (allowed outside production, so the feature can be tried)
let smtp; // production with a real (fake) mail server: the live setup
let off; // production without a mail server: the feature is switched off
let fake;
const NEW_PW = 'Brand-New-Pass#2026';
const sha256 = (t) => createHash('sha256').update(t).digest('hex');

before(async () => {
  fake = await startFakeSmtp();
  [preview, smtp, off] = await Promise.all([
    startServer('resetprev', { NODE_ENV: 'development', TRUST_PROXY: '1' }),
    startServer('resetsmtp', { ...fake.env, NODE_ENV: 'production', TRUST_PROXY: '1', APP_URL: 'https://budget.example' }),
    startServer('resetoff', { NODE_ENV: 'production', TRUST_PROXY: '1' }),
  ]);
});
after(async () => {
  await fake.close();
  await shutdown(preview, smtp, off);
});

// every request comes from its own address unless a test says otherwise, so the per-address limits of other tests never get in the way
let ipCounter = 0;
const nextIp = () => `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
const asVisitor = (srv, ip = nextIp()) => ({ client: new Client(srv.base), headers: { 'x-forwarded-for': ip } });
const forgot = (srv, address, ip) => {
  const v = asVisitor(srv, ip);
  return v.client.post('/auth/password/forgot', { email: address }, v.headers);
};
const check = (srv, token) => {
  const v = asVisitor(srv);
  return v.client.post('/auth/password/check', { token }, v.headers);
};
const reset = (srv, token, new_password = NEW_PW, ip) => {
  const v = asVisitor(srv, ip);
  return v.client.post('/auth/password/reset', { token, new_password }, v.headers);
};
const login = (srv, identifier, password) => {
  const v = asVisitor(srv);
  return v.client.post('/auth/login', { identifier, password }, v.headers);
};

/** The mail files written in preview mode that went to this address, oldest first. */
const previewMail = (srv, to) => {
  if (!fs.existsSync(srv.mailDir)) return [];
  return fs
    .readdirSync(srv.mailDir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => fs.readFileSync(path.join(srv.mailDir, f), 'utf8'))
    .filter((t) => t.startsWith(`To: ${to}\n`));
};
const tokenIn = (text) => /reset-password\?token=([\w-]+)/.exec(text)?.[1];
const resetToken = async (srv, address) => {
  const mail = await eventually(() => previewMail(srv, address).at(-1), { what: `a reset e-mail to ${address}` });
  return tokenIn(mail);
};
const tokensFor = async (srv, userId) => (await srv.db.query(`SELECT * FROM email_tokens WHERE user_id = $1 AND purpose = 'reset'`, [userId])).rows;
const quiet = () => new Promise((r) => setTimeout(r, 400)); // long enough for a mail that was NOT going to be sent to show up anyway

describe('asking for a link', () => {
  it('mails the person a link, hands nothing back, and keeps only a hash of the token', async () => {
    const p = await signup(preview);
    const r = ok(await forgot(preview, p.body.email));
    assert.deepEqual(r, { ok: true }, 'the answer carries no link, token or hint, even in preview mode');
    const token = await resetToken(preview, p.body.email);
    assert.match(token, /^[\w-]{40,}$/);
    const rows = await tokensFor(preview, p.user.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, sha256(token), 'only the hash is stored');
    assert.notEqual(rows[0].token_hash, token);
    const minutes = (new Date(rows[0].expires_at).getTime() - Date.now()) / 60_000;
    assert.ok(minutes > 58 && minutes <= 60, `works for an hour, not ${minutes} minutes`);
    const log = (await preview.db.query(`SELECT kind, status FROM email_log WHERE user_id = $1`, [p.user.id])).rows;
    assert.deepEqual(log, [{ kind: 'reset', status: 'preview' }]);
    const events = (await preview.db.query(`SELECT kind FROM audit_events WHERE user_id = $1 AND kind LIKE 'password_reset%'`, [p.user.id])).rows;
    assert.deepEqual(events, [{ kind: 'password_reset_requested' }]);
  });

  it('answers exactly the same for an address nobody uses, and sends nothing', async () => {
    const p = await signup(preview);
    const stranger = `nobody-${uid()}@example.com`;
    const known = await forgot(preview, p.body.email);
    const unknown = await forgot(preview, stranger);
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.json, known.json);
    await quiet();
    assert.equal(previewMail(preview, stranger).length, 0, 'a stranger gets no mail');
    assert.equal((await preview.db.query(`SELECT 1 FROM email_tokens WHERE email = $1`, [stranger])).rowCount, 0);
    assert.equal((await preview.db.query(`SELECT 1 FROM audit_events WHERE detail ILIKE $1`, [`%${stranger}%`])).rowCount, 0, 'the address is not written to the activity log');
  });

  it('does not care about capital letters or spaces in the address', async () => {
    const p = await signup(preview);
    ok(await forgot(preview, `  ${p.body.email.toUpperCase()} `));
    assert.ok(await resetToken(preview, p.body.email));
  });

  it('refuses something that is not an e-mail address', async () => {
    fails(await forgot(preview, 'not-an-address'), 400);
    fails(await forgot(preview, ''), 400);
  });

  it('only the newest link works: asking again cancels the one before', async () => {
    const p = await signup(preview);
    ok(await forgot(preview, p.body.email));
    const first = await resetToken(preview, p.body.email);
    ok(await forgot(preview, p.body.email));
    const second = await eventually(() => (previewMail(preview, p.body.email).length === 2 ? tokenIn(previewMail(preview, p.body.email)[1]) : null), { what: 'the second e-mail' });
    assert.notEqual(first, second);
    assert.equal(ok(await check(preview, first)).valid, false);
    assert.equal(ok(await check(preview, second)).valid, true);
    assert.equal((await tokensFor(preview, p.user.id)).length, 1);
  });

  it('a suspended account gets the same answer and no mail', async () => {
    const p = await signup(preview);
    await preview.db.query('UPDATE users SET suspended_at = now() WHERE id = $1', [p.user.id]);
    const r = ok(await forgot(preview, p.body.email));
    assert.deepEqual(r, { ok: true });
    await quiet();
    assert.equal(previewMail(preview, p.body.email).length, 0);
    assert.equal((await tokensFor(preview, p.user.id)).length, 0);
  });

  it('is limited per address (3 an hour, however many places ask), and the limit is written to the activity log', async () => {
    const p = await signup(preview);
    for (let i = 0; i < 3; i++) ok(await forgot(preview, p.body.email));
    const r = fails(await forgot(preview, p.body.email), 429);
    assert.match(r.error, /Too many reset e-mails/);
    // an address nobody uses is limited in exactly the same way, so the limit tells a guesser nothing
    const stranger = `ghost-${uid()}@example.com`;
    for (let i = 0; i < 3; i++) ok(await forgot(preview, stranger));
    fails(await forgot(preview, stranger), 429);
    const logged = await preview.db.query(`SELECT 1 FROM audit_events WHERE kind = 'rate_limited' AND detail = 'too many reset e-mails for one address'`);
    assert.ok(logged.rowCount >= 1);
  });

  it('is limited per place (10 an hour), whichever addresses are tried', async () => {
    const ip = '10.99.0.1';
    for (let i = 0; i < 10; i++) ok(await forgot(preview, `spray-${uid()}@example.com`, ip));
    fails(await forgot(preview, `spray-${uid()}@example.com`, ip), 429);
    ok(await forgot(preview, `spray-${uid()}@example.com`, '10.99.0.2')); // somebody else is not affected
  });
});

describe('checking a link', () => {
  it('says whether it is good, and looking does not use it up', async () => {
    const p = await signup(preview);
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);
    for (let i = 0; i < 3; i++) assert.equal(ok(await check(preview, token)).valid, true);
    ok(await reset(preview, token), 200); // still works after being looked at
  });

  it('says no to a made-up or expired link, and to a confirmation link', async () => {
    const p = await signup(preview);
    assert.equal(ok(await check(preview, 'x'.repeat(43))).valid, false);
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);
    await preview.db.query(`UPDATE email_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [p.user.id]);
    assert.equal(ok(await check(preview, token)).valid, false, 'expired');
    // an e-mail confirmation link is a different thing and must never reset a password
    const sent = ok(await p.client.post('/auth/email/send-verification'));
    const verifyToken = new URL(sent.dev_link).searchParams.get('token');
    assert.equal(ok(await check(preview, verifyToken)).valid, false);
    fails(await reset(preview, verifyToken), 400);
    fails(await check(preview, 'short'), 400);
  });
});

describe('choosing a new password', () => {
  it('changes it, signs the person out everywhere, does not sign them in, and uses the link up', async () => {
    const p = await signup(preview);
    const other = new Client(preview.base); // a second device, signed in
    ok(await other.post('/auth/login', { identifier: p.body.email, password: PW }, { 'x-forwarded-for': nextIp() }));
    assert.equal((await other.get('/auth/me')).status, 200);
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);

    const visitor = asVisitor(preview);
    const r = await visitor.client.post('/auth/password/reset', { token, new_password: NEW_PW }, visitor.headers);
    assert.deepEqual(ok(r), { ok: true });
    assert.equal(visitor.client.lastSetCookie.length, 0, 'resetting does not sign anybody in');

    assert.equal((await other.get('/auth/me')).status, 401, 'the other device is signed out');
    assert.equal((await p.client.get('/auth/me')).status, 401, 'so is the one used to sign up');
    assert.equal((await preview.db.query('SELECT 1 FROM sessions WHERE user_id = $1', [p.user.id])).rowCount, 0);
    fails(await login(preview, p.body.email, PW), 401);
    ok(await login(preview, p.body.email, NEW_PW));
    assert.equal((await tokensFor(preview, p.user.id)).length, 0);
    fails(await reset(preview, token, 'Another-Pass#2027'), 400); // the link is spent
    fails(await login(preview, p.body.email, 'Another-Pass#2027'), 401);
  });

  it('counts as confirming the address, tells the person (in the app and by e-mail), and is written to the activity log', async () => {
    const p = await signup(preview);
    assert.equal(p.user.email_verified, false);
    ok(await forgot(preview, p.body.email));
    ok(await reset(preview, await resetToken(preview, p.body.email)));
    const row = (await preview.db.query('SELECT email_verified_at FROM users WHERE id = $1', [p.user.id])).rows[0];
    assert.ok(row.email_verified_at, 'getting the link proves the address is theirs');
    const note = (await preview.db.query(`SELECT kind, title FROM notifications WHERE user_id = $1 AND kind = 'security'`, [p.user.id])).rows;
    assert.deepEqual(note, [{ kind: 'security', title: 'Your password was reset' }]);
    const mails = previewMail(preview, p.body.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1], /^Subject: Your Penny password was changed$/m);
    assert.ok(!mails.join('\n').includes(NEW_PW), 'no e-mail ever contains a password');
    const events = (await preview.db.query(`SELECT kind FROM audit_events WHERE user_id = $1 AND kind LIKE 'password_reset%' ORDER BY id`, [p.user.id])).rows.map((e) => e.kind);
    assert.deepEqual(events, ['password_reset_requested', 'password_reset']);
  });

  it('refuses a weak password WITHOUT using the link up, and explains what is wrong', async () => {
    const p = await signup(preview);
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);
    const weak = await reset(preview, token, 'short');
    assert.equal(weak.status, 400);
    assert.ok(weak.json.problems.length > 0, 'it says what is missing');
    assert.equal(ok(await check(preview, token)).valid, true, 'the link still works');
    fails(await login(preview, p.body.email, 'short'), 401);
    ok(await login(preview, p.body.email, PW)); // the old password is untouched
    ok(await reset(preview, token));
  });

  it('judges the password against the person it is for (a password made from their own e-mail is refused)', async () => {
    const p = await signup(preview, { email: `maryanne.${uid()}@example.com` });
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);
    const local = p.body.email.split('@')[0];
    const r = await reset(preview, token, `${local}-Aa1!zzzz`);
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.json.problems), /email name/i, 'it names the reason');
    ok(await reset(preview, token));
  });

  it('refuses an expired or made-up link, and the password stays as it was', async () => {
    const p = await signup(preview);
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);
    await preview.db.query(`UPDATE email_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [p.user.id]);
    const r = fails(await reset(preview, token), 400);
    assert.match(r.error, /not valid or has expired/);
    fails(await reset(preview, 'y'.repeat(43)), 400);
    ok(await login(preview, p.body.email, PW));
  });

  it('two people using the same link at the same moment: exactly one of them wins', async () => {
    const p = await signup(preview);
    ok(await forgot(preview, p.body.email));
    const token = await resetToken(preview, p.body.email);
    const [a, b] = await Promise.all([reset(preview, token, 'First-Winner#2026'), reset(preview, token, 'Second-Winner#2026')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 400]);
    const winner = a.status === 200 ? 'First-Winner#2026' : 'Second-Winner#2026';
    const loser = a.status === 200 ? 'Second-Winner#2026' : 'First-Winner#2026';
    ok(await login(preview, p.body.email, winner));
    fails(await login(preview, p.body.email, loser), 401);
  });

  it('lets a person who only ever signed in with Google choose a password', async () => {
    const p = await signup(preview);
    await preview.db.query(`UPDATE users SET password_hash = NULL, google_id = $2 WHERE id = $1`, [p.user.id, `g-${uid()}`]);
    fails(await login(preview, p.body.email, PW), 401);
    ok(await forgot(preview, p.body.email));
    ok(await reset(preview, await resetToken(preview, p.body.email)));
    ok(await login(preview, p.body.email, NEW_PW));
  });

  it('is limited per place, so a link cannot be guessed at', async () => {
    const ip = '10.98.0.1';
    for (let i = 0; i < 20; i++) fails(await reset(preview, `z${i}`.padEnd(43, 'z'), NEW_PW, ip), 400);
    fails(await reset(preview, 'q'.repeat(43), NEW_PW, ip), 429);
  });
});

describe('on the live setup (production, with a real mail server)', () => {
  it('is switched on, sends a proper e-mail with the public address in the link, and is told to the page', async () => {
    const c = new Client(smtp.base);
    assert.equal(ok(await c.get('/auth/config')).passwordResetAvailable, true);
    const p = await signup(smtp);
    const r = ok(await forgot(smtp, p.body.email));
    assert.deepEqual(r, { ok: true });
    const mail = await eventually(() => fake.messages.find((m) => m.to?.includes(p.body.email) && /Reset your/.test(m.subject)), { what: 'the e-mail' });
    assert.equal(mail.subject, 'Reset your Penny password');
    const token = /https:\/\/budget\.example\/reset-password\?token=([\w-]+)/.exec(mail.text)?.[1];
    assert.ok(token, 'the link uses the public address');
    assert.match(mail.html, /Choose a new password/);
    assert.match(mail.text, /expires in 60 minutes/);
    ok(await reset(smtp, token));
    const done = await eventually(() => fake.messages.find((m) => m.to?.includes(p.body.email) && /was changed/.test(m.subject)), { what: 'the notice' });
    assert.match(done.text, /every device was signed out/);
  });

  it('a failing mail server does not change the answer, and the failure is written down', async () => {
    const broken = await startServer('resetbroken', { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true', NODE_ENV: 'production' });
    try {
      const p = await signup(broken);
      assert.deepEqual(ok(await new Client(broken.base).post('/auth/password/forgot', { email: p.body.email })), { ok: true });
      const row = await eventually(async () => (await broken.db.query(`SELECT status, error FROM email_log WHERE user_id = $1 AND kind = 'reset'`, [p.user.id])).rows[0], { what: 'the failure being logged' });
      assert.equal(row.status, 'failed');
      assert.ok(row.error);
    } finally {
      await broken.stop(); // it is expected to have logged failed deliveries
    }
  });
});

describe('without a mail server in production (the state of a fresh install)', () => {
  it('is switched off: the page is told, and every step says why instead of making a link nobody can receive', async () => {
    const c = new Client(off.base);
    assert.equal(ok(await c.get('/auth/config')).passwordResetAvailable, false);
    const p = await signup(off);
    const r = fails(await forgot(off, p.body.email), 503);
    assert.match(r.error, /not set up on this server/);
    fails(await check(off, 'x'.repeat(43)), 503);
    fails(await reset(off, 'x'.repeat(43)), 503);
    assert.equal((await off.db.query('SELECT 1 FROM email_tokens')).rowCount, 0, 'no link was made');
    assert.ok(!fs.existsSync(off.mailDir) || fs.readdirSync(off.mailDir).length === 0, 'nothing was written to the preview folder either');
  });

  it('is on for a developer trying it on their own computer', async () => {
    assert.equal(ok(await new Client(preview.base).get('/auth/config')).passwordResetAvailable, true);
  });
});
