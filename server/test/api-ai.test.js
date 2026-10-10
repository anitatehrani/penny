import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { categoryId, connect, daysFromToday, fails, ok, shutdown, signup, startServer, tx } from './helpers.js';

// A made-up key and a pretend OpenRouter on this computer: nothing here reaches the real service or uses a real key.
const KEY = 'sk-or-v1-test-key-not-real-0000000000';

/** A pretend OpenRouter. `next` decides each reply; `calls` keeps what it was sent. */
async function fakeRouter() {
  const calls = [];
  const state = { next: () => ({ status: 200, body: { model: 'fake/free-model:free', choices: [{ message: { content: 'Fake answer: you spent a little on food.' } }] } }) };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const call = { url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') };
      calls.push(call);
      const r = state.next(call);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { calls, state, base: `http://127.0.0.1:${server.address().port}/api/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}
const answer = (text) => () => ({ status: 200, body: { model: 'fake/free-model:free', choices: [{ message: { content: text } }] } });

let router;
let on; // a server where the AI service is set up
let off; // a server where it is not
before(async () => {
  router = await fakeRouter();
  on = await startServer('ai_on', { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: router.base, AI_DAILY_LIMIT: '0', AI_PERSON_DAILY_LIMIT: '4', AI_DATA_COLLECTION: '' });
  off = await startServer('ai_off', { OPENROUTER_API_KEY: '', OPENROUTER_BASE_URL: router.base });
});
after(async () => {
  await shutdown(on, off);
  await router.close();
});

const status = async (p) => ok(await p.client.get('/assistant/ai'));
const turn = async (p, value) => ok(await p.client.put('/assistant/ai', { on: value }));
const ask = async (p, question, extra = {}) => ok(await p.client.post('/assistant/ask', { question, ...extra }));
const sent = () => router.calls.length;

/** A person with a few real-looking payments. */
async function person(srv, over = {}) {
  const p = await signup(srv, over);
  const food = await categoryId(p.client, 'Groceries');
  ok(await tx(p.client, { description: 'Corner supermarket', amount: 42.5, category_id: food, status: 'paid' }), 201);
  ok(await tx(p.client, { description: 'Card IT60X0542811101000000123456 shop', amount: 12, category_id: food, status: 'paid' }), 201);
  ok(await tx(p.client, { description: 'Electric company', amount: 60, date: daysFromToday(3), status: 'pending' }), 201);
  return p;
}

describe('without a key on the server', () => {
  it('nothing changes: no AI service, the old answers and the old promise', async () => {
    const p = await person(off);
    assert.deepEqual(await status(p), { configured: false, on: false, waiting: 0, members: 1, ready: false });
    fails(await p.client.put('/assistant/ai', { on: true }), 400);
    const a = await ask(p, 'what is the weather like');
    assert.equal(a.intent, 'unknown');
    assert.equal('ai' in a, false);
    assert.match((await ask(p, 'what can you do?')).answer, /Nothing is sent to an outside AI service/);
    assert.equal(sent(), 0);
  });

  it('turning it off is always allowed', async () => {
    const p = await signup(off);
    assert.equal((await turn(p, false)).on, false);
  });
});

describe('with a key on the server', () => {
  it('is available but off until the person turns it on, and they are asked nothing else', async () => {
    const p = await person(on);
    assert.deepEqual(await status(p), { configured: true, on: false, waiting: 0, members: 1, ready: false });
    const before = sent();
    const a = await ask(p, 'did I buy anything at the corner supermarket this month?');
    assert.notEqual(a.intent, 'ai');
    assert.equal('ai' in a, false);
    assert.equal(sent(), before, 'nothing is sent while it is off');
    assert.match((await ask(p, 'what can you do?')).answer, /Nothing is sent to an outside AI service/);
  });

  it('answers a typed question with the service, and sends only the budget summary', async () => {
    const p = await person(on, { name: 'Zuzanna Quarkmeister', username: 'quark_zuza' });
    assert.equal((await turn(p, true)).ready, true);
    router.state.next = answer('You paid 42.50 at the corner supermarket.\n\n**Nice and low.**');
    const n = sent();
    const a = await ask(p, 'Did I buy anything at the corner supermarket?');
    assert.equal(a.intent, 'ai');
    assert.equal(a.answer, 'You paid 42.50 at the corner supermarket.\n\nNice and low.');
    assert.deepEqual(a.ai, { used: true });
    assert.deepEqual(a.blocks, []);
    assert.ok(a.follow_ups.length > 0);
    assert.equal(sent(), n + 1);

    const call = router.calls.at(-1);
    assert.equal(call.url, '/api/v1/chat/completions');
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
    assert.ok([call.body.model, ...(call.body.models ?? [])].every((m) => m === 'openrouter/free' || m.endsWith(':free')), 'free models only');
    assert.equal(call.body.provider.data_collection, 'deny');
    const [system, ...rest] = call.body.messages;
    assert.equal(system.role, 'system');
    assert.deepEqual(rest, [{ role: 'user', content: 'Did I buy anything at the corner supermarket?' }]);
    assert.ok(system.content.includes('Corner supermarket') && system.content.includes('Groceries') && system.content.includes('Electric company'), 'the budget is in the summary');
    assert.match(system.content, /whose name contains "corner"/);
    assert.match(system.content, /Month by month, the last twelve months/);
    assert.match(system.content, /spending EUR|spending $|spending USD/);
    // nothing that says who the person is, and no account number
    const everything = JSON.stringify(call.body);
    for (const secret of [p.user.email, 'quark_zuza', 'Zuzanna', 'Quarkmeister', '0542811101000000123456', KEY]) assert.ok(!everything.includes(secret), `leaked: ${secret}`);
    assert.ok(everything.includes('IT…3456'));
  });

  it('passes the last turns on, so a follow-up makes sense', async () => {
    const p = await person(on);
    await turn(p, true);
    router.state.next = answer('Last month it was lower.');
    await ask(p, 'And last month?', { history: [{ q: 'How much on food?', a: 'About 54.50 so far.' }] });
    const m = router.calls.at(-1).body.messages;
    assert.deepEqual(m.slice(1).map((x) => [x.role, x.content]), [['user', 'How much on food?'], ['assistant', 'About 54.50 so far.'], ['user', 'And last month?']]);
    fails(await p.client.post('/assistant/ask', { question: 'x', history: Array.from({ length: 7 }, () => ({ q: 'a', a: 'b' })) }), 400);
    fails(await p.client.post('/assistant/ask', { question: 'x', chip: 'yes' }), 400);
  });

  it('answers the buttons itself, exactly, even when it is on', async () => {
    const p = await person(on);
    await turn(p, true);
    const n = sent();
    const a = await ask(p, 'Give me a summary', { chip: true });
    assert.equal(a.intent, 'summary');
    assert.equal(sent(), n);
    const help = await ask(p, 'What can you do?', { chip: true });
    assert.match(help.answer, /OpenRouter/);
    assert.doesNotMatch(help.answer, /Nothing is sent to an outside AI service/);
  });

  it('uses the built-in answer, with a plain note, when the service cannot answer', async () => {
    const p = await person(on);
    await turn(p, true);
    router.state.next = () => ({ status: 429, body: { error: { code: 429, message: 'rate limit for free models' } } });
    let a = await ask(p, 'what is the weather like');
    assert.equal(a.intent, 'unknown');
    assert.deepEqual(a.ai, { used: false, note: 'The free AI service has reached its limit for now, so this answer comes from Penny’s built-in rules.' });
    router.state.next = () => ({ status: 500, body: { error: { message: 'upstream broke' } } });
    a = await ask(p, 'give me a summary please');
    assert.equal(a.intent, 'summary');
    assert.match(a.ai.note, /could not answer just now/);
    router.state.next = answer('   ');
    a = await ask(p, 'what is the weather like');
    assert.equal(a.ai.used, false);
  });

  it('stops a person at their daily limit and goes back to the built-in answers', async () => {
    const p = await person(on);
    await turn(p, true);
    router.state.next = answer('fine');
    const n = sent();
    for (let i = 0; i < 4; i++) assert.equal((await ask(p, `question number ${i}`)).intent, 'ai');
    const a = await ask(p, 'one more');
    assert.equal(a.ai.used, false);
    assert.match(a.ai.note, /limit/);
    assert.equal(sent(), n + 4, 'the fifth was never sent');
  });

  it('does not use it for an empty budget', async () => {
    const p = await signup(on);
    await turn(p, true);
    const n = sent();
    assert.equal((await ask(p, 'how much did I spend on food?')).intent, 'empty');
    assert.equal(sent(), n);
  });

  it('turning it off stops it at once, and turning it on is remembered', async () => {
    const p = await person(on);
    await turn(p, true);
    assert.equal((await status(p)).on, true);
    assert.equal((await turn(p, false)).on, false);
    router.state.next = answer('should not be used');
    const n = sent();
    assert.notEqual((await ask(p, 'did I buy anything at the corner supermarket?')).intent, 'ai');
    assert.equal(sent(), n);
    fails(await p.client.put('/assistant/ai', { on: 'yes' }), 400);
    fails(await p.client.put('/assistant/ai', { on: true, extra: 1 }), 400);
  });

  it('in a shared budget it works only when every member has turned it on', async () => {
    const owner = await signup(on, { name: 'Olive Owner' });
    const member = await signup(on, { name: 'Marco Member' });
    await connect(owner, member);
    const group = ok(await owner.client.post('/workspaces', { name: 'Home' }), 201);
    ok(await owner.client.post(`/workspaces/${group.id}/invites`, { username: member.user.username }), 201);
    const inv = ok(await member.client.get('/inbox')).group_invites[0];
    ok(await member.client.post(`/workspace-invites/${inv.id}/accept`));
    owner.client.ws = group.id;
    member.client.ws = group.id;
    ok(await tx(owner.client, { description: 'Shared groceries', amount: 30, status: 'paid' }), 201);
    router.state.next = answer('Shared answer.');

    assert.deepEqual(await turn(owner, true), { configured: true, on: true, waiting: 1, members: 2, ready: false });
    const n = sent();
    assert.notEqual((await ask(owner, 'what did we buy lately?')).intent, 'ai');
    assert.equal(sent(), n, 'one member said yes, the other has not: nothing is sent');
    assert.match((await ask(owner, 'what can you do?', { chip: true })).answer, /Nothing is sent to an outside AI service/);

    assert.deepEqual(await turn(member, true), { configured: true, on: true, waiting: 0, members: 2, ready: true });
    assert.equal((await ask(owner, 'what did we buy lately?')).intent, 'ai');
    assert.equal((await ask(member, 'what did we buy lately?')).intent, 'ai');

    await turn(member, false); // one person changing their mind switches it off for the budget
    assert.equal((await status(owner)).ready, false);
    const m = sent();
    assert.notEqual((await ask(owner, 'what did we buy lately?')).intent, 'ai');
    assert.equal(sent(), m);
    // a personal budget of the owner is not held back by the shared one
    owner.client.ws = null;
    assert.equal((await status(owner)).ready, true);
  });

  it('forgets the choice when the preferences are reset, which is the safe direction', async () => {
    const p = await person(on);
    await turn(p, true);
    assert.equal((await p.client.del('/preferences')).status, 204);
    assert.equal((await status(p)).on, false);
  });
});
