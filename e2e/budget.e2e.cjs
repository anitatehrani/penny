/* Browser end-to-end checks for the monthly budget (docs/DESIGN.md section 43).
 *
 *   cd e2e && npm install && npm run budget
 *
 * It starts the real server on a throw-away database, signs a new person up with some spending in the last months and this month, and drives
 * a real headless Chrome/Edge: the empty page, suggesting budgets from what is usually spent, changing one (from now on, and for one month
 * only), the figures and the words about them, a month that is over, the dashboard widget, the alert in the notification centre, the
 * setting for it, a phone and the dark theme. Needs the built client (npm run build) and Postgres. Set CHROME_PATH if Chrome is elsewhere.
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'penny-budget-shots');

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
const ym = (back) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

(async () => {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH');
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-budget-'));
  const dbName = `penny_e2e_budget_${process.pid}`;
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const port = await freePort();
  const BASE = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, DATABASE_URL: `${PG_BASE}/${dbName}`, PORT: String(port), COOKIE_SECURE: 'false', ALERT_SCAN_MINUTES: 'off', BACKUPS: 'off', SMTP_HOST: '', MAIL_PREVIEW_DIR: path.join(dir, 'mail') },
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

  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bea Budget', email: `bud${Date.now()}@example.com`, username: `bud${Date.now() % 1e7}`, password: 'Tr1cky-Horse!Battery', accept_terms: true }),
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
  const sid = /sid=([^;]+)/.exec(signup.headers.getSetCookie().join(';'))[1];
  const api = (p, init = {}) => fetch(`${BASE}/api${p}`, { ...init, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((r) => r.json());
  await api('/settings', { method: 'PUT', body: JSON.stringify({ opening_balance: 2000, currency: 'EUR' }) });
  const cats = await api('/categories');
  const cat = (name) => cats.find((c) => c.name === name).id;
  const pay = (category, amount, date, description = 'Payment', status = 'paid') => api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', description, amount, date, status, category_id: cat(category) }) });
  // three earlier months of usual spending, and this month so far
  for (const back of [1, 2, 3]) {
    await pay('Groceries', 120, `${ym(back)}-05`);
    await pay('Dining & leisure', 60, `${ym(back)}-12`);
    await pay('Rent / Mortgage', 700, `${ym(back)}-01`);
  }
  await pay('Groceries', 45, `${ym(0)}-01`);
  await pay('Dining & leisure', 30, `${ym(0)}-01`);
  await api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'income', description: 'Pay', amount: 2400, date: `${ym(0)}-01`, status: 'paid', category_id: cat('Salary') }) });

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
  const inRow = (page, name, re) =>
    page.evaluate(
      (n, src, flags) => {
        const row = [...document.querySelectorAll('.bud-row')].find((r) => r.querySelector('.cat')?.textContent.includes(n));
        const el = row && [...row.querySelectorAll('button, a')].find((b) => new RegExp(src, flags).test(b.textContent));
        if (!el) return false;
        el.click();
        return true;
      },
      name,
      re.source,
      re.flags,
    );
  const rowText = (page, name) => page.evaluate((n) => [...document.querySelectorAll('.bud-row')].find((r) => r.querySelector('.cat')?.textContent.includes(n))?.textContent ?? '', name);
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const thisMonthName = new Date().toLocaleDateString('en', { month: 'long' });

  console.log('Monthly budget');
  const page = await open('/budget');

  await check('the page is in the menu, and with no budget it explains and offers a quick start', async () => {
    truthy(await page.$('a[href="/budget"]'), 'a Monthly budget link in the menu');
    const t = await text(page);
    truthy(new RegExp(`No budget for ${thisMonthName} yet`).test(t), 'the empty state');
    truthy(/Suggest from what I usually spend/.test(t) && /last month.s spending/.test(t), 'the two quick starts');
    truthy(!/\b(API|JSON|null|undefined)\b/.test(t), 'no technical words');
    await shot(page, '1-empty');
  });

  await check('suggesting from what is usually spent fills the categories with sensible amounts and shows the month', async () => {
    await clickText(page, /Suggest from what I usually spend/);
    await page.waitForSelector('.bud-summary');
    const t = await text(page);
    truthy(/Left to spend|Over budget by/.test(t), 'the big figure');
    truthy(/Day \d+ of \d+/.test(t) && /Expected by month end/.test(t), 'the time and the estimate');
    const groceries = await rowText(page, 'Groceries');
    truthy(/€\s?120/.test(groceries) || /120/.test(groceries), `groceries budget of 120 in: ${groceries}`);
    truthy(/€\s?700/.test(await rowText(page, 'Rent')) || /700/.test(await rowText(page, 'Rent')), 'rent budget of 700');
    truthy(/usually/.test(groceries), 'the usual amount is shown');
    await shot(page, '2-suggested');
  });

  await check('changing a budget below what is spent says so in words, in the row and in "what stands out"', async () => {
    truthy(await inRow(page, 'Dining', /Change budget/), 'a Change budget button');
    await page.waitForSelector('.bud-editor input');
    const hint = await text(page, '.bud-editor');
    truthy(/When does it apply/.test(hint) && /From .* on\. Earlier months keep what they had/.test(hint) && /Only .*next month goes back/.test(hint), 'the choice of when it applies');
    await page.click('.bud-editor input[inputmode=decimal]', { clickCount: 3 });
    await page.type('.bud-editor input[inputmode=decimal]', '20');
    await clickText(page, /Save budget/);
    await page.waitForFunction(() => /Over budget/.test([...document.querySelectorAll('.bud-row')].find((r) => r.textContent.includes('Dining'))?.textContent ?? ''), { timeout: 10000 });
    truthy(/Dining & leisure is over its budget by/.test(await text(page, '.bud-findings')), 'the finding in plain words');
    await shot(page, '3-over');
  });

  await check('a wrong amount is refused with a hint, and cannot be saved', async () => {
    truthy(await inRow(page, 'Groceries', /Change budget/), 'a Change budget button');
    await page.waitForSelector('.bud-editor input');
    await page.click('.bud-editor input[inputmode=decimal]', { clickCount: 3 });
    await page.type('.bud-editor input[inputmode=decimal]', 'a lot');
    truthy(/Type an amount, like 120 or 120\.50/.test(await text(page, '.bud-editor')), 'the hint');
    eq(await page.$eval('.bud-editor button.primary', (b) => b.disabled), true, 'Save disabled');
    await clickText(page, /^Cancel$/);
  });

  await check('the next month carries the budget forward; "only this month" changes just that month', async () => {
    const next = await open(`/budget?month=${ym(-1)}`);
    truthy(/120/.test(await rowText(next, 'Groceries')), 'groceries budget carried to next month');
    truthy(await inRow(next, 'Groceries', /Change budget/), 'a Change budget button');
    await next.waitForSelector('.bud-editor input');
    await next.click('.bud-editor input[inputmode=decimal]', { clickCount: 3 });
    await next.type('.bud-editor input[inputmode=decimal]', '300');
    await next.evaluate(() => document.querySelector('.bud-editor input[type=radio][name=scope]:not(:checked)')?.click());
    await clickText(next, /Save budget/);
    await next.waitForFunction(() => /300/.test([...document.querySelectorAll('.bud-row')].find((r) => r.textContent.includes('Groceries'))?.textContent ?? ''), { timeout: 10000 });
    const after = await api(`/budgets?month=${ym(-2)}`);
    eq(after.lines.find((l) => l.name === 'Groceries').budget, 120, 'the month after goes back to 120');
    eq((await api(`/budgets?month=${ym(-1)}`)).lines.find((l) => l.name === 'Groceries').budget, 300, 'that month');
    eq((await api(`/budgets?month=${ym(0)}`)).lines.find((l) => l.name === 'Groceries').budget, 120, 'this month is untouched');
    await next.close();
  });

  await check('a month that is over is a review: within budget or over, no pace, and a line on how it went', async () => {
    // budgets set from this month on never rewrite last month, so last month needs its own for there to be a review
    await api(`/budgets/${cat('Groceries')}`, { method: 'PUT', body: JSON.stringify({ month: ym(1), amount: 150, scope: 'month' }) });
    await api(`/budgets/${cat('Dining & leisure')}`, { method: 'PUT', body: JSON.stringify({ month: ym(1), amount: 50, scope: 'month' }) });
    const past = await open(`/budget?month=${ym(1)}`);
    const t = await text(past);
    truthy(/Within budget|Over budget/.test(t), 'a verdict on each category');
    truthy(/You stayed within budget in \d+ of \d+ categories/.test(t), 'the review sentence');
    truthy(!/Day \d+ of \d+/.test(t) && !/days left/.test(t), 'no pace for a finished month');
    await shot(past, '4-past');
    await past.close();
  });

  await check('the dashboard has the budget in a corner, with a way to the page', async () => {
    const d = await open('/');
    await d.waitForSelector('.bud-widget');
    const t = await text(d, '.bud-widget');
    truthy(/Left to spend|Over budget by/.test(t) && /spent of/.test(t), 'the figure and the bar words');
    truthy(/Dining & leisure/.test(t) && /Over budget/.test(t), 'the category that needs a look');
    truthy(await d.$('.bud-widget a[href^="/budget"]'), 'the link');
    await shot(d, '5-dashboard');
    await d.close();
  });

  await check('Penny tells you in the notification centre when a category is over, once', async () => {
    await api('/notifications/refresh', { method: 'POST', body: '{}' });
    await api('/notifications/refresh', { method: 'POST', body: '{}' });
    const n = await open('/notifications');
    const t = await text(n);
    eq((t.match(/Dining & leisure is over its budget/g) || []).length, 1, 'notices about Dining');
    await shot(n, '6-notification');
    await n.close();
  });

  await check('Settings can switch the alerts off, and says they are in the app only', async () => {
    const s = await open('/settings?tab=notifications');
    const t = await text(s);
    truthy(/Monthly budget alerts/.test(t) && /80% of its monthly budget/.test(t) && /Not by email/.test(t), 'the setting and its words');
    await s.close();
  });

  await check('the assistant answers about the budget', async () => {
    const reply = await api('/assistant/ask', { method: 'POST', body: JSON.stringify({ question: 'How is my budget?', chip: true }) });
    eq(reply.intent, 'budget', 'intent');
    truthy(/you have spent .* of the .* you budgeted/.test(reply.answer), 'the sentence');
  });

  await check('every bar says in words what it shows, for people who cannot see it', async () => {
    const p = await open('/budget');
    const bars = await p.$$eval('.bud-bar', (els) => els.map((e) => [e.getAttribute('role'), e.getAttribute('aria-label') ?? '']));
    truthy(bars.length >= 4, 'bars on the page');
    for (const [role, label] of bars) {
      eq(role, 'img', 'role of a bar');
      truthy(/spent of/.test(label) && /€/.test(label), `a label with the amounts: ${label}`);
    }
    const chips = await p.$$eval('.bud-chip', (els) => els.map((e) => e.textContent.trim()));
    truthy(chips.length >= 3 && chips.every((c) => c.length > 3), 'every state has words');
    await p.close();
  });

  await check('the search box finds the page (Ctrl K, "budget")', async () => {
    const p = await open('/payments');
    await p.keyboard.down('Control');
    await p.keyboard.press('k');
    await p.keyboard.up('Control');
    await p.waitForSelector('[role=dialog] input, [role=combobox]');
    await p.keyboard.type('budget');
    await sleep(400);
    truthy(/Monthly budget/.test(await text(p, '[role=dialog]')), 'Monthly budget among the results');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => location.pathname === '/budget', { timeout: 5000 });
    await p.close();
  });

  await check('on a phone it is under "More", and the page opens from there', async () => {
    const p = await open('/payments', { width: 390, height: 844 });
    await clickText(p, /^More$/, 'button, a');
    await sleep(300);
    truthy(/Monthly budget/.test(await text(p)), 'Monthly budget in the More menu');
    await clickText(p, /Monthly budget/, '[role=menuitem], a, button');
    await p.waitForFunction(() => location.pathname === '/budget', { timeout: 5000 });
    await p.close();
  });

  await check('the dashboard widget follows the month being looked at', async () => {
    const d = await open(`/?month=${ym(1)}`);
    await d.waitForSelector('.bud-widget');
    truthy(new RegExp(new Date(ym(1) + '-15').toLocaleDateString('en', { month: 'long' })).test(await text(d, '[data-widget=budget]')), 'the widget names that month');
    truthy(await d.$('.bud-widget a[href*="month=' + ym(1) + '"]'), 'its link keeps the month');
    await d.close();
  });

  await check('turning the alerts off in Settings is kept', async () => {
    const s = await open('/settings?tab=notifications');
    await s.evaluate(() => {
      const sw = document.querySelector('[aria-label="Monthly budget alerts: in the app"]');
      sw?.click();
    });
    await sleep(800);
    eq((await api('/notifications/settings')).budget_alerts, false, 'the saved setting');
    await api('/notifications/settings', { method: 'PUT', body: JSON.stringify({ budget_alerts: true }) });
    await s.close();
  });

  await check('a phone: nothing runs off the screen, with the editor open', async () => {
    const p = await open('/budget', { width: 390, height: 844 });
    await inRow(p, 'Dining', /Change budget/);
    await p.waitForSelector('.bud-editor');
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.bud-row *, .bud-summary *')].some((e) => e.getBoundingClientRect().right > window.innerWidth + 1));
    eq(wide, false, 'horizontal overflow');
    await shot(p, '7-phone');
    await p.close();
  });

  await check('the dark theme', async () => {
    const p = await open('/budget', { theme: 'dark' });
    await shot(p, '8-dark');
    await p.close();
  });

  await check('no script errors in the browser', async () => {
    eq(errors.filter((e) => !/Download the font|net::ERR/.test(e)).join(' | '), '');
  });

  await browser.close();
  server.kill();
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
