import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { Client, connect, daysFromToday, eventually, fails, headerOf, ok, shutdown, signup, startFakeSmtp, startServer, today, tx, verifyEmail } from './helpers.js';

let preview; // no mail server: e-mails are written to a folder
let smtp; // a (fake) mail server that records what it receives
let fake;
let broken; // points at a mail server that is not there
let scheduled; // runs the alert scan on a short timer
let fakeScheduled;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

before(async () => {
  fake = await startFakeSmtp();
  fakeScheduled = await startFakeSmtp();
  [preview, smtp, broken, scheduled] = await Promise.all([
    startServer('mailprev'),
    startServer('mailsmtp', { ...fake.env, APP_URL: 'https://budget.example' }),
    startServer('mailbroken', { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true' }),
    startServer('mailtimer', { ...fakeScheduled.env, ALERT_SCAN_MINUTES: '0.03' }),
  ]);
});
after(async () => {
  await Promise.allSettled([fake.close(), fakeScheduled.close()]);
  // the "broken" server is expected to log failed deliveries, so it is stopped without the no-errors check
  await broken.stop();
  await shutdown(preview, smtp, scheduled);
});

const prefs = async (p, body) => ok(await p.client.put('/notifications/settings', body));
async function verifiedPerson(srv, over = {}) {
  const p = await signup(srv, over);
  await verifyEmail(srv, p.user.id);
  await prefs(p, { timezone: LOCAL_TZ, balance_warning: false, forecast_warning: false, ai_insights: false });
  return p;
}
const inbox = (to) => fake.messages.filter((m) => m.to?.includes(to));
const nowHourUtc = () => new Date().getUTCHours();
const unsubTokenFrom = (message) => /unsubscribe\?token=([^"\s<&]+)/.exec(message.html + message.text)?.[1];

describe('confirming an e-mail address', () => {
  it('sends a link, which confirms the address once and then stops working', async () => {
    const p = await signup(preview);
    assert.equal(p.user.email_verified, false);
    const sent = ok(await p.client.post('/auth/email/send-verification'));
    assert.deepEqual([sent.sent, sent.mode], [true, 'preview']);
    assert.match(sent.dev_link, /\/verify-email\?token=[\w-]{40,}/);
    const token = new URL(sent.dev_link).searchParams.get('token');
    // it was written to the preview folder, to the right person
    const files = fs.readdirSync(preview.mailDir).filter((f) => f.endsWith('.txt'));
    const mail = files.map((f) => fs.readFileSync(`${preview.mailDir}/${f}`, 'utf8')).find((t) => t.includes(p.user.email));
    assert.ok(mail && mail.includes(token), 'the preview e-mail contains the link');
    // only a hash of the token is stored
    assert.equal((await preview.db.query('SELECT 1 FROM email_tokens WHERE token_hash = $1', [token])).rowCount, 0);
    assert.equal((await preview.db.query('SELECT count(*)::int n FROM email_tokens WHERE user_id = $1', [p.user.id])).rows[0].n, 1);
    // confirming needs no login (the link is opened from a mail app)
    const anon = new Client(preview.base.replace(/\/api$/, ''));
    ok(await anon.post('/auth/email/verify', { token }));
    assert.equal((await p.client.get('/auth/me')).json.user.email_verified, true);
    assert.equal(ok(await p.client.get('/notifications/settings')).email_verified, true);
    fails(await anon.post('/auth/email/verify', { token }), 400);
    assert.deepEqual((await p.client.get('/notifications?kind=system')).json.items.map((n) => n.title), ['E-mail address confirmed']);
    assert.deepEqual(ok(await p.client.post('/auth/email/send-verification')), { verified: true }, 'nothing more to send');
  });

  it('refuses unknown, malformed, expired and superseded links', async () => {
    const p = await signup(preview);
    const anon = new Client(preview.base.replace(/\/api$/, ''));
    for (const token of ['x'.repeat(40), 'short', '', 'a'.repeat(300), undefined, 12345678901234567890]) {
      assert.equal((await anon.post('/auth/email/verify', { token })).status, 400, String(token).slice(0, 20));
    }
    const first = new URL(ok(await p.client.post('/auth/email/send-verification')).dev_link).searchParams.get('token');
    const second = new URL(ok(await p.client.post('/auth/email/send-verification')).dev_link).searchParams.get('token');
    fails(await anon.post('/auth/email/verify', { token: first }), 400);
    await preview.db.query(`UPDATE email_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [p.user.id]);
    fails(await anon.post('/auth/email/verify', { token: second }), 400);
    assert.equal((await p.client.get('/auth/me')).json.user.email_verified, false);
  });

  it('is rate limited, and needs a login to request', async () => {
    const p = await signup(preview);
    let last;
    for (let i = 0; i < 8; i++) last = await p.client.post('/auth/email/send-verification');
    assert.equal(last.status, 429);
    assert.equal((await new Client(preview.base.replace(/\/api$/, '')).post('/auth/email/send-verification')).status, 401);
  });

  it('a link only ever confirms the address it was sent to', async () => {
    const a = await signup(preview);
    const b = await signup(preview);
    const token = new URL(ok(await a.client.post('/auth/email/send-verification')).dev_link).searchParams.get('token');
    ok(await new Client(preview.base.replace(/\/api$/, '')).post('/auth/email/verify', { token }));
    assert.equal((await a.client.get('/auth/me')).json.user.email_verified, true);
    assert.equal((await b.client.get('/auth/me')).json.user.email_verified, false);
  });

  it('with a real mail server the link is only e-mailed, never returned by the API', async () => {
    const p = await signup(smtp);
    const r = ok(await p.client.post('/auth/email/send-verification'));
    assert.deepEqual(r, { sent: true, mode: 'smtp' });
    const m = await eventually(() => inbox(p.user.email)[0], { what: 'verification e-mail' });
    assert.equal(m.subject, 'Confirm your e-mail address');
    const token = /verify-email\?token=([\w-]+)/.exec(m.text)[1];
    assert.match(m.text, /https:\/\/budget\.example\/verify-email\?token=/);
    ok(await new Client(smtp.base.replace(/\/api$/, '')).post('/auth/email/verify', { token }));
  });

  it('reports a failure when the mail server cannot be reached', async () => {
    const p = await signup(broken);
    const r = await p.client.post('/auth/email/send-verification');
    assert.equal(r.status, 502);
    assert.match(r.json.error, /could not be sent/);
    assert.ok(!JSON.stringify(r.json).includes('ECONNREFUSED'), 'no internal details leak to the user');
    assert.equal((await broken.db.query(`SELECT status FROM email_log WHERE user_id = $1`, [p.user.id])).rows[0].status, 'failed');
  });
});

describe('the test e-mail', () => {
  it('needs a confirmed address, then works, is logged, and is rate limited', async () => {
    const p = await signup(preview);
    fails(await p.client.post('/notifications/test-email'), 400);
    await verifyEmail(preview, p.user.id);
    const r = ok(await p.client.post('/notifications/test-email'));
    assert.equal(r.status, 'preview');
    assert.match(r.preview_file, /\.html$/);
    assert.ok(!r.preview_file.includes('/') && !r.preview_file.includes('\\'), 'only the file name is shown');
    const log = ok(await p.client.get('/notifications/emails'));
    assert.deepEqual([log[0].kind, log[0].status, log[0].subject], ['test', 'preview', 'Test alert from Penny']);
    let last;
    for (let i = 0; i < 7; i++) last = await p.client.post('/notifications/test-email');
    assert.equal(last.status, 429);
  });

  it('is really delivered, with an unsubscribe link and a plain-text version', async () => {
    const p = await verifiedPerson(smtp);
    ok(await p.client.post('/notifications/test-email'));
    const m = await eventually(() => inbox(p.user.email).find((x) => x.subject === 'Test alert from Penny'), { what: 'test e-mail' });
    assert.match(m.html, /It works/);
    assert.match(m.text, /alert settings|Alert settings|alerts are set up/i);
    assert.ok(unsubTokenFrom(m), 'has an unsubscribe link');
    assert.match(m.text, /https:\/\/budget\.example\/notifications\?tab=settings/);
  });

  it('reports a delivery failure without leaking details', async () => {
    const p = await signup(broken);
    await verifyEmail(broken, p.user.id);
    const r = await p.client.post('/notifications/test-email');
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.json).includes('ECONNREFUSED'));
    assert.equal(ok(await p.client.get('/notifications/emails'))[0].status, 'failed');
  });
});

describe('instant e-mail alerts', () => {
  it('sends an alert e-mail soon after an event, once, to the right person', async () => {
    const a = await verifiedPerson(smtp, { name: 'Asker <Admin>' });
    const b = await verifiedPerson(smtp);
    await prefs(b, { email_enabled: true, email_frequency: 'instant', email_social: true });
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    const m = await eventually(() => inbox(b.user.email)[0], { what: 'instant e-mail' });
    assert.match(m.subject, /wants to connect with you/);
    assert.match(m.html, /Asker &lt;Admin&gt;/, 'names are HTML-escaped');
    assert.ok(!m.html.includes('<Admin>'));
    assert.equal(headerOf(m, 'List-Unsubscribe-Post'), 'List-Unsubscribe=One-Click');
    assert.match(headerOf(m, 'List-Unsubscribe'), /^<https:\/\/budget\.example\/api\/unsubscribe\?token=/);
    assert.match(m.html, /https:\/\/budget\.example\/notifications/);
    // marked as sent, so a later scan does not repeat it
    await b.client.post('/notifications/refresh');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(inbox(b.user.email).length, 1);
    assert.equal(inbox(a.user.email).length, 0, 'the asker gets nothing');
    const n = ok(await b.client.get('/notifications')).items[0];
    assert.ok((await smtp.db.query('SELECT emailed_at FROM notifications WHERE id = $1', [n.id])).rows[0].emailed_at);
  });

  it('groups alerts that arrive together into one message', async () => {
    const p = await verifiedPerson(smtp);
    await prefs(p, { email_enabled: true, email_frequency: 'instant' });
    for (const d of [0, 1, 2]) ok(await tx(p.client, { description: `Bill ${d}`, amount: 10 + d, date: daysFromToday(d), status: 'pending' }), 201);
    ok(await tx(p.client, { description: 'Old bill', amount: 99, date: daysFromToday(-2), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    const m = await eventually(() => inbox(p.user.email)[0], { what: 'digest of alerts' });
    assert.equal(inbox(p.user.email).length, 1);
    assert.equal(m.subject, '1 overdue and 3 upcoming payments');
    for (const text of ['Bill 0', 'Bill 1', 'Bill 2', 'Old bill']) assert.ok(m.text.includes(text), text);
    assert.match(m.text, /Old bill — \$99\.00, 2 days overdue/);
    assert.match(m.text, /Bill 0 — \$10\.00, due today/);
    assert.match(m.text, /Bill 1 — \$11\.00, due tomorrow/);
    assert.match(m.text, /Bill 2 — \$12\.00, due in 2 days/);
    assert.ok(m.text.indexOf('OVERDUE') < m.text.indexOf('COMING UP'), 'overdue comes first');
  });

  it('escapes payment descriptions so markup cannot reach the e-mail', async () => {
    const p = await verifiedPerson(smtp);
    await prefs(p, { email_enabled: true, email_frequency: 'instant' });
    ok(await tx(p.client, { description: '<script>alert(1)</script> & "quotes" <img src=x onerror=alert(2)>', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    const m = await eventually(() => inbox(p.user.email)[0], { what: 'e-mail' });
    assert.ok(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
    assert.ok(!/<script|<img/i.test(m.html.replace(/<!doctype[\s\S]*?<body/i, '')), 'no live tags from user input');
    assert.ok(m.text.includes('<script>alert(1)</script>'), 'the plain-text version shows the original text');
  });

  it('respects the per-kind e-mail switches', async () => {
    const p = await verifiedPerson(smtp);
    await prefs(p, { email_enabled: true, email_frequency: 'instant', email_due: false, email_overdue: true });
    ok(await tx(p.client, { description: 'Soon', amount: 5, date: daysFromToday(1), status: 'pending' }), 201);
    ok(await tx(p.client, { description: 'Late', amount: 5, date: daysFromToday(-1), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    await eventually(() => inbox(p.user.email)[0], { what: 'e-mail' });
    const m = inbox(p.user.email)[0];
    assert.match(m.text, /Late/);
    assert.ok(!m.text.includes('Soon'), 'due alerts were switched off for e-mail');
    // both still appear in the app
    assert.equal(ok(await p.client.get('/notifications')).items.length, 2);
  });

  it('does not e-mail when e-mail is off, unconfirmed, or alerts are paused; the app still shows them', async () => {
    const off = await verifiedPerson(smtp);
    ok(await tx(off.client, { description: 'Due', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await off.client.post('/notifications/refresh'));
    const lost = await verifiedPerson(smtp);
    await prefs(lost, { email_enabled: true, email_frequency: 'instant' });
    await smtp.db.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [lost.user.id]);
    ok(await tx(lost.client, { description: 'Due', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await lost.client.post('/notifications/refresh'));
    const paused = await verifiedPerson(smtp);
    await prefs(paused, { email_enabled: true, email_frequency: 'instant' });
    ok(await tx(paused.client, { description: 'Due', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await paused.client.post('/notifications/refresh'));
    await eventually(() => inbox(paused.user.email)[0], { what: 'first e-mail' });
    const sentBefore = inbox(paused.user.email).length;
    await prefs(paused, { paused_until: daysFromToday(1) });
    ok(await tx(paused.client, { description: 'Due later', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await paused.client.post('/notifications/refresh'));
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(inbox(off.user.email).length, 0);
    assert.equal(inbox(lost.user.email).length, 0);
    assert.equal(inbox(paused.user.email).length, sentBefore, 'nothing new while paused');
    assert.equal(ok(await off.client.get('/notifications')).items.length, 1, 'in-app alerts are independent of e-mail');
  });

  it('turning e-mail on does not replay old notifications', async () => {
    const p = await verifiedPerson(smtp);
    ok(await tx(p.client, { description: 'Old news', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    await smtp.db.query(`UPDATE notifications SET created_at = now() - interval '2 hours' WHERE user_id = $1`, [p.user.id]);
    await prefs(p, { email_enabled: true, email_frequency: 'instant' });
    ok(await p.client.post('/notifications/refresh'));
    await new Promise((r) => setTimeout(r, 1800));
    assert.equal(inbox(p.user.email).length, 0);
  });

  it('keeps unsent alerts when delivery fails, and records the failure', async () => {
    const p = await signup(broken);
    await verifyEmail(broken, p.user.id);
    await prefs(p, { email_enabled: true, email_frequency: 'instant', timezone: LOCAL_TZ, balance_warning: false, forecast_warning: false, ai_insights: false });
    ok(await tx(p.client, { description: 'Will not arrive', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    const log = await eventually(async () => (await broken.db.query(`SELECT status, error FROM email_log WHERE user_id = $1 AND kind = 'alert'`, [p.user.id])).rows[0], { what: 'failed log' });
    assert.equal(log.status, 'failed');
    assert.ok(log.error);
    const n = (await broken.db.query('SELECT emailed_at FROM notifications WHERE user_id = $1', [p.user.id])).rows[0];
    assert.equal(n.emailed_at, null, 'still waiting to be sent');
    assert.equal(ok(await p.client.get('/notifications')).items.length, 1, 'the in-app alert is unaffected');
  });
});

describe('the daily digest', () => {
  it('sends once a day at the chosen hour, and not before', async () => {
    const hour = nowHourUtc();
    const due = await verifiedPerson(smtp);
    await prefs(due, { email_enabled: true, email_frequency: 'daily', timezone: 'UTC', email_hour: hour });
    ok(await tx(due.client, { description: 'Digest bill', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await due.client.post('/notifications/refresh'));
    const m = await eventually(() => inbox(due.user.email)[0], { what: 'digest' });
    assert.match(m.text, /Digest bill/);
    ok(await due.client.post('/notifications/refresh'));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(inbox(due.user.email).length, 1, 'only one digest per day');
    // new alerts the same day wait for tomorrow's digest
    ok(await tx(due.client, { description: 'Later bill', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await due.client.post('/notifications/refresh'));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(inbox(due.user.email).length, 1);
    if (hour < 23) {
      const early = await verifiedPerson(smtp);
      await prefs(early, { email_enabled: true, email_frequency: 'daily', timezone: 'UTC', email_hour: hour + 1 });
      ok(await tx(early.client, { description: 'Too early', amount: 5, date: today(), status: 'pending' }), 201);
      ok(await early.client.post('/notifications/refresh'));
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(inbox(early.user.email).length, 0, 'it is not their hour yet');
    }
  });

  it('events do not trigger an immediate e-mail in daily mode', async () => {
    const a = await verifiedPerson(smtp);
    const b = await verifiedPerson(smtp);
    await prefs(b, { email_enabled: true, email_frequency: 'daily', email_social: true, email_hour: 0 });
    ok(await a.client.post('/connections', { username: b.user.username }), 201);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(inbox(b.user.email).length, 0);
    ok(await b.client.post('/notifications/refresh')); // the scan is what sends the digest
    const m = await eventually(() => inbox(b.user.email)[0], { what: 'digest' });
    assert.match(m.subject, /wants to connect/);
  });

  it('leaves out what you already read, what is stale, and says nothing when there is nothing', async () => {
    const p = await verifiedPerson(smtp);
    await prefs(p, { email_enabled: true, email_frequency: 'daily', email_hour: 0, timezone: 'UTC' });
    const read = ok(await tx(p.client, { description: 'Seen already', amount: 5, date: today(), status: 'pending' }), 201);
    const old = ok(await tx(p.client, { description: 'Ancient alert', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await tx(p.client, { description: 'Fresh one', amount: 5, date: today(), status: 'pending' }), 201);
    // create the alerts without sending (daily mode only sends in the scan, so insert via the scan with e-mail off first)
    await prefs(p, { email_enabled: false });
    ok(await p.client.post('/notifications/refresh'));
    const list = ok(await p.client.get('/notifications')).items;
    await p.client.post(`/notifications/${list.find((n) => n.data.transaction_id === read.id).id}/read`);
    await smtp.db.query(`UPDATE notifications SET created_at = now() - interval '4 days' WHERE user_id = $1 AND (data ->> 'transaction_id')::int = $2`, [p.user.id, old.id]);
    await prefs(p, { email_enabled: true });
    await smtp.db.query(`UPDATE notifications SET emailed_at = NULL WHERE user_id = $1`, [p.user.id]); // as if they had never been sent
    ok(await p.client.post('/notifications/refresh'));
    const m = await eventually(() => inbox(p.user.email)[0], { what: 'digest' });
    assert.ok(m.text.includes('Fresh one'));
    assert.ok(!m.text.includes('Seen already'), 'read in the app, so not repeated by e-mail');
    assert.ok(!m.text.includes('Ancient alert'), 'older than three days');
    // an empty day sends nothing and does not use up the day
    const quiet = await verifiedPerson(smtp);
    await prefs(quiet, { email_enabled: true, email_frequency: 'daily', email_hour: 0, timezone: 'UTC' });
    ok(await quiet.client.post('/notifications/refresh'));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(inbox(quiet.user.email).length, 0);
    assert.equal((await smtp.db.query('SELECT last_digest_on FROM notification_settings WHERE user_id = $1', [quiet.user.id])).rows[0].last_digest_on, null);
  });
});

describe('unsubscribing', () => {
  async function aMailFor() {
    const p = await verifiedPerson(smtp);
    await prefs(p, { email_enabled: true, email_frequency: 'instant' });
    ok(await p.client.post('/notifications/test-email'));
    const m = await eventually(() => inbox(p.user.email)[0], { what: 'e-mail' });
    return { p, m, token: unsubTokenFrom(m) };
  }

  it('the link in an e-mail turns e-mail alerts off without a login', async () => {
    const { p, token } = await aMailFor();
    assert.ok(token);
    const anon = new Client(smtp.base.replace(/\/api$/, ''));
    ok(await anon.post('/unsubscribe', { token }));
    assert.equal(ok(await p.client.get('/notifications/settings')).email_enabled, false);
    ok(await anon.post('/unsubscribe', { token }), 200); // idempotent
    // nothing more is sent
    ok(await tx(p.client, { description: 'After unsubscribe', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(inbox(p.user.email).length, 1);
  });

  it('works as a one-click POST from a mail app (token in the address, form body)', async () => {
    const { p, m } = await aMailFor();
    const url = /^<(.+?)>/.exec(headerOf(m, 'List-Unsubscribe'))[1];
    assert.match(url, /\/api\/unsubscribe\?token=/);
    const res = await fetch(`${smtp.base}/api/unsubscribe?${url.split('?')[1]}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(res.status, 200);
    assert.equal(ok(await p.client.get('/notifications/settings')).email_enabled, false);
  });

  it('rejects tampered, foreign and missing tokens', async () => {
    const { p, token } = await aMailFor();
    const other = await verifiedPerson(smtp);
    await prefs(other, { email_enabled: true });
    const anon = new Client(smtp.base.replace(/\/api$/, ''));
    const [body, sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ u: other.user.id, p: 'unsub' })).toString('base64url');
    for (const bad of [`${forgedBody}.${sig}`, `${body}.${'A'.repeat(sig.length)}`, `${body}x.${sig}`, body, `.${sig}`, 'garbage', '', 'a.b.c', `${token}${token}`]) {
      assert.equal((await anon.post('/unsubscribe', { token: bad })).status, 400, bad.slice(0, 30));
    }
    assert.equal((await anon.post('/unsubscribe', {})).status, 400);
    assert.equal((await anon.post('/unsubscribe?token=nope', {})).status, 400);
    assert.equal(ok(await other.client.get('/notifications/settings')).email_enabled, true, 'nobody else was affected');
    assert.equal(ok(await p.client.get('/notifications/settings')).email_enabled, true, 'a bad token changes nothing');
  });
});

describe('without a mail server (preview mode)', () => {
  it('writes alert e-mails to a folder and logs them, so the feature can be tried locally', async () => {
    const p = await verifiedPerson(preview);
    await prefs(p, { email_enabled: true, email_frequency: 'instant' });
    ok(await tx(p.client, { description: 'Preview me', amount: 5, date: today(), status: 'pending' }), 201);
    ok(await p.client.post('/notifications/refresh'));
    const log = await eventually(async () => (await preview.db.query(`SELECT status, subject FROM email_log WHERE user_id = $1 AND kind = 'alert'`, [p.user.id])).rows[0], { what: 'preview log' });
    assert.equal(log.status, 'preview');
    const html = fs.readdirSync(preview.mailDir).filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(`${preview.mailDir}/${f}`, 'utf8'));
    const mine = html.find((h) => h.includes(p.user.email) && h.includes('Preview me'));
    assert.ok(mine, 'a preview file exists for it');
    assert.match(mine, /preview mode: this e-mail was not sent/);
    assert.equal(ok(await p.client.get('/notifications/settings')).mail_mode, 'preview');
  });
});

describe('the hourly scan', () => {
  it('runs on its own: alerts and e-mails appear without anyone asking', async () => {
    const p = await signup(scheduled);
    await verifyEmail(scheduled, p.user.id);
    await prefs(p, { timezone: LOCAL_TZ, balance_warning: false, forecast_warning: false, ai_insights: false, email_enabled: true, email_frequency: 'instant' });
    ok(await tx(p.client, { description: 'Scheduled bill', amount: 5, date: daysFromToday(1), status: 'pending' }), 201);
    const n = await eventually(async () => (await p.client.get('/notifications')).json.items.find((x) => x.kind === 'payment_due'), { ms: 15000, what: 'the scan to create an alert' });
    assert.match(n.title, /Scheduled bill is due tomorrow/);
    const m = await eventually(() => fakeScheduled.messages.find((x) => x.to?.includes(p.user.email)), { ms: 15000, what: 'the scan to send the e-mail' });
    assert.match(m.text, /Scheduled bill/);
  });

  it('housekeeping removes old read notifications, spent tokens and orphaned alert rules', async () => {
    const p = await signup(scheduled);
    await scheduled.db.query(`INSERT INTO notifications (user_id, kind, title, read_at, created_at) VALUES ($1, 'system', 'old read', now() - interval '61 days', now() - interval '70 days'), ($1, 'system', 'ancient', NULL, now() - interval '181 days'), ($1, 'system', 'recent', NULL, now())`, [p.user.id]);
    await scheduled.db.query(`INSERT INTO alert_overrides (user_id, target_type, target_id, mode) VALUES ($1, 'transaction', 999999, 'off'), ($1, 'category', 999999, 'off')`, [p.user.id]);
    await scheduled.db.query(`INSERT INTO email_tokens (token_hash, user_id, purpose, email, expires_at) VALUES ('stale-token', $1, 'verify', 'x@example.com', now() - interval '3 days')`, [p.user.id]);
    await eventually(async () => (await scheduled.db.query(`SELECT 1 FROM alert_overrides WHERE user_id = $1`, [p.user.id])).rowCount === 0, { ms: 15000, what: 'housekeeping' });
    const left = (await scheduled.db.query('SELECT title FROM notifications WHERE user_id = $1', [p.user.id])).rows.map((r) => r.title);
    assert.deepEqual(left, ['recent']);
    assert.equal((await scheduled.db.query(`SELECT 1 FROM email_tokens WHERE token_hash = 'stale-token'`)).rowCount, 0);
  });
});

describe('notifications about people still work with e-mail in the mix', () => {
  it('e-mail for social events is opt-in (off by default)', async () => {
    const a = await verifiedPerson(smtp);
    const b = await verifiedPerson(smtp);
    await prefs(b, { email_enabled: true, email_frequency: 'instant' }); // email_social stays at its default (off)
    await connect(a, b);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(inbox(b.user.email).length, 0);
    assert.ok(ok(await b.client.get('/notifications')).items.length >= 1, 'but the in-app notification exists');
  });
});
