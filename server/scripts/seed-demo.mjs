/**
 * Fills the running app with a realistic demo: one main account with months of history, recurring items,
 * installments, split payments, connections, shared budgets and pending invitations, plus the other people
 * involved (so you can also log in as them and see the other side).
 *
 *   npm run seed:demo            (the server must be running; default http://localhost:3001)
 *
 * Safe to run again: it first removes the demo accounts (and everything they own), then recreates them.
 * It only ever touches the accounts listed below, never anyone else's data.
 */
import 'dotenv/config';
import pg from 'pg';
import { deflateSync } from 'node:zlib';

const API = `${process.env.API_URL || 'http://localhost:3001'}/api`;
const PASSWORD = 'Budget-Showcase#2026';

const PEOPLE = {
  alex: { name: 'Alex Morgan', email: 'alex.morgan@example.com', username: 'alex', phone: '+1 415 555 0101' },
  sam: { name: 'Sam Rivera', email: 'sam.rivera@example.com', username: 'sam', phone: '+1 415 555 0102' },
  jordan: { name: 'Jordan Morgan', email: 'jordan.morgan@example.com', username: 'jordan', phone: '+1 415 555 0103' },
  priya: { name: 'Priya Nair', email: 'priya.nair@example.com', username: 'priya', phone: '+1 415 555 0104' },
  chris: { name: 'Chris Walker', email: 'chris.walker@example.com', username: 'chris', phone: '+1 415 555 0105' },
  dana: { name: 'Dana Lee', email: 'dana.lee@example.com', username: 'dana', phone: '+1 415 555 0106' },
};

// ---------- tiny HTTP client ----------
class Client {
  jar = {};
  ws = null;
  async call(method, url, body) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(API + url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(this.ws ? { 'x-workspace': String(this.ws) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (/Max-Age=0/i.test(sc)) delete this.jar[pair.slice(0, i)];
      else this.jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  get = (u) => this.call('GET', u);
  post = (u, b = {}) => this.call('POST', u, b);
  put = (u, b) => this.call('PUT', u, b);
  patch = (u, b) => this.call('PATCH', u, b);
  del = (u) => this.call('DELETE', u);
  /** Send a file as the raw request body (profile pictures, receipts). */
  async upload(method, url, buf, type, filename) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(API + url, {
      method,
      headers: { 'content-type': type, ...(filename ? { 'x-filename': encodeURIComponent(filename) } : {}), ...(cookie ? { cookie } : {}), ...(this.ws ? { 'x-workspace': String(this.ws) } : {}) },
      body: buf,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  async inWorkspace(id, fn) {
    const prev = this.ws;
    this.ws = id;
    try {
      return await fn();
    } finally {
      this.ws = prev;
    }
  }
}

// ---------- dates & deterministic "randomness" ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const monthDate = (offset, day) => {
  const t = new Date();
  const last = new Date(t.getFullYear(), t.getMonth() + offset + 1, 0).getDate();
  return iso(new Date(t.getFullYear(), t.getMonth() + offset, Math.min(day, last)));
};
const ym = (offset) => monthDate(offset, 1).slice(0, 7);
let seed = 20261002;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const around = (base, pct = 0.15) => Math.round(base * (1 + (rnd() * 2 - 1) * pct) * 100) / 100;

// ---------- 0. start clean ----------
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget' });
await db.query('DELETE FROM users WHERE email = ANY($1)', [Object.values(PEOPLE).map((p) => p.email)]);
await db.query(`DELETE FROM workspaces WHERE kind = 'group' AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspaces.id)`);
await db.end();

// ---------- 1. accounts ----------
const who = {};
for (const [key, p] of Object.entries(PEOPLE)) {
  const c = new Client();
  await c.post('/auth/signup', { ...p, password: PASSWORD });
  who[key] = c;
}
const { alex, sam, jordan, priya, chris, dana } = who;

// ---------- 2. people ----------
const connect = async (from, to, relation, accept = true) => {
  await from.post('/connections', { username: PEOPLE[to].username, relation });
  if (!accept) return;
  const toClient = who[to];
  const incoming = (await toClient.get('/connections')).incoming.find((c) => c.user.username === PEOPLE[Object.keys(who).find((k) => who[k] === from)].username);
  await toClient.post(`/connections/${incoming.id}/accept`, { relation });
};
await connect(alex, 'sam', 'partner');
await connect(jordan, 'alex', 'family');
await connect(alex, 'priya', 'friend');
await connect(sam, 'priya', 'friend');
await connect(chris, 'alex', 'friend', false); // waiting for Alex to answer
await connect(alex, 'dana', 'friend', false); // Alex is waiting for Dana

// ---------- helpers for budgets ----------
const catId = async (c, name) => (await c.get('/categories')).find((x) => x.name === name)?.id ?? null;
const addTx = (c, o) => c.post('/transactions', { type: 'expense', status: 'paid', ...o });
const addRule = (c, o) => c.post('/recurring', { type: 'expense', frequency: 'monthly', interval_count: 1, ...o });
const settle = async (c, month) => {
  // Anything that was already due earlier this month has, realistically, been paid.
  const t = dayOffset(0);
  for (const x of await c.get(`/transactions?month=${month}&status=pending&limit=500`)) {
    if (x.date < t && x.source !== 'manual') await c.patch(`/transactions/${x.id}/status`, { status: 'paid' });
  }
};

// =========================================================================================
// 3. Alex — personal budget
// =========================================================================================
await alex.put('/settings', { opening_balance: 400, currency: 'EUR' });
const A = {};
for (const n of ['Salary', 'Freelance', 'Rent / Mortgage', 'Utilities', 'Groceries', 'Transport', 'Subscriptions', 'Installments & loans', 'Birthdays & gifts', 'Health', 'Dining & leisure', 'Other', 'Gifts received']) A[n] = await catId(alex, n);
const pets = await alex.post('/categories', { name: 'Pets', kind: 'expense', color: '#c2410c' });
const travel = await alex.post('/categories', { name: 'Travel', kind: 'expense', color: '#0ea5e9' });

// six months of history, entered as already-paid payments
for (let m = -6; m <= -1; m++) {
  await addTx(alex, { type: 'income', description: 'Salary', amount: 3100, date: monthDate(m, 28), category_id: A.Salary });
  if ([-5, -3, -1].includes(m)) await addTx(alex, { type: 'income', description: 'Freelance project', amount: around(480, 0.25), date: monthDate(m, 15), category_id: A.Freelance });
  await addTx(alex, { description: 'Rent', amount: 1450, date: monthDate(m, 1), category_id: A['Rent / Mortgage'] });
  await addTx(alex, { description: 'Electricity & gas', amount: around(118, 0.2), date: monthDate(m, 8), category_id: A.Utilities });
  await addTx(alex, { description: 'Internet', amount: 39.9, date: monthDate(m, 10), category_id: A.Utilities });
  await addTx(alex, { description: 'Netflix', amount: 13.99, date: monthDate(m, 9), category_id: A.Subscriptions });
  await addTx(alex, { description: 'Spotify', amount: 10.99, date: monthDate(m, 9), category_id: A.Subscriptions });
  await addTx(alex, { description: 'Gym', amount: 39, date: monthDate(m, 3), category_id: A.Health });
  await addTx(alex, { description: 'Phone plan', amount: 25, date: monthDate(m, 12), category_id: A.Utilities });
  for (const d of [3, 8, 13, 19, 25]) await addTx(alex, { description: d % 2 ? 'Supermarket' : 'Farmers market', amount: around(98, 0.3), date: monthDate(m, d), category_id: A.Groceries });
  for (const d of [6, 20]) await addTx(alex, { description: 'Metro pass & taxis', amount: around(62, 0.3), date: monthDate(m, d), category_id: A.Transport });
  for (const [d, what] of [[5, 'Dinner out'], [14, 'Brunch'], [22, 'Cinema & drinks']]) await addTx(alex, { description: what, amount: around(58, 0.4), date: monthDate(m, d), category_id: A['Dining & leisure'] });
  await addTx(alex, { description: 'Online shopping', amount: around(95, 0.5), date: monthDate(m, 17), category_id: A.Other });
  await addTx(alex, { description: 'Vet & pet food', amount: around(48, 0.3), date: monthDate(m, 11), category_id: pets.id });
}
await addTx(alex, { description: 'Flight to Berlin', amount: 189, date: monthDate(-4, 14), category_id: travel.id });
await addTx(alex, { description: 'Hotel in Berlin', amount: 260, date: monthDate(-4, 15), category_id: travel.id });
await addTx(alex, { description: 'Car repair', amount: 420, date: monthDate(-2, 9), category_id: A.Transport });
await addTx(alex, { description: 'Dentist check-up', amount: 85, date: monthDate(-5, 18), category_id: A.Health });
await addTx(alex, { type: 'income', description: 'Birthday money from Grandma', amount: 100, date: monthDate(-3, 4), category_id: A['Gifts received'] });
await addTx(alex, { description: "Mum's birthday gift", amount: 75, date: monthDate(-2, 21), category_id: A['Birthdays & gifts'] });

// recurring commitments
await addRule(alex, { type: 'income', description: 'Salary', amount: 3100, start_date: monthDate(0, 28), category_id: A.Salary });
await addRule(alex, { description: 'Rent', amount: 1450, start_date: monthDate(0, 1), category_id: A['Rent / Mortgage'] });
await addRule(alex, { description: 'Internet', amount: 39.9, start_date: monthDate(0, 10), category_id: A.Utilities });
await addRule(alex, { description: 'Phone plan', amount: 25, start_date: monthDate(0, 12), category_id: A.Utilities });
await addRule(alex, { description: 'Netflix', amount: 13.99, start_date: monthDate(0, 9), category_id: A.Subscriptions });
await addRule(alex, { description: 'Spotify', amount: 10.99, start_date: monthDate(0, 9), category_id: A.Subscriptions });
await addRule(alex, { description: 'Gym', amount: 39, start_date: monthDate(0, 3), category_id: A.Health });
await addRule(alex, { description: 'Car insurance', amount: 310, interval_count: 3, start_date: monthDate(1, 20), category_id: A.Transport, note: 'Paid every quarter' });
await addRule(alex, { description: 'Yoga class', amount: 18, frequency: 'weekly', interval_count: 2, start_date: dayOffset(3), category_id: A.Health });
await addRule(alex, { description: "Mum's birthday gift", amount: 80, frequency: 'yearly', start_date: monthDate(2, 21), category_id: A['Birthdays & gifts'] });
await addRule(alex, { description: "Sam's birthday", amount: 120, frequency: 'yearly', start_date: monthDate(5, 9), category_id: A['Birthdays & gifts'] });
await addRule(alex, { type: 'income', description: 'Freelance retainer', amount: 300, start_date: monthDate(1, 15), end_date: monthDate(6, 15), category_id: A.Freelance, note: 'Contract ends in six months' });
await addRule(alex, { description: 'Old magazine subscription', amount: 9.5, start_date: monthDate(0, 18), category_id: A.Subscriptions, active: false });

// installments
await alex.post('/installments', { description: 'Laptop', installment_amount: 125, installment_count: 10, first_due_date: monthDate(-3, 15), paid_count: 3, category_id: A['Installments & loans'] });
await alex.post('/installments', { description: 'Sofa', total_amount: 900, installment_count: 6, first_due_date: monthDate(-2, 5), paid_count: 2, category_id: A['Installments & loans'] });
await alex.post('/installments', { description: 'Dental treatment', total_amount: 1800, installment_count: 6, first_due_date: monthDate(1, 10), category_id: A.Health });
await alex.post('/installments', { description: 'Summer trip deposit', installment_amount: 200, installment_count: 4, first_due_date: monthDate(-5, 25), paid_count: 4, category_id: travel.id });

// this month: bills already paid, one overdue, a few coming up, one big future expense
await settle(alex, ym(0));
await addTx(alex, { description: 'Electricity & gas', amount: 124.3, date: dayOffset(-4), status: 'pending', category_id: A.Utilities, note: 'Reminder came by email' });
await addTx(alex, { description: 'Supermarket', amount: 87.2, date: dayOffset(-2), category_id: A.Groceries });
await addTx(alex, { description: 'Pharmacy', amount: 23.4, date: dayOffset(-1), category_id: A.Health });
await addTx(alex, { description: 'Dentist check-up', amount: 85, date: dayOffset(5), status: 'pending', category_id: A.Health });
await addTx(alex, { description: 'Concert tickets', amount: 120, date: dayOffset(9), status: 'pending', category_id: A['Dining & leisure'] });
await addTx(alex, { description: 'Car service', amount: 240, date: dayOffset(11), status: 'pending', category_id: A.Transport });
await addTx(alex, { description: 'Summer holiday', amount: 2600, date: monthDate(4, 10), status: 'pending', category_id: travel.id, note: 'Flights + apartment' });
await addTx(alex, { type: 'income', description: 'Tax refund', amount: 650, date: monthDate(2, 12), status: 'pending', category_id: A.Other });
// skip one recurring occurrence (travelling next month)
const gymNext = (await alex.get(`/transactions?month=${ym(1)}&status=pending`)).find((t) => t.description === 'Gym');
if (gymNext) await alex.del(`/transactions/${gymNext.id}`);

// payments shared with other people (split)
await addTx(alex, { description: 'Dinner with Sam & Priya', amount: 96, date: dayOffset(-6), category_id: A['Dining & leisure'], participants: [{ username: 'sam', share: 32 }, { username: 'priya', share: 32 }] });
await addTx(alex, { description: 'Weekend cabin', amount: 240, date: dayOffset(-12), category_id: travel.id, participants: [{ username: 'sam', share: 120 }] });
await addTx(alex, { description: "Mum's birthday cake & flowers", amount: 70, date: dayOffset(-9), category_id: A['Birthdays & gifts'], participants: [{ username: 'jordan', share: 35 }] });
await addTx(alex, { description: 'Group present for Priya', amount: 60, date: dayOffset(7), status: 'pending', category_id: A['Birthdays & gifts'], participants: [{ username: 'sam', share: 20 }, { username: 'jordan', share: 20 }] });

// and payments other people shared with Alex
const shared = async (c, o, extra) => c.post('/transactions', { type: 'expense', status: 'paid', ...o, participants: [{ username: 'alex', share: extra }] });
const pizza = await shared(sam, { description: 'Pizza night', amount: 48, date: dayOffset(-3) }, 16);
await shared(sam, { description: 'Festival tickets', amount: 150, date: dayOffset(-8) }, 75);
await shared(priya, { description: 'Birthday dinner at Luigi\'s', amount: 120, date: dayOffset(-5) }, 30);
await shared(jordan, { description: 'Present for Mum', amount: 90, date: dayOffset(-10) }, 45);
await alex.post(`/shared/${pizza.id}/import`, {}); // Alex already added this one to his budget

// =========================================================================================
// 4. "Home" — Alex and Sam pool their money
// =========================================================================================
const home = await alex.post('/workspaces', { name: 'Home' });
await alex.post(`/workspaces/${home.id}/invites`, { username: 'sam' });
const homeInvite = (await sam.get('/inbox')).group_invites.find((i) => i.workspace.id === home.id);
await sam.post(`/workspace-invites/${homeInvite.id}/accept`);

await alex.inWorkspace(home.id, async () => {
  await alex.put('/settings', { opening_balance: 2200, currency: 'EUR' });
  const H = {};
  for (const n of ['Salary', 'Rent / Mortgage', 'Utilities', 'Groceries', 'Subscriptions', 'Installments & loans', 'Dining & leisure', 'Transport', 'Health']) H[n] = await catId(alex, n);
  const reno = await alex.post('/categories', { name: 'Home improvements', kind: 'expense', color: '#7c3aed' });
  for (let m = -3; m <= -1; m++) {
    await addTx(alex, { type: 'income', description: 'Alex salary', amount: 3100, date: monthDate(m, 28), category_id: H.Salary, paid_by: 'alex' });
    await addTx(alex, { type: 'income', description: 'Sam salary', amount: 2900, date: monthDate(m, 27), category_id: H.Salary, paid_by: 'sam' });
    await addTx(alex, { description: 'Rent', amount: 1850, date: monthDate(m, 1), category_id: H['Rent / Mortgage'], paid_by: 'sam' });
    await addTx(alex, { description: 'Electricity & water', amount: around(165, 0.15), date: monthDate(m, 7), category_id: H.Utilities, paid_by: 'alex' });
    await addTx(alex, { description: 'Internet & TV', amount: 64.9, date: monthDate(m, 10), category_id: H.Utilities, paid_by: 'sam' });
    for (const [d, who2] of [[4, 'alex'], [11, 'sam'], [18, 'alex'], [25, 'sam']]) await addTx(alex, { description: 'Weekly groceries', amount: around(142, 0.25), date: monthDate(m, d), category_id: H.Groceries, paid_by: who2 });
    await addTx(alex, { description: 'Dinner out together', amount: around(86, 0.4), date: monthDate(m, 16), category_id: H['Dining & leisure'], paid_by: m % 2 ? 'sam' : 'alex' });
    await addTx(alex, { description: 'Streaming & music', amount: 24.98, date: monthDate(m, 9), category_id: H.Subscriptions, paid_by: 'sam' });
  }
  await addTx(alex, { description: 'New bookshelf', amount: 329, date: monthDate(-2, 14), category_id: reno.id, paid_by: 'alex' });
  await addRule(alex, { type: 'income', description: 'Alex salary', amount: 3100, start_date: monthDate(0, 28), category_id: H.Salary, paid_by: 'alex' });
  await addRule(alex, { type: 'income', description: 'Sam salary', amount: 2900, start_date: monthDate(0, 27), category_id: H.Salary, paid_by: 'sam' });
  await addRule(alex, { description: 'Rent', amount: 1850, start_date: monthDate(0, 1), category_id: H['Rent / Mortgage'], paid_by: 'sam' });
  await addRule(alex, { description: 'Internet & TV', amount: 64.9, start_date: monthDate(0, 10), category_id: H.Utilities, paid_by: 'sam' });
  await addRule(alex, { description: 'Streaming & music', amount: 24.98, start_date: monthDate(0, 9), category_id: H.Subscriptions, paid_by: 'sam' });
  await addRule(alex, { description: 'Home insurance', amount: 420, frequency: 'yearly', start_date: monthDate(3, 5), category_id: H.Utilities, paid_by: 'alex' });
  await alex.post('/installments', { description: 'Washing machine', installment_amount: 75, installment_count: 8, first_due_date: monthDate(-2, 12), paid_count: 3, category_id: H['Installments & loans'], paid_by: 'alex' });
  await settle(alex, ym(0));
  await addTx(alex, { description: 'Electricity & water', amount: 171.4, date: dayOffset(-3), status: 'pending', category_id: H.Utilities, paid_by: 'alex' });
  await addTx(alex, { description: 'Weekly groceries', amount: 138.6, date: dayOffset(-2), category_id: H.Groceries, paid_by: 'sam' });
  await addTx(alex, { description: 'Weekly groceries', amount: 151.2, date: dayOffset(-9), category_id: H.Groceries, paid_by: 'alex' });
  await addTx(alex, { description: 'Plumber visit', amount: 180, date: dayOffset(6), status: 'pending', category_id: reno.id, paid_by: 'sam' });
});

// =========================================================================================
// 5. "Lisbon trip" — Alex and Priya; Jordan has been invited but has not answered
// =========================================================================================
const trip = await alex.post('/workspaces', { name: 'Lisbon trip' });
await alex.post(`/workspaces/${trip.id}/invites`, { username: 'priya' });
await alex.post(`/workspaces/${trip.id}/invites`, { username: 'jordan' });
const tripInvite = (await priya.get('/inbox')).group_invites.find((i) => i.workspace.id === trip.id);
await priya.post(`/workspace-invites/${tripInvite.id}/accept`);
await alex.inWorkspace(trip.id, async () => {
  await alex.put('/settings', { opening_balance: 0, currency: 'EUR' });
  const T = {};
  for (const n of ['Transport', 'Dining & leisure', 'Other']) T[n] = await catId(alex, n);
  const stay = await alex.post('/categories', { name: 'Accommodation', kind: 'expense', color: '#0891b2' });
  await addTx(alex, { type: 'income', description: 'Alex contribution', amount: 600, date: monthDate(-1, 20), category_id: T.Other, paid_by: 'alex' });
  await addTx(alex, { type: 'income', description: 'Priya contribution', amount: 600, date: monthDate(-1, 22), category_id: T.Other, paid_by: 'priya' });
  await addTx(alex, { description: 'Flights', amount: 438, date: monthDate(-1, 24), category_id: T.Transport, paid_by: 'alex' });
  await addTx(alex, { description: 'Apartment (50% deposit)', amount: 360, date: monthDate(-1, 26), category_id: stay.id, paid_by: 'priya' });
  await addTx(alex, { description: 'Apartment (balance)', amount: 360, date: dayOffset(28), status: 'pending', category_id: stay.id, paid_by: 'priya' });
  await addTx(alex, { description: 'Tram & day tickets', amount: 54, date: dayOffset(34), status: 'pending', category_id: T.Transport, paid_by: 'alex' });
  await addTx(alex, { description: 'Pastéis de nata tour', amount: 76, date: dayOffset(35), status: 'pending', category_id: T['Dining & leisure'], paid_by: 'priya' });
});

// =========================================================================================
// 6. Invitations waiting for Alex
// =========================================================================================
const book = await priya.post('/workspaces', { name: 'Book club' });
await priya.post(`/workspaces/${book.id}/invites`, { username: 'alex' });


// =========================================================================================
// 7. Profile pictures, receipts, alert rules, e-mail alerts
// =========================================================================================
// Tiny PNG encoder so the demo needs no image files: fn(x, y) -> [r, g, b]
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const png = (w, h, fn) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 3 + 1) + 1 + x * 3);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
// a round-ish colour gradient "avatar" with a lighter figure in the middle
const avatar = (top, bottom) =>
  png(160, 160, (x, y) => {
    const t = y / 159;
    const [a, b] = [hex(top), hex(bottom)];
    const base = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const head = (x - 80) ** 2 + (y - 62) ** 2 < 28 ** 2;
    const body = (x - 80) ** 2 + (y - 150) ** 2 < 56 ** 2;
    return head || body ? [255, 255, 255] : base;
  });
// a thermal-printer style receipt: grey text lines on white
const receiptImage = (seed) =>
  png(260, 380, (x, y) => {
    if (x < 14 || x > 245 || y < 14) return [255, 255, 255];
    const row = Math.floor((y - 14) / 14);
    const inLine = (y - 14) % 14 < 6;
    const len = 60 + ((row * 37 + seed * 11) % 150);
    return inLine && x - 14 < len && row < 24 ? (row === 0 ? [30, 30, 30] : [120, 120, 120]) : [255, 255, 255];
  });
const invoicePdf = (title) =>
  Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 14 Tf 20 150 Td (${title}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`,
  );

for (const [client, top, bottom] of [
  [alex, '#2a78d6', '#1d3f73'],
  [sam, '#1baf7a', '#0e5a40'],
  [priya, '#eb6834', '#8a2f10'],
  [jordan, '#8b5cf6', '#44267f'],
]) await client.upload('PUT', '/profile/avatar', avatar(top, bottom), 'image/png');

const cabin = (await alex.get('/transactions?q=Weekend%20cabin&status=')).find((t) => t.description === 'Weekend cabin');
const dinner = (await alex.get('/transactions?q=Dinner%20with&status=')).find((t) => t.description.startsWith('Dinner with Sam'));
const dentist = (await alex.get('/transactions?q=Dentist&status=pending')).find((t) => t.description === 'Dentist check-up');
await alex.upload('POST', `/transactions/${cabin.id}/receipts`, receiptImage(1), 'image/png', 'cabin-booking.png');
await alex.upload('POST', `/transactions/${cabin.id}/receipts`, invoicePdf('Weekend cabin - invoice'), 'application/pdf', 'cabin-invoice.pdf');
await alex.upload('POST', `/transactions/${dinner.id}/receipts`, receiptImage(2), 'image/png', 'restaurant-bill.png');
await alex.upload('POST', `/transactions/${dentist.id}/receipts`, invoicePdf('Dentist - treatment quote'), 'application/pdf', 'dentist-quote.pdf');

// alert rules: a recurring item, a category, and single payments
const rules = await alex.get('/recurring');
const gymRule = rules.find((r) => r.description === 'Gym');
await alex.put(`/alerts/recurring/${gymRule.id}`, { mode: 'on', days: 1 });
await alex.put(`/alerts/category/${A.Subscriptions}`, { mode: 'off' });
const holiday = (await alex.get('/transactions?q=Summer%20holiday&status=pending')).find((t) => t.description === 'Summer holiday');
await alex.put(`/alerts/transaction/${holiday.id}`, { mode: 'on', days: 30 });
const concert = (await alex.get('/transactions?q=Concert&status=pending')).find((t) => t.description === 'Concert tickets');
await alex.put(`/alerts/transaction/${concert.id}`, { mode: 'off' });

// Alex confirms the e-mail address and turns on a daily summary (no mail server here, so mail goes to server/mail-preview)
const db2 = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget' });
await db2.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [PEOPLE.alex.email]);
await db2.end();
await alex.put('/notifications/settings', { email_enabled: true, email_frequency: 'daily', email_hour: 8, timezone: 'Europe/Berlin', lead_days: 3, weekly_summary: true, monthly_summary: true, weekly_day: 1 });
for (const c of [alex, sam, priya, jordan]) await c.post('/notifications/refresh');
const notes = await alex.get('/notifications?limit=100');

// ---------- report ----------
const me = await alex.get('/summary');
const fc = await alex.get('/forecast?months=12&past=3');
const inbox = await alex.get('/inbox');
const spaces = await alex.get('/workspaces');
const homeFc = await alex.inWorkspace(home.id, () => alex.get('/forecast?months=12&past=3'));
console.log('\nDemo data ready.\n');
console.log('Sign in at http://localhost:3001 with:');
console.log(`  main account : ${PEOPLE.alex.email} `);
console.log(`  password     : ${PASSWORD}`);
console.log('  other people (same password): ' + ['sam', 'jordan', 'priya', 'chris', 'dana'].map((k) => PEOPLE[k].email).join(', '));
console.log(`\nAlex: balance ${me.balance} EUR, ${me.overdue.count} overdue, ${me.upcoming.length} due in 14 days, ${spaces.length} budgets, inbox: ${inbox.connection_requests.length} request(s) + ${inbox.group_invites.length} invitation(s) + ${inbox.shared_waiting} shared payment(s)`);
console.log(`Personal forecast: lowest ${fc.insights.lowest.balance} in ${fc.insights.lowest.month}; ` + (fc.insights.firstNegativeMonth ? `goes negative in ${fc.insights.firstNegativeMonth.month}` : 'never negative'));
console.log(`Notifications: ${notes.items.length} for Alex (unread, so the bell has a badge); receipts on 3 payments; alert rules on a recurring item, a category and 2 payments; e-mail summary on (saved to server/mail-preview).`);
console.log(`Home forecast: lowest ${homeFc.insights.lowest.balance} in ${homeFc.insights.lowest.month}`);
