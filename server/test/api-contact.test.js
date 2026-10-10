import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DAILY_CAP, KEEP_DAYS, MESSAGE_MAX, pruneContactMessages } from '../src/lib/contact.js';
import { Client, eventually, fails, headerOf, ok, PW, shutdown, signup, startFakeSmtp, startServer } from './helpers.js';

// The contact form and the admin's Messages tab (docs/DESIGN.md section 38).
// TRUST_PROXY lets each test come from its own made-up address, because the form allows only a few messages an hour from one place.
let srv; // no mail server: e-mails are only saved in a folder
let mailSrv; // a (fake) mail server that records what is sent
let brokenSrv; // a mail server that is not there
let fake;
before(async () => {
  fake = await startFakeSmtp();
  [srv, mailSrv, brokenSrv] = await Promise.all([
    startServer('contact', { TRUST_PROXY: '1' }),
    startServer('contactmail', { ...fake.env, TRUST_PROXY: '1' }),
    startServer('contactbad', { ...fake.env, SMTP_PORT: '1', TRUST_PROXY: '1' }),
  ]);
});
after(async () => {
  await fake.close();
  await shutdown(srv, mailSrv, brokenSrv);
});

const q = (sql, params) => srv.db.query(sql, params);
let n = 10;
const newIp = () => `203.0.113.${n++}`;
const GOOD = { name: 'Sam Visitor', email: 'sam@example.com', topic: 'question', message: 'Hello, how do I move a payment to next month?' };
const send = (body, { client = new Client(srv.base), ip = newIp() } = {}) => client.raw('POST', '/contact', { body, headers: { 'x-forwarded-for': ip } });
async function admin() {
  const p = await signup(srv);
  await q('UPDATE users SET is_admin = true WHERE id = $1', [p.user.id]);
  return p;
}
const list = async (a, params = '') => ok(await a.client.get(`/admin/messages${params}`));
const wipe = () => q('DELETE FROM contact_messages');

describe('sending a message', () => {
  it('anybody can write, signed out: it is kept with the writer\'s name, address, topic and text', async () => {
    await wipe();
    const r = await send({ ...GOOD, topic: 'idea' });
    assert.deepEqual(ok(r, 201), { ok: true });
    const rows = (await q('SELECT * FROM contact_messages')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Sam Visitor');
    assert.equal(rows[0].email, 'sam@example.com');
    assert.equal(rows[0].topic, 'idea');
    assert.equal(rows[0].message, GOOD.message);
    assert.equal(rows[0].user_id, null);
    assert.equal(rows[0].read_at, null);
  });

  it('a signed-in person\'s message is tied to their account', async () => {
    await wipe();
    const p = await signup(srv);
    ok(await send(GOOD, { client: p.client }), 201);
    assert.equal((await q('SELECT user_id FROM contact_messages')).rows[0].user_id, p.user.id);
  });

  it('what is wrong is said, and nothing is kept: a missing name, a bad address, a short or long message, an unknown topic', async () => {
    await wipe();
    fails(await send({ ...GOOD, name: '   ' }), 400);
    fails(await send({ ...GOOD, email: 'not-an-address' }), 400);
    fails(await send({ ...GOOD, email: '' }), 400);
    const short = fails(await send({ ...GOOD, message: 'too short' }), 400);
    assert.match(short.error, /message: must be at least 10 characters/);
    fails(await send({ ...GOOD, message: 'x'.repeat(MESSAGE_MAX + 1) }), 400);
    fails(await send({ ...GOOD, topic: 'spam-me' }), 400);
    fails(await send({ ...GOOD, name: 'n'.repeat(81) }), 400);
    fails(await send({}), 400);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 0);
  });

  it('the topic defaults to a question, the address is lower-cased, spaces are trimmed, control characters dropped, line breaks kept', async () => {
    await wipe();
    ok(await send({ name: '  Sam  ', email: '  Sam@Example.COM ', message: '  line one\r\nline two\u0000\u0007 with a tab\t end  ' }), 201);
    const row = (await q('SELECT * FROM contact_messages')).rows[0];
    assert.equal(row.topic, 'question');
    assert.equal(row.name, 'Sam');
    assert.equal(row.email, 'sam@example.com');
    assert.equal(row.message, 'line one\nline two with a tab\t end');
  });

  it('markup is kept as plain text, exactly as typed', async () => {
    await wipe();
    const text = 'Please look at <img src=x onerror=alert(1)> and <script>alert(2)</script> thanks';
    ok(await send({ ...GOOD, message: text }), 201);
    const a = await admin();
    assert.equal((await list(a, '?filter=all')).messages[0].message, text);
  });

  it('the hidden field: filled in, the message is thrown away but the answer says "sent"', async () => {
    await wipe();
    assert.deepEqual(ok(await send({ ...GOOD, website: 'https://spam.example' }), 201), { ok: true });
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 0);
    ok(await send({ ...GOOD, website: '' }), 201);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 1, 'left empty, as a person leaves it, it is kept');
  });

  it('five messages an hour from one place; the sixth is turned away (and shows in the activity log), another place is fine', async () => {
    await wipe();
    const ip = newIp();
    for (let i = 0; i < 5; i++) ok(await send(GOOD, { ip }), 201);
    const sixth = fails(await send(GOOD, { ip }), 429);
    assert.match(sixth.error, /try again in an hour/i);
    ok(await send(GOOD), 201);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 6);
    await eventually(async () => (await q(`SELECT 1 FROM audit_events WHERE kind = 'rate_limited' AND detail LIKE '%contact%'`)).rowCount === 1, { what: 'the turned-away message in the activity log' });
  });

  it('a day\'s total is capped, so a flood cannot fill the database', async () => {
    await wipe();
    await q(`INSERT INTO contact_messages (name, email, topic, message) SELECT 'x', 'x@example.com', 'other', 'filler message number ' || g FROM generate_series(1, $1) g`, [DAILY_CAP]);
    fails(await send(GOOD), 429);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, DAILY_CAP);
    await q(`UPDATE contact_messages SET created_at = now() - interval '2 days'`);
    ok(await send(GOOD), 201);
  });

  it('what was typed never reaches the activity log or a notification', async () => {
    await wipe();
    await admin();
    const secret = 'my-very-private-sentence-4711';
    ok(await send({ ...GOOD, message: `Hello ${secret} please help` }), 201);
    await eventually(async () => (await q(`SELECT 1 FROM notifications WHERE title = 'New message'`)).rowCount >= 1, { what: 'the notification' });
    assert.equal((await q(`SELECT count(*)::int AS n FROM notifications WHERE body LIKE $1 OR title LIKE $1`, [`%${secret}%`])).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int AS n FROM audit_events WHERE detail LIKE $1`, [`%${secret}%`])).rows[0].n, 0);
  });
});

describe('the admin\'s Messages tab', () => {
  it('only admins get in: a visitor is asked to sign in, an ordinary person is told "not found"', async () => {
    const person = await signup(srv);
    const visitor = new Client(srv.base);
    const routes = [['get', '/admin/messages'], ['get', '/admin/messages/unread'], ['post', '/admin/messages/1/read'], ['post', '/admin/messages/1/archive'], ['del', '/admin/messages/1']];
    for (const [method, url] of routes) {
      assert.equal((await visitor[method](url)).status, 401, `${method} ${url} signed out`);
      assert.equal((await person.client[method](url)).status, 404, `${method} ${url} as an ordinary person`);
    }
  });

  it('lists the newest first, with unread counted, and filters Unread, All and Archived', async () => {
    await wipe();
    const a = await admin();
    for (const name of ['First', 'Second', 'Third']) {
      ok(await send({ ...GOOD, name }), 201);
      await new Promise((r) => setTimeout(r, 15));
    }
    const all = await list(a, '?filter=all');
    assert.deepEqual(all.messages.map((m) => m.name), ['Third', 'Second', 'First']);
    assert.equal(all.unread, 3);
    assert.deepEqual(Object.keys(all.messages[0]).sort(), ['archived', 'created_at', 'email', 'id', 'message', 'name', 'read', 'replied', 'replied_at', 'reply', 'signed_in', 'topic', 'topic_label']);
    assert.equal((await list(a)).total, 3, 'unread is the default view');
    const second = all.messages[1];
    ok(await a.client.post(`/admin/messages/${second.id}/read`, { value: true }));
    assert.deepEqual((await list(a, '?filter=unread')).messages.map((m) => m.name), ['Third', 'First']);
    assert.equal((await list(a, '?filter=all')).total, 3);
    ok(await a.client.post(`/admin/messages/${second.id}/archive`, { value: true }));
    assert.deepEqual((await list(a, '?filter=archived')).messages.map((m) => m.name), ['Second']);
    assert.deepEqual((await list(a, '?filter=all')).messages.map((m) => m.name), ['Third', 'First'], 'archived ones leave the main list');
    fails(await a.client.get('/admin/messages?filter=bogus'), 400);
  });

  it('mark read and unread, archive and restore; the unread count follows and the first read time is kept', async () => {
    await wipe();
    const a = await admin();
    ok(await send(GOOD), 201);
    const id = (await list(a)).messages[0].id;
    assert.equal(ok(await a.client.get('/admin/messages/unread')).unread, 1);
    const r1 = ok(await a.client.post(`/admin/messages/${id}/read`, { value: true }));
    assert.equal(r1.message.read, true);
    assert.equal(r1.unread, 0);
    const first = (await q('SELECT read_at FROM contact_messages WHERE id = $1', [id])).rows[0].read_at.getTime();
    await new Promise((r) => setTimeout(r, 30));
    ok(await a.client.post(`/admin/messages/${id}/read`, { value: true }));
    assert.equal((await q('SELECT read_at FROM contact_messages WHERE id = $1', [id])).rows[0].read_at.getTime(), first, 'reading again keeps the first time');
    assert.equal(ok(await a.client.post(`/admin/messages/${id}/read`, { value: false })).unread, 1, 'marked unread');
    const arch = ok(await a.client.post(`/admin/messages/${id}/archive`, { value: true }));
    assert.equal(arch.message.archived, true);
    assert.equal(arch.unread, 0, 'an archived message is no longer waiting');
    assert.equal(ok(await a.client.post(`/admin/messages/${id}/archive`, { value: false })).message.archived, false);
    fails(await a.client.post('/admin/messages/999999/read', {}), 404);
    fails(await a.client.post('/admin/messages/999999/archive', {}), 404);
    fails(await a.client.post(`/admin/messages/${id}/read`, { value: 'yes' }), 400);
  });

  it('delete removes it for good', async () => {
    await wipe();
    const a = await admin();
    ok(await send(GOOD), 201);
    const id = (await list(a)).messages[0].id;
    const r = ok(await a.client.del(`/admin/messages/${id}`));
    assert.equal(r.unread, 0);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 0);
    fails(await a.client.del(`/admin/messages/${id}`), 404);
  });

  it('pages of 25, and the overview carries the unread count', async () => {
    await wipe();
    const a = await admin();
    await q(`INSERT INTO contact_messages (name, email, topic, message) SELECT 'p' || g, 'p@example.com', 'other', 'a message number ' || g FROM generate_series(1, 30) g`);
    const p1 = await list(a, '?filter=all&page=1');
    assert.equal(p1.messages.length, 25);
    assert.equal(p1.total, 30);
    assert.equal(p1.pages, 2);
    assert.equal((await list(a, '?filter=all&page=2')).messages.length, 5);
    assert.equal(ok(await a.client.get('/admin/overview')).unread_messages, 30);
  });

  it('every admin is told about a new message, and nobody else', async () => {
    await wipe();
    const a1 = await admin();
    const a2 = await admin();
    const ordinary = await signup(srv);
    ok(await send({ ...GOOD, name: 'Notify Me', topic: 'problem' }), 201);
    for (const a of [a1, a2]) {
      await eventually(async () => (await q(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'New message'`, [a.user.id])).rowCount === 1, { what: 'the notification' });
      const rows = (await q(`SELECT title, body, link FROM notifications WHERE user_id = $1 AND title = 'New message'`, [a.user.id])).rows;
      assert.equal(rows.length, 1, 'an admin is told once');
      assert.equal(rows[0].link, '/admin?tab=messages');
      assert.match(rows[0].body, /Notify Me wrote to you \(Something is wrong\)/);
    }
    assert.equal((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title = 'New message'`, [ordinary.user.id])).rows[0].n, 0);
  });
});

describe('what happens to a message afterwards', () => {
  it('"Download my data" includes what the person sent while signed in, and nothing sent by others', async () => {
    await wipe();
    const p = await signup(srv);
    ok(await send({ ...GOOD, message: 'A question from a signed-in person here' }, { client: p.client }), 201);
    ok(await send({ ...GOOD, message: 'Somebody else wrote this one' }), 201);
    const data = ok(await p.client.get('/auth/account/export'));
    const sent = data.messages_you_sent_through_the_contact_form;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message, 'A question from a signed-in person here');
  });

  it('deleting the account deletes the messages sent from it, and only those', async () => {
    await wipe();
    const p = await signup(srv);
    ok(await send(GOOD, { client: p.client }), 201);
    ok(await send(GOOD), 201);
    ok(await p.client.post('/auth/account/delete', { confirm: 'DELETE', password: PW }));
    const rows = (await q('SELECT user_id FROM contact_messages')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, null);
  });

  it('after a year the daily clean-up deletes them, archived or not, and keeps newer ones', async () => {
    await wipe();
    await q(`INSERT INTO contact_messages (name, email, topic, message, created_at, archived_at) VALUES
      ('old', 'o@example.com', 'other', 'an old message here', now() - make_interval(days => $1 + 1), now()),
      ('old2', 'o@example.com', 'other', 'another old message', now() - make_interval(days => $1 + 5), NULL),
      ('new', 'n@example.com', 'other', 'a recent message here', now() - make_interval(days => $1 - 5), NULL)`, [KEEP_DAYS]);
    await pruneContactMessages(srv.db);
    assert.deepEqual((await q('SELECT name FROM contact_messages')).rows.map((r) => r.name), ['new']);
  });
});

describe('answering a message from the Messages tab', () => {
  const sendTo = (server, body = GOOD) => new Client(server.base).raw('POST', '/contact', { body, headers: { 'x-forwarded-for': newIp() } });
  async function adminOn(server) {
    const p = await signup(server);
    await server.db.query('UPDATE users SET is_admin = true WHERE id = $1', [p.user.id]);
    return p;
  }
  const firstId = async (a) => ok(await a.client.get('/admin/messages?filter=all')).messages[0].id;
  const mailed = () => fake.messages.length;

  it('the answer goes to the writer by e-mail, quoting what they wrote, with the admin as "reply to"', async () => {
    const a = await adminOn(mailSrv);
    ok(await sendTo(mailSrv, { ...GOOD, name: 'Sam Visitor', email: 'sam@example.com', topic: 'problem', message: 'My forecast looks wrong after the card bill.\nCan you check?' }), 201);
    const id = await firstId(a);
    const before = mailed();
    const r = ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Hi Sam, <b>thanks</b> for telling me.\nIt is fixed now.' }));
    assert.equal(r.mail, 'sent');
    assert.equal(mailed(), before + 1);
    const m = fake.messages.at(-1);
    assert.match(m.to, /sam@example\.com/);
    assert.equal(m.subject, 'Re: your message to Penny (Something is wrong)');
    assert.match(m.text, /^Hi Sam,\n\nHi Sam, <b>thanks<\/b> for telling me\.\nIt is fixed now\./);
    assert.match(m.text, /> My forecast looks wrong after the card bill\.\n> Can you check\?/);
    assert.ok(m.html.includes('&lt;b&gt;thanks&lt;/b&gt;') && !m.html.includes('<b>thanks'), 'markup in the answer is shown as text');
    assert.ok(headerOf(m, 'Reply-To').includes(a.user.email), 'replies go to the admin: ' + headerOf(m, 'Reply-To'));
    assert.match(headerOf(m, 'From'), /alerts@test\.local/);
  });

  it('it is kept: marked replied and read, with what was said, in the list and in the e-mail log', async () => {
    const a = await adminOn(mailSrv);
    ok(await sendTo(mailSrv, { ...GOOD, email: 'logged@example.com', message: 'Another question for the admin here' }), 201);
    const id = await firstId(a);
    const r = ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Here is the answer.' }));
    assert.equal(r.message.replied, true);
    assert.equal(r.message.reply, 'Here is the answer.');
    assert.equal(r.message.read, true);
    const listed = ok(await a.client.get('/admin/messages?filter=all')).messages.find((x) => x.id === id);
    assert.equal(listed.replied, true);
    const log = (await mailSrv.db.query(`SELECT status FROM email_log WHERE kind = 'contact-reply' AND to_email = 'logged@example.com'`)).rows[0];
    assert.equal(log.status, 'sent');
    assert.equal((await mailSrv.db.query('SELECT replied_by FROM contact_messages WHERE id = $1', [id])).rows[0].replied_by, a.user.id);
  });

  it('a bad answer is refused and nothing is sent: empty, too long, no such message', async () => {
    const a = await adminOn(mailSrv);
    ok(await sendTo(mailSrv), 201);
    const id = await firstId(a);
    const before = mailed();
    fails(await a.client.post(`/admin/messages/${id}/reply`, { reply: '   ' }), 400);
    fails(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'x'.repeat(4001) }), 400);
    fails(await a.client.post(`/admin/messages/${id}/reply`, {}), 400);
    fails(await a.client.post('/admin/messages/999999/reply', { reply: 'Hello there' }), 404);
    assert.equal(mailed(), before);
    assert.equal((await mailSrv.db.query('SELECT replied_at FROM contact_messages WHERE id = $1', [id])).rows[0].replied_at, null);
  });

  it('only admins can answer: a visitor is asked to sign in, an ordinary person is told "not found"', async () => {
    const person = await signup(mailSrv);
    const before = mailed();
    assert.equal((await new Client(mailSrv.base).post('/admin/messages/1/reply', { reply: 'Hello there' })).status, 401);
    assert.equal((await person.client.post('/admin/messages/1/reply', { reply: 'Hello there' })).status, 404);
    assert.equal(mailed(), before);
  });

  it('when the mail server cannot be reached the admin is told, and the message is not marked as answered', async () => {
    const a = await adminOn(brokenSrv);
    ok(await sendTo(brokenSrv), 201);
    const id = await firstId(a);
    const e = fails(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'This cannot be delivered.' }), 502);
    assert.match(e.error, /could not be sent/);
    const row = (await brokenSrv.db.query('SELECT replied_at, reply FROM contact_messages WHERE id = $1', [id])).rows[0];
    assert.equal(row.replied_at, null);
    assert.equal(row.reply, null);
    assert.equal((await brokenSrv.db.query(`SELECT status FROM email_log WHERE kind = 'contact-reply'`)).rows[0].status, 'failed');
  });

  it('without a mail server it only saves a preview, and says so', async () => {
    const a = await admin();
    ok(await send(GOOD), 201);
    const id = (await list(a)).messages[0].id;
    assert.equal(ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Saved but not sent.' })).mail, 'preview');
  });

  it('a name with line breaks cannot add headers such as a hidden copy to somebody else', async () => {
    const a = await adminOn(mailSrv);
    await mailSrv.db.query('UPDATE users SET name = $2 WHERE id = $1', [a.user.id, 'Evil\r\nBcc: victim@example.com']);
    ok(await sendTo(mailSrv), 201);
    const id = await firstId(a);
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Hello from a tricky name.' }));
    const m = fake.messages.at(-1);
    assert.equal(headerOf(m, 'Bcc'), undefined);
    assert.equal(m.headerLines.filter((l) => /victim@example\.com/.test(l) && !/^reply-to:/i.test(l)).length, 0, 'no header other than Reply-To names the victim');
  });

  it('an admin can send 30 answers an hour, and the 31st is turned away', async () => {
    const a = await adminOn(mailSrv);
    ok(await sendTo(mailSrv), 201);
    const id = await firstId(a);
    for (let i = 0; i < 30; i++) ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: `Answer number ${i + 1}` }));
    fails(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'One too many' }), 429);
  });
});
