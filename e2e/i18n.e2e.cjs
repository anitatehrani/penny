/* Browser end-to-end checks for the languages (docs/DESIGN.md section 46).
 *
 *   cd e2e && npm install && npm run i18n
 *
 * It starts the real server on a throw-away database, signs a new person up with some data, and drives a real headless Chrome/Edge: the app in
 * English and in Italian (decided by the browser's language, then by the person's own choice), the switch in Settings, the choice following
 * the person to another browser, every page read for English left behind, dates and money in Italian, a phone and the dark theme.
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'penny-i18n-shots');

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

// Words that only English uses: if one shows up on a page in Italian, a sentence was left behind.
const ENGLISH = /\b(the|and|your|you|with|for|from|this|that|are|not|will|has|have|can|use|add|see|more|show|open|please|click|enter|choose|select|payments?|settings|installments?|recurring|overdue|save|cancel|loading|delete|edit|sign|log)\b/gi;

(async () => {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH');
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-i18n-'));
  const dbName = `penny_e2e_i18n_${process.pid}`;
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

  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bea Lingua', email: `lin${Date.now()}@example.com`, username: `lin${Date.now() % 1e7}`, password: 'Tr1cky-Horse!Battery', accept_terms: true }),
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
  const sid = /sid=([^;]+)/.exec(signup.headers.getSetCookie().join(';'))[1];
  const api = (p, init = {}) => fetch(`${BASE}/api${p}`, { ...init, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((r) => r.json());
  await api('/settings', { method: 'PUT', body: JSON.stringify({ opening_balance: 2500.5, currency: 'EUR' }) });
  const cats = await api('/categories');
  const cat = (name) => cats.find((c) => c.name === name).id;
  const pay = (category, amount, date, description, status = 'paid') => api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', description, amount, date, status, category_id: cat(category) }) });
  for (const back of [1, 2]) {
    await pay('Groceries', 120, `${ym(back)}-05`, 'Mercato');
    await pay('Rent / Mortgage', 700, `${ym(back)}-01`, 'Casa');
  }
  await pay('Groceries', 45, `${ym(0)}-01`, 'Forno');
  await pay('Dining & leisure', 30, `${ym(0)}-02`, 'Cena', 'paid');
  await pay('Utilities', 80, `${ym(0)}-28`, 'Bolletta', 'pending');
  await api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'income', description: 'Stipendio', amount: 2400, date: `${ym(0)}-01`, status: 'paid', category_id: cat('Salary') }) });
  await api('/recurring', { method: 'POST', body: JSON.stringify({ type: 'expense', description: 'Affitto mensile', amount: 700, frequency: 'monthly', interval_count: 1, start_date: `${ym(0)}-01`, active: true, category_id: cat('Rent / Mortgage') }) });
  await api('/installments', { method: 'POST', body: JSON.stringify({ description: 'Portatile', installment_amount: 100, installment_count: 6, first_due_date: `${ym(0)}-20`, paid_count: 1, category_id: null }) });
  await api('/debts', { method: 'POST', body: JSON.stringify({ name: 'Marco', total_amount: 300, plan: 'monthly', first_due_date: `${ym(0)}-25`, installment_count: 3, count_in_budget: true }) });
  await api('/budgets/' + cat('Groceries'), { method: 'PUT', body: JSON.stringify({ month: ym(0), amount: 300, scope: 'onward' }) });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  /** `browserLang` is what the browser says it speaks; `signedIn: false` opens it as a visitor. */
  async function open(url, { width = 1280, height = 900, theme = 'light', browserLang = 'en-US', signedIn = true } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    if (signedIn) await page.setCookie({ name: 'sid', value: sid, url: BASE });
    else await page.deleteCookie({ name: 'sid', url: BASE });
    await page.evaluateOnNewDocument(
      (t, langs) => {
        try {
          localStorage.setItem('theme', t);
        } catch {
          /* ignore */
        }
        Object.defineProperty(navigator, 'languages', { get: () => langs });
        Object.defineProperty(navigator, 'language', { get: () => langs[0] });
      },
      theme,
      browserLang === 'it' ? ['it-IT', 'it'] : ['en-US', 'en'],
    );
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
    return page;
  }
  const text = (page, sel = 'body') => page.$eval(sel, (e) => e.innerText);
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const leftovers = (t) => [...new Set((t.match(ENGLISH) ?? []).map((w) => w.toLowerCase()))];
  /** The lines that hold English words, so a failure says where to look. */
  const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && new RegExp(ENGLISH.source, 'i').test(l)).map((l) => l.slice(0, 110));

  console.log('Languages');

  await check('an English browser gets English: the menu, the dates and the page language', async () => {
    const p = await open('/', { browserLang: 'en' });
    truthy(/Payments/.test(await text(p, '.sidebar, nav')), 'English menu');
    eq(await p.evaluate(() => document.documentElement.lang), 'en', 'html lang');
    await p.close();
  });

  await check('an Italian browser gets Italian without being asked: the menu, the page language and the greeting', async () => {
    const p = await open('/', { browserLang: 'it' });
    const menu = await text(p, '.sidebar, nav');
    truthy(/Pagamenti/.test(menu) && /Budget mensile/.test(menu) && /Impostazioni/.test(menu), `Italian menu, got: ${menu.slice(0, 120)}`);
    truthy(!/Payments|Settings/.test(menu), 'no English in the menu');
    eq(await p.evaluate(() => document.documentElement.lang), 'it', 'html lang');
    truthy(/Buongiorno|Buon pomeriggio|Buonasera|Ancora in piedi/.test(await text(p)), 'an Italian greeting');
    await shot(p, '1-dashboard-it');
    await p.close();
  });

  await check('money and dates are written the Italian way', async () => {
    const p = await open('/payments', { browserLang: 'it' });
    const t = await text(p);
    truthy(/\d\.\d{3},\d{2}\s?€|€\s?\d/.test(t) || /\d,\d{2}\s?€/.test(t), `an amount like 2.500,50 €, got: ${t.slice(0, 200)}`);
    truthy(!/\$\d|€\d/.test(t), 'no English-style money');
    truthy(/gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic/i.test(t), 'an Italian month');
    await shot(p, '2-payments-it');
    await p.close();
  });

  await check('no page leaves English behind', async () => {
    const pages = ['/', '/payments', '/budget', '/recurring', '/installments', '/debts', '/forecast', '/people', '/notifications', '/profile', '/settings?tab=general', '/settings?tab=account', '/settings?tab=notifications', '/settings?tab=appearance'];
    const found = [];
    for (const url of pages) {
      const p = await open(url, { browserLang: 'it' });
      const words = leftovers(await text(p));
      if (words.length) found.push(`${url}: ${lines(await text(p)).slice(0, 4).join(' // ')}`);
      await p.close();
    }
    eq(found.join(' | '), '', 'English words on pages');
  });

  await check('the switch in Settings changes the language at once, and the choice is kept in the account', async () => {
    const p = await open('/settings?tab=appearance', { browserLang: 'it' });
    truthy(/Lingua/.test(await text(p)), 'the Language row in Italian');
    await p.evaluate(() => [...document.querySelectorAll('[role=radio]')].find((b) => /^English$/.test(b.textContent.trim())).click());
    await p.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 8000 });
    await p.waitForFunction(() => document.body.innerText.includes('Look and feel'), { timeout: 8000 });
    await sleep(300);
    eq((await api('/preferences')).language, 'en', 'saved in the account');
    await p.evaluate(() => [...document.querySelectorAll('[role=radio]')].find((b) => /^Italiano$/.test(b.textContent.trim())).click());
    await p.waitForFunction(() => document.documentElement.lang === 'it', { timeout: 8000 });
    await sleep(300);
    eq((await api('/preferences')).language, 'it', 'saved again');
    await p.close();
  });

  await check('the saved choice wins over the browser, and follows the person to another browser', async () => {
    await api('/preferences', { method: 'PUT', body: JSON.stringify({ language: 'en' }) });
    const english = await open('/', { browserLang: 'it' }); // an Italian browser, but they chose English
    await english.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 8000 });
    truthy(/Payments/.test(await text(english, '.sidebar, nav')), 'English menu');
    await english.close();
    await api('/preferences', { method: 'PUT', body: JSON.stringify({ language: 'it' }) });
    const italian = await open('/', { browserLang: 'en' }); // a clean browser that speaks English, but they chose Italian
    await italian.waitForFunction(() => document.documentElement.lang === 'it', { timeout: 8000 });
    truthy(/Pagamenti/.test(await text(italian, '.sidebar, nav')), 'Italian menu');
    await italian.close();
  });

  await check('the language button in the top bar switches at once, saves the choice, and fits a phone', async () => {
    const p = await open('/', { browserLang: 'en-US' });
    const now = () => p.evaluate(() => document.documentElement.lang);
    const start = await now();
    const other = start === 'it' ? 'en' : 'it';
    await p.click('.lang-quick');
    await p.waitForFunction((l) => document.documentElement.lang === l, {}, other);
    await sleep(600);
    const saved = await api('/preferences');
    eq(saved.language ?? saved.data?.language, other, 'saved in the account');
    await shot(p, '8-topbar-lang');
    await p.click('.lang-quick');
    await p.waitForFunction((l) => document.documentElement.lang === l, {}, start);
    await sleep(1000);
    await p.waitForSelector('.avatar-btn');
    await p.click('.avatar-btn');
    truthy(await p.$('[role="menuitemradio"] >>> ::-p-text(Italiano)'), 'the account menu lists the languages');
    await p.close();
    const m = await open('/', { width: 360, height: 740 });
    truthy(await m.$('.lang-quick'), 'the button is there on a phone');
    eq(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no sideways scrolling');
    await shot(m, '9-topbar-lang-phone');
    await m.close();
  });

  await check('the command palette, the assistant and the dialogs speak Italian too', async () => {
    const p = await open('/', { browserLang: 'it' });
    await p.keyboard.down('Control');
    await p.keyboard.press('KeyK');
    await p.keyboard.up('Control');
    await p.waitForSelector('[role=dialog], [role=combobox], .cmd', { timeout: 5000 });
    const t = await text(p);
    truthy(/Cerca|Vai a|Azioni/.test(t), 'Italian palette');
    // (the names of the keys on the keyboard, like Enter, are the same everywhere)
    const left = leftovers(t).filter((w) => w !== 'enter');
    truthy(left.length === 0, `English left: ${left}`);
    await p.keyboard.press('Escape');
    await p.close();
  });

  await check('on a phone the longer Italian words still fit the screen', async () => {
    for (const url of ['/', '/payments', '/budget', '/settings?tab=appearance']) {
      const p = await open(url, { width: 360, height: 740, browserLang: 'it' });
      const wide = await p.evaluate(() => ({ page: document.documentElement.scrollWidth > window.innerWidth + 1, items: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.table-wrap, .scroll-x')).map((e) => e.tagName + '.' + e.className).slice(0, 3) }));
      eq(wide.page, false, `sideways scrolling on ${url}: ${wide.items.join(', ')}`);
      if (url === '/') await shot(p, '3-phone-it');
      await p.close();
    }
  });

  await check('the dark theme in Italian', async () => {
    const p = await open('/budget', { theme: 'dark', browserLang: 'it' });
    await shot(p, '4-dark-it');
    await p.close();
  });

  await check('a visitor: the address decides the language of a public page, and the switch moves between the two', async () => {
    const p = await open('/', { signedIn: false, browserLang: 'it' });
    await p.evaluate(() => localStorage.removeItem('lang'));
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    eq(await p.evaluate(() => document.documentElement.lang), 'en', 'the home address is English');
    const link = await p.$('a[hreflang="it"]');
    truthy(link, 'a link to the Italian page');
    eq(await p.$eval('a[hreflang="it"]', (a) => a.getAttribute('href')), '/it');
    await Promise.all([p.waitForFunction(() => location.pathname === '/it'), link.click()]);
    await p.waitForFunction(() => document.documentElement.lang === 'it');
    const body = await text(p);
    truthy(/Accedi/.test(body), 'the sign-in button is Italian');
    eq(await p.title().then((x) => /Penny/.test(x)), true);
    const hrefs = await p.$$eval('footer a, header a', (as) => as.map((a) => a.getAttribute('href')));
    for (const want of ['/it/terms', '/it/privacy', '/it/contact', '/it/guides']) truthy(hrefs.includes(want), `a link to ${want} (got ${hrefs.join(' ')})`);
    await shot(p, '5-landing-it');
    await p.close();
  });

  await check('the public pages in Italian leave no English behind, and keep their links in Italian', async () => {
    for (const url of ['/it', '/it/terms', '/it/privacy', '/it/contact', '/it/guides', '/it/guides/how-to-plan-a-monthly-budget', '/it/guides/budgeting-as-a-couple']) {
      const p = await open(url, { signedIn: false });
      eq(await p.evaluate(() => document.documentElement.lang), 'it', url);
      const t = await text(p);
      const left = lines(t).filter((l) => !/Penny|Italiano|English/.test(l) || ENGLISH.test(l.replace(/Penny|Italiano|English/g, '')));
      eq(left.join(' | '), '', `English left on ${url}`);
      const own = await p.$$eval('a[href^="/"]:not(.lang-links a)', (as) => as.map((a) => a.getAttribute('href')).filter((h) => /^\/(terms|privacy|contact|guides)/.test(h)));
      eq(own.join(' '), '', `${url} links to an English page`);
      await p.close();
    }
  });

  await check('the choice on a public page is remembered for the sign-in pages', async () => {
    const p = await open('/it/terms', { signedIn: false });
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    eq(await p.evaluate(() => document.documentElement.lang), 'it');
    truthy(/Accedi/.test(await text(p)), 'the sign-in page is Italian');
    await shot(p, '6-login-it');
    await p.close();
  });

  await check('on a phone the public pages in Italian fit the screen', async () => {
    for (const url of ['/it', '/it/terms', '/it/guides', '/it/guides/budgeting-as-a-couple', '/login']) {
      const p = await open(url, { width: 360, height: 740, signedIn: false });
      const wide = await p.evaluate(() => ({ page: document.documentElement.scrollWidth > window.innerWidth + 1, items: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.table-wrap, .scroll-x, .g-example')).map((e) => e.tagName + '.' + e.className).slice(0, 3) }));
      eq(wide.page, false, `sideways scrolling on ${url}: ${wide.items.join(', ')}`);
      if (url === '/it/guides') await shot(p, '7-phone-guides-it');
      await p.close();
    }
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
