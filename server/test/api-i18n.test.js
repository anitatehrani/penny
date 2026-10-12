import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { categoryId, connect, daysFromToday, fails, ok, shutdown, signup, startServer, thisMonth, today, tx } from './helpers.js';

// What the server writes, in the language of the person it is for (docs/DESIGN.md section 46): answers, insights, budget sentences, error messages,
// alerts and e-mails, in English and in Italian, through the real server.
let srv;
before(async () => {
  srv = await startServer('i18n');
});
after(async () => {
  await shutdown(srv);
});

const IT = { 'x-language': 'it' };
const EN = { 'x-language': 'en' };
const M = thisMonth();

/** A person with some spending, something due soon, something overdue and a budget that is over. */
async function household() {
  const p = await signup(srv);
  ok(await p.client.put('/settings', { opening_balance: 2000, currency: 'EUR' }));
  const food = await categoryId(p.client, 'Groceries');
  const rent = await categoryId(p.client, 'Rent / Mortgage');
  const subs = await categoryId(p.client, 'Subscriptions');
  await tx(p.client, { description: 'Market', amount: 120, category_id: food, status: 'paid', date: `${M}-01` });
  await tx(p.client, { description: 'Flat', amount: 700, category_id: rent, status: 'paid', date: `${M}-01` });
  await tx(p.client, { description: 'Gas bill', amount: 80, status: 'pending', date: daysFromToday(3) });
  await tx(p.client, { description: 'Old bill', amount: 40, status: 'pending', date: daysFromToday(-4) });
  ok(await p.client.post('/recurring', { type: 'expense', description: 'Video app', amount: 12, frequency: 'monthly', interval_count: 1, start_date: `${M}-01`, active: true, category_id: subs }), 201);
  ok(await p.client.put(`/budgets/${food}`, { month: M, amount: 50, scope: 'onward' }));
  return { p, food };
}
const ask = async (p, question, headers = IT, chip = false) => ok(await p.client.post('/assistant/ask', { question, chip }, headers));

describe('the language of a request', () => {
  it('is English until the app says otherwise, and English again for a language that does not exist', async () => {
    const wrong = { email: 'nobody@example.com', password: 'x' };
    const en = new (await import('./helpers.js')).Client(srv.base);
    assert.equal(fails(await en.post('/auth/login', { identifier: wrong.email, password: wrong.password }), 401).error, 'Invalid email, username or password.');
    assert.equal(fails(await en.post('/auth/login', { identifier: wrong.email, password: wrong.password }, EN), 401).error, 'Invalid email, username or password.');
    assert.equal(fails(await en.post('/auth/login', { identifier: wrong.email, password: wrong.password }, { 'x-language': 'fr' }), 401).error, 'Invalid email, username or password.');
    assert.equal(fails(await en.post('/auth/login', { identifier: wrong.email, password: wrong.password }, { 'x-language': 'IT; drop table users' }), 401).error, 'Invalid email, username or password.');
  });

  it('turns the error messages into Italian', async () => {
    const en = new (await import('./helpers.js')).Client(srv.base);
    assert.equal(fails(await en.post('/auth/login', { identifier: 'nobody@example.com', password: 'x' }, IT), 401).error, 'Email, nome utente o password non validi.');
    const p = await signup(srv);
    assert.equal(fails(await p.client.post('/connections/999999999/accept', {}, IT), 404).error, 'Richiesta non trovata.');
    assert.equal(fails(await p.client.post('/connections/999999999/accept', {}, EN), 404).error, 'Request not found.');
    // a check of the request: the message part is translated, the name of the field is not
    const bad = fails(await p.client.post('/transactions', { type: 'expense', description: 'x', amount: -5, date: today() }, IT), 400);
    assert.match(bad.error, /amount: deve essere maggiore di 0/);
    const bad2 = fails(await p.client.post('/transactions', { type: 'expense', description: 'x', amount: -5, date: today() }, EN), 400);
    assert.match(bad2.error, /amount: must be greater than 0/);
  });

  it('keeps many requests at once in their own language', async () => {
    const p = await signup(srv);
    const calls = [];
    for (let i = 0; i < 40; i++) calls.push(p.client.post('/connections/999999999/accept', {}, i % 2 ? IT : EN).then((r) => [i % 2, r.json.error]));
    for (const [it, message] of await Promise.all(calls)) assert.equal(message, it ? 'Richiesta non trovata.' : 'Request not found.');
  });
});

describe('the assistant in Italian', () => {
  let h;
  before(async () => {
    h = await household();
  });

  it('answers each of the buttons, in Italian, and the buttons it offers next are Italian too', async () => {
    const cases = [
      ['Dammi un riepilogo', 'summary', /hai speso/],
      ['Com’è il mio budget?', 'budget', /budget/],
      ['Andrò in negativo?', 'forecast', /previsione/],
      ['Cosa scade a breve?', 'upcoming', /in scadenza nei prossimi 14 giorni/],
      ['Dove vanno i miei soldi?', 'categories', /La tua spesa più grande/],
      ['Quali sono i miei abbonamenti?', 'subscriptions', /abbonament/],
      ['Cosa è in ritardo?', 'overdue', /in ritardo/],
    ];
    for (const [question, intent, words] of cases) {
      const a = await ask(h.p, question, IT, true);
      assert.equal(a.intent, intent, question);
      assert.match(a.answer, words, question);
      assert.ok(!/\b(You|Your|spent|this month|overdue)\b/.test(a.answer), `English left in: ${a.answer}`);
      for (const f of a.follow_ups) assert.ok(!/^(What|Where|How|Will|Give|Am)\b/.test(f), `a follow-up left in English: ${f}`);
    }
  });

  it('every button it offers can be pressed and understood again (in both languages)', async () => {
    for (const headers of [IT, EN]) {
      const first = await ask(h.p, headers === IT ? 'Dammi un riepilogo' : 'Give me a summary', headers, true);
      const seen = new Set();
      const queue = [...first.follow_ups];
      while (queue.length && seen.size < 40) {
        const q = queue.shift();
        if (seen.has(q)) continue;
        seen.add(q);
        const a = await ask(h.p, q, headers, true);
        assert.notEqual(a.intent, 'unknown', `the button "${q}" was not understood`);
        queue.push(...a.follow_ups);
      }
      assert.ok(seen.size >= 6, `${headers['x-language']}: ${seen.size} different buttons found`);
    }
  });

  it('understands a question typed in Italian, with the category by its Italian name', async () => {
    const a = await ask(h.p, 'Quanto ho speso per la spesa?');
    assert.equal(a.intent, 'category');
    assert.match(a.answer, /^Spesa:/);
    const b = await ask(h.p, 'quanto ho speso per Spesa?');
    assert.equal(b.intent, 'category');
    const c = await ask(h.p, 'Sto spendendo più del mese scorso?');
    assert.equal(c.intent, 'compare');
    assert.equal((await ask(h.p, 'Cosa sai fare?')).intent, 'help');
    assert.equal((await ask(h.p, 'ciao')).intent, 'help');
    assert.ok(['savings'].includes((await ask(h.p, 'Come posso risparmiare?')).intent));
  });

  it('says the category names in Italian and keeps the English ones when asked in English', async () => {
    const it = await ask(h.p, 'Dove vanno i miei soldi?');
    assert.ok(it.blocks[0].rows.some((r) => r.label === 'Spesa'), 'Groceries is Spesa');
    assert.ok(it.blocks[0].rows.some((r) => r.label === 'Affitto / Mutuo'), 'Rent / Mortgage is Affitto / Mutuo');
    const en = await ask(h.p, 'Where does my money go?', EN);
    assert.ok(en.blocks[0].rows.some((r) => r.label === 'Groceries'));
  });

  it('writes money and months the Italian way', async () => {
    const a = await ask(h.p, 'Come va il mese?');
    assert.match(JSON.stringify(a), /\d\s?€|€\s?\d/);
    assert.ok(!/€\d/.test(a.answer), 'no English-style money: ' + a.answer);
  });

  it('is still English for the English header, and for no header at all', async () => {
    assert.match((await ask(h.p, 'What is due soon?', EN)).answer, /payment is due in the next 14 days/);
    assert.match((await ask(h.p, 'What is due soon?', {})).answer, /payment is due in the next 14 days/);
  });
});

describe('insights and the budget in Italian', () => {
  let h;
  before(async () => {
    h = await household();
  });

  it('writes the cards of the dashboard in Italian', async () => {
    const r = ok(await h.p.client.get('/insights', IT));
    const titles = r.insights.map((i) => i.title).join(' | ');
    assert.match(titles, /in ritardo/);
    assert.ok(!/\b(overdue|payment|balance)\b/i.test(titles), titles);
    for (const i of r.insights) {
      assert.ok(!/\b(You|Your|the)\b/.test(`${i.title} ${i.body}`), `English left in: ${i.title} / ${i.body}`);
      for (const q of i.ask ?? []) assert.ok(!/^(What|Where|How|Will|Give|Am)\b/.test(q), `an ask left in English: ${q}`);
    }
    assert.match(r.summary.text, /hai speso/);
    assert.equal(r.summary.title.endsWith(' finora'), true);
    const en = ok(await h.p.client.get('/insights', EN));
    assert.match(en.insights.map((i) => i.title).join(' | '), /overdue payment/);
  });

  it('writes what stands out in the monthly budget in Italian', async () => {
    const v = ok(await h.p.client.get(`/budgets?month=${M}`, IT));
    const text = v.findings.map((f) => f.text).join(' | ');
    assert.match(text, /ha superato il budget di/);
    assert.ok(/Spesa/.test(text), 'the category name in Italian: ' + text);
    assert.ok(!/\b(over its budget|spent of)\b/.test(text), text);
    const en = ok(await h.p.client.get(`/budgets?month=${M}`, EN));
    assert.match(en.findings.map((f) => f.text).join(' | '), /over its budget by/);
  });
});

describe('what is written for somebody else, in their language', () => {
  it('a connection request arrives in the language of the person who gets it, not of the one who sent it', async () => {
    const a = await signup(srv, { name: 'Anna Rossi' });
    const b = await signup(srv, { name: 'Bruno Verdi' });
    const c = await signup(srv, { name: 'Carla Neri' });
    ok(await b.client.put('/preferences', { language: 'it' }));
    ok(await c.client.put('/preferences', { language: 'en' }));
    // Anna writes in English; Bruno reads Italian, Carla English
    ok(await a.client.post('/connections', { username: b.user.username, relation: 'friend' }, EN), 201);
    ok(await a.client.post('/connections', { username: c.user.username, relation: 'friend' }, EN), 201);
    const titleOf = async (p) => ok(await p.client.get('/notifications')).items.find((n) => n.kind === 'connection_request').title;
    assert.equal(await titleOf(b), 'Anna Rossi vuole mettersi in contatto con te');
    assert.equal(await titleOf(c), 'Anna Rossi wants to connect with you');
  });

  it('a change of language counts at once for what is written next', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const c = await signup(srv);
    ok(await b.client.put('/preferences', { language: 'en' }));
    ok(await a.client.post('/connections', { username: b.user.username, relation: 'friend' }), 201);
    ok(await b.client.put('/preferences', { language: 'it' }));
    ok(await a.client.post('/connections', { username: c.user.username, relation: 'friend' }), 201);
    const items = ok(await b.client.get('/notifications')).items.filter((n) => n.kind === 'connection_request');
    assert.equal(items.length, 1);
    assert.match(items[0].title, /wants to connect with you/, 'the one written before the change stays as it was');
    const d = await signup(srv);
    ok(await d.client.put('/preferences', { language: 'it' }));
    ok(await a.client.post('/connections', { username: d.user.username, relation: 'friend' }), 201);
    assert.match(ok(await d.client.get('/notifications')).items[0].title, /vuole mettersi in contatto con te/);
  });

  it('the alerts found by the periodic scan are written for each person in their language', async () => {
    const it = await signup(srv);
    const en = await signup(srv);
    ok(await it.client.put('/preferences', { language: 'it' }));
    ok(await en.client.put('/preferences', { language: 'en' }));
    for (const p of [it, en]) {
      await tx(p.client, { description: 'Bolletta', amount: 60, status: 'pending', date: daysFromToday(1) });
      await tx(p.client, { description: 'Vecchia', amount: 30, status: 'pending', date: daysFromToday(-3) });
      ok(await p.client.post('/notifications/refresh'));
    }
    const titles = async (p) => ok(await p.client.get('/notifications')).items.map((n) => n.title);
    assert.ok((await titles(it)).includes('Bolletta scade domani'), (await titles(it)).join(' | '));
    assert.ok((await titles(it)).includes('Vecchia è in ritardo'));
    assert.ok((await titles(en)).includes('Bolletta is due tomorrow'), (await titles(en)).join(' | '));
    assert.ok((await titles(en)).includes('Vecchia is overdue'));
  });
});

describe('e-mails in the language of the person', () => {
  const mails = () => fs.readdirSync(srv.mailDir).filter((f) => f.endsWith('.txt')).map((f) => fs.readFileSync(`${srv.mailDir}/${f}`, 'utf8'));
  const mailTo = (email) => mails().find((m) => m.includes(`To: ${email}`));

  it('the confirmation link is asked for in Italian and arrives in Italian', async () => {
    const p = await signup(srv);
    ok(await p.client.post('/auth/email/send-verification', {}, IT));
    const mail = mailTo(p.user.email);
    assert.match(mail, /Subject: Conferma il tuo indirizzo email/);
    assert.match(mail, /Ciao /);
    assert.ok(!/Confirm your e-mail address/.test(mail));
  });

  it('and in English when nothing says otherwise', async () => {
    const p = await signup(srv);
    ok(await p.client.post('/auth/email/send-verification'));
    assert.match(mailTo(p.user.email), /Subject: Confirm your e-mail address/);
  });

  it('the page of an e-mail has the language of the e-mail', async () => {
    const p = await signup(srv);
    ok(await p.client.post('/auth/email/send-verification', {}, IT));
    const html = fs.readdirSync(srv.mailDir).filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(`${srv.mailDir}/${f}`, 'utf8')).find((h) => h.includes('Conferma'));
    assert.ok(html && /Il pulsante non funziona/.test(html) && /Ricevi questa email/.test(html) || /Questo è un messaggio una tantum/.test(html), 'the footer and the helper line are Italian');
  });
});
