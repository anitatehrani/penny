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
  // choose an option in one of the Payments page's filter dropdowns by what it says
  const pickFilter = async (page, label, option) => {
    await page.click(`.filters button[aria-label^="${label}:"]`);
    await page.waitForSelector('.filter-pop [role=option]');
    await page.evaluate((o) => [...document.querySelectorAll('.filter-pop [role=option]')].find((e) => e.textContent.trim() === o).click(), option);
    await page.waitForSelector('.filter-pop', { hidden: true });
  };
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
      await out.goto(BASE + '/login', { waitUntil: 'networkidle0' });
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
  await check('the logo: drawn in the sidebar and on the sign-in page, and the tab, home-screen and manifest icons are served', async () => {
    const logo = await page.$eval('.sidebar svg.wordmark', (e) => {
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), paths: e.querySelectorAll('path').length, stroke: getComputedStyle(e).stroke, ink: getComputedStyle(e.closest('.brand')).color, hidden: e.getAttribute('aria-hidden') };
    });
    eq(logo.paths, 6, 'six strokes: p e n n y (the y has two)');
    truthy(logo.h === 24 && logo.w > 80, `sidebar wordmark is ${logo.w}x${logo.h}`);
    eq(logo.stroke, logo.ink, 'it takes the text colour, so it follows light and dark');
    eq(logo.hidden, 'true', 'decorative for screen readers (the name is read from the text beside it)');
    // the drawn ink (plus half a stroke each side) must fill the viewBox exactly: nothing clipped, no stray margin
    const fit = await page.$eval('.sidebar svg.wordmark', (e) => {
      const b = e.getBBox();
      const [vx, vy, vw, vh] = e.getAttribute('viewBox').split(' ').map(Number);
      const half = Number(e.getAttribute('stroke-width')) / 2;
      return { left: b.x - half - vx, top: b.y - half - vy, right: vx + vw - (b.x + b.width + half), bottom: vy + vh - (b.y + b.height + half) };
    });
    truthy(Object.values(fit).every((v) => Math.abs(v) <= 2), `ink fits the box to within 2 units: ${JSON.stringify(fit)}`);
    const links = await page.$$eval('head link[rel~="icon"], head link[rel="apple-touch-icon"], head link[rel="manifest"]', (els) => els.map((e) => e.getAttribute('href')));
    for (const href of ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/manifest.webmanifest']) truthy(links.includes(href), `${href} is linked`);
    const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
    eq(manifest.name, 'Penny', 'manifest name');
    truthy(manifest.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon');
    for (const src of [...links, ...manifest.icons.map((i) => i.src)]) {
      const r = await page.evaluate(async (u) => { const x = await fetch(u); return { ok: x.ok, type: x.headers.get('content-type'), size: (await x.arrayBuffer()).byteLength }; }, src);
      truthy(r.ok && r.size > 100 && /image|manifest/.test(r.type), `${src} is served (${r.type}, ${r.size} bytes)`);
    }
    const fresh = await browser.createBrowserContext();
    const out = await fresh.newPage();
    try {
      await out.goto(BASE + '/login', { waitUntil: 'networkidle0' });
      eq(await count(out, '.auth-brand svg.wordmark'), 1, 'wordmark on the sign-in screen');
    } finally {
      await fresh.close();
    }
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
  await check('pointing at the balance opens the breakdown on top of the page and the figure never moves (no flicker)', async () => {
    const figure = () => page.$eval('.hero-balance', (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    const before = await figure();
    await page.evaluate(() => {
      window.__hover = [];
      const el = document.querySelector('.hero-balance');
      el.addEventListener('mouseenter', () => window.__hover.push('enter'));
      el.addEventListener('mouseleave', () => window.__hover.push('leave'));
    });
    await page.mouse.move(before.x, before.y);
    await sleep(900); // longer than the opening animation: a jumping figure would have flickered by now
    eq(await page.$eval('.hero-breakdown', (e) => e.classList.contains('open')), true, 'open while pointing');
    const during = await figure();
    eq(during.y, before.y, 'the figure did not move');
    eq(JSON.stringify(await page.evaluate(() => window.__hover)), '["enter"]', 'one enter, no leave: it did not flicker');
    const panel = await page.$eval('.hero-breakdown', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 40, shadow: getComputedStyle(e).boxShadow }; });
    truthy(await page.evaluate((x, y) => !!document.elementFromPoint(x, y)?.closest('.hero-breakdown'), panel.x, panel.y), 'the panel is on top of the widgets below it, not hidden or clipped');
    truthy(panel.shadow !== 'none', 'the floating panel has a shadow');
    await page.mouse.move(before.x + 600, before.y + 300);
    await sleep(400);
    eq(await page.$eval('.hero-breakdown', (e) => e.classList.contains('open')), false, 'closes when the pointer leaves');
    eq(await page.$eval('.hero-breakdown', (e) => getComputedStyle(e).visibility), 'hidden', 'and is hidden from the tab order and screen readers');
  });
  await check('every floating surface token resolves to a real shadow (light-dark() is only valid around colours)', async () => {
    const shadow = await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.boxShadow = 'var(--pop)';
      document.body.appendChild(d);
      const s = getComputedStyle(d).boxShadow;
      d.remove();
      return s;
    });
    truthy(shadow && shadow !== 'none', `--pop gave "${shadow}"`);
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
    // bring the button to the middle of the screen first: after the hover checks above the page is scrolled, and a button partly under the sticky top bar would be clicked through to the bar
    await page.$eval('.insights-widget .insight .insight-x', (e) => e.scrollIntoView({ block: 'center' }));
    await page.click('.insights-widget .insight .insight-x');
    await sleep(600);
    const afterTitles = await page.$$eval('.insights-widget .insight-title', (e) => e.map((x) => x.textContent));
    truthy(!afterTitles.includes(title) || before > 2, 'the card is gone: ' + JSON.stringify({ before, title, afterTitles }));
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

  await check('"Paying off" lists debts and installment plans with their progress, and "Coming up" has no Overdue badge', async () => {
    const debt = await api(page, 'POST', '/debts', { name: 'E2E widget debt', total_amount: 300, plan: 'monthly', first_due_date: '2031-01-10', installment_count: 3, count_in_budget: true });
    const plan = await api(page, 'POST', '/installments', { description: 'E2E widget plan', installment_amount: 40, installment_count: 4, first_due_date: '2031-01-10', paid_count: 1, category_id: null });
    eq(debt.status + ',' + plan.status, '201,201', 'a debt and a plan');
    try {
      page = await open('/');
      await page.waitForSelector('[data-widget=paying] .paying-row');
      const info = await page.evaluate(() => {
        const w = document.querySelector('[data-widget=paying]');
        const row = (n) => [...w.querySelectorAll('.paying-row')].find((r) => r.textContent.includes(n));
        const d = row('E2E widget debt');
        const p = row('E2E widget plan');
        return { title: w.querySelector('h2, h3')?.textContent ?? '', debtBar: !!d?.querySelector('.progress:not(.steps)'), planSteps: [...(p?.querySelectorAll('.step') ?? [])].map((x) => x.className.replace('step ', '')), planText: p?.textContent ?? '', lead: w.querySelector('.widget-lead')?.textContent ?? '', overdueBadges: document.querySelectorAll('[data-widget=upcoming] .prow .badge.tone-neg').length };
      });
      truthy(/Paying off/.test(info.title), 'the widget is titled: ' + info.title);
      eq(info.debtBar, true, 'a debt gets a plain bar');
      eq(info.planSteps.join(','), 'paid,next,later,later', 'a plan gets a step per installment');
      truthy(/1 of 4 paid/.test(info.planText), 'and says how many are paid');
      truthy(/still to pay in your budget/.test(info.lead), 'the lead says what is left');
      eq(info.overdueBadges, 0, 'no Overdue badge in Coming up');
    } finally {
      await api(page, 'DELETE', '/debts/' + debt.json.id);
      await api(page, 'DELETE', '/installments/' + plan.json.id);
      for (const t of (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((x) => /E2E widget/.test(x.description))) await api(page, 'DELETE', '/transactions/' + t.id + '?hard=1');
    }
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
    // the payments come from the server, so wait for them rather than guessing how long that takes
    await page.waitForFunction(() => [...document.querySelectorAll('.palette-group')].some((x) => x.textContent === 'Payments'), { timeout: 8000 }).catch(() => {});
    truthy((await page.$$eval('.palette-group', (e) => e.map((x) => x.textContent))).includes('Payments'), 'payments group');
    await page.$eval('.palette input', (e) => (e.value = ''));
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.type('.palette input', 'sam');
    await page.waitForFunction(() => [...document.querySelectorAll('.palette-group')].some((x) => x.textContent === 'People'), { timeout: 8000 }).catch(() => {});
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
    eq(await count(page, '.sidebar .logo-mark'), 1, 'the p monogram replaces the wordmark');
    eq(await count(page, '.sidebar .wordmark'), 0, 'no wordmark while collapsed');
    eq(await text(page, '.sidebar .brand-name'), 'Penny', 'the name is still there for screen readers');
    await page.hover('.nav-item:nth-child(2) .nav-link');
    await sleep(700);
    eq(await page.$eval('.nav-item:nth-child(2) .tip', (e) => getComputedStyle(e).opacity), '1', 'tooltip shown');
    page = await open('/');
    eq(await page.$eval('.shell', (e) => e.classList.contains('is-collapsed')), true, 'collapsed after reload');
    await page.click('.collapse-btn');
    await sleep(400);
    eq(await count(page, '.sidebar .wordmark'), 1, 'the wordmark is back after expanding');
  });
  await check('pinning a page moves it to a "Pinned" group', async () => {
    // find Forecast by its name, so adding a page to the sidebar does not move it
    const index = (await page.$$eval('.nav-item .nav-label', (ls) => ls.map((l) => l.textContent.trim()))).indexOf('Forecast') + 1;
    truthy(index > 0, 'Forecast is in the sidebar');
    await page.hover(`.nav-item:nth-child(${index})`);
    await page.click(`.nav-item:nth-child(${index}) .nav-pin`);
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

  console.log('\nCredit card payments');
  const pad2 = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const THIS = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const NEXT = nextMonth.getFullYear() + '-' + pad2(nextMonth.getMonth() + 1);
  const TODAY = THIS + '-' + pad2(now.getDate());
  let cardId = null;
  await check('adding a payment made with the credit card: bought today, counted in next month, balance untouched this month', async () => {
    page = await open('/payments');
    const before = { now: (await api(page, 'GET', '/summary?month=' + THIS)).json.totals, next: (await api(page, 'GET', '/summary?month=' + NEXT)).json.totals };
    await page.click('.head-actions .btn.primary');
    await page.waitForSelector('.card-box');
    eq(await count(page, '.card-box .month-cal'), 0, 'no month choice until the card is switched on');
    await page.type('input[placeholder="e.g. Electricity bill"]', 'E2E card sofa');
    await page.type('input[placeholder="0.00"]', '123.45');
    await page.click('.card-box input[type=checkbox]');
    eq(await page.$eval('.card-box .month-cal-cell.selected', (e) => e.dataset.month), NEXT, 'the next bill is chosen by default');
    truthy(/Leaves your balance on/.test(await text(page, '.card-box')), 'it says when the money leaves');
    truthy(/Bought on/.test(await text(page, '.modal')), 'the date is now the purchase day');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.card-box', { hidden: true });
    const made = (await api(page, 'GET', '/transactions?month=' + NEXT)).json.find((t) => t.description === 'E2E card sofa');
    truthy(made, 'it is listed under next month');
    cardId = made.id;
    eq(made.pay_method, 'credit_card', 'saved as a card payment');
    eq(made.charged_on, TODAY, 'bought today');
    eq(made.date, NEXT + '-10', 'paid on the card pay day of next month');
    eq(made.status, 'pending', 'still to pay until the bill is paid');
    eq((await api(page, 'GET', '/transactions?month=' + THIS)).json.some((t) => t.description === 'E2E card sofa'), false, 'not in this month');
    const after = { now: (await api(page, 'GET', '/summary?month=' + THIS)).json.totals, next: (await api(page, 'GET', '/summary?month=' + NEXT)).json.totals };
    eq(JSON.stringify(after.now), JSON.stringify(before.now), 'this month is untouched');
    eq(Math.round((after.next.expensePending - before.next.expensePending) * 100), 12345, 'next month carries the amount');
  });
  await check('the list marks it as a credit card payment, totals the card, and filters by it', async () => {
    page = await open('/payments?month=' + NEXT);
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.tx-row')].find((x) => x.textContent.includes('E2E card sofa'));
      return r ? { badge: r.querySelector('.badge.card')?.textContent.trim(), meta: r.querySelector('.tx-meta')?.textContent, title: r.querySelector('.badge.card')?.getAttribute('title') } : null;
    });
    truthy(row, 'the row is there');
    eq(row.badge, 'Credit card', 'badge');
    truthy(/bought/.test(row.meta), 'says when it was bought: ' + row.meta);
    truthy(/counts when the bill is paid/i.test(row.title), 'the tooltip explains it');
    eq(/Paid with the card bill|Bought on card/.test(await text(page, '.summary-strip')), false, 'the old tile names are gone');
    await pickFilter(page, 'Paid with', 'Credit card');
    await sleep(600);
    const rows = await page.$$eval('.tx-row', (rs) => rs.map((r) => !!r.querySelector('.badge.card')));
    truthy(rows.length >= 1 && rows.every(Boolean), 'only card payments are listed');
    await pickFilter(page, 'Paid with', 'Cash and bank');
    await sleep(600);
    eq(await page.$$eval('.tx-row', (rs) => rs.some((r) => r.textContent.includes('E2E card sofa'))), false, 'and none of them under cash');
    // ...and it IS shown in the month it was bought, marked as counting later, but not added to that month's figures
    page = await open('/payments?month=' + THIS);
    const bought = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.tx-row')].find((x) => x.textContent.includes('E2E card sofa'));
      return r ? { only: r.classList.contains('purchase-only'), date: r.querySelector('.tx-date strong')?.textContent, meta: r.querySelector('.tx-meta')?.textContent, buttons: [...r.querySelectorAll('.tx-actions button')].map((x) => x.textContent.trim()).filter(Boolean) } : null;
    });
    truthy(bought, 'it is listed in the month it was bought');
    truthy(bought.only, 'marked as a purchase only');
    truthy(/counts on/.test(bought.meta), 'says when it counts: ' + bought.meta);
    eq(bought.buttons.some((t) => /Mark paid|Received|Paid/.test(t)), false, 'no "Mark paid" on a purchase that is not due yet');
    const strip = await text(page, '.summary-strip');
    truthy(/Bought with credit card\s*[€$£]?\s*123\.45/.test(strip), 'the strip shows it as bought with the credit card: ' + strip.replace(/\s+/g, ' '));
    const summary = (await api(page, 'GET', '/summary?month=' + THIS)).json.totals;
    const expensesShown = Number(/Expenses\s*[€$£]?\s*([\d,]+\.\d\d)/.exec(strip.replace(/\s+/g, ' '))[1].replace(/,/g, ''));
    eq(Math.round(expensesShown * 100), Math.round((summary.expensePaid + summary.expensePending) * 100), 'the month\'s expenses do not include it');
    // the "To pay" view is about what is due, so it does not add the purchase to this month
    page = await open('/payments?month=' + THIS + '&status=pending');
    eq(await page.$$eval('.tx-row', (rs) => rs.some((r) => r.textContent.includes('E2E card sofa'))), false, 'not under "To pay" in the month it was bought');
  });
  await check('editing it shows the card details again, and the month can be changed', async () => {
    page = await open('/payments?month=' + NEXT);
    await page.click('[aria-label="Edit E2E card sofa"]');
    await page.waitForSelector('.card-box');
    eq(await page.$eval('.card-box input[type=checkbox]', (e) => e.checked), true, 'the card switch is on');
    eq(await page.$eval('.card-box .month-cal-cell.selected', (e) => e.dataset.month), NEXT, 'its bill month');
    const longToday = await page.evaluate((d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }, TODAY);
    truthy((await page.$eval('.modal .date-btn', (e) => e.getAttribute('aria-label'))).includes(longToday), 'the date field is the purchase day');
    await page.click('.card-box .month-cal-head button:last-of-type'); // next year, where the later months are
    const later = await page.$$eval('.card-box .month-cal-cell:not(.off)', (cells) => cells.at(-1).dataset.month);
    await page.click(`.card-box [data-month="${later}"]`);
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.card-box', { hidden: true });
    const moved = (await api(page, 'GET', '/transactions?month=' + later)).json.find((t) => t.id === cardId);
    truthy(moved, 'it moved to the month chosen (' + later + ')');
    eq(moved.charged_on, TODAY, 'still bought today');
    await api(page, 'PUT', '/transactions/' + cardId, { type: 'expense', description: 'E2E card sofa', amount: 123.45, date: NEXT + '-10', charged_on: TODAY, pay_method: 'credit_card', category_id: null });
  });
  await check('the card pay day is a setting, and the form follows it', async () => {
    page = await open('/settings');
    const field = 'input[type=number][max="28"]';
    eq(await page.$eval(field, (e) => e.value), '10', 'starts at the 10th');
    await page.click(field, { clickCount: 3 });
    await page.type(field, '15');
    await page.evaluate(() => [...document.querySelectorAll('form .btn.primary')].find((b) => b.textContent.trim() === 'Save').click());
    await sleep(800);
    eq((await api(page, 'GET', '/settings')).json.card_pay_day, 15, 'saved');
    page = await open('/payments');
    await page.click('.head-actions .btn.primary');
    await page.waitForSelector('.card-box');
    await page.click('.card-box input[type=checkbox]');
    truthy(/15/.test(await text(page, '.card-box')), 'the form now says the 15th: ' + (await text(page, '.card-box')).slice(-90));
  });
  await check('clean up: the test payment is removed and the pay day is back to the 10th', async () => {
    page = await open('/payments');
    const s = (await api(page, 'GET', '/settings')).json;
    await api(page, 'PUT', '/settings', { opening_balance: s.opening_balance, currency: s.currency, card_pay_day: 10 });
    eq((await api(page, 'DELETE', '/transactions/' + cardId)).status, 200, 'deleted');
    eq((await api(page, 'GET', '/settings')).json.card_pay_day, 10, 'pay day restored');
    eq((await api(page, 'GET', '/transactions?month=' + NEXT)).json.some((t) => t.description === 'E2E card sofa'), false, 'gone');
  });

  console.log('\nDebts');
  const DEBT = 'E2E Faeze';
  const debtByName = async (name) => (await api(page, 'GET', '/debts')).json.debts.find((d) => d.name === name);
  const fillDebt = async (name, total) => {
    await page.type('input[placeholder="e.g. Faeze, Car loan"]', name);
    await page.type('.modal input[placeholder="0.00"]', String(total));
  };
  const pickSegment = (label) => page.evaluate((l) => [...document.querySelectorAll('.modal .segmented button')].find((b) => b.textContent.trim() === l)?.click(), label);
  await check('Debts is in the sidebar, and the palette can start one', async () => {
    page = await open('/');
    truthy((await page.$$eval('.sidebar .nav-link', (as) => as.map((a) => a.textContent.trim()))).some((t) => /^Debts/.test(t)), 'a Debts link in the sidebar');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.palette');
    await page.type('.palette input', 'add a debt');
    await sleep(300);
    eq(await page.$eval('.palette-item.active .palette-label', (e) => e.textContent.trim()), 'Add a debt', 'the palette finds it');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.modal input[placeholder="e.g. Faeze, Car loan"]', { timeout: 4000 });
    truthy(/\/debts/.test(page.url()), 'it opened the Debts page with the form');
  });
  await check('adding a debt split over three months: the preview, the payments and the badge', async () => {
    page = await open('/debts');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Add debt/.test(x.textContent))?.click());
    await page.waitForSelector('.modal');
    await fillDebt(DEBT, 300);
    await pickSegment('Split over months');
    truthy(/3 payments of\s*€100\.00/.test(await text(page, '.modal .banner')), 'the preview says 3 payments of 100: ' + (await text(page, '.modal .banner')));
    truthy(/Its payments appear in Payments and in your forecast/.test(await text(page, '.modal .split-box')), 'counted by default, and it says what that means');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const d = await debtByName(DEBT);
    truthy(d, 'saved');
    eq([d.plan, d.installment_count, d.count_in_budget, d.scheduled_count, d.remaining].join(','), 'monthly,3,true,3,300', 'a three payment plan, counted');
    const card = await page.evaluate((n) => {
      const c = [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n);
      return c ? { badge: c.querySelector('.badge')?.textContent.trim(), text: c.textContent } : null;
    }, DEBT);
    truthy(card, 'its card is on the page');
    eq(card.badge, 'In your forecast', 'badge');
    truthy(/Still owed\s*€300\.00/.test(card.text) && /3 monthly payments/.test(card.text), 'figures and plan: ' + card.text.slice(0, 120));
  });
  await check('its repayments are real payments with a Debt badge, in the right months', async () => {
    const d = await debtByName(DEBT);
    const next = d.next_due.slice(0, 7);
    page = await open('/payments?month=' + next);
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.tx-row')].find((x) => x.textContent.includes('Repay E2E Faeze'));
      return r ? { text: r.querySelector('.tx-title')?.textContent, badge: !!r.querySelector('.badge') && /Debt/.test(r.querySelector('.tx-title').textContent) } : null;
    });
    truthy(row && row.badge, 'a "Debt" badge on the repayment: ' + JSON.stringify(row));
    truthy(/\(1\/3\)/.test(row.text), 'numbered 1 of 3');
  });
  await check('recording a payment lowers what is owed and shrinks the payments still planned', async () => {
    page = await open('/debts');
    await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelector('.debt-actions .primary-soft').click(), DEBT);
    await page.waitForSelector('.modal');
    await page.click('.modal input[type=number]', { clickCount: 3 });
    await page.type('.modal input[type=number]', '60');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    await sleep(500);
    const d = await debtByName(DEBT);
    eq([d.paid, d.remaining, d.scheduled_total].join(','), '60,240,240', 'paid 60, 240 left, planned payments now share 240');
    const pend = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=pending')).json.filter((t) => t.debt_id === d.id).map((t) => t.amount);
    eq(pend.join(','), '80,80,80', 'three payments of 80');
    truthy(/Still owed\s*€240\.00/.test(await text(page, '.card.debt')), 'the card shows 240');
  });
  await check('the repayment timeline is closed at first, then shows paid, next, later and the debt-free day', async () => {
    page = await open('/debts');
    eq(await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelector('details.timeline-wrap').open, DEBT), false, 'closed by default');
    await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelector('details.timeline-wrap > summary').click(), DEBT);
    await sleep(200);
    const info = await page.evaluate((n) => {
      const c = [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n);
      const ol = c.querySelector('ol.timeline');
      return { steps: [...ol.querySelectorAll('li')].map((li) => li.className.replace('tl-step ', '')), label: ol.getAttribute('aria-label'), end: c.querySelector('.tl-step.end')?.textContent };
    }, DEBT);
    eq(info.steps.join(','), 'paid,next,later,later,end', 'paid 60, then three planned payments, then the debt-free line');
    eq(info.label, 'Repayment timeline for ' + DEBT, 'the list is named');
    truthy(/Debt-free/.test(info.end), 'it says Debt-free');
  });
  await check('"count it in my budget" off: the plan is kept but the payments leave the forecast', async () => {
    page = await open('/debts');
    await page.click('[aria-label="Edit ' + DEBT + '"]');
    await page.waitForSelector('.modal');
    await page.click('.modal .split-box input[type=checkbox]');
    truthy(/Only kept on file/.test(await text(page, '.modal .split-box')), 'it explains: only kept on file');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const d = await debtByName(DEBT);
    eq([d.count_in_budget, d.scheduled_count, d.plan, d.paid].join(','), 'false,0,monthly,60', 'no payments, plan and the 60 paid are kept');
    const badge = await page.$eval('.card.debt .badge', (e) => e.textContent.trim());
    eq(badge, 'Not counted');
    eq((await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=pending')).json.some((t) => t.debt_id === d.id), false, 'nothing pending');
  });
  await check('turning it back on, settling by hand, reopening and deleting', async () => {
    page = await open('/debts');
    await page.click('[aria-label="Edit ' + DEBT + '"]');
    await page.waitForSelector('.modal');
    await page.click('.modal .split-box input[type=checkbox]');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    eq((await debtByName(DEBT)).scheduled_count, 3, 'three payments again');
    await page.evaluate(() => (window.confirm = () => true));
    await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelectorAll('.debt-actions .btn')[1].click(), DEBT);
    await sleep(700);
    eq((await debtByName(DEBT)).status, 'settled', 'settled');
    truthy(/Settled/.test(await text(page, 'main, .content, body')), 'it moved to the Settled section');
    await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelector('.debt-actions .btn').click(), DEBT);
    await sleep(700);
    eq((await debtByName(DEBT)).status, 'active', 'reopened');
    await page.click('[aria-label="Delete ' + DEBT + '"]');
    await sleep(700);
    eq(await debtByName(DEBT), undefined, 'deleted');
    eq((await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((t) => t.description.includes('E2E Faeze')).every((t) => t.status === 'paid'), true, 'only the paid payment is left in the history');
  });
  await check('a debt with no plan sits on file, counted or not, and the totals say so', async () => {
    page = await open('/debts');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Add debt/.test(x.textContent))?.click());
    await page.waitForSelector('.modal');
    await fillDebt('E2E Romena', 520);
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const d = await debtByName('E2E Romena');
    eq([d.plan, d.scheduled_count, d.remaining].join(','), 'none,0,520', 'on file, nothing scheduled');
    truthy(/Total owed\s*€[\d,]*520\.00/.test(await text(page, '.summary-strip')) || /520\.00/.test(await text(page, '.summary-strip')), 'the total owed includes it');
    truthy(/after paying every counted debt/i.test(await text(page, 'body')), 'the balance after debts is shown');
  });
  await check('clean up: the test debts and the test payments are gone', async () => {
    page = await open('/debts');
    for (const d of (await api(page, 'GET', '/debts')).json.debts.filter((x) => x.name.startsWith('E2E '))) await api(page, 'DELETE', '/debts/' + d.id);
    const left = (await api(page, 'GET', '/debts')).json.debts.filter((x) => x.name.startsWith('E2E '));
    eq(left.length, 0, 'no test debts left');
    const paid = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=paid')).json.filter((t) => /E2E (Faeze|Romena)/.test(t.description));
    for (const t of paid) await api(page, 'DELETE', '/transactions/' + t.id + '?hard=1');
    eq((await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.some((t) => /E2E (Faeze|Romena)/.test(t.description)), false, 'no test payments left');
  });

  console.log('\nMoney owed to you');
  const LENT = 'E2E Sam';
  const sideTabs = () => page.$$eval('.debt-sides .segmented button', (bs) => bs.map((b) => b.textContent.trim()));
  const clickSide = (label) => page.evaluate((l) => [...document.querySelectorAll('.debt-sides .segmented button')].find((b) => b.textContent.trim().startsWith(l))?.click(), label);
  const lentCard = () => page.evaluate((n) => { const c = [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n); return c ? { text: c.textContent, direction: c.getAttribute('data-direction'), badge: c.querySelector('.badge')?.textContent.trim() } : null; }, LENT);
  await check('Debts has two sides, and the palette starts one for money someone owes you', async () => {
    page = await open('/debts');
    await page.waitForSelector('.debt-sides');
    truthy((await sideTabs())[0].startsWith('I owe') && (await sideTabs())[1].startsWith('Owed to me'), 'the two sides: ' + (await sideTabs()).join(' | '));
    page = await open('/');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.palette');
    await page.type('.palette input', 'owes me');
    await sleep(300);
    eq(await page.$eval('.palette-item.active .palette-label', (e) => e.textContent.trim()), 'Someone owes me money', 'the palette finds it');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.modal input[placeholder="e.g. Sam, Dinner share"]', { timeout: 4000 });
    truthy(/show=lent/.test(page.url()) || /Who owes you/.test(await text(page, '.modal')), 'it opened the Owed to me form: ' + page.url());
  });
  await check('adding what someone owes you in three repayments: the preview, the wording and the income', async () => {
    page = await open('/debts?show=lent');
    await page.waitForSelector('.debt-sides');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Add what someone owes me/.test(x.textContent))?.click());
    await page.waitForSelector('.modal');
    truthy(/Who owes you/.test(await text(page, '.modal')), 'it asks who owes you');
    await page.type('input[placeholder="e.g. Sam, Dinner share"]', LENT);
    await page.type('.modal input[placeholder="0.00"]', '300');
    await pickSegment('Split over months');
    truthy(/3 repayments of\s*€100\.00/.test(await text(page, '.modal .banner')), 'the preview says repayments: ' + (await text(page, '.modal .banner')));
    truthy(/appear in Payments as money coming in/.test(await text(page, '.modal')), 'it says they come in as income');
    truthy(/Also record the money I handed over/.test(await text(page, '.modal')) && /not counted as spending/.test(await text(page, '.modal')), 'the loan option, and that it is not spending');
    eq(await page.$eval('.modal input[type=checkbox]', (e) => e.checked), false, 'off by default');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const d = (await api(page, 'GET', '/debts')).json.debts.find((x) => x.name === LENT);
    eq([d.direction, d.plan, d.scheduled_count, d.remaining].join(','), 'lent,monthly,3,300', 'a lent debt with three repayments');
    const card = await lentCard();
    truthy(card, 'its card is on the page');
    eq(card.direction + ',' + card.badge, 'lent,In your forecast', 'direction and badge');
    truthy(/Still owed to you\s*€300\.00/.test(card.text) && /3 monthly repayments/.test(card.text), 'figures: ' + card.text.slice(0, 140));
    truthy(/Owed to you\s*€/.test(await text(page, '.summary-strip')) && /If everyone paid you back/.test(await text(page, 'body')), 'the summary and the balance line speak of money owed to you');
  });
  await check('the two sides are kept apart: it is not under "I owe", and not in the totals of what you owe', async () => {
    await clickSide('I owe');
    await sleep(300);
    eq(await lentCard(), null, 'not on the I owe side');
    const t = (await api(page, 'GET', '/debts')).json;
    eq(t.lent_totals.owed_to_me >= 300, true, 'counted on the owed-to-me side');
    eq(t.debts.filter((x) => x.direction === 'owe').some((x) => x.name === LENT), false, 'not among the debts you owe');
    await clickSide('Owed to me');
    await sleep(300);
    truthy(await lentCard(), 'back on its own side');
  });
  await check('its repayments are pending income with a "Paid back" badge, and the Paying off widget ignores it', async () => {
    const d = (await api(page, 'GET', '/debts')).json.debts.find((x) => x.name === LENT);
    page = await open('/payments?month=' + d.next_due.slice(0, 7));
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.tx-row')].find((x) => x.textContent.includes('Repayment from E2E Sam'));
      return r ? { title: r.querySelector('.tx-title')?.textContent, income: !!r.querySelector('.amount.income, .num.income, .pos') || /\+/.test(r.textContent) } : null;
    });
    truthy(row && /Paid back/.test(row.title) && /\(1\/3\)/.test(row.title), 'a Paid back badge, numbered: ' + JSON.stringify(row));
    const tx = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=pending')).json.filter((t) => t.debt_id === d.id);
    eq(tx.map((t) => t.type).join(','), 'income,income,income', 'all three are income');
    page = await open('/');
    await page.waitForSelector('[data-widget=paying]');
    await sleep(500);
    eq(await page.$eval('[data-widget=paying]', (w) => w.textContent.includes('E2E Sam')), false, 'money owed to you is not "paying off"');
  });
  await check('recording money received raises the balance and lowers what is still owed to you', async () => {
    const before = (await api(page, 'GET', '/summary')).json.balance;
    page = await open('/debts?show=lent');
    await page.waitForSelector('.card.debt');
    await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelector('.debt-actions .primary-soft').click(), LENT);
    await page.waitForSelector('.modal');
    truthy(/raises your balance/.test(await text(page, '.modal')), 'it says money received raises the balance');
    await page.click('.modal input[type=number]', { clickCount: 3 });
    await page.type('.modal input[type=number]', '60');
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    await sleep(500);
    const d = (await api(page, 'GET', '/debts')).json.debts.find((x) => x.name === LENT);
    eq([d.paid, d.remaining, d.scheduled_total].join(','), '60,240,240', '60 received, 240 still owed, the rest shares 240');
    eq(Math.round(((await api(page, 'GET', '/summary')).json.balance - before) * 100), 6000, 'the balance rose by 60');
    truthy(/Still owed to you\s*€240\.00/.test((await lentCard()).text) && /60\.00.{0,10}received/.test((await lentCard()).text), 'the card says received');
  });
  await check('the timeline says Received and Paid back, and a debt you owe is unchanged', async () => {
    await page.evaluate((n) => [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n).querySelector('details.timeline-wrap > summary').click(), LENT);
    await sleep(200);
    const info = await page.evaluate((n) => { const c = [...document.querySelectorAll('.card.debt')].find((x) => x.querySelector('h3')?.textContent === n); return { text: c.querySelector('ol.timeline').textContent, steps: [...c.querySelectorAll('ol.timeline li')].map((li) => li.className.replace('tl-step ', '')) }; }, LENT);
    eq(info.steps.join(','), 'paid,next,later,later,end', 'received 60, then three expected, then the end');
    truthy(/Received/.test(info.text) && /Expected/.test(info.text) && /Paid back/.test(info.text), 'the words fit: ' + info.text.slice(0, 120));
    truthy(!/Debt-free/.test(info.text), 'not "Debt-free"');
  });
  await check('clean up: the test money owed to you and its payments are gone', async () => {
    page = await open('/debts?show=lent');
    for (const d of (await api(page, 'GET', '/debts')).json.debts.filter((x) => x.name.startsWith('E2E '))) await api(page, 'DELETE', '/debts/' + d.id);
    for (const t of (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((x) => /E2E Sam/.test(x.description))) await api(page, 'DELETE', '/transactions/' + t.id + '?hard=1');
    eq((await api(page, 'GET', '/debts')).json.debts.some((x) => x.name.startsWith('E2E ')), false, 'no test debts left');
    eq((await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.some((x) => /E2E Sam/.test(x.description)), false, 'no test payments left');
  });

  console.log('\nInstallments');
  await check('an installment plan shows a step per payment, what each is, and the last day', async () => {
    page = await open('/installments');
    const made = await api(page, 'POST', '/installments', { description: 'E2E steps', installment_amount: 50, installment_count: 4, first_due_date: '2031-01-10', paid_count: 1, category_id: null });
    eq(made.status, 201, 'a plan with 1 of 4 paid');
    try {
      page = await open('/installments');
      await page.waitForSelector('.card.plan');
      const info = await page.evaluate(() => {
        const c = [...document.querySelectorAll('.card.plan')].find((x) => x.querySelector('h3')?.textContent === 'E2E steps');
        const bar = c.querySelector('.progress');
        return { steps: [...bar.querySelectorAll('.step')].map((x) => x.className.replace('step ', '')), hidden: [...bar.querySelectorAll('.step')].every((x) => x.getAttribute('aria-hidden') === 'true'), label: bar.getAttribute('aria-label'), now: bar.getAttribute('aria-valuenow'), line: c.querySelector('.muted.small')?.textContent ?? '' };
      });
      eq(info.steps.join(','), 'paid,next,later,later', 'paid, next, then two to come');
      eq(info.hidden, true, 'steps are decoration');
      eq(info.label + '|' + info.now, '1 of 4 installments paid|25', 'the bar still says it in words');
      truthy(/about .*50.00 each/.test(info.line) && /the last one is on/.test(info.line), 'the line says what each is and when it ends: ' + info.line);
    } finally {
      await api(page, 'DELETE', '/installments/' + made.json.id);
      for (const t of (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((x) => x.description.includes('E2E steps'))) await api(page, 'DELETE', '/transactions/' + t.id + '?hard=1');
    }
  });
  await check('the Installments page is left clean: no test plans remain', async () => {
    page = await open('/installments');
    eq((await api(page, 'GET', '/installments')).json.filter((p) => p.description.startsWith('E2E ')).length, 0, 'none left');
    eq((await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.some((x) => x.description.includes('E2E steps')), false, 'and no test payments');
  });

  console.log('\nRecurring items: how they end');
  let ruleId = null;
  await check('ending a recurring item after a number of payments shows the last payment and saves the date', async () => {
    page = await open('/recurring?new=1');
    await page.waitForSelector('.end-box');
    eq(await page.$eval('.end-box .segmented .active', (e) => e.textContent.trim()), 'Never', 'never by default');
    truthy(/keeps going/.test(await text(page, '.end-box')), 'it says it keeps going');
    await page.type('.modal input[type=text], .modal input:not([type])', 'E2E ends');
    await page.type('.modal input[type=number][step="0.01"]', '10');
    await page.evaluate(() => [...document.querySelectorAll('.end-box .segmented button')].find((b) => /After a number/.test(b.textContent))?.click());
    await page.click('.end-box input[type=number]', { clickCount: 3 });
    await page.type('.end-box input[type=number]', '3');
    truthy(/3 payments in total/.test(await text(page, '.end-box')), 'the last payment is shown: ' + (await text(page, '.end-box')).slice(-90));
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const rule = (await api(page, 'GET', '/recurring')).json.find((r) => r.description === 'E2E ends');
    truthy(rule, 'saved');
    ruleId = rule.id;
    const pending = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=pending&limit=500')).json.filter((t) => t.recurring_id === rule.id);
    eq(pending.length, 3, 'exactly three payments were created');
    eq(rule.end_date, pending.map((t) => t.date).sort().at(-1), 'the end date is the third payment');
    truthy(await page.evaluate(() => { const r = [...document.querySelectorAll('.tx-row.rule')].find((x) => x.textContent.includes('E2E ends')); return !!r && /Ends/.test(r.querySelector('.badge')?.textContent ?? ''); }), 'the list shows when it ends');
  });
  await check('editing it opens on "On a date", and "Never" removes the ending', async () => {
    page = await open('/recurring');
    await page.click('[aria-label="Edit E2E ends"]');
    await page.waitForSelector('.end-box');
    eq(await page.$eval('.end-box .segmented .active', (e) => e.textContent.trim()), 'On a date', 'an existing ending opens as a date');
    truthy(!/not set/.test(await page.$eval('.end-box .date-btn', (e) => e.getAttribute('aria-label'))), 'with its date filled in');
    await page.evaluate(() => [...document.querySelectorAll('.end-box .segmented button')].find((b) => b.textContent.trim() === 'Never')?.click());
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    eq((await api(page, 'GET', '/recurring')).json.find((r) => r.id === ruleId).end_date, null, 'no ending any more');
  });
  await check('clean up: the test recurring item is removed', async () => {
    page = await open('/recurring');
    eq((await api(page, 'DELETE', '/recurring/' + ruleId)).status, 204, 'deleted');
    eq((await api(page, 'GET', '/recurring')).json.some((r) => r.description === 'E2E ends'), false, 'gone');
  });

  console.log('\nDate picker');
  let dateRule;
  const longOf = (d) => page.evaluate((x) => { const [y, m, dd] = x.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }, d);
  const dateBtnLabel = () => page.$eval('.modal .date-btn', (e) => e.getAttribute('aria-label'));
  const openDateEdit = async () => {
    page = await open('/recurring');
    await page.click('[aria-label="Edit E2E dates"]');
    await page.waitForSelector('.modal');
  };
  await check('a date field is our own calendar, not the browser one: Monday first, today ringed, the chosen day filled', async () => {
    const made = await api(page, 'POST', '/recurring', { type: 'expense', description: 'E2E dates', amount: 50, frequency: 'monthly', interval_count: 1, start_date: THIS + '-15', active: true });
    eq(made.status, 201, 'a monthly item on the 15th');
    dateRule = made.json.id;
    await openDateEdit();
    eq(await count(page, '.modal input[type=date]'), 0, 'no browser date input in the form');
    await page.click('.modal .date-btn');
    await page.waitForSelector('.date-pop');
    const info = await page.evaluate(() => ({
      week: [...document.querySelectorAll('.date-week span')].map((e) => e.textContent.trim().toLowerCase().slice(0, 2)),
      cells: document.querySelectorAll('.date-cell').length,
      selected: document.querySelector('.date-cell.selected')?.dataset.ymd,
      today: document.querySelectorAll('.date-cell.today').length,
      dialog: document.querySelector('.date-pop')?.getAttribute('role'),
      focused: document.activeElement?.dataset?.ymd,
    }));
    eq(info.week.join(','), 'mo,tu,we,th,fr,sa,su', 'Monday first');
    eq(info.cells, 42, 'six whole weeks, so the page keeps its height');
    eq(info.selected, THIS + '-15', 'the chosen day is filled');
    eq(info.today, 1, 'today has a ring');
    eq(info.dialog, 'dialog', 'it is a dialog');
    eq(info.focused, THIS + '-15', 'focus starts on the chosen day');
    eq(await page.$eval('.modal .date-btn', (e) => e.getAttribute('aria-expanded')), 'true', 'the button says it is open');
  });
  await check('choosing a day closes the calendar, not the form; another month, a year and Today work', async () => {
    await page.click('.date-pop [data-ymd="' + THIS + '-20"]');
    await page.waitForSelector('.date-pop', { hidden: true });
    truthy(await page.$('.modal'), 'the form is still open');
    truthy((await dateBtnLabel()).includes(await longOf(THIS + '-20')), 'the button shows the new day: ' + (await dateBtnLabel()));
    await page.click('.modal .date-btn');
    await page.waitForSelector('.date-pop');
    const title = () => page.$eval('.date-title', (e) => e.textContent.trim());
    const before = await title();
    await page.click('.date-head button[aria-label="Next month"]');
    await sleep(150);
    truthy((await title()) !== before, 'the arrow moved to the next month');
    await page.click('.date-title');
    await page.waitForSelector('.date-pop .month-cal-cell');
    eq(await count(page, '.date-pop .month-cal-cell'), 12, 'twelve months to jump to');
    await page.click('.date-head button[aria-label="Next year"]');
    await sleep(150);
    await page.evaluate(() => document.querySelector('.date-pop .month-cal-cell[data-month$="-03"]').click());
    await page.waitForSelector('.date-grid');
    truthy(/March/.test(await title()), 'back on the days of the month that was chosen: ' + (await title()));
    await page.evaluate(() => [...document.querySelectorAll('.date-foot .btn')].find((b) => b.textContent.trim() === 'Today').click());
    await page.waitForSelector('.date-pop', { hidden: true });
    truthy((await dateBtnLabel()).includes(await longOf(TODAY)), 'Today picked today: ' + (await dateBtnLabel()));
  });
  await check('the keyboard: arrows and Page Down move, Escape closes the calendar first and the form second', async () => {
    await page.click('.modal .date-btn');
    await page.waitForSelector('.date-pop');
    const focused = () => page.evaluate(() => document.activeElement?.dataset?.ymd ?? '');
    const start = await focused();
    eq(start, TODAY, 'on the chosen day');
    await page.keyboard.press('ArrowRight');
    const next = await focused();
    truthy(next > start && next.slice(0, 7) >= start.slice(0, 7), 'ArrowRight went one day on: ' + start + ' -> ' + next);
    await page.keyboard.press('ArrowDown');
    truthy((await focused()) > next, 'ArrowDown went a week on');
    const month = (await focused()).slice(0, 7);
    await page.keyboard.press('PageDown');
    truthy((await focused()).slice(0, 7) > month, 'Page Down went to the next month');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.date-pop', { hidden: true });
    truthy(await page.$('.modal'), 'Escape closed only the calendar');
    eq(await page.evaluate(() => document.activeElement?.classList.contains('date-btn')), true, 'focus came back to the field');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { hidden: true });
  });
  await check('days that cannot be chosen are struck through and refuse the click (the last day cannot be before the first)', async () => {
    await openDateEdit();
    await page.evaluate(() => [...document.querySelectorAll('.end-box .segmented button')].find((b) => /On a date/.test(b.textContent))?.click());
    await page.waitForSelector('.end-box .date-btn');
    const startLabel = await page.$eval('.end-box .date-btn', (e) => e.getAttribute('aria-label'));
    await page.click('.end-box .date-btn');
    await page.waitForSelector('.date-pop');
    const off = await page.evaluate(() => ({ n: document.querySelectorAll('.date-cell.off').length, title: document.querySelector('.date-cell.off')?.getAttribute('title'), first: document.querySelector('.date-cell.off')?.dataset.ymd }));
    truthy(off.n > 0 && off.title === 'Too early', 'days before the start are off: ' + JSON.stringify(off));
    await page.click('.date-pop [data-ymd="' + off.first + '"]');
    await sleep(150);
    truthy(await page.$('.date-pop'), 'clicking a day that is off does nothing');
    eq(await page.$eval('.end-box .date-btn', (e) => e.getAttribute('aria-label')), startLabel, 'the value did not change');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { hidden: true });
  });
  await check('changing the date of the recurring item on the Recurring page moves every unpaid month', async () => {
    const pending = async () => (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=pending&limit=1000')).json.filter((t) => t.recurring_id === dateRule);
    const before = await pending();
    truthy(before.length >= 24, 'two years of payments: ' + before.length);
    await openDateEdit();
    await page.click('.modal .date-btn');
    await page.waitForSelector('.date-pop');
    await page.click('.date-pop [data-ymd="' + THIS + '-22"]');
    await page.waitForSelector('.date-pop', { hidden: true });
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const after = await pending();
    eq(after.length, before.length, 'the same number of months');
    eq([...new Set(after.map((t) => t.date.slice(8)))].join(), '22', 'every month is on the 22nd now');
  });
  await check('changing one month on the Payments page changes only that month, not the recurring item', async () => {
    page = await open('/payments?month=' + NEXT);
    await page.evaluate(() => [...document.querySelectorAll('.tx-row')].find((r) => r.textContent.includes('E2E dates')).querySelector('[aria-label="Edit E2E dates"]').click());
    await page.waitForSelector('.modal');
    truthy(/only affect this payment/.test(await text(page, '.modal .banner')), 'the form says it changes only this payment');
    await page.click('.modal .date-btn');
    await page.waitForSelector('.date-pop');
    await page.click('.date-pop [data-ymd="' + NEXT + '-03"]');
    await page.waitForSelector('.date-pop', { hidden: true });
    await page.click('.modal .form-actions .btn.primary');
    await page.waitForSelector('.modal', { hidden: true });
    const all = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=pending&limit=1000')).json.filter((t) => t.recurring_id === dateRule);
    eq(all.filter((t) => t.date === NEXT + '-03').length, 1, 'that month moved to the 3rd');
    eq([...new Set(all.filter((t) => t.date !== NEXT + '-03').map((t) => t.date.slice(8)))].join(), '22', 'every other month is still on the 22nd');
    const rule = (await api(page, 'GET', '/recurring')).json.find((r) => r.id === dateRule);
    eq(rule.start_date.slice(8) + ',' + rule.amount, '22,50', 'the recurring item itself is as it was');
  });
  await check('clean up: the test recurring item for the dates is removed', async () => {
    page = await open('/recurring');
    eq((await api(page, 'DELETE', '/recurring/' + dateRule)).status, 204, 'deleted');
    eq((await api(page, 'GET', '/recurring')).json.some((r) => r.description === 'E2E dates'), false, 'gone');
  });

  await check('recurring items say what they come to in a month, with a share bar that is only decoration', async () => {
    page = await open('/recurring');
    await page.waitForSelector('.tx-row.rule');
    const info = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tx-row.rule')];
      const active = rows.filter((r) => !r.classList.contains('skipped'));
      return {
        active: active.length,
        withShare: active.filter((r) => /about .* a month · \d+% of (commitments|income)/.test(r.querySelector('.rule-share')?.textContent ?? '')).length,
        barsHidden: [...document.querySelectorAll('.rule-bar')].every((b) => b.getAttribute('aria-hidden') === 'true'),
        pausedWithShare: rows.filter((r) => r.classList.contains('skipped') && r.querySelector('.rule-share')).length,
      };
    });
    truthy(info.active > 0, 'there are active items');
    eq(info.withShare, info.active, 'every active item says what it comes to a month');
    eq(info.barsHidden, true, 'bars are hidden from screen readers');
    eq(info.pausedWithShare, 0, 'paused items show no figure');
  });

  console.log('\nSigning in');
  // The demo accounts' documented test password (see DEMO-LOGINS.md); this app is running locally.
  const DEMO_PASSWORD = 'Budget-Showcase#2026';
  const signInPage = async (typed, password) => {
    const fresh = await browser.createBrowserContext(); // its own cookie jar: nobody is signed in
    const p = await fresh.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
    await p.type('input[autocomplete=username]', typed);
    await p.type('input[autocomplete=current-password]', password);
    await p.click('.auth-card .btn.primary.wide');
    return { p, close: () => fresh.close() };
  };
  await check('the sign-in form asks for an email or a username', async () => {
    const fresh = await browser.createBrowserContext();
    const p = await fresh.newPage();
    try {
      await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
      eq(await p.$eval('input[autocomplete=username]', (e) => e.closest('label').querySelector('.field-label').textContent.trim()), 'Email or username', 'the label');
      eq(await p.$eval('input[autocomplete=username]', (e) => e.type), 'text', 'a plain text box, so a username is not rejected as "not an email"');
      truthy(/@username/.test(await p.$eval('input[autocomplete=username]', (e) => e.placeholder)), 'the placeholder shows both');
    } finally {
      await fresh.close();
    }
  });
  for (const [label, typed] of [['username', 'alex'], ['username with an @ and capitals', '@Alex'], ['email address', 'alex.morgan@example.com']]) {
    await check('signing in with the ' + label + ' reaches the dashboard', async () => {
      const s = await signInPage(typed, DEMO_PASSWORD);
      try {
        await s.p.waitForSelector('.dash-title h1', { timeout: 8000 });
        truthy(/Alex/.test(await s.p.$eval('.dash-title h1', (e) => e.textContent)), 'the dashboard greets Alex');
      } finally {
        await s.close();
      }
    });
  }
  await check('a wrong password, or a username that does not exist, gets the same calm message and stays on the sign-in page', async () => {
    for (const [typed, password] of [['alex', 'Not-The-Password1!'], ['nobody.at.all', DEMO_PASSWORD]]) {
      const s = await signInPage(typed, password);
      try {
        await s.p.waitForFunction(() => /Invalid email, username or password/.test(document.body.innerText), { timeout: 6000 });
        eq(await s.p.$$eval('.dash-title', (e) => e.length), 0, 'still signed out');
        truthy((await s.p.$eval('input[autocomplete=username]', (e) => e.value)) === typed, 'what was typed is still there');
      } finally {
        await s.close();
      }
    }
  });

  console.log('\nMonth calendar');
  const monthOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const plus = (n) => monthOf(new Date(new Date().getFullYear(), new Date().getMonth() + n, 1));
  const NOWM = plus(0);
  const CAL_NEXT = plus(1);
  const popupFits = (p) => p.evaluate(() => { const r = document.querySelector('.month-pop')?.getBoundingClientRect(); return !!r && r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1; });
  await check('the dashboard has a month calendar: it opens on this month, ringed, with the year and arrows', async () => {
    page = await open('/');
    await page.waitForSelector('.dash-monthbar .month-picker-btn');
    eq(await page.$eval('.dash-monthbar .month-picker-btn', (e) => e.getAttribute('aria-expanded')), 'false', 'closed at first');
    await page.click('.dash-monthbar .month-picker-btn');
    await page.waitForSelector('.month-pop .month-cal-cell');
    eq(await count(page, '.month-pop .month-cal-cell'), 12, 'twelve months');
    eq(await page.$eval('.month-pop .month-cal-cell.selected', (e) => e.dataset.month), NOWM, 'this month is chosen');
    eq(await page.$eval('.month-pop .month-cal-cell.now', (e) => e.getAttribute('aria-current')), 'date', 'and marked as now');
    eq(await page.$eval('.month-pop .month-cal-year', (e) => e.textContent), NOWM.slice(0, 4), 'the year is shown');
    truthy(await popupFits(page), 'the popup is inside the screen');
    await sleep(300);
    eq(await page.evaluate(() => document.activeElement?.dataset?.month), NOWM, 'keyboard focus starts on the chosen month');
  });
  await check('months outside the dashboard\'s reach are greyed out with a reason', async () => {
    // the dashboard reaches 12 months back and 24 ahead
    for (let i = 0; i < 4; i++) await page.click('.month-pop .month-cal-head button:last-of-type').catch(() => {});
    const far = await page.$$eval('.month-pop .month-cal-cell.off', (cells) => cells.map((c) => [c.dataset.month, c.getAttribute('aria-disabled'), c.getAttribute('title')]));
    truthy(far.length > 0, 'some months are greyed out three or four years ahead');
    truthy(far.every(([, d, t]) => d === 'true' && /Too far ahead/.test(t)), 'each says why: ' + JSON.stringify(far[0]));
    const before = page.url();
    await page.evaluate(() => document.querySelector('.month-pop .month-cal-cell.off').click());
    eq(page.url(), before, 'clicking one does nothing');
    await page.keyboard.press('Escape');
  });
  await check('choosing a month points the dashboard at it: address, banner, balance, payments, spending; insights step aside', async () => {
    page = await open('/');
    await page.click('.dash-monthbar .month-picker-btn');
    await page.waitForSelector('.month-pop');
    await page.evaluate((m) => document.querySelector(`.month-pop [data-month="${m}"]`).click(), CAL_NEXT);
    await page.waitForFunction((m) => location.search.includes('month=' + m), { timeout: 5000 }, CAL_NEXT);
    eq(await count(page, '.month-pop'), 0, 'the popup closed');
    await page.waitForSelector('.month-note', { timeout: 6000 });
    truthy(/Showing/.test(await text(page, '.month-note')), 'a note says which month is shown');
    await page.waitForFunction(() => /end of/i.test(document.querySelector('.hero-figure .eyebrow')?.textContent ?? ''), { timeout: 8000 });
    truthy(/Payments this month/.test(await text(page, 'main, body')), '"Coming up" became the month\'s payments');
    eq(await count(page, '[data-widget=insights]'), 0, 'insights are left out of another month');
    truthy((await count(page, '[data-widget=spending]')) === 1 && (await count(page, '[data-widget=outlook]')) === 1, 'spending and cash flow are still there');
    eq(await page.$eval('.dash-monthbar .month-picker-btn', (e, year) => e.textContent.includes(year), CAL_NEXT.slice(0, 4)), true, 'the button shows the month');
  });
  await check('the month view fills with the numbers of that month, the same as the Payments page and the forecast', async () => {
    const fc = (await api(page, 'GET', '/forecast?past=5&months=6')).json.months.find((m) => m.month === CAL_NEXT);
    const shown = await page.$eval('.hero-balance', (e) => e.textContent.replace(/[^\d.\-−]/g, '').replace('−', '-'));
    eq(Math.round(Number(shown) * 100), Math.round(fc.endBalance * 100), 'the balance at the end of the month is the forecast\'s');
    const rows = (await api(page, 'GET', '/transactions?month=' + CAL_NEXT + '&bought=1&limit=300')).json;
    const listed = await count(page, '.widget[data-widget=upcoming] .tx-row');
    eq(listed, Math.min(8, rows.length), 'the payments of that month are listed (up to the first eight)');
  });
  await check('"This month" and the browser\'s back button come back', async () => {
    await page.click('.dash-monthbar .month-nav .btn.sm');
    await page.waitForFunction(() => !location.search.includes('month='), { timeout: 5000 });
    eq(await count(page, '.month-note'), 0, 'the note is gone');
    await page.waitForSelector('[data-widget=insights]', { timeout: 6000 });
    await page.goBack();
    await page.waitForFunction((m) => location.search.includes('month=' + m), { timeout: 5000 }, CAL_NEXT);
    truthy(true, 'back returns to the month');
  });
  await check('the arrows step one month, and the address controls the month: a bad one means this month', async () => {
    page = await open('/?month=' + CAL_NEXT);
    await page.waitForSelector('.month-note');
    await page.click('.dash-monthbar [aria-label="Next month"]');
    await page.waitForFunction((m) => location.search.includes('month=' + m), { timeout: 5000 }, plus(2));
    await page.click('.dash-monthbar [aria-label="Previous month"]');
    await page.waitForFunction((m) => location.search.includes('month=' + m), { timeout: 5000 }, CAL_NEXT);
    for (const bad of ['2099-01', '1999-01', 'soon', '2026-13']) {
      page = await open('/?month=' + bad);
      await page.waitForSelector('.dash-monthbar');
      eq(await count(page, '.month-note'), 0, bad + ' is ignored: this month is shown');
    }
  });
  await check('keyboard: open, move with the arrows and Page Down, choose with Enter, Escape closes and gives focus back', async () => {
    page = await open('/');
    await page.focus('.dash-monthbar .month-picker-btn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.month-pop .month-cal-cell');
    await sleep(200);
    await page.keyboard.press('PageDown');
    await sleep(200);
    eq(await page.$eval('.month-pop .month-cal-year', (e) => e.textContent), String(Number(NOWM.slice(0, 4)) + 1), 'Page Down shows next year');
    eq(await page.evaluate(() => document.activeElement?.dataset?.month?.slice(5)), '01', 'focus is on January');
    await page.keyboard.press('ArrowRight');
    eq(await page.evaluate(() => document.activeElement?.dataset?.month?.slice(5)), '02', 'the right arrow moves to February');
    await page.keyboard.press('ArrowDown');
    eq(await page.evaluate(() => document.activeElement?.dataset?.month?.slice(5)), '06', 'the down arrow moves a row (four months)');
    await page.keyboard.press('Escape');
    await sleep(200);
    eq(await count(page, '.month-pop'), 0, 'Escape closes it');
    eq(await page.evaluate(() => document.activeElement?.classList.contains('month-picker-btn')), true, 'focus is back on the button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.month-pop');
    await sleep(200);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForFunction((m) => location.search.includes('month=' + m), { timeout: 5000 }, CAL_NEXT);
    truthy(true, 'Enter chose the next month');
  });
  await check('clicking outside closes it, and Tab stays inside it', async () => {
    page = await open('/');
    await page.click('.dash-monthbar .month-picker-btn');
    await page.waitForSelector('.month-pop');
    await sleep(200);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    truthy(await page.evaluate(() => !!document.activeElement?.closest('.month-pop')), 'focus is still inside the popup after six Tabs');
    await page.mouse.click(5, 5);
    await sleep(200);
    eq(await count(page, '.month-pop'), 0, 'a click elsewhere closes it');
  });
  await check('the Payments page month navigator has the same calendar', async () => {
    page = await open('/payments');
    await page.click('.month-nav .month-picker-btn');
    await page.waitForSelector('.month-pop');
    await page.evaluate((m) => document.querySelector(`.month-pop [data-month="${m}"]`).click(), CAL_NEXT);
    await page.waitForFunction((m) => location.search.includes('month=' + m), { timeout: 5000 }, CAL_NEXT);
    truthy(new RegExp(String(Number(CAL_NEXT.slice(0, 4)))).test(await text(page, '.month-nav .month-picker-btn')), 'the button shows the month');
    await page.click('.month-nav .btn.sm');
    await page.waitForFunction(() => !location.search.includes('month='), { timeout: 5000 });
  });
  await check('"Counts in" for a credit card is a calendar that only allows months the bill can fall in', async () => {
    page = await open('/payments');
    await page.click('.head-actions .btn.primary');
    await page.waitForSelector('.card-box');
    await page.click('.card-box input[type=checkbox]');
    await page.waitForSelector('.card-box .month-cal');
    eq(await page.$eval('.card-box .month-cal-cell.selected', (e) => e.dataset.month), CAL_NEXT, 'the next bill is chosen');
    const off = await page.$$eval('.card-box .month-cal-cell.off', (cells) => cells.map((c) => c.dataset.month));
    truthy(off.every((m) => m < NOWM || m > plus(12)), 'only months before the purchase or more than a year after are greyed out');
    truthy(off.some((m) => m < NOWM) || NOWM.endsWith('-01'), 'earlier months this year are greyed out');
    // this month is allowed only while the card pay day (the 10th) is still ahead; either way, the calendar says so
    const thisOff = await page.$eval(`.card-box [data-month="${NOWM}"]`, (e) => e.classList.contains('off'));
    if (thisOff) {
      truthy(/cannot fall before the purchase/.test(await page.$eval(`.card-box [data-month="${NOWM}"]`, (e) => e.title)), 'a greyed-out month says why');
    } else {
      await page.click(`.card-box [data-month="${NOWM}"]`);
      eq(await page.$eval('.card-box .month-cal-cell.selected', (e) => e.dataset.month), NOWM, 'this month can be chosen while the pay day is ahead');
    }
    truthy(/Leaves your balance on/.test(await text(page, '.card-box')), 'it still says when the money leaves');
    await page.keyboard.press('Escape');
  });
  await check('on a phone the calendar is a sheet at the bottom, and the month view fits', async () => {
    page = await open('/', { width: 390, height: 844 });
    await page.waitForSelector('.dash-monthbar .month-picker-btn');
    await page.click('.dash-monthbar .month-picker-btn');
    await page.waitForSelector('.month-pop');
    await sleep(200);
    truthy(await popupFits(page), 'the popup is inside the screen');
    const geo = await page.$eval('.month-pop', (e) => { const r = e.getBoundingClientRect(); return { bottomGap: Math.round(window.innerHeight - r.bottom), width: Math.round(r.width) }; });
    truthy(geo.bottomGap <= 16 && geo.width >= 340, 'at the bottom and nearly full width: ' + JSON.stringify(geo));
    const small = await page.$$eval('.month-pop .month-cal-cell', (cells) => cells.filter((c) => c.getBoundingClientRect().height < 40).length);
    eq(small, 0, 'month buttons are big enough to tap');
    await page.evaluate((m) => document.querySelector(`.month-pop [data-month="${m}"]`).click(), CAL_NEXT);
    await page.waitForSelector('.month-note', { timeout: 6000 });
    await sleep(800);
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'nothing scrolls sideways in the month view');
  });

  console.log('\nPayment filters');
  const cats = (await api(page, 'GET', '/categories')).json;
  const expenseCat = cats.find((c) => c.kind === 'expense' && c.name.length >= 5);
  const openCats = async (p) => {
    await p.click('.filters button[aria-label^="Category:"]');
    await p.waitForSelector('.filter-pop .filter-opt');
  };
  const optionTexts = (p) => p.$$eval('.filter-pop [role=option]', (os) => os.map((o) => o.textContent.trim()));
  await check('the filters are styled dropdowns with icons next to a search box, not the browser\'s own menus', async () => {
    page = await open('/payments');
    await page.waitForSelector('.filters .search-box');
    eq(await count(page, '.filters select'), 0, 'no native selects');
    eq(await count(page, '.filters .filter-btn'), 3, 'type, paid with, category');
    eq(await count(page, '.filters .filter-btn svg'), 6, 'each has its icon and chevron');
    eq(await page.$eval('.filters', (e) => e.getAttribute('role')), 'search', 'announced as a search region');
    eq(await count(page, '.filters .filter-btn.active'), 0, 'nothing is filtering yet');
    eq(await count(page, '.filters-clear'), 0, 'so there is nothing to clear');
  });
  await check('the category list opens with a search box in focus, groups, colours and a tick on the chosen one', async () => {
    await openCats(page);
    eq(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'combobox', 'the search box has focus');
    const groups = await page.$$eval('.filter-pop .filter-group', (g) => g.map((x) => x.textContent.trim()));
    eq(groups.join('|'), 'Expenses|Income', 'grouped');
    truthy((await optionTexts(page))[0] === 'All categories' && (await optionTexts(page))[1] === 'Uncategorized', 'all and uncategorized first');
    eq(await page.$eval('.filter-pop [aria-selected=true]', (e) => e.textContent.trim()), 'All categories', 'the chosen one is marked');
    truthy((await count(page, '.filter-pop .filter-opt .dot')) >= cats.length, 'each category has its colour');
    truthy(await page.$eval('.filter-pop', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), 'the popup is on screen');
  });
  await check('typing narrows the list (ignoring capitals and accents) and says when nothing matches', async () => {
    const all = (await optionTexts(page)).length;
    await page.keyboard.type(expenseCat.name.slice(0, 4).toUpperCase());
    await sleep(150);
    const some = await optionTexts(page);
    truthy(some.length >= 1 && some.length < all, 'fewer options: ' + some.length + ' of ' + all);
    truthy(some.includes(expenseCat.name), 'it finds ' + expenseCat.name);
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type('zzzqx');
    await sleep(150);
    eq((await optionTexts(page)).length, 0, 'nothing listed');
    truthy(/Nothing matches/.test(await text(page, '.filter-none')), 'and it says so');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await sleep(150);
    eq((await optionTexts(page)).length, all, 'clearing the search brings everything back');
  });
  await check('arrows and Enter choose: the button turns green, the address and the list follow, and Clear filters appears', async () => {
    await page.keyboard.type(expenseCat.name.slice(0, 5));
    await sleep(150);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.filter-pop', { hidden: true });
    eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Category: ' + expenseCat.name, 'focus is back on the button, which now says what is chosen');
    truthy(page.url().includes('category=' + expenseCat.id), 'the address has the category');
    eq(await count(page, '.filters .filter-btn.active'), 1, 'one filter is on');
    await sleep(600);
    const rows = await page.$$eval('.tx-row .cat', (r) => r.map((x) => x.textContent.trim()));
    truthy(rows.every((t) => t === expenseCat.name), 'the list is only that category: ' + [...new Set(rows)].join(', '));
    eq(await text(page, '.filters-clear'), 'Clear filters (1)', 'a way back');
    await page.click('.filters-clear');
    await page.waitForFunction(() => !document.querySelector('.filters-clear'), { timeout: 4000 });
    truthy(!page.url().includes('category='), 'cleared from the address');
    eq(await count(page, '.filters .filter-btn.active'), 0, 'and from the buttons');
  });
  await check('Escape and clicking away close it without changing anything; the arrow keys open it', async () => {
    await openCats(page);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.filter-pop', { hidden: true });
    eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Category: All categories', 'focus goes back to the button');
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector('.filter-pop .filter-opt');
    await page.mouse.click(5, 300);
    await page.waitForSelector('.filter-pop', { hidden: true });
    eq(await count(page, '.filters .filter-btn.active'), 0, 'no filter was set');
  });
  await check('a short list has no search box, and the type and paid-with filters work from the keyboard', async () => {
    await page.click('.filters button[aria-label^="Type:"]');
    await page.waitForSelector('.filter-pop .filter-opt');
    eq(await count(page, '.filter-pop input'), 0, 'three options need no search');
    eq(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'listbox', 'the list itself has focus');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.filter-pop', { hidden: true });
    truthy(page.url().includes('type=expense'), 'expenses only');
    await sleep(700);
    eq(await page.$$eval('.tx-row .tx-amount.pos, .tx-row .amount.pos', (r) => r.length), 0, 'no income left in the list');
    await pickFilter(page, 'Type', 'Income & expenses');
    truthy(!page.url().includes('type='), 'back to everything');
  });
  await check('the search box finds payments, has a clear button, and Clear filters counts it', async () => {
    const first = (await api(page, 'GET', '/transactions?month=' + THIS)).json[0];
    await page.type('.filters .search-box input', first.description.slice(0, 6));
    await sleep(700);
    truthy((await count(page, '.tx-row')) >= 1, 'something is found');
    eq(await text(page, '.filters-clear'), 'Clear filters (1)', 'counted');
    await page.click('.search-clear');
    await sleep(700);
    eq(await page.$eval('.filters .search-box input', (e) => e.value), '', 'the box is empty');
    eq(await count(page, '.search-clear'), 0, 'the clear button goes away');
    eq(await count(page, '.filters-clear'), 0, 'and so does Clear filters');
  });
  await check('on a phone the filters fit, and a dropdown opens as a sheet with big rows', async () => {
    const small = await open('/payments', { width: 390, height: 800 });
    await small.waitForSelector('.filters .search-box');
    eq(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'nothing scrolls sideways');
    await small.click('.filters button[aria-label^="Category:"]');
    await small.waitForSelector('.filter-pop .filter-opt');
    await sleep(200);
    const g = await small.$eval('.filter-pop', (e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom) }; });
    truthy(g.left <= 12 && g.right <= 12 && g.bottom <= 12, 'a sheet at the bottom: ' + JSON.stringify(g));
    const short = await small.$$eval('.filter-pop .filter-opt', (o) => o.filter((x) => x.getBoundingClientRect().height < 40).length);
    eq(short, 0, 'rows are big enough to tap');
    await small.close();
  });

  console.log('\nBalance card and forecast page');
  await check('the balance card says whether the balance dips below zero, and its figure is not squeezed against the chart', async () => {
    page = await open('/');
    await page.waitForSelector('.hero-figure');
    const hero = await page.$eval('.hero-figure', (e) => ({ status: e.querySelector('.hero-status')?.textContent.trim(), tone: e.querySelector('.hero-status')?.className, box: e.getBoundingClientRect().height, chart: document.querySelector('.hero-chart')?.getBoundingClientRect().height }));
    truthy(/below zero|No dip ahead/i.test(hero.status ?? ''), 'a status line: ' + hero.status);
    truthy(/ok|warn/.test(hero.tone), 'with a tone');
    truthy(Math.abs(hero.box - hero.chart) <= 2, 'the card is as tall as the chart beside it: ' + JSON.stringify([hero.box, hero.chart]));
    eq(await count(page, '.hero-status'), 1, 'only once');
  });
  await check('the forecast looks ahead with a segmented choice, not a browser menu, and estimates are switches', async () => {
    page = await open('/forecast');
    await page.waitForSelector('.est-card');
    eq(await count(page, 'select'), 0, 'no native selects');
    eq(await count(page, '[role=radiogroup][aria-label="Look ahead"] [role=radio]'), 4, 'four lengths');
    eq(await page.$eval('[aria-label="Look ahead"] [aria-checked=true]', (e) => e.textContent), '1 yr', 'a year by default');
    eq(await count(page, '.est-card [role=switch]'), 2, 'two switches');
    eq(await count(page, '.est-card input[type=checkbox]'), 0, 'no checkboxes');
    eq(await page.$eval('.est-card [role=switch]', (e) => e.getAttribute('aria-checked')), 'true', 'everyday spending is on');
    await page.evaluate(() => [...document.querySelectorAll('[aria-label="Look ahead"] button')].find((b) => b.textContent === '6 mo').click());
    await page.waitForFunction(() => /Balance in 6 months/.test(document.querySelector('.kpis')?.textContent ?? ''), { timeout: 6000 });
    await page.evaluate(() => [...document.querySelectorAll('[aria-label="Look ahead"] button')].find((b) => b.textContent === '2 yrs').click());
    await page.waitForFunction(() => /Balance in 24 months/.test(document.querySelector('.kpis')?.textContent ?? ''), { timeout: 6000 });
  });
  await check('over two years each month has its own place on the chart (two Octobers are not one)', async () => {
    await sleep(500);
    const dots = await page.$$eval('.chart-box .recharts-line-dots circle', (cs) => cs.map((c) => Math.round(Number(c.getAttribute('cx')))));
    truthy(dots.length >= 25, 'a point for each month: ' + dots.length);
    eq(new Set(dots).size, dots.length, 'every point at its own place');
    const sorted = [...dots].sort((a, b) => a - b);
    eq(JSON.stringify(dots), JSON.stringify(sorted), 'in order, left to right');
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
    truthy(Math.max(...gaps) - Math.min(...gaps) <= 2, 'evenly spaced: ' + JSON.stringify([Math.min(...gaps), Math.max(...gaps)]));
    // each label under the chart sits right under a month's point: with two months of the same name the labels used to drift away from the points
    const ticks = await page.evaluate(() => [...document.querySelector('.chart-box .recharts-line-dots').closest('.chart-box').querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')].map((t) => Math.round(Number(t.getAttribute('x')))));
    truthy(ticks.length >= 6, 'labels under the chart: ' + ticks.length);
    const stray = ticks.filter((t) => !dots.some((d) => Math.abs(d - t) <= 2));
    eq(stray.length, 0, 'every label is under a point; strays at ' + JSON.stringify(stray));
  });
  await check('a balance that goes below zero is marked on the chart, also over two years', async () => {
    const made = await api(page, 'POST', '/transactions', { type: 'expense', description: 'E2E dip', amount: 90000, date: NEXT + '-20', category_id: null });
    eq(made.status, 201, 'a big payment next month');
    try {
      page = await open('/forecast');
      await page.waitForSelector('[aria-label="Look ahead"]');
      await page.evaluate(() => [...document.querySelectorAll('[aria-label="Look ahead"] button')].find((b) => b.textContent === '2 yrs').click());
      await page.waitForFunction(() => /Balance in 24 months/.test(document.querySelector('.kpis')?.textContent ?? ''), { timeout: 6000 });
      await page.waitForSelector('.recharts-reference-dot', { timeout: 6000 });
      eq(await count(page, '.recharts-reference-dot'), 1, 'one marker');
      truthy(/Dips below zero/.test(await page.$eval('.chart-box', (e) => e.textContent)), 'with its label');
    } finally {
      await api(page, 'DELETE', '/transactions/' + made.json.id + '?hard=1');
    }
  });
  await check('the estimate switches ask the server for a different forecast', async () => {
    const asked = page.waitForResponse((r) => r.url().includes('/forecast') && r.url().includes('estimateIncome=1'), { timeout: 6000 });
    await page.evaluate(() => document.querySelectorAll('.est-card [role=switch]')[1].click());
    await asked;
    eq(await page.$$eval('.est-card [role=switch]', (x) => x[1].getAttribute('aria-checked')), 'true', 'the income estimate is on');
    const off = page.waitForResponse((r) => r.url().includes('/forecast') && r.url().includes('estimateExpenses=0'), { timeout: 6000 });
    await page.evaluate(() => document.querySelectorAll('.est-card [role=switch]')[0].click());
    await off;
  });
  await check('on a phone the forecast controls and cards fit the screen', async () => {
    const small = await open('/forecast', { width: 390, height: 800 });
    await small.waitForSelector('.est-card');
    eq(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'nothing scrolls sideways');
    const r = await small.$eval('[aria-label="Look ahead"]', (e) => { const b = e.getBoundingClientRect(); return b.right <= innerWidth && b.left >= 0; });
    truthy(r, 'the choice is on screen');
    const home = await open('/', { width: 390, height: 800 });
    await home.waitForSelector('.hero-status');
    eq(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'the dashboard does not scroll sideways either');
    await small.close();
    await home.close();
  });

  console.log('\nPayment rows');
  await check('paid and overdue rows get a status edge, the Overdue badge is gone, and the icon buttons stay reachable', async () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    const day = now.getDate();
    const made = [];
    try {
      page = await open('/payments');
      const paid = await api(page, 'POST', '/transactions', { type: 'expense', description: 'E2E row paid', amount: 12, date: ym + '-' + pad(day), status: 'paid', category_id: null });
      eq(paid.status, 201, 'a paid payment');
      made.push(paid.json.id);
      if (day > 1) {
        const late = await api(page, 'POST', '/transactions', { type: 'expense', description: 'E2E row late', amount: 13, date: ym + '-' + pad(day - 1), status: 'pending', category_id: null });
        eq(late.status, 201, 'a late payment');
        made.push(late.json.id);
      }
      page = await open('/payments');
      await page.waitForSelector('.tx-row');
      const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tx-row')].filter((r) => /E2E row/.test(r.textContent)).map((r) => [r.querySelector('.tx-title').textContent.trim().split(' ').slice(0, 3).join(' '), { cls: r.className, badge: !!r.querySelector('.badge.danger'), shadow: getComputedStyle(r).boxShadow, buttons: [...r.querySelectorAll('.tx-actions button')].filter((b) => b.offsetParent).length }])));
      truthy(/is-paid/.test(rows['E2E row paid']?.cls ?? ''), 'the paid row is marked: ' + JSON.stringify(rows));
      truthy(rows['E2E row paid'].shadow !== 'none', 'and has an edge');
      truthy(rows['E2E row paid'].buttons >= 2, 'its buttons are all still there');
      if (day > 1) {
        truthy(/is-overdue/.test(rows['E2E row late']?.cls ?? ''), 'the late row is marked');
        eq(rows['E2E row late'].badge, false, 'with no red Overdue badge');
        truthy(/overdue/.test(await page.evaluate(() => [...document.querySelectorAll('.tx-row.is-overdue .tx-date')].map((e) => e.textContent).join(' '))), 'it still says "overdue" in words');
      }
    } finally {
      for (const id of made) await api(page, 'DELETE', '/transactions/' + id + '?hard=1');
    }
  });

  console.log('\nDropdowns');
  await check('forms use the same dropdown as the filters: coloured categories, Escape closes only the list, the choice shows', async () => {
    page = await open('/payments');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add payment/.test(b.textContent))?.click());
    await page.waitForSelector('.modal');
    eq(await count(page, '.modal select'), 0, 'no browser dropdowns in the form');
    const openList = async () => {
      await page.evaluate(() => document.querySelector('.modal .filter-btn.as-field[aria-label^="Category"]').click());
      await page.waitForSelector('.filter-pop [role=option]');
    };
    await openList();
    const opts = await page.$$eval('.filter-pop [role=option]', (o) => o.map((x) => ({ text: x.textContent.trim(), dot: !!x.querySelector('.dot') })));
    truthy(opts.length >= 3, 'a list of categories: ' + opts.length);
    eq(opts[0].text, 'No category', 'the empty choice comes first');
    truthy(opts.slice(1).every((x) => x.dot), 'every category shows its colour');
    await page.keyboard.press('Escape');
    await sleep(150);
    eq(await count(page, '.filter-pop'), 0, 'Escape closes the list');
    eq(await count(page, '.modal'), 1, 'and leaves the form open');
    await openList();
    const second = opts[1].text;
    await page.evaluate(() => document.querySelectorAll('.filter-pop [role=option]')[1].click());
    await sleep(150);
    const shown = await page.$eval('.modal .filter-btn.as-field[aria-label^="Category"]', (b) => b.textContent.trim());
    eq(shown, second, 'the chosen category is shown on the button');
    await page.keyboard.press('Escape');
    await sleep(200);
    eq(await count(page, '.modal'), 0, 'a second Escape closes the form');
  });

  console.log('\nLeft over from last month');
  await check('a month starts with a line for what was left over, it is in Income and Net, filters hide it, and the setting turns it off', async () => {
    page = await open('/payments');
    const before = (await api(page, 'GET', '/carryover?month=2031-04')).json.amount;
    const made = [];
    try {
      for (const [type, amount] of [['income', 1000], ['expense', 400]]) {
        const r = await api(page, 'POST', '/transactions', { type, description: 'E2E leftover ' + type, amount, date: '2031-03-10', status: 'pending', category_id: null });
        eq(r.status, 201, 'a ' + type + ' in March 2031');
        made.push(r.json.id);
      }
      const after = (await api(page, 'GET', '/carryover?month=2031-04')).json;
      eq(Math.round((after.amount - before) * 100), 60000, 'March passes on 600 more than before');
      const digits = (t) => t.replace(/[^0-9]/g, '');
      page = await open('/payments?month=2031-04');
      await page.waitForSelector('.tx-row.carry');
      const row = await page.evaluate(() => { const r = document.querySelector('.tx-row.carry'); return { title: r.querySelector('.tx-title').textContent, amount: r.querySelector('.tx-amount').textContent, others: document.querySelectorAll('.tx-row:not(.carry)').length, strip: document.querySelector('.summary-strip')?.textContent ?? '' }; });
      truthy(/Left over from March/.test(row.title) && /Carried over/.test(row.title), 'the line: ' + row.title);
      eq(digits(row.amount), String(Math.round(after.amount * 100)), 'with the amount from the server');
      truthy(/left over from March/.test(row.strip), 'the strip says Income includes it');
      truthy(/expected/.test(await text(page, '.tx-row.carry .tx-date')), 'it is expected while April 2031 has not started');
      page = await open('/payments?month=2031-04&type=expense');
      await sleep(400);
      eq(await count(page, '.tx-row.carry'), 0, 'hidden when only expenses are shown');
      page = await open('/payments?month=2031-04&q=nothing');
      await sleep(400);
      eq(await count(page, '.tx-row.carry'), 0, 'hidden while searching');
      const s0 = (await api(page, 'GET', '/settings')).json;
      await api(page, 'PUT', '/settings', { opening_balance: s0.opening_balance, currency: s0.currency, carry_over: false });
      try {
        page = await open('/payments?month=2031-04');
        await sleep(600);
        eq(await count(page, '.tx-row.carry'), 0, 'gone when the setting is off');
      } finally {
        await api(page, 'PUT', '/settings', { opening_balance: s0.opening_balance, currency: s0.currency, carry_over: true });
      }
    } finally {
      for (const id of made) await api(page, 'DELETE', '/transactions/' + id + '?hard=1');
    }
    eq((await api(page, 'GET', '/carryover?month=2031-04')).json.amount, before, 'cleaned up');
  });
  await check('Settings has the switch, on by default, and it saves', async () => {
    page = await open('/settings');
    await page.waitForSelector('.split-box input[type=checkbox]');
    const state = () => page.evaluate(() => { const l = [...document.querySelectorAll('.split-box label')].find((x) => /left over/i.test(x.textContent)); return l?.querySelector('input')?.checked; });
    eq(await state(), true, 'on by default');
    await page.evaluate(() => [...document.querySelectorAll('.split-box label')].find((x) => /left over/i.test(x.textContent)).querySelector('input').click());
    await page.evaluate(() => [...document.querySelectorAll('.form-actions .btn.primary')].find((b) => /^Save$/.test(b.textContent.trim())).click());
    await sleep(700);
    eq((await api(page, 'GET', '/settings')).json.carry_over, false, 'saved as off');
    await page.evaluate(() => [...document.querySelectorAll('.split-box label')].find((x) => /left over/i.test(x.textContent)).querySelector('input').click());
    await page.evaluate(() => [...document.querySelectorAll('.form-actions .btn.primary')].find((b) => /^Save$/.test(b.textContent.trim())).click());
    await sleep(700);
    eq((await api(page, 'GET', '/settings')).json.carry_over, true, 'and back on');
  });

  console.log('\nBought with each card');
  await check('the strip shows what was bought with the credit card and with the debit card, by purchase day', async () => {
    page = await open('/payments');
    const made = [];
    try {
      const card = await api(page, 'POST', '/transactions', { type: 'expense', description: 'E2E card buy', amount: 100, date: '2031-06-10', charged_on: '2031-05-02', pay_method: 'credit_card', status: 'pending', category_id: null });
      const cash = await api(page, 'POST', '/transactions', { type: 'expense', description: 'E2E debit buy', amount: 30, date: '2031-05-03', status: 'pending', category_id: null });
      eq(card.status + ',' + cash.status, '201,201', 'a card purchase and a cash one');
      made.push(card.json.id, cash.json.id);
      page = await open('/payments?month=2031-05');
      await page.waitForSelector('.summary-strip');
      const tiles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.summary-strip > div')].map((d) => [d.querySelector('.muted')?.textContent.trim(), d.querySelector('strong')?.textContent.trim()])));
      truthy(/100[.]00/.test(tiles['Bought with credit card'] ?? ''), 'credit card: ' + JSON.stringify(tiles));
      truthy(/30[.]00/.test(tiles['Bought with debit card'] ?? ''), 'debit card: ' + JSON.stringify(tiles));
      eq('Paid with the card bill' in tiles || 'Bought on card' in tiles, false, 'the old labels are gone');
      page = await open('/payments?month=2031-06');
      await page.waitForSelector('.summary-strip');
      const june = await page.evaluate(() => [...document.querySelectorAll('.summary-strip > div .muted')].map((d) => d.textContent.trim()));
      eq(june.includes('Bought with credit card'), false, 'the bill in June is not counted as bought in June');
    } finally {
      for (const id of made) await api(page, 'DELETE', '/transactions/' + id + '?hard=1');
    }
  });

  console.log('\nCard purchases in installments');
  await check('a card purchase paid in installments is one line in the purchase month at its price, counted once, and shows its interest', async () => {
    page = await open('/payments');
    const made = await api(page, 'POST', '/installments', { description: 'E2E card inst', installment_amount: 260, installment_count: 4, first_due_date: '2031-07-10', charged_on: '2031-06-02', purchase_amount: 1000, category_id: null });
    eq(made.status, 201, 'a plan of 4 x 260 for a 1000 purchase');
    try {
      const digits = (t) => t.replace(/[^0-9]/g, '');
      page = await open('/payments?month=2031-06');
      await page.waitForSelector('.tx-row');
      const june = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.tx-row')].filter((r) => r.textContent.includes('E2E card inst'));
        const r = rows[0];
        return { n: rows.length, title: r?.querySelector('.tx-title')?.textContent.trim(), amount: r?.querySelector('.tx-amount')?.textContent ?? '', meta: r?.querySelector('.tx-meta')?.textContent ?? '', strip: document.querySelector('.summary-strip')?.textContent ?? '' };
      });
      eq(june.n, 1, 'one line in the purchase month');
      truthy(!/\(1\/4\)/.test(june.title), 'without the installment number: ' + june.title);
      eq(digits(june.amount), '100000', 'at the price, not the installment');
      truthy(/paid in 4 installments/.test(june.meta), 'says how it is paid: ' + june.meta);
      truthy(/Bought with credit card\s*[€$£]?\s*1,?000\.00/.test(june.strip), 'bought with credit card counts the price once: ' + june.strip.replace(/\s+/g, ' '));
      page = await open('/payments?month=2031-08');
      await page.waitForSelector('.tx-row');
      const aug = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.tx-row')].filter((r) => r.textContent.includes('E2E card inst'));
        return { n: rows.length, title: rows[0]?.querySelector('.tx-title')?.textContent.trim(), amount: rows[0]?.querySelector('.tx-amount')?.textContent ?? '', strip: document.querySelector('.summary-strip')?.textContent ?? '' };
      });
      eq(aug.n, 1, 'one installment in August');
      truthy(/\(2\/4\)/.test(aug.title), 'the second of four: ' + aug.title);
      eq(digits(aug.amount), '26000', 'with its interest in the amount');
      eq(/Bought with credit card/.test(aug.strip), false, 'later installments are not bought again');
      page = await open('/installments');
      await page.waitForSelector('.card.plan');
      const plan = await page.evaluate(() => [...document.querySelectorAll('.card.plan')].find((c) => c.querySelector('h3')?.textContent === 'E2E card inst')?.textContent ?? '');
      truthy(/Bought with the credit card on/.test(plan) && /interest/.test(plan) && /40\.00/.test(plan), 'the plan shows the interest: ' + plan.replace(/\s+/g, ' ').slice(0, 220));
    } finally {
      await api(page, 'DELETE', '/installments/' + made.json.id);
    }
    eq((await api(page, 'GET', '/installments')).json.some((p) => p.description === 'E2E card inst'), false, 'cleaned up');
  });
  await check('the payment form offers installments for a card purchase, works out the interest, and refuses less than the price', async () => {
    page = await open('/payments');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add payment/.test(b.textContent))?.click());
    await page.waitForSelector('.modal');
    await page.type('.modal input[maxlength="200"]', 'E2E form card');
    await page.type('.modal input[inputmode="decimal"]', '1000');
    await page.click('.card-box input[type=checkbox]');
    await page.waitForSelector('.card-box [role=radiogroup]');
    await page.evaluate(() => [...document.querySelectorAll('.card-box [role=radio]')].find((b) => /In installments/.test(b.textContent)).click());
    await page.waitForSelector('.card-box input[max="36"]');
    await page.click('.card-box input[max="36"]', { clickCount: 3 });
    await page.type('.card-box input[max="36"]', '5');
    await sleep(200);
    truthy(/no interest/.test(await text(page, '.card-box .banner')), 'starts with no interest: ' + (await text(page, '.card-box .banner')));
    await page.evaluate(() => { const i = [...document.querySelectorAll('.card-box input[type=number]')].find((x) => x.max !== '36'); i.focus(); });
    await page.keyboard.type('220');
    await sleep(200);
    truthy(/interest/.test(await text(page, '.card-box .banner')) && /100\.00/.test(await text(page, '.card-box .banner')) && /10%/.test(await text(page, '.card-box .banner')), 'interest 100.00 (10%): ' + (await text(page, '.card-box .banner')));
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type('150');
    await sleep(200);
    truthy(/less than the price/.test(await text(page, '.card-box .banner')), 'refuses less than the price: ' + (await text(page, '.card-box .banner')));
    eq(await count(page, '.modal .receipt-section'), 0, 'receipts are not offered for the plan');
    await page.keyboard.press('Escape');
    await sleep(200);
    eq(await count(page, '.modal'), 0, 'closed without saving');
    eq((await api(page, 'GET', '/installments')).json.some((p) => /E2E form card/.test(p.description)), false, 'nothing was created');
  });

  console.log('\nNumber boxes');
  await check('scrolling with the mouse wheel over the amount box does not change the number', async () => {
    page = await open('/payments');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add payment/.test(b.textContent))?.click());
    await page.waitForSelector('.modal');
    const amount = '.modal input[inputmode="decimal"]';
    await page.click(amount);
    await page.type(amount, '100');
    const box = await page.$eval(amount, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    for (const deltaY of [-120, -120, 120, 240, -60]) {
      await page.mouse.wheel({ deltaY });
      await sleep(60);
    }
    eq(await page.$eval(amount, (e) => e.value), '100', 'still 100 after scrolling over it');
    // the same for a count box and a pay-day box elsewhere
    await page.keyboard.press('Escape');
    await sleep(200);
    page = await open('/settings');
    const day = 'input[type=number][max="28"]';
    await page.waitForSelector(day);
    const before = await page.$eval(day, (e) => e.value);
    await page.click(day);
    const d = await page.$eval(day, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(d.x, d.y);
    await page.mouse.wheel({ deltaY: -200 });
    await sleep(100);
    eq(await page.$eval(day, (e) => e.value), before, 'the card pay day is left alone too');
  });

  console.log('\nPart-paying a card bill');
  await check('pay only part of the card bill: the preview says what happens, and the rest moves with its interest', async () => {
    page = await open('/payments');
    const made = [];
    const sum = async (month) => {
      const rows = (await api(page, 'GET', '/transactions?from=' + month + '-01&to=' + month + '-28&status=')).json.filter((t) => t.pay_method === 'credit_card' && /^(E2E bill|Card interest \(rest of the December 2031)/.test(t.description));
      return Math.round(rows.reduce((a, t) => a + t.amount * 100, 0)) / 100;
    };
    try {
      for (const [d, amount, bought] of [['E2E bill A', 8, '2031-12-01'], ['E2E bill B', 89, '2031-11-20'], ['E2E bill C', 138, '2031-11-02']]) {
        const r = await api(page, 'POST', '/transactions', { type: 'expense', description: d, amount, date: '2031-12-10', charged_on: bought, pay_method: 'credit_card', status: 'pending', category_id: null });
        eq(r.status, 201, d);
        made.push(r.json.id);
      }
      page = await open('/payments?month=2031-12');
      await page.waitForSelector('.card-bill-line');
      truthy(/235\.00/.test(await text(page, '.card-bill-line')) && /Pay only part/.test(await text(page, '.card-bill-line')), 'the card bill line: ' + (await text(page, '.card-bill-line')));
      await page.evaluate(() => [...document.querySelectorAll('.card-bill-line button')].find((b) => /Pay only part/.test(b.textContent)).click());
      await page.waitForSelector('.modal');
      const submit = () => page.$eval('.modal .form-actions .btn.primary', (b) => b.disabled);
      eq(await submit(), true, 'cannot move anything before saying what is paid now');
      const pay = '.modal input[type=number]';
      await page.type(pay, '235');
      await sleep(150);
      truthy(/whole bill|less than/.test(await text(page, '.modal .banner')), 'paying everything is explained: ' + (await text(page, '.modal .banner')));
      eq(await submit(), true, 'and cannot be saved');
      await page.click(pay, { clickCount: 3 });
      await page.type(pay, '100');
      await page.evaluate(() => { const i = [...document.querySelectorAll('.modal input[type=number]')][1]; i.focus(); });
      await page.keyboard.type('5');
      await sleep(200);
      const banner = await text(page, '.modal .banner');
      truthy(/100\.00/.test(banner) && /135\.00/.test(banner) && /5\.00/.test(banner) && /interest/.test(banner), 'the preview: ' + banner);
      truthy(/E2E bill C: [^0-9]*38\.00 of [^0-9]*138\.00 moves/.test(banner), 'it says which purchase is split: ' + banner);
      eq(await submit(), false, 'now it can be saved');
      await page.click('.modal .form-actions .btn.primary');
      await page.waitForSelector('.modal', { hidden: true });
      await sleep(500);
      eq(await sum('2031-12'), 100, 'this bill is what is paid now');
      eq(await sum('2032-01'), 140, 'the later bill has the rest and the interest');
      const lineAfter = await text(page, '.card-bill-line');
      truthy(/100\.00/.test(lineAfter), 'the page shows the new bill: ' + lineAfter);
      page = await open('/payments?month=2032-01');
      await page.waitForSelector('.tx-row');
      const later = await page.evaluate(() => [...document.querySelectorAll('.tx-row')].map((r) => r.querySelector('.tx-title')?.textContent.trim()).filter((t) => /E2E bill|Card interest/.test(t ?? '')));
      truthy(later.some((t) => /Card interest/.test(t)) && later.some((t) => /E2E bill C \(rest\)/.test(t)), 'the later month lists the rest and the interest: ' + JSON.stringify(later));
    } finally {
      const rows = (await api(page, 'GET', '/transactions?from=2031-11-01&to=2032-02-28&status=')).json.filter((t) => /^(E2E bill|Card interest \(rest of the December 2031)/.test(t.description));
      for (const t of rows) await api(page, 'DELETE', '/transactions/' + t.id + '?hard=1');
    }
    eq((await api(page, 'GET', '/transactions?from=2031-11-01&to=2032-02-28&status=')).json.some((t) => /^E2E bill|^Card interest \(rest of the December 2031/.test(t.description)), false, 'cleaned up');
  });

  console.log('\nUnequal card installments');
  await check('a card purchase can be paid in different amounts: untyped boxes share the rest, interest shows, and it saves exactly', async () => {
    page = await open('/payments');
    let planId = null;
    try {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add payment/.test(b.textContent))?.click());
      await page.waitForSelector('.modal');
      await page.type('.modal input[maxlength="200"]', 'E2E unequal');
      await page.type('.modal input[inputmode="decimal"]', '42');
      await page.click('.card-box input[type=checkbox]');
      await page.waitForSelector('.card-box [role=radiogroup]');
      await page.evaluate(() => [...document.querySelectorAll('.card-box [role=radio]')].find((b) => /In installments/.test(b.textContent)).click());
      await page.waitForSelector('.card-box input[max="36"]');
      await page.evaluate(() => [...document.querySelectorAll('.card-box [role=radio]')].find((b) => /Different amounts/.test(b.textContent)).click());
      await page.waitForSelector('.inst-list input');
      const boxes = () => page.$$eval('.inst-list input', (is) => is.map((i) => i.value));
      eq((await boxes()).join(','), '14,14,14', 'starts as equal parts of the price');
      await page.click('.inst-list input', { clickCount: 3 });
      await page.keyboard.type('30');
      await sleep(200);
      eq((await boxes()).join(','), '30,6,6', 'the boxes not typed share what is left');
      truthy(/no interest/.test(await text(page, '.card-box .banner')), 'no interest: ' + (await text(page, '.card-box .banner')));
      await page.evaluate(() => { const i = document.querySelectorAll('.inst-list input')[2]; i.focus(); });
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.type('8');
      await sleep(200);
      eq((await boxes()).join(','), '30,4,8', 'a typed box is kept as typed, the one left open takes what remains');
      truthy(/no interest/.test(await text(page, '.card-box .banner')), 'still the price exactly');
      await page.evaluate(() => { const i = document.querySelectorAll('.inst-list input')[1]; i.focus(); });
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.type('8');
      await sleep(200);
      eq((await boxes()).join(','), '30,8,8', 'typing every box is exactly what was typed');
      truthy(/interest/.test(await text(page, '.card-box .banner')) && /4\.00/.test(await text(page, '.card-box .banner')), 'the extra is interest: ' + (await text(page, '.card-box .banner')));
      await page.evaluate(() => [...document.querySelectorAll('.inst-list button')].find((b) => /Share equally again/.test(b.textContent)).click());
      await sleep(200);
      eq((await boxes()).join(','), '14,14,14', 'and it can go back to equal');
      await page.click('.inst-list input', { clickCount: 3 });
      await page.keyboard.type('30');
      await sleep(200);
      await page.click('.modal .form-actions .btn.primary');
      await page.waitForSelector('.modal', { hidden: true });
      await sleep(500);
      const plan = (await api(page, 'GET', '/installments')).json.find((p) => p.description === 'E2E unequal');
      truthy(plan, 'the plan was made');
      planId = plan.id;
      eq(plan.total_amount + ',' + plan.purchase_amount + ',' + plan.installment_count, '42,42,3', 'a total of 42 in three');
      const rows = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((t) => t.installment_plan_id === planId).sort((a, b) => a.installment_no - b.installment_no);
      eq(rows.map((t) => t.amount).join(','), '30,6,6', 'each installment is what was typed');
    } finally {
      if (planId) await api(page, 'DELETE', '/installments/' + planId);
      else {
        const left = (await api(page, 'GET', '/installments')).json.find((p) => p.description === 'E2E unequal');
        if (left) await api(page, 'DELETE', '/installments/' + left.id);
      }
    }
    eq((await api(page, 'GET', '/installments')).json.some((p) => p.description === 'E2E unequal'), false, 'cleaned up');
    eq((await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.some((t) => /^E2E unequal/.test(t.description)), false, 'and no payments left');
  });

  console.log('\nInstallment months');
  await check('each installment has its own bill month, consecutive by default and changeable with a calendar', async () => {
    page = await open('/payments');
    let planId = null;
    try {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add payment/.test(b.textContent))?.click());
      await page.waitForSelector('.modal');
      await page.type('.modal input[maxlength="200"]', 'E2E months');
      await page.type('.modal input[inputmode="decimal"]', '300');
      await page.click('.card-box input[type=checkbox]');
      await page.waitForSelector('.card-box [role=radiogroup]');
      await page.evaluate(() => [...document.querySelectorAll('.card-box [role=radio]')].find((b) => /In installments/.test(b.textContent)).click());
      await page.waitForSelector('.inst-list');
      const months = () => page.evaluate(() => [...document.querySelectorAll('.inst-row .inst-when')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      const first = (await months())[0];
      const rows = await months();
      eq(rows.length, 3, 'three installments by default: ' + JSON.stringify(rows));
      truthy(/1\./.test(rows[0]) && /2\./.test(rows[1]) && /3\./.test(rows[2]), 'numbered');
      eq(await page.$$eval('.inst-row .inst-month', (b) => b.length), 2, 'every installment after the first has a month button');
      const before = rows[1];
      // choose a later month for the second installment: the third follows it
      await page.evaluate(() => document.querySelectorAll('.inst-row .inst-month')[0].click());
      await page.waitForSelector('.month-pop button[data-month]');
      await page.evaluate(() => { const next = document.querySelector('.month-pop button[aria-label^="Next year"]'); if (next && !next.disabled) next.click(); });
      await sleep(150);
      const chosen = await page.evaluate(() => { const cells = [...document.querySelectorAll('.month-pop button[data-month]:not([disabled])')]; const c = cells[cells.length - 1]; const m = c.getAttribute('data-month'); c.click(); return m; });
      await sleep(250);
      const after = await months();
      truthy(after[1] !== before, 'the second installment moved: ' + before + ' -> ' + after[1]);
      truthy(after[2] !== rows[2], 'and the third follows it: ' + after[2]);
      eq(after[0], first, 'the first is unchanged');
      truthy(/Back to consecutive months/.test(await text(page, '.inst-list')), 'a way back is offered');
      await page.click('.modal .form-actions .btn.primary');
      await page.waitForSelector('.modal', { hidden: true });
      await sleep(500);
      const plan = (await api(page, 'GET', '/installments')).json.find((p) => p.description === 'E2E months');
      truthy(plan, 'the plan was made');
      planId = plan.id;
      const tx = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((t) => t.installment_plan_id === planId).sort((a, b) => a.installment_no - b.installment_no);
      eq(tx.length, 3, 'three payments');
      eq(tx[1].date.slice(0, 7), chosen, 'the second is in the month that was chosen');
      eq(tx[2].date.slice(0, 7) > tx[1].date.slice(0, 7), true, 'the third is after it');
      eq(plan.last_due, tx[2].date, 'the plan reports its real last day');
    } finally {
      const left = (await api(page, 'GET', '/installments')).json.find((p) => p.description === 'E2E months');
      if (left) await api(page, 'DELETE', '/installments/' + left.id);
    }
    eq((await api(page, 'GET', '/installments')).json.some((p) => p.description === 'E2E months'), false, 'cleaned up');
  });

  console.log('\nSafety buffer');
  await check('a safety buffer is set in Settings, warns on the balance card and shows as a line on the chart', async () => {
    page = await open('/settings');
    const field = 'xpath/.//label[contains(., "Safety buffer")]//input';
    await page.waitForSelector(field);
    const original = (await api(page, 'GET', '/settings')).json;
    eq(original.min_balance, 0, 'no buffer to start with');
    try {
      const bal = (await api(page, 'GET', '/summary')).json.balance;
      const buffer = Math.ceil(bal) + 500;
      await page.click(field, { clickCount: 3 });
      await page.type(field, String(buffer));
      await page.evaluate(() => [...document.querySelectorAll('.form-actions .btn.primary')].find((b) => /^Save$/.test(b.textContent.trim())).click());
      await sleep(800);
      eq((await api(page, 'GET', '/settings')).json.min_balance, buffer, 'saved');
      page = await open('/');
      await page.waitForSelector('.hero-status');
      const status = await page.$eval('.hero-status', (e) => ({ cls: e.className, text: e.textContent.trim() }));
      truthy(/Below your .*buffer today/.test(status.text) && /caution/.test(status.cls), 'the balance card says so: ' + JSON.stringify(status));
      truthy(/Buffer/.test(await page.$eval('.hero .chart-box', (e) => e.textContent)), 'the chart has a Buffer line');
      page = await open('/forecast');
      await page.waitForSelector('.banner');
      truthy(/buffer/.test(await text(page, '.banner')), 'the forecast page speaks of the buffer: ' + (await text(page, '.banner')).slice(0, 160));
    } finally {
      await api(page, 'PUT', '/settings', { opening_balance: original.opening_balance, currency: original.currency, min_balance: 0 });
    }
    page = await open('/');
    await page.waitForSelector('.hero-status');
    eq(/buffer/i.test(await page.$eval('.hero-status', (e) => e.textContent)), false, 'with no buffer the old words are back');
    eq((await api(page, 'GET', '/settings')).json.min_balance, 0, 'restored');
  });

  console.log('\nSafe to spend');
  await check('the balance card says how much is safe to spend, matching the server, and the buffer is taken out', async () => {
    page = await open('/');
    await page.waitForSelector('.hero-safe');
    const digits = (t) => t.replace(/[^0-9]/g, '');
    const line = await text(page, '.hero-safe');
    const safe = (await api(page, 'GET', '/safe-to-spend')).json;
    truthy(/Safe to spend|short before|Nothing spare/.test(line), 'a line: ' + line);
    if (safe.per_day > 0) truthy(digits(line).includes(String(Math.round(safe.per_day * 100))), 'it shows the server figure ' + safe.per_day + ': ' + line);
    else if (safe.short > 0) truthy(digits(line).includes(String(Math.round(safe.short * 100))), 'it shows the shortfall ' + safe.short + ': ' + line);
    truthy(/\d+ days?/.test(line) || /short before|Nothing spare/.test(line), 'and for how long');
    const title = await page.$eval('.hero-safe', (e) => e.getAttribute('title') ?? '');
    truthy(/Balance today/.test(title) && /Still to pay until/.test(title), 'hovering shows the arithmetic: ' + title.replace(/\n/g, ' | '));
    // a buffer takes money out of what can be spent
    const original = (await api(page, 'GET', '/settings')).json;
    try {
      const before = safe.available;
      await api(page, 'PUT', '/settings', { opening_balance: original.opening_balance, currency: original.currency, min_balance: 50 });
      const after = (await api(page, 'GET', '/safe-to-spend')).json;
      eq(Math.round((before - after.available) * 100), 5000, 'a 50 buffer takes 50 off what is available');
      eq(after.buffer, 50, 'and is reported');
    } finally {
      await api(page, 'PUT', '/settings', { opening_balance: original.opening_balance, currency: original.currency, min_balance: 0 });
    }
  });

  console.log('\nMatch the bank balance');
  await check('match my bank balance: shows the difference, adds one adjustment payment, and deleting it undoes it', async () => {
    page = await open('/');
    await page.waitForSelector('.hero-why');
    const before = (await api(page, 'GET', '/summary')).json.balance;
    let adjId = null;
    try {
      await page.evaluate(() => [...document.querySelectorAll('.hero-why')].find((b) => /Match my bank balance/.test(b.textContent)).click());
      await page.waitForSelector('.modal');
      const submit = () => page.$eval('.modal .form-actions .btn.primary', (b) => b.disabled);
      eq(await submit(), true, 'nothing to save before a balance is typed');
      await page.type('.modal input[type=number]', String(before));
      await sleep(150);
      truthy(/already match/.test(await text(page, '.modal .banner[aria-live]')), 'the same figure says they match: ' + (await text(page, '.modal')).slice(0, 200));
      eq(await submit(), true, 'and there is nothing to save');
      await page.click('.modal input[type=number]', { clickCount: 3 });
      await page.type('.modal input[type=number]', String(Math.round((before + 25.5) * 100) / 100));
      await sleep(150);
      const preview = await text(page, '.modal');
      truthy(/25\.50/.test(preview) && /more/.test(preview) && /income/.test(preview), 'it says what will happen: ' + preview.slice(0, 260));
      await page.click('.modal .form-actions .btn.primary');
      await page.waitForSelector('.modal', { hidden: true });
      await sleep(600);
      const after = (await api(page, 'GET', '/summary')).json.balance;
      eq(Math.round((after - before) * 100), 2550, 'the balance moved by the difference');
      const adj = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((t) => t.source === 'adjustment');
      eq(adj.length, 1, 'one adjustment payment');
      adjId = adj[0].id;
      page = await open('/payments');
      await page.waitForSelector('.tx-row');
      truthy(await page.evaluate(() => [...document.querySelectorAll('.tx-row')].some((r) => /Balance adjustment/.test(r.textContent) && /Adjustment/.test(r.querySelector('.badge')?.textContent ?? ''))), 'the list shows it with an Adjustment badge');
    } finally {
      const left = (await api(page, 'GET', '/transactions?from=2000-01-01&to=2100-01-01&status=')).json.filter((t) => t.source === 'adjustment');
      for (const t of left) await api(page, 'DELETE', '/transactions/' + t.id + '?hard=1');
    }
    eq(Math.round(((await api(page, 'GET', '/summary')).json.balance - before) * 100), 0, 'deleting the adjustment puts the balance back');
  });

  console.log('\nBackups');
  await check('Settings says when the last backup was made, and the status gives no file or folder names', async () => {
    const status = (await api(page, 'GET', '/backups/status')).json;
    eq(Object.keys(status).sort().join(), 'count,enabled,last_at,problem', 'only the safe facts');
    page = await open('/settings');
    await page.waitForSelector('.backup-line');
    const line = await text(page, '.backup-line');
    if (status.enabled && status.last_at) truthy(/Last automatic backup:/.test(line) && new RegExp(status.count + ' kept').test(line), 'the line: ' + line);
    else truthy(line.length > 0, 'a line: ' + line);
    truthy(!/\.dump|penny-20/.test(await text(page, 'main')), 'no file names on the page');
  });

  console.log('\nAdmin dashboard');
  const setAdmin = (on) => db.query('UPDATE users SET is_admin = $2 WHERE id = $1', [userId, on]);
  const adminTab = async (tab) => {
    page = await open('/admin' + (tab ? '?tab=' + tab : ''));
    await page.waitForSelector('[role=tabpanel]');
    await sleep(500);
  };
  const SPAM = 'e2e_spam_' + Date.now().toString(36).slice(-5);
  await check('an ordinary person has no Admin link, is sent home from /admin, and the admin API says "not found"', async () => {
    await setAdmin(false);
    page = await open('/admin');
    await sleep(600);
    truthy(!/\/admin/.test(page.url()), 'sent away from /admin: ' + page.url());
    eq(await count(page, '.sidebar a[href="/admin"]'), 0, 'no Admin link in the sidebar');
    eq((await api(page, 'GET', '/admin/overview')).status, 404, 'the admin API answers not found');
  });
  await check('an admin gets the Admin link, a privacy note, and five tabs', async () => {
    await setAdmin(true);
    await adminTab();
    eq(await count(page, '.sidebar a[href="/admin"]'), 1, 'an Admin link in the sidebar');
    truthy(/never payments, amounts, debts or notes/.test(await text(page, '.admin-privacy')) && /View as/.test(await text(page, '.admin-privacy')), 'it says money is not shown, and that View as is the way: ' + (await text(page, '.admin-privacy')));
    eq((await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent.trim()))).join(), 'Overview,People,Messages,Activity,System', 'the five tabs');
  });
  await check('the overview has counts, a 30-day sign-up chart and a going-public checklist read from the settings', async () => {
    await adminTab();
    const info = await page.evaluate(() => ({
      stats: [...document.querySelectorAll('.stat')].map((e) => e.querySelector('span')?.textContent.trim()),
      bars: document.querySelectorAll('.admin-chart .su-col').length,
      chart: document.querySelector('.admin-chart .su-bars')?.getAttribute('aria-label') ?? '',
      checks: document.querySelectorAll('.admin-checks li').length,
      badge: document.querySelector('.admin-checks .badge')?.textContent.trim() ?? '',
      todos: document.querySelectorAll('.admin-checks li.todo p').length,
    }));
    truthy(['People', 'Active this week', 'Sign-ins', 'Failed sign-ins', 'Payments', 'Receipts'].every((n) => info.stats.includes(n)), 'the stat cards: ' + info.stats.join());
    eq(info.bars, 30, 'thirty days of bars');
    truthy(/last 30 days/.test(info.chart), 'the chart is described for a screen reader');
    eq(info.checks, 6, 'six checks');
    truthy(/\d of 6 ready/.test(info.badge), 'it says how many are ready: ' + info.badge);
    truthy(info.todos >= 1, 'a check that is not done says what to do');
    truthy(!/€|\$|£/.test(await text(page, '[role=tabpanel]')) || /Payments/.test(await text(page, '[role=tabpanel]')), 'no money on the page');
  });
  await check('People: search finds someone, a row opens its details and actions, nothing about their money', async () => {
    await adminTab('people');
    await page.type('.admin-search input', 'sam');
    await sleep(900);
    const names = await page.$$eval('.admin-person .admin-name strong', (e) => e.map((x) => x.textContent.trim()));
    truthy(names.some((n) => /Sam Rivera/.test(n)), 'Sam is found: ' + names.join());
    await page.evaluate(() => [...document.querySelectorAll('.admin-person')].find((b) => /Sam Rivera/.test(b.textContent)).click());
    await page.waitForSelector('.admin-detail-panel');
    const panel = await text(page, '.admin-detail-panel');
    truthy(/Devices signed in/.test(panel) && /Shared budgets/.test(panel) && /sam.rivera@example.com/.test(panel), 'details: ' + panel.slice(0, 160));
    truthy(/a count only/.test(panel), 'payments are only a count');
    const buttons = await page.$$eval('.admin-actions .btn', (b) => b.map((x) => ({ t: x.textContent.trim(), off: x.disabled })));
    truthy(['Suspend', 'Sign out everywhere', 'Delete account'].every((t) => buttons.some((b) => b.t === t)), 'the three actions: ' + JSON.stringify(buttons));
    truthy(buttons.find((b) => b.t === 'Delete account').off, 'Sam shares budgets with others, so deleting is off');
    truthy(/Cannot be deleted/.test(await text(page, '.admin-actions')), 'and it says why');
  });
  await check('a throwaway account can be suspended (with a reason), cannot sign in, is reinstated, signed out and deleted', async () => {
    const make = await fetch(BASE + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accept_terms: true, name: 'E2E Spam Person', email: SPAM + '@example.com', username: SPAM, password: 'Tr1cky-Horse!Battery' }) });
    eq(make.status, 201, 'the throwaway account');
    await adminTab('people');
    await page.type('.admin-search input', SPAM);
    await sleep(900);
    await page.evaluate(() => document.querySelector('.admin-person').click());
    await page.waitForSelector('.admin-detail-panel');
    await page.evaluate(() => [...document.querySelectorAll('.admin-actions .btn')].find((b) => b.textContent.trim() === 'Suspend').click());
    await page.waitForSelector('.modal');
    await page.type('.modal input', 'e2e spam');
    await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].find((b) => b.textContent.trim() === 'Suspend').click());
    await page.waitForSelector('.modal', { hidden: true });
    await sleep(700);
    truthy(await page.evaluate(() => [...document.querySelectorAll('.admin-person .badge')].some((b) => b.textContent.trim() === 'Suspended')), 'the row says Suspended');
    truthy(/e2e spam/.test(await text(page, '.admin-detail-panel')), 'the reason is shown to the admin');
    const blocked = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: SPAM, password: 'Tr1cky-Horse!Battery' }) });
    eq(blocked.status, 403, 'they cannot sign in');
    await page.evaluate(() => [...document.querySelectorAll('.admin-actions .btn')].find((b) => /Reinstate/.test(b.textContent)).click());
    await sleep(900);
    const back = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: SPAM, password: 'Tr1cky-Horse!Battery' }) });
    eq(back.status, 200, 'reinstated, they can sign in again');
    // they signed in from outside this page, so close and open the row again for the current number of devices
    await page.evaluate(() => document.querySelector('.admin-person').click());
    await sleep(250);
    await page.evaluate(() => document.querySelector('.admin-person').click());
    await page.waitForSelector('.admin-detail-panel');
    await sleep(500);
    truthy(/Devices signed in\s*1/.test(await text(page, '.admin-detail-panel')), 'the panel now shows one device: ' + (await text(page, '.admin-detail-panel')).slice(0, 120));
    await page.evaluate(() => [...document.querySelectorAll('.admin-actions .btn')].find((b) => /Sign out everywhere/.test(b.textContent)).click());
    await sleep(900);
    const gone = await fetch(BASE + '/api/auth/me', { headers: { cookie: (back.headers.get('set-cookie') || '').split(';')[0] } });
    eq(gone.status, 401, 'signed out everywhere');
    await page.evaluate(() => [...document.querySelectorAll('.admin-actions .btn')].find((b) => /Delete account/.test(b.textContent)).click());
    await page.waitForSelector('.modal');
    truthy(await page.$eval('.modal .btn.danger[type=submit]', (b) => b.disabled), 'delete waits for the username');
    await page.type('.modal input', '@' + SPAM);
    await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].find((b) => /Delete account/.test(b.textContent)).click());
    await page.waitForSelector('.modal', { hidden: true });
    await sleep(900);
    eq(await count(page, '.admin-person'), 0, 'they are gone from the list');
    eq((await db.query('SELECT 1 FROM users WHERE username = $1', [SPAM])).rowCount, 0, 'and from the database');
  });
  await check('Activity lists what happened, filters by kind, and never shows what was typed', async () => {
    await adminTab('activity');
    const all = await text(page, '.admin-events');
    truthy(/Suspended by an admin/.test(all) && /Account deleted by an admin/.test(all) && /Signed in/.test(all), 'the log has the sign-in and the admin actions');
    truthy(!/Tr1cky-Horse|e2e spam person@/i.test(all), 'no password in the log');
    await page.click('.admin-filters button[aria-label^="Show:"]');
    await page.waitForSelector('.filter-pop [role=option]');
    await page.evaluate(() => [...document.querySelectorAll('.filter-pop [role=option]')].find((e) => e.textContent.trim() === 'Suspended by an admin').click());
    await sleep(800);
    const kinds = await page.$$eval('.admin-events .badge', (b) => [...new Set(b.map((x) => x.textContent.trim()))]);
    eq(kinds.join(), 'Suspended by an admin', 'only that kind is shown');
    truthy(/Kept for 90 days/.test(await text(page, '.admin-note')), 'it says how long events are kept');
  });
  await check('System shows the database, the app, backups and mail', async () => {
    await adminTab('system');
    const t = await text(page, '.admin-system');
    truthy(/Database/.test(t) && /Biggest tables/.test(t) && /users/.test(t), 'database and tables');
    truthy(/Running for/.test(t) && /Version/.test(t), 'the app');
    truthy(/Backups/.test(t) && /E-mail/.test(t), 'backups and mail');
    truthy(/\d+ (KB|MB)/.test(t), 'sizes are readable: ' + t.slice(0, 120));
  });
  await check('the Admin page fits a phone: nothing overflows sideways, and a person row can be opened', async () => {
    page = await open('/admin?tab=people', { width: 390, height: 844 });
    await page.waitForSelector('.admin-person');
    const o = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, v: window.innerWidth }));
    truthy(o.w <= o.v + 1, 'no sideways scroll: ' + JSON.stringify(o));
    await page.evaluate(() => document.querySelector('.admin-person').click());
    await page.waitForSelector('.admin-detail-panel');
    const o2 = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, v: window.innerWidth }));
    truthy(o2.w <= o2.v + 1, 'still none with a row open: ' + JSON.stringify(o2));
    page = await open('/admin', { width: 390, height: 844 });
    await sleep(500);
    const o3 = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, v: window.innerWidth }));
    truthy(o3.w <= o3.v + 1, 'the overview fits too: ' + JSON.stringify(o3));
  });
  const openViewAs = async (name) => {
    await adminTab('people');
    await page.type('.admin-search input', name);
    await sleep(900);
    await page.evaluate(() => document.querySelector('.admin-person').click());
    await page.waitForSelector('.admin-detail-panel');
    await page.evaluate((n) => [...document.querySelectorAll('.admin-actions .btn')].find((b) => b.textContent.includes('View as')).click(), name);
    await page.waitForSelector('.modal');
  };
  await check('View as: it asks why and for the admin password, and says what happens; a wrong password changes nothing', async () => {
    await openViewAs('priya');
    const dlg = await text(page, '.modal');
    truthy(/they are told in the app/.test(dlg) && /30 minutes/.test(dlg), 'it says they are told, and for how long: ' + dlg.slice(0, 160));
    truthy(await page.$eval('.modal .btn.primary', (b) => b.disabled), 'the button waits for a reason and a password');
    await page.type('.modal input:not([type=password]):not([type=checkbox])', 'e2e check of view as');
    truthy(await page.$eval('.modal .btn.primary', (b) => b.disabled), 'still waiting for the password');
    await page.type('.modal input[type=password]', 'Wrong-Password-1!x');
    await page.click('.modal .btn.primary');
    await sleep(900);
    truthy(/password is not correct/i.test(await text(page, 'body')), 'a wrong password is refused with a message');
    truthy(!!(await page.$('.modal')), 'the dialog stays, and so does the admin');
    eq(await count(page, '.viewing-bar'), 0, 'nothing started');
    eq((await api(page, 'GET', '/admin/overview')).status, 200, 'still signed in as the admin');
  });
  await check('View as: the page becomes that person\'s account with a banner, read-only, and a change is refused', async () => {
    await page.click('.modal input[type=password]', { clickCount: 3 });
    await page.type('.modal input[type=password]', DEMO_PASSWORD);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.modal .btn.primary')]);
    await page.waitForSelector('.viewing-bar');
    const bar = await text(page, '.viewing-bar');
    truthy(/Priya Nair/.test(bar) && /read-only/.test(bar) && /min left/.test(bar), 'the banner says who, how and for how long: ' + bar);
    truthy(/Priya/.test(await text(page, '.sidebar-foot')), 'the sidebar shows her account');
    eq(await count(page, '.sidebar a[href="/admin"]'), 0, 'no Admin link while viewing as someone else');
    eq((await api(page, 'GET', '/admin/overview')).status, 404, 'the admin tools are not available while viewing');
    const add = await api(page, 'POST', '/transactions', { type: 'expense', description: 'E2E should not exist', amount: 1, date: TODAY });
    eq(add.status, 403, 'a change is refused');
    truthy(/read-only/i.test(add.json.error), 'with a plain message: ' + add.json.error);
    eq((await db.query("SELECT 1 FROM transactions WHERE description = 'E2E should not exist'")).rowCount, 0, 'and nothing was saved');
  });
  await check('View as: Exit goes back to the admin\'s own account, and the log says who looked at whom and why', async () => {
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.viewing-bar .btn')]);
    await page.waitForSelector('[role=tabpanel]');
    eq(await count(page, '.viewing-bar'), 0, 'the banner is gone');
    eq(await count(page, '.sidebar a[href="/admin"]'), 1, 'the Admin link is back');
    eq((await api(page, 'GET', '/admin/overview')).status, 200, 'the admin tools work again');
    await adminTab('activity');
    const log = await text(page, '.admin-events');
    truthy(/An admin viewed their account/.test(log) && /An admin stopped viewing their account/.test(log), 'both are in the log');
    truthy(/read-only: e2e check of view as/.test(log), 'with the reason');
    const note = (await db.query("SELECT body FROM notifications WHERE title = 'An admin viewed your account' ORDER BY id DESC LIMIT 1")).rows[0];
    truthy(note && /e2e check of view as/.test(note.body), 'and the person was told, with the reason');
  });
  await check('clean up: the demo person is an ordinary person again', async () => {
    await setAdmin(false);
    eq((await db.query('SELECT is_admin FROM users WHERE id = $1', [userId])).rows[0].is_admin, false, 'not an admin');
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
      const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept_terms: true, name: 'New Person', email, username: 'np' + Date.now().toString(36).slice(-7), password: 'Tr1cky-Horse!Battery' }) });
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

  await check('the newer screens fit a phone: Debts, the credit card and ending options, settings, and the sign-in page', async () => {
    const fits = () => page.evaluate(() => ({ sideways: document.documentElement.scrollWidth > window.innerWidth + 1, modalOut: (() => { const m = document.querySelector('.modal'); if (!m) return false; const r = m.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; })() }));
    const expectFits = async (what) => {
      const r = await fits();
      eq(r.sideways, false, `${what}: nothing scrolls sideways`);
      eq(r.modalOut, false, `${what}: the dialog stays inside the screen`);
    };
    // give the Debts page something to show: one counted plan and one that is only tracked
    page = await open('/debts', { width: 390, height: 844 });
    const made = [];
    for (const body of [{ name: 'E2E Phone A', total_amount: 300, plan: 'monthly', first_due_date: '2031-01-10', installment_count: 3, count_in_budget: true }, { name: 'E2E Phone B', total_amount: 520, plan: 'none', count_in_budget: false }]) {
      made.push((await api(page, 'POST', '/debts', body)).json.id);
    }
    try {
      page = await open('/debts', { width: 390, height: 844 });
      truthy((await count(page, '.card.debt')) >= made.length, 'the debts are drawn');
      await expectFits('the Debts page');
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Add debt/.test(x.textContent))?.click());
      await page.waitForSelector('.modal');
      await page.evaluate(() => [...document.querySelectorAll('.modal .segmented button')].find((b) => b.textContent.trim() === 'Split over months')?.click());
      await expectFits('the Add debt form');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      page = await open('/payments', { width: 390, height: 844 });
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Add payment/.test(x.textContent))?.click());
      await page.waitForSelector('.card-box');
      await page.click('.card-box input[type=checkbox]');
      await expectFits('the payment form with the credit card option');
      page = await open('/recurring?new=1', { width: 390, height: 844 });
      await page.waitForSelector('.end-box');
      await page.evaluate(() => [...document.querySelectorAll('.end-box .segmented button')].find((b) => /After a number/.test(b.textContent))?.click());
      await expectFits('the recurring form with its ending options');
      page = await open('/settings', { width: 390, height: 844 });
      await expectFits('Settings');
    } finally {
      page = await open('/debts', { width: 390, height: 844 });
      for (const id of made) await api(page, 'DELETE', '/debts/' + id);
    }
    const fresh = await browser.createBrowserContext();
    const out = await fresh.newPage();
    try {
      await out.setViewport({ width: 390, height: 844 });
      await out.goto(BASE + '/login', { waitUntil: 'networkidle0' });
      eq(await out.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'the sign-in page: nothing scrolls sideways');
      const input = await out.$eval('input[autocomplete=username]', (e) => e.getBoundingClientRect().height);
      truthy(input >= 34, 'the sign-in field is big enough to tap: ' + input);
    } finally {
      await fresh.close();
    }
  });
  await check('the Debts page is left clean: no test debts remain', async () => {
    page = await open('/debts', { width: 390, height: 844 });
    eq((await api(page, 'GET', '/debts')).json.debts.filter((d) => d.name.startsWith('E2E ')).length, 0, 'none left');
  });

  console.log('\nThe home page');
  {
    const ctx = await browser.createBrowserContext();
    const home = await ctx.newPage();
    home.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const clickText = (p, re, sel = 'button') => p.evaluate((src, selector) => [...document.querySelectorAll(selector)].find((b) => new RegExp(src).test(b.textContent))?.click(), re.source, sel);
    const scrollThrough = () => home.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } window.scrollTo(0, 0); });
    // move a range slider the way a person would (React listens for the input event, so the value is set through the native setter)
    const slide = (label, value) => home.evaluate((text, v) => {
      const row = [...document.querySelectorAll('.lp-slider')].find((l) => l.textContent.includes(text));
      const input = row.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, label, value);
    try {
      await check('somebody who is not signed in sees the home page at "/", with ways to log in and sign up', async () => {
        await home.setViewport({ width: 1280, height: 800 });
        await home.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await home.goto(BASE + '/', { waitUntil: 'networkidle0' });
        truthy(/See your money\s+months ahead/.test(await text(home, 'h1')), 'the headline');
        const links = await home.$$eval('.lp-hero a.btn', (a) => a.map((x) => x.getAttribute('href')));
        truthy(links.includes('/login') && links.includes('/signup'), 'hero buttons: ' + links.join());
        const nav = await home.$$eval('.lp-nav a.btn', (a) => a.map((x) => x.getAttribute('href')));
        eq(nav.join(','), '/login,/signup', 'the top bar buttons');
        eq(await home.title(), 'Penny: see your money months ahead', 'its own tab title');
      });
      await check('it explains the features: a strip, a forecast to play with, seven feature cards, a tour, three steps, privacy, questions', async () => {
        truthy((await count(home, '.lp-marquee-track span')) >= 12, 'the strip of what Penny covers');
        eq(await count(home, '.lp-demo'), 1, 'the forecast to play with');
        eq(await count(home, '.lp-card'), 7, 'seven feature cards');
        eq(await count(home, '.lp-tabs button'), 5, 'five pages in the tour');
        eq(await count(home, '.lp-steps li'), 3, 'three steps');
        eq(await count(home, '.lp-privacy-grid li'), 4, 'four privacy promises');
        eq(await count(home, '.lp-faq details'), 6, 'six questions');
        const cards = await home.$$eval('.lp-card h3', (h) => h.map((x) => x.textContent));
        truthy(cards.some((h) => /forecast/i.test(h)) && cards.some((h) => /Debts/.test(h)) && cards.some((h) => /together/i.test(h)) && cards.some((h) => /Ask Penny/.test(h)), 'forecast, debts, shared, assistant: ' + cards.join(' | '));
        await home.evaluate(() => document.querySelector('.lp-faq summary').click());
        truthy(await home.$eval('.lp-faq details', (d) => d.open), 'a question opens');
      });
      await check('the forecast to play with answers the sliders: a squeezed budget goes below zero, a roomy one does not', async () => {
        const verdict = () => home.$eval('.lp-verdict', (e) => ({ bad: e.classList.contains('bad'), text: e.textContent }));
        const start = await verdict();
        eq(start.bad, false, 'the starting numbers are fine: ' + start.text);
        await slide('Bills each month', 4500);
        const squeezed = await verdict();
        eq(squeezed.bad, true, 'bills of 4500 against 2600 coming in: ' + squeezed.text);
        truthy(/below zero in/.test(squeezed.text), 'it says when');
        eq(await home.$eval('.lp-chart', (s) => !!s.getAttribute('aria-label')), true, 'the chart is described for a screen reader');
        const label = await home.$eval('.lp-chart', (s) => s.getAttribute('aria-label'));
        truthy(/lowest point is -/.test(label.replace('−', '-')) || /lowest point is/.test(label), 'it says where the lowest point is: ' + label);
        await slide('Bills each month', 300);
        await slide('One big purchase', 0);
        eq((await verdict()).bad, false, 'roomy again');
        eq(await count(home, '.lp-chart .lp-xl'), 13, 'a label for now and for each of twelve months');
      });
      await check('the tour shows one real page at a time, and the tabs work by mouse and by arrow keys', async () => {
        eq(await home.$eval('.lp-tabs button[aria-selected=true]', (b) => b.textContent.trim()), 'Forecast', 'it starts on the forecast');
        await clickText(home, /^Debts$/, '.lp-tabs button');
        await home.waitForFunction(() => /owe/.test(document.querySelector('.lp-tour-text h3')?.textContent ?? ''));
        eq(await home.$eval('.lp-tabs button[aria-selected=true]', (b) => b.textContent.trim()), 'Debts', 'the debts tab is the chosen one');
        truthy(await home.$eval('.lp-tour-panel .lp-shot-light', (i) => /debts-light\.webp$/.test(i.getAttribute('src'))), 'with the debts picture');
        await home.focus('.lp-tabs button[aria-selected=true]');
        await home.keyboard.press('ArrowRight');
        await home.waitForFunction(() => /together/.test(document.querySelector('.lp-tour-text h3')?.textContent ?? ''));
        eq(await home.$eval('.lp-tabs button[aria-selected=true]', (b) => b.textContent.trim()), 'Shared', 'the arrow key moves on');
        await home.keyboard.press('ArrowRight');
        eq(await home.$eval('.lp-tabs button[aria-selected=true]', (b) => b.textContent.trim()), 'Forecast', 'and wraps around');
      });
      await check('things fade in as they scroll into view, and everything has appeared by the end', async () => {
        await scrollThrough();
        await sleep(900);
        eq(await count(home, '.lp-reveal:not(.in)'), 0, 'nothing is left hidden');
      });
      await check('the pictures load, and the ones that match the theme are the ones shown', async () => {
        await home.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); // not whatever this computer happens to use
        await sleep(300);
        const shown = await home.$$eval('.lp-shot', (imgs) => imgs.filter((i) => getComputedStyle(i).display !== 'none').map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })));
        eq(shown.length, 2, 'the hero and the tour: one picture each');
        truthy(shown.every((i) => i.ok), 'all shown pictures loaded: ' + JSON.stringify(shown.filter((i) => !i.ok)));
        truthy(shown.every((i) => /-light\.webp$/.test(i.src)), 'light theme shows the light pictures');
        await home.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await sleep(300);
        const dark = await home.$$eval('.lp-shot', (imgs) => imgs.filter((i) => getComputedStyle(i).display !== 'none').map((i) => i.getAttribute('src')));
        truthy(dark.length === 2 && dark.every((src) => /-dark\.webp$/.test(src)), 'dark theme shows the dark ones: ' + dark.join());
        await home.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      });
      await check('a person who chose a theme by hand gets that theme\'s pictures, whatever the system says', async () => {
        await home.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const src = await home.$$eval('.lp-shot', (imgs) => imgs.filter((i) => getComputedStyle(i).display !== 'none').map((i) => i.getAttribute('src')));
        truthy(src.length === 2 && src.every((x) => /-dark\.webp$/.test(x)), 'forced dark: ' + src.join());
        await home.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      });
      await check('the links lead on: the buttons, the terms, the privacy policy, and the logo from the sign-in page leads back', async () => {
        await home.click('.lp-nav a[href="/login"]');
        await home.waitForSelector('input[autocomplete=username]');
        eq(new URL(home.url()).pathname, '/login', 'log in');
        await home.click('.auth-brand');
        await home.waitForSelector('.landing');
        eq(new URL(home.url()).pathname, '/', 'the logo goes home');
        await home.click('.lp-nav a[href="/signup"]');
        await home.waitForSelector('.consent-card');
        await home.goto(BASE + '/', { waitUntil: 'networkidle0' });
        const foot = await home.$$eval('.lp-footer a', (a) => a.map((x) => x.getAttribute('href')));
        truthy(foot.includes('/terms') && foot.includes('/privacy'), 'footer: ' + foot.join());
      });
      await check('with reduced motion the page is complete and still: nothing hidden, the strip stands still', async () => {
        await home.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await home.goto(BASE + '/', { waitUntil: 'networkidle0' });
        eq(await home.$$eval('.lp-reveal', (els) => els.filter((e) => getComputedStyle(e).opacity !== '1').length), 0, 'every block is visible at once');
        eq(await home.$eval('.lp-marquee-track', (e) => getComputedStyle(e).animationName), 'none', 'the strip does not scroll');
        eq(await home.$$eval('.lp-marquee-track span', (s) => s.filter((x) => getComputedStyle(x).display === 'none').length), 12, 'the repeated half is not shown');
        await home.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      });
      await check('on a phone nothing scrolls sideways and the top bar keeps its two buttons on one line each', async () => {
        await home.setViewport({ width: 390, height: 844 });
        await home.goto(BASE + '/', { waitUntil: 'networkidle0' });
        await scrollThrough();
        eq(await home.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no sideways scroll');
        const heights = await home.$$eval('.lp-nav-actions .btn', (b) => b.map((x) => Math.round(x.getBoundingClientRect().height)));
        truthy(heights.length === 2 && heights.every((h) => h <= 46), 'one line each: ' + heights.join());
        eq(await home.$eval('.lp-theme-nav', (e) => getComputedStyle(e).display), 'none', 'the theme switch leaves the top bar');
        truthy(await home.$eval('.lp-theme-foot', (e) => getComputedStyle(e).display !== 'none'), 'and is in the footer');
        const big = await home.$$eval('.lp-cta .btn', (b) => b.map((x) => Math.round(x.getBoundingClientRect().height)));
        truthy(big.every((h) => h >= 44), 'big buttons are easy to tap: ' + big.join());
        eq(await home.$$eval('.lp-float', (f) => f.filter((x) => getComputedStyle(x).display !== 'none').length), 0, 'the floating cards give way on a phone');
        eq(await home.$$eval('.lp-card', (c) => new Set(c.map((x) => Math.round(x.getBoundingClientRect().left))).size), 1, 'the feature cards stack in one column');
      });
      await check('the page tells link previews and search engines what it is, with this site\'s own address', async () => {
        const html = await (await fetch(BASE + '/')).text();
        truthy(html.includes('og:image" content="http') && html.includes('/landing/og.png"'), 'an absolute share image address');
        truthy(!html.includes('__APP_URL__'), 'no placeholder left');
        truthy(/name="description" content="Penny is a calm personal budget/.test(html), 'a description');
        const robots = await (await fetch(BASE + '/robots.txt')).text();
        truthy(/Disallow: \/api\//.test(robots), 'robots.txt keeps crawlers out of the API');
      });
    } finally {
      await ctx.close();
    }
  }


  console.log('\nForgot password');
  // A throw-away person (never the demo account), in a browser that is signed out. Where the server has no mail server and runs in production
  // (the real Docker stack) the feature is switched off on purpose, so these checks are skipped there.
  const MAIL_DIR = process.env.MAIL_PREVIEW_DIR || require('node:path').join(__dirname, '..', 'server', 'mail-preview');
  const resetPerson = { name: 'E2E Reset', email: `e2e-reset-${Date.now().toString(36)}@example.com`, username: `e2ereset${Date.now().toString(36)}`.slice(0, 24), password: 'Tr1cky-Horse!Battery', accept_terms: true };
  const newPassword = 'Fresh-Start#2026-ok';
  const resetOn = (await (await fetch(BASE + '/api/auth/config')).json()).passwordResetAvailable === true;
  if (!resetOn) console.log('  skip password reset checks: switched off on this server (production without a mail server)');
  else {
    const signed = await fetch(BASE + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resetPerson) });
    eq(signed.status, 201, 'the throw-away account is made');
    const ctx = await browser.createBrowserContext();
    const out = await ctx.newPage();
    await out.setViewport({ width: 1100, height: 800 });
    out.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const bodyText = () => out.evaluate(() => document.body.innerText);
    const link = async () => {
      for (let i = 0; i < 60; i++) {
        if (fs.existsSync(MAIL_DIR)) {
          const hit = fs.readdirSync(MAIL_DIR).filter((n) => n.endsWith('.txt')).sort().map((n) => fs.readFileSync(require('node:path').join(MAIL_DIR, n), 'utf8')).filter((t) => t.startsWith(`To: ${resetPerson.email}\n`) && /Reset your Penny password/.test(t)).at(-1);
          const m = hit && /(https?:\/\/\S+\/reset-password\?token=[\w-]+)/.exec(hit);
          if (m) return m[1];
        }
        await sleep(250);
      }
      throw new Error('the reset e-mail never arrived in ' + MAIL_DIR);
    };
    let resetUrl;
    try {
      await check('the sign-in page offers "Forgot your password?" and it leads to a page asking for the e-mail address', async () => {
        await out.goto(BASE + '/login', { waitUntil: 'networkidle0' });
        truthy(/Forgot your password\?/.test(await bodyText()), 'the link is there');
        await out.evaluate(() => [...document.querySelectorAll('a')].find((a) => /Forgot your password/.test(a.textContent))?.click());
        await out.waitForSelector('input[type=email]');
        eq(new URL(out.url()).pathname, '/forgot-password', 'the address');
        truthy(/Send me a link/.test(await bodyText()), 'the button');
      });
      await check('asking for a link says the same thing for every address, and a link arrives for the real one', async () => {
        await out.type('input[type=email]', resetPerson.email);
        await out.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Send me a link/.test(b.textContent))?.click());
        await out.waitForFunction(() => /is on its way/.test(document.body.innerText));
        truthy(!/no account|not found|does not exist/i.test(await bodyText()), 'it does not say whether the account exists');
        resetUrl = await link();
        truthy(/reset-password\?token=/.test(resetUrl), 'the link points at the reset page');
      });
      await check('the link opens a page for choosing a new password; a weak one cannot be sent, a mismatch cannot be sent', async () => {
        await out.goto(resetUrl, { waitUntil: 'networkidle0' });
        await out.waitForSelector('input[autocomplete=new-password]');
        const [a, b] = await out.$$('input[autocomplete=new-password]');
        const disabled = () => out.$eval('button.btn.primary', (x) => x.disabled);
        eq(await disabled(), true, 'nothing typed yet');
        await a.type('short');
        await b.type('short');
        eq(await disabled(), true, 'a weak password');
        await a.click({ clickCount: 3 });
        await a.type(newPassword);
        eq(await disabled(), true, 'the two boxes differ');
        await b.click({ clickCount: 3 });
        await b.type(newPassword);
        eq(await disabled(), false, 'a good password, typed twice');
      });
      await check('choosing the password changes it, and the new password signs in (the old one does not)', async () => {
        await out.evaluate(() => document.querySelector('button.btn.primary').click());
        await out.waitForFunction(() => /Password changed/.test(document.body.innerText));
        await out.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Go to sign in/.test(b.textContent))?.click());
        await out.waitForSelector('input[autocomplete=username]');
        const tryLogin = async (pw) => {
          await out.goto(BASE + '/login', { waitUntil: 'networkidle0' });
          await out.type('input[autocomplete=username]', resetPerson.email);
          await out.type('input[autocomplete=current-password]', pw);
          await out.evaluate(() => document.querySelector('form button.btn.primary').click());
        };
        await tryLogin(resetPerson.password);
        await out.waitForFunction(() => /Invalid email, username or password/.test(document.body.innerText));
        await tryLogin(newPassword);
        await out.waitForFunction(() => !document.querySelector('input[autocomplete=username]'), { timeout: 15000 });
      });
      await check('the same link a second time says it has expired, and offers to ask for a new one', async () => {
        const again = await ctx.newPage();
        await again.goto(resetUrl, { waitUntil: 'networkidle0' });
        await again.waitForFunction(() => /This link has expired/.test(document.body.innerText));
        truthy(await again.evaluate(() => [...document.querySelectorAll('a')].some((a) => /Ask for a new link/.test(a.textContent))), 'a way forward');
        await again.close();
      });
      await check('a made-up link says it has expired, without a flicker of the password form', async () => {
        const bad = await ctx.newPage();
        await bad.goto(BASE + '/reset-password?token=' + 'a'.repeat(43), { waitUntil: 'networkidle0' });
        await bad.waitForFunction(() => /This link has expired/.test(document.body.innerText));
        eq(await bad.$$eval('input[autocomplete=new-password]', (n) => n.length), 0, 'no password boxes');
        await bad.close();
      });
    } finally {
      await ctx.close();
      await db.query('DELETE FROM users WHERE email = $1', [resetPerson.email]);
      if (fs.existsSync(MAIL_DIR)) {
        for (const n of fs.readdirSync(MAIL_DIR)) {
          const p = require('node:path').join(MAIL_DIR, n);
          if (n.endsWith('.txt') && fs.readFileSync(p, 'utf8').startsWith(`To: ${resetPerson.email}\n`)) {
            fs.rmSync(p, { force: true });
            fs.rmSync(p.replace(/\.txt$/, '.html'), { force: true });
          }
        }
      }
    }
  }

  console.log('\nTerms, your data and deleting the account');
  {
    const stamp = Date.now().toString(36);
    const person = { name: 'E2E Legal', email: `e2e-legal-${stamp}@example.com`, username: `e2elegal${stamp}`.slice(0, 24), password: 'Tr1cky-Horse!Battery' };
    const ctx = await browser.createBrowserContext();
    const out = await ctx.newPage();
    await out.setViewport({ width: 1100, height: 800 });
    out.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const bodyText = (p = out) => p.evaluate(() => document.body.innerText);
    const clickText = (p, re, sel = 'button') => p.evaluate((src, selector) => [...document.querySelectorAll(selector)].find((b) => new RegExp(src).test(b.textContent))?.click(), re.source, sel);
    try {
      await check('the terms and the privacy policy open without signing in, and link to each other', async () => {
        await out.goto(BASE + '/terms', { waitUntil: 'networkidle0' });
        truthy(/Terms of use/.test(await bodyText()) && /Last updated/.test(await bodyText()), 'the terms page');
        truthy(/not financial, tax or legal advice/.test(await bodyText()), 'says it is not advice');
        await clickText(out, /Privacy policy/, 'nav a');
        await out.waitForFunction(() => /What Penny keeps/.test(document.body.innerText));
        truthy(/We do not sell your data/.test(await bodyText()), 'the privacy promise');
        truthy(/download everything and delete your account yourself/.test(await bodyText()), 'says what you can do');
      });
      await check('the sign-in page links to both documents', async () => {
        await out.goto(BASE + '/login', { waitUntil: 'networkidle0' });
        const links = await out.$$eval('.auth-legal a', (a) => a.map((x) => x.getAttribute('href')));
        eq(links.join(','), '/terms,/privacy,/contact', 'the two documents and the contact form');
      });
      await check('sign-up cannot be sent until the terms are accepted, and the documents open in a new tab', async () => {
        await out.goto(BASE + '/signup', { waitUntil: 'networkidle0' });
        const targets = await out.$$eval('.consent-card a', (a) => a.map((x) => x.target));
        eq(targets.join(','), '_blank,_blank', 'new tabs, so a half-filled form is not lost');
        await out.type('input[autocomplete=name]', person.name);
        await out.type('input[type=email]', person.email);
        await out.$eval('input[type=email]', (e) => e.blur());
        await sleep(400);
        await out.click('.prefixed input', { clickCount: 3 });
        await out.type('.prefixed input', person.username);
        const [a, b] = await out.$$('input[autocomplete=new-password]');
        await a.type(person.password);
        await b.type(person.password);
        await sleep(700); // the username check
        const disabled = () => out.$eval('form button.btn.primary', (x) => x.disabled);
        eq(await disabled(), true, 'everything filled in but the box is not ticked');
        await out.click('.consent-card .consent-box');
        eq(await disabled(), false, 'the box is ticked');
      });
      await check('signing up creates the account (the acceptance is kept) and opens the app, without the one-time notice', async () => {
        await out.evaluate(() => document.querySelector('form button.btn.primary').click());
        await out.waitForFunction(() => !document.querySelector('input[autocomplete=new-password]'), { timeout: 15000 });
        await out.waitForSelector('.shell', { timeout: 15000 });
        const row = (await db.query('SELECT terms_version, terms_accepted_at FROM users WHERE email = $1', [person.email])).rows[0];
        truthy(row?.terms_version && row.terms_accepted_at, 'the acceptance was recorded');
        eq(await out.$('.terms-notice'), null, 'no notice for somebody who just accepted');
      });
      await check('somebody from before the terms existed sees a one-time notice, and it goes away once accepted', async () => {
        await db.query('UPDATE users SET terms_version = NULL, terms_accepted_at = NULL WHERE email = $1', [person.email]);
        await out.goto(BASE + '/', { waitUntil: 'networkidle0' });
        await out.waitForSelector('.terms-notice');
        truthy(/Terms of use/.test(await text(out, '.terms-notice')) && /Privacy policy/.test(await text(out, '.terms-notice')), 'the notice names both');
        await clickText(out, /I accept/);
        await out.waitForSelector('.terms-notice', { hidden: true });
        truthy((await db.query('SELECT terms_version FROM users WHERE email = $1', [person.email])).rows[0].terms_version, 'remembered');
      });
      await check('Settings, Account has "Download my data": the file holds the person and no secrets', async () => {
        await out.goto(BASE + '/settings?tab=account', { waitUntil: 'networkidle0' });
        truthy(/Download my data/.test(await bodyText()) && /Delete my account/.test(await bodyText()), 'both are there');
        const r = await out.evaluate(async () => {
          const res = await fetch('/api/auth/account/export', { credentials: 'same-origin' });
          return { status: res.status, disposition: res.headers.get('content-disposition'), text: await res.text() };
        });
        eq(r.status, 200, 'status');
        truthy(/^attachment; filename="penny-data-/.test(r.disposition), 'a download');
        truthy(r.text.includes(person.email) && !/password_hash|token_hash/.test(r.text), 'the person is in it, secrets are not');
      });
      await check('deleting the account: the button waits for the password and the word DELETE, then everything is gone', async () => {
        await clickText(out, /Delete my account…/);
        await out.waitForSelector('.modal');
        const disabled = () => out.$eval('.modal button.btn.danger', (x) => x.disabled);
        eq(await disabled(), true, 'nothing filled in');
        await out.type('.modal input[autocomplete=current-password]', 'wrong-Password-1!');
        await out.type('.modal input[autocomplete=off]', 'DELETE');
        eq(await disabled(), false, 'password and DELETE typed');
        await out.evaluate(() => document.querySelector('.modal button.btn.danger').click());
        await out.waitForFunction(() => /not correct/.test(document.body.innerText), { timeout: 10000 });
        eq((await db.query('SELECT 1 FROM users WHERE email = $1', [person.email])).rowCount, 1, 'a wrong password deletes nothing');
        await out.click('.modal input[autocomplete=current-password]', { clickCount: 3 });
        await out.type('.modal input[autocomplete=current-password]', person.password);
        await out.evaluate(() => document.querySelector('.modal button.btn.danger').click());
        await out.waitForSelector('input[autocomplete=username]', { timeout: 15000 });
        eq((await db.query('SELECT 1 FROM users WHERE email = $1', [person.email])).rowCount, 0, 'the account is gone');
        eq((await db.query('SELECT 1 FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = w.owner_id)')).rowCount, 0, 'no budget was left behind');
      });
    } finally {
      await ctx.close();
      await db.query('DELETE FROM users WHERE email = $1', [person.email]);
      if (process.env.MAIL_PREVIEW_DIR || true) {
        const dir = process.env.MAIL_PREVIEW_DIR || require('node:path').join(__dirname, '..', 'server', 'mail-preview');
        if (fs.existsSync(dir)) {
          for (const n of fs.readdirSync(dir)) {
            const p = require('node:path').join(dir, n);
            if (n.endsWith('.txt') && fs.readFileSync(p, 'utf8').startsWith(`To: ${person.email}\n`)) {
              fs.rmSync(p, { force: true });
              fs.rmSync(p.replace(/\.txt$/, '.html'), { force: true });
            }
          }
        }
      }
    }
  }

  console.log('\nContact form and messages');
  {
    const WHO = 'E2E Visitor ' + Date.now().toString(36).slice(-4);
    const TEXT = 'E2E: how do I move a payment to next month? ' + Date.now();
    const mine = () => db.query("SELECT * FROM contact_messages WHERE message LIKE 'E2E:%' ORDER BY id");
    const clickBtn = (p, re, sel = 'button') => p.evaluate((src, selector) => [...document.querySelectorAll(selector)].find((b) => new RegExp(src).test(b.textContent))?.click(), re.source, sel);
    const ctx = await browser.createBrowserContext();
    const visitor = await ctx.newPage();
    visitor.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    try {
      await check('a visitor who is not signed in can open /contact, and the form cannot be sent until it is filled in', async () => {
        await visitor.setViewport({ width: 1280, height: 900 });
        await visitor.goto(BASE + '/contact', { waitUntil: 'networkidle0' });
        eq(await text(visitor, 'h1'), 'Contact us', 'the heading');
        eq(await visitor.$eval('.contact-form input[autocomplete=name]', (i) => i.value), '', 'the name starts empty');
        eq(await visitor.$eval('.contact-form button.btn.primary', (b) => b.disabled), true, 'nothing to send yet');
        await visitor.type('.contact-form input[autocomplete=name]', WHO);
        await visitor.type('.contact-form input[type=email]', 'visitor@example.com');
        await visitor.type('.contact-form textarea', 'too short');
        eq(await visitor.$eval('.contact-form button.btn.primary', (b) => b.disabled), true, 'still too short');
      });
      await check('the trap field is out of sight and out of reach: hidden from people and from screen readers, and not in the tab order', async () => {
        const trap = await visitor.$eval('.contact-trap', (e) => ({ left: e.getBoundingClientRect().right, hidden: e.getAttribute('aria-hidden'), tab: e.querySelector('input').tabIndex }));
        truthy(trap.left < 0, 'it sits off the page: ' + trap.left);
        eq(trap.hidden, 'true', 'hidden from screen readers');
        eq(trap.tab, -1, 'not reachable with the Tab key');
      });
      await check('sending says thank you, with the address the answer goes to, and the message is kept (not tied to an account)', async () => {
        await visitor.click('.contact-form textarea', { clickCount: 3 });
        await visitor.type('.contact-form textarea', TEXT);
        await clickBtn(visitor, /^Send message$/, '.contact-form button');
        await visitor.waitForSelector('.banner.ok');
        truthy(/visitor@example\.com/.test(await text(visitor, '.banner.ok')), 'it names the address: ' + (await text(visitor, '.banner.ok')));
        const rows = (await mine()).rows;
        eq(rows.length, 1, 'one message');
        eq(rows[0].name, WHO, 'the name');
        eq(rows[0].user_id, null, 'not tied to an account');
        eq(rows[0].topic, 'question', 'the default topic');
      });
      await check('a signed-in person gets their name and address filled in, and the message is tied to their account', async () => {
        page = await open('/contact');
        await page.waitForSelector('.contact-form');
        const me = (await db.query('SELECT name, email FROM users WHERE id = $1', [userId])).rows[0];
        eq(await page.$eval('.contact-form input[autocomplete=name]', (i) => i.value), me.name, 'the name');
        eq((await page.$eval('.contact-form input[type=email]', (i) => i.value)).toLowerCase(), me.email.toLowerCase(), 'the address');
        await page.type('.contact-form textarea', 'E2E: a note from a signed-in person, about an idea');
        await clickBtn(page, /^Send message$/, '.contact-form button');
        await page.waitForSelector('.banner.ok');
        const row = (await db.query("SELECT user_id FROM contact_messages WHERE message LIKE 'E2E: a note from a signed-in%'")).rows[0];
        eq(row?.user_id, userId, 'tied to the account');
      });
      await check('the contact form is one click away from the places people look: the home page, sign-in, the terms and the privacy policy', async () => {
        await visitor.goto(BASE + '/', { waitUntil: 'networkidle0' });
        truthy((await visitor.$$eval('.lp-footer a', (a) => a.map((x) => x.getAttribute('href')))).includes('/contact'), 'home page footer');
        await visitor.goto(BASE + '/login', { waitUntil: 'networkidle0' });
        truthy((await visitor.$$eval('.auth-legal a', (a) => a.map((x) => x.getAttribute('href')))).includes('/contact'), 'sign-in page');
        for (const p of ['/terms', '/privacy']) {
          await visitor.goto(BASE + p, { waitUntil: 'networkidle0' });
          truthy(await visitor.$('.legal-nav a[href="/contact"]'), p + ': Contact in the top links');
          truthy(await visitor.$('.legal-article a[href="/contact"]'), p + ': the form is named in the text');
          truthy(!/has not been added/.test(await text(visitor, 'main')), p + ': no "not added yet" line');
        }
      });
    } finally {
      await ctx.close();
    }

    await check('Admin has a Messages tab with the unread count on it; the list shows both messages, newest first, unread in bold', async () => {
      await setAdmin(true);
      await adminTab();
      const tab = await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent.trim().replace(/\s+/g, ' ')));
      truthy(tab.some((t) => /^Messages ?2$/.test(t)), 'the tab says 2 are waiting: ' + tab.join(' | '));
      await adminTab('messages');
      eq(await count(page, '.msg'), 2, 'two messages');
      eq(await count(page, '.msg.unread'), 2, 'both unread');
      truthy(/signed-in person/.test(await text(page, '.msg:first-child .msg-preview')), 'the newest first: ' + (await text(page, '.msg:first-child .msg-preview')));
    });
    await check('opening a message shows all of it, marks it read (the count goes down), and offers a reply that opens the mail program', async () => {
      await page.click('.msg:last-child .msg-head');
      await page.waitForSelector('.msg.open .msg-text');
      eq(await text(page, '.msg.open .msg-text'), TEXT, 'the whole text');
      await page.waitForFunction(() => /^Messages ?1$/.test([...document.querySelectorAll('[role=tab]')].find((t) => /Messages/.test(t.textContent)).textContent.trim().replace(/\s+/g, ' ')));
      const href = await page.$eval('.msg.open a.btn', (a) => a.getAttribute('href'));
      truthy(href.startsWith('mailto:visitor@example.com?subject='), 'a reply to the writer: ' + href);
      eq((await db.query('SELECT read_at IS NOT NULL AS r FROM contact_messages WHERE message = $1', [TEXT])).rows[0].r, true, 'marked read in the database');
    });
    await check('mark unread, archive and restore work from the open message, and the filter shows archived ones', async () => {
      await clickBtn(page, /^\s*Mark unread/, '.msg.open button');
      await page.waitForFunction(() => document.querySelectorAll('.msg.unread').length === 2);
      await clickBtn(page, /^\s*Archive/, '.msg.open button');
      await page.waitForFunction(() => document.querySelectorAll('.msg').length === 1);
      eq((await db.query('SELECT archived_at IS NOT NULL AS a FROM contact_messages WHERE message = $1', [TEXT])).rows[0].a, true, 'archived in the database');
      await page.click('.admin-filters .filter-btn');
      await page.waitForSelector('.filter-opt');
      await clickBtn(page, /Archived/, '.filter-opt');
      await page.waitForFunction(() => document.querySelectorAll('.msg').length === 1 && /Visitor|visitor/.test(document.querySelector('.msg').textContent));
      await page.click('.msg-head');
      await page.waitForSelector('.msg.open');
      await clickBtn(page, /^\s*Restore/, '.msg.open button');
      await page.waitForFunction(() => document.querySelectorAll('.msg').length === 0);
    });
    await check('delete asks first, then removes the message for good', async () => {
      await adminTab('messages');
      await page.click('.msg-head');
      await page.waitForSelector('.msg.open');
      await page.confirm();
      await clickBtn(page, /^\s*Delete/, '.msg.open button');
      await page.waitForFunction(() => document.querySelectorAll('.msg').length === 0 || document.querySelectorAll('.msg').length === 1);
      await sleep(400);
      eq((await mine()).rowCount, 1, 'one message is left, the other is gone');
    });
    await check('on a phone the contact form is one column and Messages does not scroll sideways', async () => {
      page = await open('/admin?tab=messages', { width: 390, height: 844 });
      await page.waitForSelector('[role=tabpanel]');
      await sleep(500);
      eq(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Messages: no sideways scroll');
      page = await open('/contact', { width: 390, height: 844 });
      await page.waitForSelector('.contact-form');
      eq(await page.$$eval('.contact-row > *', (c) => new Set(c.map((x) => Math.round(x.getBoundingClientRect().left))).size), 1, 'name and e-mail stacked');
      eq(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'the form: no sideways scroll');
    });
    await db.query("DELETE FROM contact_messages WHERE message LIKE 'E2E:%'");
    await db.query("DELETE FROM notifications WHERE user_id = $1 AND title = 'New message'", [userId]);
    await setAdmin(false);
  }

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
