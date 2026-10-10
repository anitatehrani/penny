/* Browser end-to-end checks for AI answers in the assistant (docs/DESIGN.md section 42).
 *
 *   cd e2e && npm install && npm run ai
 *
 * It starts a PRETEND OpenRouter on this computer and the real server on a throw-away database, with a made-up key, signs a new person up and
 * drives a real headless Chrome/Edge through the assistant: the card that asks first, typing a question before and after saying yes, a button,
 * the service failing, turning it off in Settings, a phone and the dark theme. Nothing reaches the real service; the key is invented.
 * Needs the built client (npm run build) and Postgres. Set CHROME_PATH if Chrome is not in its usual place.
 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pg = require('pg');

const ROOT = path.join(__dirname, '..');
const PG_BASE = process.env.TEST_PG_URL || 'postgres://budget@127.0.0.1:5433';
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'penny-ai-shots');
const KEY = 'sk-or-v1-test-key-not-real-0000000000';

let passed = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`);
  }
}
const eq = (a, b, what = '') => {
  if (a !== b) throw new Error(`${what} expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`);
};
const truthy = (v, what) => {
  if (!v) throw new Error(`expected ${what}`);
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

(async () => {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH');
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-ai-'));

  // the pretend OpenRouter
  const calls = [];
  let next = () => ({ status: 200, body: { model: 'pretend/model:free', choices: [{ message: { content: 'You have spent 54.50 on groceries so far this month.' } }] } });
  const router = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      calls.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
      const r = next();
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((resolve) => router.listen(0, '127.0.0.1', resolve));

  // a throw-away database and the real server on it
  const dbName = `penny_e2e_ai_${process.pid}`;
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const port = await freePort();
  const BASE = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env,
      DATABASE_URL: `${PG_BASE}/${dbName}`,
      PORT: String(port),
      COOKIE_SECURE: 'false',
      ALERT_SCAN_MINUTES: 'off',
      BACKUPS: 'off',
      SMTP_HOST: '',
      MAIL_PREVIEW_DIR: path.join(dir, 'mail'),
      OPENROUTER_API_KEY: KEY,
      OPENROUTER_BASE_URL: `http://127.0.0.1:${router.address().port}/api/v1`,
      AI_DATA_COLLECTION: '',
      AI_DAILY_LIMIT: '0',
      AI_PERSON_DAILY_LIMIT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }

  // a person with a few payments
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ada Assistant', email: `ai${Date.now()}@example.com`, username: `ai${Date.now() % 1e7}`, password: 'Tr1cky-Horse!Battery', accept_terms: true }),
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
  const sid = /sid=([^;]+)/.exec(signup.headers.getSetCookie().join(';'))[1];
  const api = (p, init = {}) => fetch(`${BASE}/api${p}`, { ...init, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((r) => r.json());
  await api('/settings', { method: 'PUT', body: JSON.stringify({ opening_balance: 1000, currency: 'EUR' }) });
  const cats = await api('/categories');
  const food = cats.find((c) => c.name === 'Groceries').id;
  const day = new Date().toISOString().slice(0, 10);
  for (const [description, amount] of [['Corner supermarket', 42.5], ['Bakery', 12]]) {
    await api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', description, amount, date: day, status: 'paid', category_id: food }) });
  }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function open(url, { width = 1280, height = 900, theme = 'light' } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setCookie({ name: 'sid', value: sid, url: BASE });
    await page.evaluateOnNewDocument((t) => {
      try {
        localStorage.setItem('theme', t);
      } catch {
        /* ignore */
      }
    }, theme);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
    return page;
  }
  const text = (page, sel = 'body') => page.$eval(sel, (e) => e.textContent);
  const clickText = async (page, re, scope = 'button') => {
    const ok = await page.evaluate(
      (src, flags, sc) => {
        const rx = new RegExp(src, flags);
        const el = [...document.querySelectorAll(sc)].find((b) => rx.test(b.innerText || b.textContent) && !b.disabled);
        if (!el) return false;
        el.click();
        return true;
      },
      re.source,
      re.flags,
      scope,
    );
    if (!ok) throw new Error(`no button matching ${re}`);
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const openAssistant = async (page) => {
    await page.click('.ask-btn');
    await page.waitForSelector('.sheet [aria-label="Ask about your finances"]');
  };
  const typeAndSend = async (page, question) => {
    await page.type('.ask-form input', question);
    await page.keyboard.press('Enter');
  };
  const lastAnswer = (page) => page.evaluate(() => [...document.querySelectorAll('.chat-a:not(.pending)')].at(-1)?.textContent ?? '');
  const waitAnswers = (page, n) => page.waitForFunction((k) => document.querySelectorAll('.chat-a:not(.pending)').length >= k, { timeout: 15000 }, n);

  console.log('AI answers in the assistant');
  const page = await open('/dashboard');

  await check('before saying yes: the old promise, a card that asks first, and typing sends nothing', async () => {
    await openAssistant(page);
    truthy(/Nothing is sent to an outside AI service/.test(await text(page, '.sheet-head')), 'the old subtitle');
    truthy(/Smarter answers \(optional\)/.test(await text(page, '.sheet-body')), 'the card on the overview');
    await clickText(page, /^Conversation/);
    truthy(/Smarter answers \(optional\)/.test(await text(page, '.sheet-body')), 'the card on the empty conversation');
    const card = await text(page, '.ai-card');
    truthy(/OpenRouter/.test(card) && /make mistakes/.test(card) && /turn this off at any time/.test(card), 'what is sent, the warning and the way out');
    truthy(!/\b(LLM|API|token|model)\b/i.test(card), 'no jargon on the card');
    await shot(page, '1-card');
    await typeAndSend(page, 'What did I buy at the corner supermarket?');
    await waitAnswers(page, 1);
    truthy(/can.t answer that yet/.test(await lastAnswer(page)), 'the built-in answer');
    eq(calls.length, 0, 'calls to the AI service');
    truthy(!/Written by an AI/.test(await text(page, '.sheet-body')), 'no AI label');
  });

  await check('turning it on changes the card and the subtitle', async () => {
    await page.click('.chat-turn');
    await page.evaluate(() => document.querySelector('.assistant-tabs button.nc-link')?.click()); // Clear
    await clickText(page, /Turn on AI answers/);
    await page.waitForFunction(() => /AI answers are on/.test(document.querySelector('.ai-card')?.textContent ?? ''));
    truthy(/go to an AI service you turned on/.test(await text(page, '.sheet-head')), 'the new subtitle');
    truthy(/Turn off AI answers/.test(await text(page, '.ai-card')), 'the way back');
    const saved = await api('/assistant/ai');
    eq(saved.ready, true, 'ready on the server');
  });

  await check('a typed question is answered by the service, labelled, and the summary holds the budget but not the person', async () => {
    await page.waitForSelector('.ask-form input');
    await typeAndSend(page, 'What did I buy at the corner supermarket?');
    await waitAnswers(page, 1);
    eq(calls.length, 1, 'calls to the AI service');
    truthy(/54\.50 on groceries/.test(await lastAnswer(page)), 'the answer text');
    truthy(/Written by an AI service/.test(await lastAnswer(page)), 'the label');
    const sent = JSON.stringify(calls[0].body);
    truthy(/Corner supermarket/.test(sent) && /Groceries/.test(sent), 'the budget in the summary');
    truthy(!sent.includes('Ada') && !/@example\.com/.test(sent), 'no name or e-mail');
    eq(calls[0].headers.authorization, `Bearer ${KEY}`, 'authorization');
    await shot(page, '2-ai-answer');
  });

  await check('a button is still answered here, without the service', async () => {
    await clickText(page, /^Give me a summary$/, '.chip');
    await waitAnswers(page, 2);
    eq(calls.length, 1, 'calls to the AI service');
    truthy(!/Written by an AI/.test(await lastAnswer(page)), 'no AI label on a button answer');
  });

  await check('a follow-up question carries the conversation', async () => {
    await typeAndSend(page, 'And what about last month?');
    await waitAnswers(page, 3);
    eq(calls.length, 2, 'calls to the AI service');
    const roles = calls[1].body.messages.map((m) => m.role).join(',');
    eq(roles, 'system,user,assistant,user,assistant,user', 'roles of the messages');
  });

  await check('when the service cannot answer, the built-in answer comes with a plain note', async () => {
    next = () => ({ status: 429, body: { error: { code: 429, message: 'rate limit for free models' } } });
    await typeAndSend(page, 'Why is the sky blue?');
    await waitAnswers(page, 4);
    const a = await lastAnswer(page);
    truthy(/can.t answer that yet/.test(a) && /reached its limit for now/.test(a), 'built-in answer and the note');
    truthy(!/Written by an AI/.test(a), 'not labelled as written by an AI');
    await shot(page, '3-note');
  });

  await check('Settings shows the card and turning it off there stops it', async () => {
    const s = await open('/settings');
    truthy(/Assistant: AI answers/.test(await text(s)), 'the Settings card');
    truthy(/AI answers are on/.test(await text(s, '.ai-card')), 'it says it is on');
    await clickText(s, /Turn off AI answers/);
    await s.waitForFunction(() => /Smarter answers \(optional\)/.test(document.querySelector('.ai-card')?.textContent ?? ''));
    eq((await api('/assistant/ai')).on, false, 'off on the server');
    await shot(s, '4-settings');
    await s.close();
    const before = calls.length;
    const reply = await api('/assistant/ask', { method: 'POST', body: JSON.stringify({ question: 'What did I buy at the corner supermarket?' }) });
    truthy(reply.intent !== 'ai' && calls.length === before, 'nothing is sent after turning it off');
  });

  await check('a phone: the card and the answers fit the screen', async () => {
    await api('/assistant/ai', { method: 'PUT', body: JSON.stringify({ on: true }) });
    next = () => ({ status: 200, body: { model: 'pretend/model:free', choices: [{ message: { content: 'A long answer. '.repeat(40) } }] } });
    const p = await open('/dashboard', { width: 390, height: 844 });
    await openAssistant(p);
    await clickText(p, /^Conversation/);
    await typeAndSend(p, 'Tell me everything about my spending this month please');
    await waitAnswers(p, 1);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.sheet *')].some((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'));
    eq(wide, false, 'horizontal overflow');
    await shot(p, '5-phone');
    await p.close();
  });

  await check('the dark theme', async () => {
    const p = await open('/dashboard', { theme: 'dark' });
    await openAssistant(p);
    await clickText(p, /^Conversation/);
    await typeAndSend(p, 'Summarise please');
    await waitAnswers(p, 1);
    await shot(p, '6-dark');
    await p.close();
  });

  await check('no script errors in the browser', async () => {
    eq(errors.filter((e) => !/Download the font|net::ERR/.test(e)).join(' | '), '');
  });

  await browser.close();
  server.kill();
  router.close();
  await sleep(300);
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots in ${SHOTS}`);
  if (/Error|error:/.test(log.replace(/Penny listening.*/g, ''))) console.log(`server log:\n${log}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
