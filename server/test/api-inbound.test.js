import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { DAILY_INCOMING_CAP } from '../src/lib/inbound.js';
import { Client, eventually, fails, headerOf, ok, shutdown, signup, startFakeSmtp, startServer } from './helpers.js';

// Replies to an admin's answer come back into the Messages tab (docs/DESIGN.md section 40).
const SECRET = 'test-secret-0123456789abcdef0123456789';
const DOMAIN = 'reply.test.local';
let on; // replies by e-mail set up
let off; // not set up
let fake;
before(async () => {
  fake = await startFakeSmtp();
  [on, off] = await Promise.all([
    startServer('inbound', { ...fake.env, TRUST_PROXY: '1', REPLY_DOMAIN: DOMAIN, INBOUND_SECRET: SECRET, APP_SECRET: 'inbound-test-app-secret' }),
    startServer('inboundoff', { ...fake.env, TRUST_PROXY: '1' }),
  ]);
});
after(async () => {
  await fake.close();
  await shutdown(on, off);
});

let n = 20;
const GOOD = { name: 'Sam Visitor', email: 'sam@example.com', topic: 'question', message: 'Hello, how do I move a payment to next month?' };
const q = (sql, params) => on.db.query(sql, params);
const sign = (id) => createHmac('sha256', 'inbound-test-app-secret').update(`contact-reply:${id}`).digest('hex').slice(0, 16);
const addressFor = (id) => `m${id}-${sign(id)}@${DOMAIN}`;
const hook = (srv, secret, body) => new Client(srv.base).raw('POST', `/inbound/mail/${secret}`, { body });
const mailTo = (to, over = {}) => ({
  Uuid: ['u1'],
  MessageId: `<mail-${n++}@mail.example>`,
  From: { Address: 'sam@example.com', Name: 'Sam' },
  To: [{ Address: to }],
  Recipients: [{ Address: to }],
  Subject: 'Re: your message to Penny (Question)',
  ExtractedMarkdownMessage: 'Yes, thank you, that worked.',
  RawTextBody: 'Yes, thank you, that worked.\n\n> older text',
  Headers: {},
  Spam: { Score: 0.4 },
  ...over,
});
const feed = (items, secret = SECRET, srv = on) => hook(srv, secret, { items });
async function setup(srv = on) {
  const a = await signup(srv);
  await srv.db.query('UPDATE users SET is_admin = true WHERE id = $1', [a.user.id]);
  const w = new Client(srv.base);
  ok(await w.raw('POST', '/contact', { body: { ...GOOD, message: `A question number ${n++} for the admin` }, headers: { 'x-forwarded-for': `198.51.100.${n}` } }), 201);
  const list = ok(await a.client.get('/admin/messages?filter=all'));
  return { a, id: list.messages[0].id };
}
const thread = async (a, id) => ok(await a.client.get('/admin/messages?filter=all')).messages.find((m) => m.id === id).thread;

describe('the address replies are sent to', () => {
  it('an answer carries a "reply to" address made for that message, signed, on the reply domain', async () => {
    const { a, id } = await setup();
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Here is how.' }));
    const m = fake.messages.at(-1);
    assert.equal(headerOf(m, 'Reply-To'), `Penny <${addressFor(id)}>`);
    assert.ok(!m.headerLines.some((l) => /^reply-to:.*@example\.com/i.test(l)), "not the admin's own address");
  });

  it('without the two settings the "reply to" stays the admin\'s own address, and the web address does not exist', async () => {
    const { a, id } = await setup(off);
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Here is how.' }));
    assert.ok(headerOf(fake.messages.at(-1), 'Reply-To').includes(a.user.email));
    fails(await hook(off, SECRET, { items: [] }), 404);
    assert.notEqual((await hook(off, '', { items: [] })).status, 200, 'an empty secret gets nowhere either');
  });
});

describe('what arrives from Brevo', () => {
  it('a reply to an answer is added to the conversation, the message is unread again, and every admin is told', async () => {
    const { a, id } = await setup();
    const a2 = await signup(on);
    await q('UPDATE users SET is_admin = true WHERE id = $1', [a2.user.id]);
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Please try the menu.' }));
    ok(await a.client.post(`/admin/messages/${id}/archive`, { value: true }));
    const r = ok(await feed([mailTo(addressFor(id))]));
    assert.deepEqual(r.results, ['stored']);
    const t = await thread(a, id);
    assert.deepEqual(t.map((e) => e.direction), ['out', 'in']);
    assert.equal(t[1].body, 'Yes, thank you, that worked.');
    assert.equal(t[1].other_sender, false);
    assert.equal(t[0].admin_name, a.user.name);
    const msg = ok(await a.client.get('/admin/messages?filter=unread')).messages.find((m) => m.id === id);
    assert.ok(msg, 'it is unread and out of the archive again');
    assert.equal(msg.archived, false);
    for (const x of [a, a2]) {
      await eventually(async () => (await q(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'New reply'`, [x.user.id])).rowCount === 1, { what: 'the notification' });
    }
    assert.equal((await q(`SELECT count(*)::int AS n FROM notifications WHERE body LIKE '%that worked%'`)).rows[0].n, 0, 'the text is not in the notification');
  });

  it('answering again quotes what the writer last said, not the first message', async () => {
    const { a, id } = await setup();
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'First answer.' }));
    ok(await feed([mailTo(addressFor(id), { ExtractedMarkdownMessage: 'My follow-up question is about cards.' })]));
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'Second answer.' }));
    const m = fake.messages.at(-1);
    assert.match(m.text, /> My follow-up question is about cards\./);
    assert.ok(!m.text.includes('A question number'), 'the first message is not quoted again');
    assert.deepEqual((await thread(a, id)).map((e) => e.direction), ['out', 'in', 'out']);
  });

  it('wrong secret, no secret: "not found", and nothing is kept', async () => {
    const { id } = await setup();
    const before = (await q('SELECT count(*)::int AS n FROM contact_replies')).rows[0].n;
    fails(await feed([mailTo(addressFor(id))], 'wrong-secret'), 404);
    fails(await feed([mailTo(addressFor(id))], SECRET.slice(0, -1)), 404);
    fails(await feed([mailTo(addressFor(id))], `${SECRET}x`), 404);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_replies')).rows[0].n, before);
  });

  it('is thrown away without a fuss: a wrong signature, another message\'s signature, another domain, no address of ours, a message that is gone', async () => {
    const { id } = await setup();
    const other = await setup();
    const results = ok(
      await feed([
        mailTo(`m${id}-0000000000000000@${DOMAIN}`),
        mailTo(`m${id}-${sign(other.id)}@${DOMAIN}`),
        mailTo(`m${id}-${sign(id)}@elsewhere.example`),
        mailTo('someone@example.com'),
        mailTo(addressFor(999999)),
      ]),
    ).results;
    assert.deepEqual(results, ['not for us', 'not for us', 'not for us', 'not for us', 'message is gone']);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_replies WHERE message_id = ANY($1)', [[id, other.id]])).rows[0].n, 0);
  });

  it('the same e-mail twice is kept once', async () => {
    const { id } = await setup();
    const mail = mailTo(addressFor(id));
    assert.deepEqual(ok(await feed([mail])).results, ['stored']);
    assert.deepEqual(ok(await feed([mail])).results, ['duplicate']);
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_replies WHERE message_id = $1', [id])).rows[0].n, 1);
  });

  it('automatic mail, spam and empty mail are ignored', async () => {
    const { id } = await setup();
    const to = addressFor(id);
    const results = ok(
      await feed([
        mailTo(to, { Headers: { 'Auto-Submitted': 'auto-replied' } }),
        mailTo(to, { Headers: { Precedence: ['bulk'] } }),
        mailTo(to, { Headers: { 'X-Autoreply': 'yes' } }),
        mailTo(to, { Spam: { Score: 15.2 } }),
        mailTo(to, { ExtractedMarkdownMessage: '  ', RawTextBody: '' }),
        mailTo(to, { Headers: { 'Auto-Submitted': 'no' } }),
      ]),
    ).results;
    assert.deepEqual(results, ['automatic', 'automatic', 'automatic', 'spam', 'empty', 'stored']);
  });

  it('a reply from another address is kept and marked, so a forward or an alias is not lost', async () => {
    const { a, id } = await setup();
    ok(await feed([mailTo(addressFor(id), { From: { Address: 'Sam.Work@Example.org', Name: 'Sam' } })]));
    const [e] = await thread(a, id);
    assert.equal(e.other_sender, true);
    assert.equal(e.from_email, 'sam.work@example.org');
  });

  it('only the new text is kept, as text: Brevo\'s extraction first, the plain text if there is none, control characters dropped, long ones cut, markup never live', async () => {
    const { a, id } = await setup();
    const to = addressFor(id);
    ok(await feed([mailTo(to, { ExtractedMarkdownMessage: 'Only this.\u0000\u0007\nAnd this <b>bold</b> <img src=x onerror=alert(1)>' })]));
    ok(await feed([mailTo(to, { ExtractedMarkdownMessage: '', RawTextBody: 'From the plain text.' })]));
    ok(await feed([mailTo(to, { ExtractedMarkdownMessage: 'x'.repeat(9000) })]));
    const t = await thread(a, id);
    assert.equal(t[0].body, 'Only this.\nAnd this <b>bold</b> <img src=x onerror=alert(1)>');
    assert.equal(t[1].body, 'From the plain text.');
    assert.ok(t[2].body.length <= 4000 && t[2].body.endsWith('…'));
  });

  it('a big mail (pictures) is accepted although the ordinary API refuses anything over 100 KB', async () => {
    const { a, id } = await setup();
    const big = mailTo(addressFor(id), { RawHtmlBody: `<p>${'x'.repeat(600_000)}</p>` });
    assert.deepEqual(ok(await feed([big])).results, ['stored']);
    assert.equal((await thread(a, id)).length, 1);
    assert.equal((await a.client.raw('POST', '/contact', { body: { ...GOOD, message: 'y'.repeat(300_000) }, headers: { 'x-forwarded-for': '198.51.100.250' } })).status, 413);
  });

  it('works without a session or an origin: it is not a browser', async () => {
    const { id } = await setup();
    const r = await new Client(on.base).raw('POST', `/inbound/mail/${SECRET}`, { body: { items: [mailTo(addressFor(id))] }, headers: { origin: 'https://brevo.example' } });
    assert.equal(r.status, 200, 'no origin check on this one route');
  });

  it('garbage in the request does not break it', async () => {
    assert.deepEqual(ok(await hook(on, SECRET, {})).results, []);
    assert.deepEqual(ok(await hook(on, SECRET, { items: 'nope' })).results, []);
    assert.deepEqual(ok(await feed([null, {}, { To: 'x' }])).results.length, 3);
  });

  it('a day\'s total and a conversation\'s length are capped', async () => {
    const { id } = await setup();
    await q(`INSERT INTO contact_replies (message_id, direction, body, created_at) SELECT $1, 'in', 'filler ' || g, now() - interval '2 days' FROM generate_series(1, 50) g`, [id]);
    assert.deepEqual(ok(await feed([mailTo(addressFor(id))])).results, ['conversation limit']);
    const other = await setup();
    await q(`INSERT INTO contact_replies (message_id, direction, body) SELECT $1, 'in', 'filler ' || g FROM generate_series(1, $2) g`, [id, DAILY_INCOMING_CAP]);
    assert.deepEqual(ok(await feed([mailTo(addressFor(other.id))])).results, ['daily limit']);
    await q(`UPDATE contact_replies SET created_at = now() - interval '2 days'`);
  });
});

describe('what happens to a conversation afterwards', () => {
  it('"Download my data" includes the replies to a message sent while signed in', async () => {
    const p = await signup(on);
    ok(await p.client.raw('POST', '/contact', { body: { ...GOOD, message: 'A signed-in question for you' }, headers: { 'x-forwarded-for': '198.51.100.200' } }), 201);
    const id = (await q('SELECT id FROM contact_messages WHERE user_id = $1', [p.user.id])).rows[0].id;
    ok(await feed([mailTo(addressFor(id), { ExtractedMarkdownMessage: 'My own follow-up here' })]));
    const data = ok(await p.client.get('/auth/account/export'));
    assert.deepEqual(data.replies_to_those_messages.map((r) => [r.direction, r.body]), [['in', 'My own follow-up here']]);
  });

  it('deleting the message deletes its conversation', async () => {
    const { a, id } = await setup();
    ok(await a.client.post(`/admin/messages/${id}/reply`, { reply: 'An answer to be deleted.' }));
    ok(await feed([mailTo(addressFor(id))]));
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_replies WHERE message_id = $1', [id])).rows[0].n, 2);
    ok(await a.client.del(`/admin/messages/${id}`));
    assert.equal((await q('SELECT count(*)::int AS n FROM contact_replies WHERE message_id = $1', [id])).rows[0].n, 0);
  });

  it('answers sent before conversations existed become the first entry, once', async () => {
    const { a, id } = await setup();
    await q(`UPDATE contact_messages SET reply = 'An old answer', replied_at = now(), replied_by = $2 WHERE id = $1`, [id, a.user.id]);
    const { initDb } = await import('../src/db.js');
    assert.ok(typeof initDb === 'function');
    // the migration is the last statement of the schema; running it by hand is what a restart does
    const sql = (await import('node:fs')).readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
    const tail = sql.slice(sql.indexOf('-- answers sent before the conversation existed'));
    await q(tail);
    await q(tail);
    const rows = (await q('SELECT direction, body FROM contact_replies WHERE message_id = $1', [id])).rows;
    assert.deepEqual(rows, [{ direction: 'out', body: 'An old answer' }]);
  });

  it('the System tab says whether replies by e-mail are on', async () => {
    const a = await signup(on);
    await q('UPDATE users SET is_admin = true WHERE id = $1', [a.user.id]);
    assert.equal(ok(await a.client.get('/admin/system')).mail.replies_by_email, DOMAIN);
    const b = await signup(off);
    await off.db.query('UPDATE users SET is_admin = true WHERE id = $1', [b.user.id]);
    assert.equal(ok(await b.client.get('/admin/system')).mail.replies_by_email, null);
  });
});
