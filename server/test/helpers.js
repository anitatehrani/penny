import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { addDays, todayYMD } from '../src/lib/dates.js';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Tests never touch the real database: each test file gets its own throw-away one on the same Postgres.
const PG_BASE = process.env.TEST_PG_URL || 'postgres://budget@127.0.0.1:5433';

pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);

export const PW = 'Tr1cky-Horse!Battery';
export const today = () => todayYMD();
export const daysFromToday = (n) => addDays(todayYMD(), n);
export const thisMonth = () => todayYMD().slice(0, 7);

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

/** Boot the real server against a fresh, empty database. */
export async function startServer(name, env = {}) {
  const dbName = `budget_test_${name}_${process.pid}`;
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const dbUrl = `${PG_BASE}/${dbName}`;
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PORT: String(port),
      GOOGLE_CLIENT_ID: '',
      COOKIE_SECURE: 'false',
      ALERT_SCAN_MINUTES: 'off', // tests trigger scans themselves so counts are exact
      SMTP_HOST: '', // preview mode unless a test provides a fake SMTP server
      MAIL_PREVIEW_DIR: path.join(SERVER_DIR, `test-mail-${dbName}`),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((resolve) => child.on('exit', resolve));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    if (Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }

  const db = new pg.Pool({ connectionString: dbUrl, max: 4 });
  return {
    base,
    mailDir: path.join(SERVER_DIR, `test-mail-${dbName}`),
    dbUrl,
    db,
    log: () => log,
    /** No uncaught server-side errors should ever be logged by a test run. */
    assertNoServerErrors() {
      assert.ok(!/Error|error:/.test(log.replace(/Penny listening.*/g, '')), `server logged errors:\n${log}`);
    },
    async stop() {
      child.kill();
      await exited;
      await db.end();
      fs.rmSync(path.join(SERVER_DIR, `test-mail-${dbName}`), { recursive: true, force: true });
      const a = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Stop servers (always), then fail if any of them logged an unexpected error while the tests ran. */
export async function shutdown(...servers) {
  const logs = servers.map((s) => s.log());
  await Promise.allSettled(servers.map((s) => s.stop()));
  for (const log of logs) {
    assert.ok(!/Error|error:/.test(log.replace(/Penny listening.*/g, '')), `server logged errors:\n${log}`);
  }
}

/** A browser-like HTTP client with a cookie jar and an optional active workspace. */
export class Client {
  constructor(root) {
    this.root = root; // http://127.0.0.1:port
    this.base = `${root}/api`;
    this.jar = {};
    this.ws = null;
    this.lastSetCookie = [];
  }

  async raw(method, url, { body, headers = {}, rawBody } = {}) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const h = { ...(cookie ? { cookie } : {}), ...(this.ws ? { 'x-workspace': String(this.ws) } : {}), ...headers };
    if (body !== undefined && !('content-type' in h)) h['content-type'] = 'application/json';
    const res = await fetch(this.base + url, {
      method,
      headers: h,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie?.() ?? [];
    this.lastSetCookie = set;
    for (const sc of set) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      if (/Max-Age=0/i.test(sc)) delete this.jar[name];
      else this.jar[name] = pair.slice(i + 1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers, text, buf };
  }

  /** Fetch a non-API page (the built web app) with the same cookies. */
  async page(url, headers = {}) {
    const res = await fetch(this.root + url, { headers, redirect: 'manual' });
    return { status: res.status, headers: res.headers, text: await res.text() };
  }

  call(method, url, body, headers) {
    return this.raw(method, url, { body, headers });
  }
  get(url, headers) {
    return this.raw('GET', url, { headers });
  }
  post(url, body, headers) {
    return this.raw('POST', url, { body: body ?? {}, headers });
  }
  put(url, body, headers) {
    return this.raw('PUT', url, { body, headers });
  }
  patch(url, body, headers) {
    return this.raw('PATCH', url, { body, headers });
  }
  del(url, headers) {
    return this.raw('DELETE', url, { headers });
  }
  /** Run a callback with another workspace selected, then restore. */
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

/** Assert a status and return the JSON body. */
export function ok(r, status = 200) {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`);
  return r.json;
}
export function fails(r, status) {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`);
  assert.ok(typeof r.json?.error === 'string' || r.status === 204, 'error responses carry a message');
  return r.json;
}

let counter = 0;
export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`.slice(-9);

/** Create an account through the API. Usernames/emails are unique per call. */
export async function signup(srv, over = {}) {
  const n = uid();
  const body = {
    name: over.name ?? `Test ${n}`,
    email: over.email ?? `t${n}@example.com`,
    username: over.username ?? `u${n}`,
    password: over.password ?? PW,
    ...(over.phone !== undefined ? { phone: over.phone } : {}),
  };
  const client = new Client(srv.base);
  const r = await client.post('/auth/signup', body);
  ok(r, 201);
  return { client, user: r.json.user, body };
}

/** A logged-in client for a user created directly in the database (e.g. Google-only accounts). */
export async function sessionFor(srv, userId) {
  const token = randomBytes(24).toString('base64url');
  await srv.db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
    createHash('sha256').update(token).digest('hex'),
    userId,
  ]);
  const c = new Client(srv.base);
  c.jar.sid = token;
  return c;
}

/** Make two people connected (a requests, b accepts). */
export async function connect(a, b, relation = 'friend') {
  const r = await a.client.post('/connections', { username: b.user.username, relation });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  if (r.json.status === 'connected') return;
  const list = ok(await b.client.get('/connections'));
  const req = list.incoming.find((c) => c.user.username === a.user.username);
  ok(await b.client.post(`/connections/${req.id}/accept`, { relation }));
}

export const personalId = async (client) => ok(await client.get('/workspaces')).find((w) => w.kind === 'personal').id;

export async function categoryId(client, name) {
  return ok(await client.get('/categories')).find((c) => c.name === name).id;
}

export function tx(client, over = {}) {
  return client.post('/transactions', { type: 'expense', description: 'Test payment', amount: 10, date: today(), ...over });
}

// ---------------------------------------------------------------------------------------------
// Files and mail for the upload / notification tests
// ---------------------------------------------------------------------------------------------
const b64 = (s) => Buffer.from(s, 'base64');
/** Tiny but real files. The server only trusts the leading bytes, so these are enough to exercise it. */
export const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
export const JPEG = b64('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=');
export const WEBP = b64('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
export const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
export const padTo = (buf, size) => Buffer.concat([buf, Buffer.alloc(Math.max(0, size - buf.length), 0x20)]);

export const upload = (client, method, url, buf, type, headers = {}) => client.raw(method, url, { rawBody: buf, headers: { 'content-type': type, ...headers } });

/** A small SMTP server that records every message it is given (for testing real e-mail delivery). */
export async function startFakeSmtp() {
  const { SMTPServer } = await import('smtp-server');
  const { simpleParser } = await import('mailparser');
  const messages = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((m) => {
          // raw header lines, with folded continuation lines joined (mailparser groups List-* headers, so assert on these)
          messages.push({ to: m.to?.text, subject: m.subject, text: m.text, html: m.html, headerLines: m.headerLines.map((l) => l.line.replace(/\r?\n\s+/g, ' ')) });
          callback();
        })
        .catch(callback);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.server.address().port;
  return {
    port,
    messages,
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true', MAIL_FROM: 'Penny <alerts@test.local>' },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Wait until `fn()` returns something truthy (or throw after `ms`). */
export async function eventually(fn, { ms = 8000, every = 100, what = 'condition' } = {}) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Mark an account's address as confirmed without going through the e-mail link. */
export const verifyEmail = (srv, userId) => srv.db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);

/** The date (YYYY-MM-DD) it currently is in a time zone. */
export const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** The value of a header of a received message (matched case-insensitively). */
export const headerOf = (message, name) => message.headerLines.find((l) => l.toLowerCase().startsWith(name.toLowerCase() + ':'))?.slice(name.length + 1).trim();
