/* Browser end-to-end checks for the welcome questions (docs/DESIGN.md section 47).
 *
 *   cd e2e && npm install && npm run welcome
 *
 * It starts the real server on a throw-away database and signs brand-new people up: one answers every question, one skips, one uses an Italian
 * browser. It checks what the answers change: the dashboard, the checklist, the alert settings, the wording, and Settings.
 * Needs the built client (npm run build) and Postgres. Set CHROME_PATH if Chrome is elsewhere.
 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('node:child_process');
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'penny-welcome-shots');

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
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
}
const eq = (a, b, what = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-welcome-'));
  const dbName = `penny_e2e_welcome_${process.pid}`;
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const port = await freePort();
  const BASE = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, DATABASE_URL: `${PG_BASE}/${dbName}`, PORT: String(port), COOKIE_SECURE: 'false', ALERT_SCAN_MINUTES: 'off', BACKUPS: 'off', SMTP_HOST: '', MAIL_PREVIEW_DIR: path.join(dir, 'mail'), APP_URL: BASE },
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

  let n = 0;
  /** A brand-new person with an empty budget; returns what is needed to open the app as them and to ask the server about them. */
  async function newPerson() {
    n += 1;
    const res = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Nia Nuova${n}`, email: `nia${n}${Date.now()}@example.com`, username: `nia${n}${Date.now() % 1e6}`, password: 'Tr1cky-Horse!Battery', accept_terms: true }),
    });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
    const sid = /sid=([^;]+)/.exec(res.headers.getSetCookie().join(';'))[1];
    const api = (p, init = {}) => fetch(`${BASE}/api${p}`, { ...init, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((r) => r.json());
    return { sid, api };
  }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function open(person, url, { width = 1280, height = 900, browserLang = 'en-US' } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setCookie({ name: 'sid', value: person.sid, url: BASE });
    await page.evaluateOnNewDocument(
      (langs) => {
        Object.defineProperty(navigator, 'languages', { get: () => langs });
        Object.defineProperty(navigator, 'language', { get: () => langs[0] });
      },
      browserLang === 'it' ? ['it-IT', 'it'] : ['en-US', 'en'],
    );
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
    return page;
  }
  const text = (page, sel = 'body') => page.$eval(sel, (e) => e.innerText);
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  /** Click the first button inside `scope` whose text contains `label`. */
  async function press(page, scope, label) {
    const ok = await page.evaluate(
      (s, l) => {
        const b = [...document.querySelectorAll(`${s} button`)].find((x) => x.innerText.includes(l));
        if (b) b.click();
        return !!b;
      },
      scope,
      label,
    );
    if (!ok) throw new Error(`no button "${label}" in ${scope}`);
    await sleep(250);
  }

  console.log('Welcome questions');

  const nia = await newPerson();

  await check('a new account sees the questions above the checklist', async () => {
    const p = await open(nia, '/');
    await p.waitForSelector('.welcome');
    truthy(/Four quick questions/.test(await text(p, '.welcome')), 'the welcome');
    eq(await p.$$eval('.firstrun-steps li', (l) => l.length), 4, 'four checklist steps');
    await shot(p, '1-welcome');
    await p.close();
  });

  await check('answering everything saves the answers, changes the alerts and shows what will happen', async () => {
    const p = await open(nia, '/');
    await p.waitForSelector('.welcome');
    await press(p, '.welcome', 'Let’s go');
    truthy(/Question 1 of 4/i.test(await text(p, '.welcome')), 'question 1');
    await press(p, '.welcome', 'My spending keeps playing hide and seek');
    await press(p, '.welcome', 'I owe people money');
    await shot(p, '2-question-1');
    await press(p, '.welcome', 'Next');
    await press(p, '.welcome', 'Straight-faced');
    await press(p, '.welcome', 'Next');
    await press(p, '.welcome', 'Early and often');
    await press(p, '.welcome', 'Next');
    await press(p, '.welcome', 'Eating out');
    await press(p, '.welcome', 'Finish');
    const t = await text(p, '.welcome');
    truthy(/Here is what Penny will do/.test(t) && /straight-faced/.test(t) && /a week ahead/.test(t) && /Dining & leisure/.test(t), `the wrap-up, got: ${t}`);
    await shot(p, '3-wrapup');
    await press(p, '.welcome', 'Show me my dashboard');
    await sleep(800);
    eq(await p.$('.welcome'), null, 'the questions are gone');
    await p.close();
    const prefs = await nia.api('/preferences');
    eq({ done: prefs.welcome_done, goals: prefs.goals, tone: prefs.tone, nudge: prefs.nudge, villain: prefs.villain }, { done: true, goals: ['budget', 'debts'], tone: 'plain', nudge: 'early', villain: 'dining' }, 'preferences');
    eq(prefs.layout.order.slice(0, 5), ['hero', 'insights', 'budget', 'spending', 'paying'], 'the dashboard order');
    const alerts = await nia.api('/notifications/settings');
    eq({ lead: alerts.lead_days, weekly: alerts.weekly_summary }, { lead: 7, weekly: true }, 'alerts');
  });

  await check('the checklist gains a step for the villain and for the debts, and the wording is plain', async () => {
    const p = await open(nia, '/');
    await p.waitForSelector('.firstrun');
    const steps = await p.$$eval('.firstrun-steps li strong', (l) => l.map((e) => e.innerText));
    eq(steps.length, 6, `six steps: ${steps.join(' | ')}`);
    truthy(steps.some((s) => /Put a limit on Dining & leisure/.test(s)), 'the villain step');
    truthy(steps.some((s) => /Write down what you owe/.test(s)), 'the debts step');
    truthy(/Four small steps\. Your dashboard/.test(await text(p, '.firstrun-head')), 'plain wording');
    await p.close();
  });

  await check('Settings can switch the voice back and answer the questions again', async () => {
    const p = await open(nia, '/settings');
    await p.waitForFunction(() => [...document.querySelectorAll('button, [role=tab]')].some((b) => /Appearance/.test(b.innerText)), { timeout: 8000 });
    await press(p, 'body', 'Appearance');
    await p.waitForFunction(() => /Penny’s voice/.test(document.body.innerText));
    await press(p, '.pref-row', 'Cheeky');
    await sleep(600);
    eq((await nia.api('/preferences')).tone, 'cheeky', 'tone saved');
    await press(p, '.pref-row', 'Answer again');
    await p.waitForSelector('.welcome');
    truthy(/Question 1 of 4/i.test(await text(p, '.welcome')), 'starts at the first question');
    await shot(p, '4-settings-redo');
    await p.close();
  });

  await check('skipping keeps everything as it was and does not ask again', async () => {
    const sam = await newPerson();
    const p = await open(sam, '/');
    await p.waitForSelector('.welcome');
    await press(p, '.welcome', 'Skip for now');
    await sleep(800);
    eq(await p.$('.welcome'), null, 'the questions are gone');
    eq(await p.$$eval('.firstrun-steps li', (l) => l.length), 4, 'the usual four steps');
    await p.reload({ waitUntil: 'networkidle0' });
    eq(await p.$('.welcome'), null, 'not asked again');
    const prefs = await sam.api('/preferences');
    eq([prefs.welcome_done, prefs.goals, prefs.tone, prefs.layout], [true, undefined, undefined, undefined], 'nothing else changed');
    await p.close();
  });

  await check('a phone fits the questions without sideways scroll', async () => {
    const pia = await newPerson();
    const p = await open(pia, '/', { width: 375, height: 800 });
    await p.waitForSelector('.welcome');
    await press(p, '.welcome', 'Let’s go');
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    eq(wide, false, 'no sideways scroll');
    await shot(p, '5-phone');
    await p.close();
  });

  await check('an Italian browser gets the questions in Italian', async () => {
    const ita = await newPerson();
    const p = await open(ita, '/', { browserLang: 'it' });
    await p.waitForSelector('.welcome');
    truthy(/Quattro domande veloci/.test(await text(p, '.welcome')), 'Italian welcome');
    await press(p, '.welcome', 'Andiamo');
    const t = await text(p, '.welcome');
    truthy(/Domanda 1 di 4/i.test(t) && /Cosa ti ha portato qui/.test(t), `Italian question, got: ${t.slice(0, 120)}`);
    await shot(p, '6-italian');
    await p.close();
  });

  await check('no script errors', async () => {
    eq(errors, [], 'console errors');
  });

  await browser.close();
  server.kill();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
  await admin.end();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failures.length} failed. Pictures: ${SHOTS}`);
  if (failures.length) {
    console.log(log.slice(-1500));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
