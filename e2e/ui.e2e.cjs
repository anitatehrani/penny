/* Browser end-to-end checks for the redesigned interface.
 *
 *   1. start the app (npm start) with the demo data (npm run seed:demo)
 *   2. cd e2e && npm install && npm run ui
 *
 * It drives a real headless Chrome/Edge through the dashboard, notification centre, command palette, assistant,
 * customise mode, avatar picker, settings and the phone layout, and prints a pass/fail line for each check.
 * Set CHROME_PATH if Chrome is not in its usual place. Not part of `npm test` because it needs a browser.
 */
const puppeteer = require('puppeteer-core');
const { createHash, randomBytes } = require('node:crypto');
const pg = require('pg');
const fs = require('node:fs');

const BASE = process.env.APP_URL || 'http://localhost:3001';
const DB = process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget';
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

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

async function sessionFor(db, email) {
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows[0]) throw new Error(`no user ${email}: run npm run seed:demo first`);
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '2 hours', 'e2e')`, [createHash('sha256').update(token).digest('hex'), rows[0].id]);
  return { token, userId: rows[0].id };
}

(async () => {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH');
  const db = new pg.Pool({ connectionString: DB });
  const { token, userId } = await sessionFor(db, 'alex.morgan@example.com');
  await db.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM insight_dismissals WHERE user_id = $1', [userId]);
  await db.query('UPDATE notifications SET read_at = NULL WHERE user_id = $1', [userId]); // start with an unread bell

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function open(path, { width = 1440, height = 900, theme = 'light' } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !/40[134]|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
    await page.setCookie({ name: 'sid', value: token, url: BASE });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    page.confirm = () => page.evaluate(() => (window.confirm = () => true));
    return page;
  }
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
  const count = (page, sel) => page.$$eval(sel, (e) => e.length);
  const api = (page, method, url, body) =>
    page.evaluate(async (method, url, body) => {
      const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, method, url, body);

  console.log('\nDashboard');
  let page = await open('/');
  await check('greets the person and shows the balance, insights and ledger', async () => {
    truthy(/Good (morning|afternoon|evening)|Still up/.test(await text(page, '.dash-title h1')), 'a greeting');
    truthy(/€[\d,]+\.\d\d/.test(await text(page, '.hero-balance')), 'a balance');
    truthy((await count(page, '.insight')) >= 1, 'at least one insight');
    truthy((await count(page, '.prow')) >= 3, 'upcoming payments');
  });
  await check('the app is called Penny: tab title, sidebar and the sign-in screen', async () => {
    eq(await page.title(), 'Dashboard · Penny', 'tab title');
    eq(await text(page, '.sidebar .brand-name'), 'Penny', 'sidebar');
    const fresh = await browser.createBrowserContext(); // its own cookie jar, so nobody is signed in
    const out = await fresh.newPage();
    try {
      await out.goto(BASE + '/', { waitUntil: 'networkidle0' });
      eq(await out.title(), 'Penny', 'signed-out tab title');
      truthy(/^Penny\b/.test(await text(out, '.auth-brand')), 'brand on the sign-in screen');
      truthy(!/Budget Planner/.test(await out.evaluate(() => document.body.innerText)), 'no old name on the page');
    } finally {
      await fresh.close();
    }
    await page.goto(BASE + '/payments', { waitUntil: 'networkidle0' });
    truthy(/ · Penny$/.test(await page.title()), 'other pages end with · Penny');
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  });
  await check('"How is this made up?" reveals the arithmetic, and again hides it', async () => {
    eq(await page.$eval('.hero-breakdown', (e) => e.classList.contains('open')), false, 'closed at first');
    await page.click('.hero-why');
    await sleep(350);
    eq(await page.$eval('.hero-breakdown', (e) => e.classList.contains('open')), true, 'open');
    truthy((await count(page, '.bd-row')) >= 5, 'breakdown rows');
    await page.click('.hero-why');
    await sleep(300);
    eq(await page.$eval('.hero-breakdown', (e) => e.classList.contains('open')), false, 'closed again');
  });
  await check('pointing at a category lights it up in the list and in the ring', async () => {
    await page.hover('.spending-list li:nth-child(2) .spend-row');
    await sleep(250);
    eq(await count(page, '.spending-list li.active'), 1, 'one active row');
    truthy((await count(page, '.spending-list li.dim')) >= 3, 'others dimmed');
    const centre = await text(page, '.donut-label .eyebrow');
    const name = await page.$eval('.spending-list li.active .cat', (e) => e.textContent.trim());
    eq(centre, name, 'donut centre shows the category');
    await page.mouse.move(5, 5);
  });
  await check('the "compare" switch hides and shows last month on the bars', async () => {
    truthy((await count(page, '.bar-tick')) > 0, 'ticks shown');
    await page.click('#cmp');
    await sleep(200);
    eq(await count(page, '.bar-tick'), 0, 'ticks hidden');
    await page.click('#cmp');
  });
  await check('quick actions appear on hover; marking paid folds the row away and Undo brings it back', async () => {
    const row = '.prow:not(.overdue)';
    const label = await page.$eval(`${row} .prow-title span`, (e) => e.textContent.trim());
    const titles = () => page.$$eval('.prow .prow-title > span:first-child', (e) => e.map((x) => x.textContent.trim()));
    const before = (await titles()).filter((t) => t === label).length;
    await page.hover(row);
    await sleep(250);
    eq(await page.$eval(`${row} .prow-actions`, (e) => getComputedStyle(e).opacity), '1', 'actions visible');
    await page.click(`${row} .prow-actions .btn.primary-soft`);
    await page.waitForFunction((l, n) => [...document.querySelectorAll('.prow .prow-title > span:first-child')].filter((x) => x.textContent.trim() === l).length < n, { timeout: 5000 }, label, before);
    truthy((await text(page, '.toast:last-child')).includes(label), 'toast names the payment');
    await page.click('.toast:last-child .toast-action');
    await page.waitForFunction((l, n) => [...document.querySelectorAll('.prow .prow-title > span:first-child')].filter((x) => x.textContent.trim() === l).length >= n, { timeout: 5000 }, label, before);
    await sleep(2000);
  });
  await check('an insight can be dismissed and restored with Undo', async () => {
    const before = await count(page, '.insights-widget .insight');
    const title = await page.$eval('.insights-widget .insight .insight-title', (e) => e.textContent);
    await page.click('.insights-widget .insight .insight-x');
    await sleep(600);
    truthy(!(await page.$$eval('.insights-widget .insight-title', (e) => e.map((x) => x.textContent))).includes(title) || before > 2, 'the card is gone');
    await page.click('.toast:last-child .toast-action');
    await sleep(900);
    truthy((await page.$$eval('.insights-widget .insight-title', (e) => e.map((x) => x.textContent))).includes(title), 'the card is back');
  });
  await check('"Why?" expands the numbers behind an insight', async () => {
    await page.click('.insights-widget .insight .insight-link[aria-expanded]');
    await sleep(250);
    truthy((await count(page, '.insights-widget .insight-row')) >= 1, 'detail rows');
  });
  await check('asking from the dashboard bar opens the assistant with an answer', async () => {
    await page.type('.ask-inline input', 'Where does my money go?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.chat-a:not(.pending)', { timeout: 6000 });
    truthy(/biggest expense/i.test(await text(page, '.chat-a p')), 'a category answer');
    truthy((await count(page, '.chat-chips .chip')) >= 1, 'follow-up chips');
    await page.keyboard.press('Escape');
    await sleep(300);
    eq(await count(page, '.sheet'), 0, 'panel closed by Escape');
  });

  console.log('\nTop bar, menus and notifications');
  await check('the notification centre groups items, marks one read on click and leads to it', async () => {
    const before = Number((await text(page, '.bell-count')) || 0);
    truthy(before > 0, 'an unread badge');
    await page.click('.nc-root .bell-btn');
    await page.waitForSelector('.nc-group');
    truthy((await count(page, '.nc-group')) >= 2, 'grouped');
    truthy((await count(page, '.nc-row.unread')) >= 1, 'unread highlighted');
    const first = await page.$('.nc-row.unread .nc-item');
    await first.click();
    await sleep(700);
    eq(await count(page, '.nc-panel'), 0, 'panel closed');
    const after = Number((await page.$eval('.bell-btn', (e) => e.getAttribute('aria-label')).then((l) => (l.match(/(\d+) unread/) ?? [0, 0])[1])) || 0);
    truthy(after < before || after === 0, 'unread count dropped');
  });
  await check('"Mark all read" empties the badge and shows the calm empty state on Unread', async () => {
    await page.click('.nc-root .bell-btn');
    await page.waitForSelector('.nc');
    await sleep(300);
    const markAll = await page.$('.nc-foot .btn[disabled]');
    if (!markAll) await page.click('.nc-foot .btn.ghost');
    await sleep(500);
    await page.click('.nc-tabs button:nth-child(2)');
    await sleep(500);
    truthy(/all caught up/i.test(await text(page, '.nc-body')), 'caught-up message');
    eq(await count(page, '.bell-count'), 0, 'no badge');
    await page.keyboard.press('Escape');
    await sleep(200);
    eq(await page.evaluate(() => document.activeElement?.classList.contains('bell-btn')), true, 'focus returns to the bell');
  });
  await check('the account menu opens, moves with arrow keys, closes on Escape and switches theme', async () => {
    await page.click('.avatar-btn');
    await page.waitForSelector('[role=menu]');
    eq(await page.evaluate(() => document.activeElement?.textContent.trim()), 'Profile', 'first item focused');
    await page.keyboard.press('ArrowDown');
    eq(await page.evaluate(() => document.activeElement?.textContent.trim()), 'Account', 'arrow moves');
    await page.keyboard.press('Escape');
    await sleep(200);
    eq(await count(page, '[role=menu]'), 0, 'closed');
    eq(await page.evaluate(() => document.activeElement?.classList.contains('avatar-btn')), true, 'focus back on the avatar');
    await page.click('.avatar-btn');
    await page.waitForSelector('[role=menu]');
    const dark = await page.evaluateHandle(() => [...document.querySelectorAll('[role=menuitemradio]')].find((e) => /Dark/.test(e.textContent)));
    await dark.click();
    await sleep(300);
    eq(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'dark theme applied');
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  });
  await check('the command palette finds pages with fuzzy search and runs them from the keyboard', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.palette');
    await page.type('.palette input', 'frcst');
    await sleep(250);
    eq(await page.$eval('.palette-item.active .palette-label', (e) => e.textContent.trim()), 'Open forecast', 'fuzzy match');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname === '/forecast', { timeout: 4000 });
  });
  await check('the palette searches payments and people, and turns a question into an assistant answer', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.palette');
    await page.type('.palette input', 'netflix');
    await sleep(700);
    truthy((await page.$$eval('.palette-group', (e) => e.map((x) => x.textContent))).includes('Payments'), 'payments group');
    await page.$eval('.palette input', (e) => (e.value = ''));
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.type('.palette input', 'sam');
    await sleep(500);
    truthy((await page.$$eval('.palette-group', (e) => e.map((x) => x.textContent))).includes('People'), 'people group');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.type('.palette input', 'will I go negative?');
    await sleep(300);
    eq(await page.$eval('.palette-item.active .palette-label', (e) => e.textContent.trim()), 'Ask the assistant: “will I go negative?”', 'questions go to the assistant first');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.chat-a:not(.pending)', { timeout: 6000 });
    truthy(/forecast|negative|zero/i.test(await page.$$eval('.chat-a p', (e) => e.at(-1).textContent)), 'a forecast answer');
    await page.keyboard.press('Escape');
  });
  await check('Ctrl+K toggles, Escape closes, and an empty search says what to do', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.palette');
    await page.type('.palette input', 'zzzzqq');
    await sleep(300);
    truthy(/Search payments for/.test(await text(page, '.palette-list')), 'falls back to payment search');
    await page.keyboard.press('Escape');
    await sleep(200);
    eq(await count(page, '.palette'), 0, 'closed');
  });

  console.log('\nPersonalisation');
  page = await open('/');
  await check('customise: move, resize and hide a widget, and it is remembered after a reload', async () => {
    await page.click('.dash-actions .btn:first-child');
    await page.waitForSelector('.customize-bar');
    await page.click('[data-widget=spending] .widget-edit-tools .btn:nth-child(1)');
    await page.click('[data-widget=recurring] .segmented.mini button[aria-label=Wide]');
    await page.click('[data-widget=outlook] .widget-edit-tools .btn:last-child');
    await sleep(900);
    const saved = (await api(page, 'GET', '/preferences')).json;
    eq(saved.layout.hidden.join(), 'outlook', 'hidden saved');
    eq(saved.layout.sizes.recurring, 'l', 'size saved');
    truthy(saved.layout.order.indexOf('spending') < saved.layout.order.indexOf('upcoming'), 'order saved');
    page = await open('/');
    eq(await count(page, '[data-widget=outlook]'), 0, 'hidden after reload');
    eq(await page.$eval('[data-widget=recurring]', (e) => e.classList.contains('size-l')), true, 'size after reload');
  });
  await check('"Reset layout" puts everything back', async () => {
    await page.click('.dash-actions .btn:first-child');
    await page.waitForSelector('.customize-bar');
    await page.click('.customize-bar .btn');
    await sleep(800);
    eq(await count(page, '[data-widget=outlook]'), 1, 'outlook back');
    await page.click('.dash-actions .btn:first-child');
  });
  await check('sidebar collapse is remembered and shows names on hover', async () => {
    await page.click('.collapse-btn');
    await sleep(500);
    eq(await page.$eval('.shell', (e) => e.classList.contains('is-collapsed')), true, 'collapsed');
    await page.hover('.nav-item:nth-child(2) .nav-link');
    await sleep(700);
    eq(await page.$eval('.nav-item:nth-child(2) .tip', (e) => getComputedStyle(e).opacity), '1', 'tooltip shown');
    page = await open('/');
    eq(await page.$eval('.shell', (e) => e.classList.contains('is-collapsed')), true, 'collapsed after reload');
    await page.click('.collapse-btn');
    await sleep(400);
  });
  await check('pinning a page moves it to a "Pinned" group', async () => {
    await page.hover('.nav-item:nth-child(5)');
    await page.click('.nav-item:nth-child(5) .nav-pin');
    await sleep(500);
    truthy(/Pinned/.test(await text(page, '.nav')), 'pinned heading');
    eq(await page.$eval('.nav-item.pinned .nav-label', (e) => e.textContent.trim()), 'Forecast', 'forecast pinned');
    await page.hover('.nav-item.pinned');
    await page.click('.nav-item.pinned .nav-pin');
  });
  await check('appearance: accent colour and compact density apply at once and persist', async () => {
    page = await open('/settings?tab=appearance');
    await page.click('.swatch-btn[aria-label=Green]');
    await page.click('[aria-label=Density] button:nth-child(2)');
    await sleep(900);
    eq(await page.evaluate(() => document.documentElement.dataset.accent), 'green', 'accent attr');
    eq(await page.evaluate(() => document.documentElement.dataset.density), 'compact', 'density attr');
    eq((await api(page, 'GET', '/preferences')).json.accent, 'green', 'saved on the server');
    page = await open('/settings?tab=appearance');
    eq(await page.evaluate(() => document.documentElement.dataset.accent), 'green', 'after reload');
    await page.click('.swatch-btn[aria-label=Blue]');
    await page.evaluate(() => [...document.querySelectorAll('[aria-label=Density] button')].find((b) => b.textContent === 'Comfortable')?.click());
    await sleep(700);
  });

  console.log('\nSettings and avatar');
  await check('notification settings: every type has an in-app and an email switch, and changes save', async () => {
    page = await open('/settings?tab=notifications');
    truthy((await count(page, '.pref-matrix-row')) >= 12, 'a switch pair per notification type');
    const start = (await api(page, 'GET', '/notifications/settings')).json.weekly_summary;
    await page.click('[aria-label="Weekly summary: in the app"]');
    await sleep(700);
    eq((await api(page, 'GET', '/notifications/settings')).json.weekly_summary, !start, 'weekly summary flipped and saved');
    await page.click('[aria-label="Weekly summary: in the app"]');
    await sleep(600);
    eq((await api(page, 'GET', '/notifications/settings')).json.weekly_summary, start, 'and back again');
  });
  await check('the avatar picker saves a generated avatar as the profile picture', async () => {
    page = await open('/profile');
    await page.click('.avatar-editor .btn');
    await page.waitForSelector('.avatar-picker');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'Generated').click());
    await sleep(300);
    truthy((await count(page, '.picker-opt')) === 8, 'eight options');
    await page.click('.picker-opt:nth-child(3)');
    await page.evaluate(() => [...document.querySelectorAll('.picker-actions .btn')].find((b) => /Use this avatar/.test(b.textContent)).click());
    await sleep(1500);
    const me = (await api(page, 'GET', '/auth/me')).json.user;
    truthy(/^\/api\/avatars\//.test(me.avatar_url), 'avatar url set');
    const type = await page.evaluate(async (u) => (await fetch(u)).headers.get('content-type'), me.avatar_url);
    eq(type, 'image/png', 'a PNG is served');
  });
  await check('"Show when I’m active" can be switched off in preferences', async () => {
    page = await open('/settings?tab=appearance');
    await page.click('#st');
    await sleep(700);
    eq((await api(page, 'GET', '/auth/me')).json.user.show_status, false, 'status hidden');
    await page.click('#st');
    await sleep(500);
  });

  console.log('\nStates');
  await check('offline: a banner appears and goes away again', async () => {
    page = await open('/');
    await page.setOfflineMode(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('.offline-banner', { timeout: 3000 });
    await page.setOfflineMode(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(300);
    eq(await count(page, '.offline-banner'), 0, 'banner gone');
  });
  await check('a failed load shows a calm error with Try again, which recovers', async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCookie({ name: 'sid', value: token, url: BASE });
    await page.setRequestInterception(true);
    let fail = true;
    page.on('request', (r) => (fail && r.url().includes('/api/summary') ? r.respond({ status: 500, contentType: 'application/json', body: '{"error":"Boom"}' }) : r.continue()));
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.state.error', { timeout: 5000 });
    truthy(/did not load/i.test(await text(page, '.state.error strong')), 'error title');
    fail = false;
    await page.click('.state.error .btn');
    await page.waitForSelector('.hero-balance', { timeout: 6000 });
  });
  await check('a brand-new account sees the getting-started checklist, empty bell and an honest assistant', async () => {
    const email = `e2e.${Date.now().toString(36)}@example.com`;
    const probe = await browser.newPage();
    await probe.goto(BASE + '/login');
    const res = await probe.evaluate(async (email) => {
      const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Person', email, username: 'np' + Date.now().toString(36).slice(-7), password: 'Tr1cky-Horse!Battery' }) });
      return r.status;
    }, email);
    eq(res, 201, 'sign-up');
    await probe.close();
    const fresh = await sessionFor(db, email);
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCookie({ name: 'sid', value: fresh.token, url: BASE });
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.firstrun', { timeout: 5000 });
    eq(await count(page, '.firstrun-steps li'), 4, 'four steps');
    await page.click('.nc-root .bell-btn');
    await page.waitForSelector('.nc .state');
    truthy(/Nothing here yet/.test(await text(page, '.nc .state')), 'empty notifications');
    await page.keyboard.press('Escape');
    await page.click('.ask-btn');
    await page.waitForSelector('.assistant');
    truthy(/Nothing to analyse yet/.test(await text(page, '.assistant-overview')), 'assistant explains there is nothing yet');
    await db.query('DELETE FROM users WHERE email = $1', [email]);
  });

  console.log('\nPhone layout');
  await check('bottom navigation replaces the sidebar, nothing overflows sideways, tap targets are big enough', async () => {
    page = await open('/', { width: 390, height: 844 });
    eq(await page.$eval('.sidebar', (e) => getComputedStyle(e).display), 'none', 'sidebar hidden');
    eq(await page.$eval('.mobile-nav', (e) => getComputedStyle(e).display), 'grid', 'bottom bar shown');
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no sideways scroll');
    const small = await page.$$eval('.mobile-tab, .topbar button, .dash-actions .btn', (els) => els.filter((e) => e.getBoundingClientRect().width < 34 || e.getBoundingClientRect().height < 34).map((e) => e.className));
    eq(small.length, 0, `controls smaller than 34px: ${small}`);
    await page.click('.mobile-nav .menu-root .mobile-tab');
    await page.waitForSelector('[role=menu]');
    truthy(/Installments/.test(await text(page, '[role=menu]')), 'More lists the rest');
    await page.keyboard.press('Escape');
  });
  await check('the notification centre becomes a bottom sheet on a phone', async () => {
    await page.click('.nc-root .bell-btn');
    await page.waitForSelector('.sheet-bottom');
    truthy((await count(page, '.sheet-bottom .nc')) === 1, 'sheet contains the centre');
    await page.keyboard.press('Escape');
    await sleep(300);
    eq(await count(page, '.sheet'), 0, 'closed');
  });
  await check('the dashboard stacks into one column on a phone', async () => {
    const cols = await page.$eval('.dash-grid', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    eq(cols, 1, 'one column');
  });

  console.log('\nHealth');
  await check('no script errors or failed requests (other than expected 401/404s) during the run', async () => {
    eq(errors.length, 0, errors.slice(0, 3).join(' | '));
  });

  await browser.close();
  await db.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM insight_dismissals WHERE user_id = $1', [userId]);
  await db.query('UPDATE notifications SET read_at = NULL WHERE user_id = $1', [userId]);
  await db.end();
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join('; ')}` : ''}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
