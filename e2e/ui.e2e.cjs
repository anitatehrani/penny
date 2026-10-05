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
      await out.goto(BASE + '/', { waitUntil: 'networkidle0' });
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
    truthy(/Paid with the card bill/.test(await text(page, '.summary-strip')) && /123\.45/.test(await text(page, '.summary-strip')), 'the card total is shown');
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
    truthy(/Bought on card/.test(strip) && /123\.45/.test(strip), 'the strip shows it as bought on card: ' + strip.replace(/\s+/g, ' '));
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
    eq(await page.$eval('.modal input[type=date]', (e) => e.value), TODAY, 'the date field is the purchase day');
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
    truthy(/^\d{4}-\d{2}-\d{2}$/.test(await page.$eval('.end-box input[type=date]', (e) => e.value)), 'with its date filled in');
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
    await p.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await p.type('input[autocomplete=username]', typed);
    await p.type('input[autocomplete=current-password]', password);
    await p.click('.auth-card .btn.primary.wide');
    return { p, close: () => fresh.close() };
  };
  await check('the sign-in form asks for an email or a username', async () => {
    const fresh = await browser.createBrowserContext();
    const p = await fresh.newPage();
    try {
      await p.goto(BASE + '/', { waitUntil: 'networkidle0' });
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
      await out.goto(BASE + '/', { waitUntil: 'networkidle0' });
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
