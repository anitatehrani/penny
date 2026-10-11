/* Browser end-to-end checks for being found by search engines and for how fast the home page is (docs/DESIGN.md section 44).
 *
 *   cd e2e && npm install && npm run seo
 *
 * It starts the real server on a throw-away database, with its own address as the site address, and visits it as a stranger would, with scripts and
 * without them: titles, descriptions, the address of each page, structured data, the words for readers without scripts, what is and is not offered
 * to search engines, and how much a visitor to the home page downloads (the signed-in app must not be part of it). Needs the built client
 * (npm run build) and Postgres. Set CHROME_PATH if Chrome is not in its usual place.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-seo-'));
  const dbName = `penny_e2e_seo_${process.pid}`;
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const port = await freePort();
  const BASE = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, DATABASE_URL: `${PG_BASE}/${dbName}`, PORT: String(port), APP_URL: BASE, COOKIE_SECURE: 'false', ALERT_SCAN_MINUTES: 'off', BACKUPS: 'off', SMTP_HOST: '', MAIL_PREVIEW_DIR: path.join(dir, 'mail') },
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

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  /** A stranger: no cookies, light theme, and a record of every file the page asks for. */
  async function visit(url, { scripts = true, theme = 'light', width = 1280, height = 900 } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height });
    await page.setJavaScriptEnabled(scripts);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    const files = [];
    page.on('response', async (r) => {
      try {
        const type = r.request().resourceType();
        const buf = type === 'script' || type === 'image' || type === 'stylesheet' ? await r.buffer() : null;
        files.push({ url: new URL(r.url()).pathname, type, bytes: buf ? buf.length : 0, status: r.status() });
      } catch {
        /* a file that was cancelled */
      }
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
    return { page, files, close: () => context.close() };
  }
  const meta = (page, sel) => page.$eval(sel, (e) => e.getAttribute('content') ?? e.getAttribute('href')).catch(() => null);

  console.log('Search engines and speed');

  await check('the home page, as a stranger sees it, has one main heading, the right title and a description of a sensible length', async () => {
    const { page, close } = await visit('/');
    eq(await page.title(), 'Penny: a personal budget with a forecast months ahead', 'title');
    eq(await page.$$eval('h1', (h) => h.length), 1, 'number of h1');
    const description = await meta(page, 'meta[name=description]');
    truthy(description.length >= 100 && description.length <= 160, `a description of ${description?.length} characters`);
    eq(await meta(page, 'link[rel=canonical]'), `${BASE}/`, 'canonical');
    eq(await meta(page, 'meta[property="og:url"]'), `${BASE}/`, 'og:url');
    eq(await page.$('meta[name=robots]'), null, 'no noindex on the home page');
    await close();
  });

  await check('every picture on the home page has a description for people who cannot see it', async () => {
    const { page, close } = await visit('/');
    const imgs = await page.$$eval('img', (els) => els.map((i) => [i.getAttribute('alt'), i.getAttribute('width'), i.getAttribute('height')]));
    truthy(imgs.length >= 2, 'pictures on the page');
    for (const [alt, w, h] of imgs) {
      truthy(alt && alt.trim().length > 8, `alt text: ${alt}`);
      truthy(w && h, 'a width and height, so the page does not jump while pictures load');
    }
    await close();
  });

  await check('the structured data is valid JSON describing a free finance web app, and matches the page', async () => {
    const { page, close } = await visit('/');
    const data = JSON.parse(await page.$eval('script[type="application/ld+json"]', (e) => e.textContent));
    const app = data.find((d) => d['@type'] === 'WebApplication');
    eq(app.name, 'Penny', 'name');
    eq(app.url, `${BASE}/`, 'url');
    eq(app.applicationCategory, 'FinanceApplication', 'category');
    eq(app.description, await meta(page, 'meta[name=description]'), 'the same description as the page');
    await close();
  });

  await check('a visitor to the home page does not download the signed-in app, and it is a fraction of the whole', async () => {
    const { files, close } = await visit('/');
    const scripts = files.filter((f) => f.type === 'script');
    truthy(scripts.length >= 1, 'a script');
    truthy(!scripts.some((s) => /SignedIn|pdf/.test(s.url)), `the app was downloaded: ${scripts.map((s) => s.url).join(', ')}`);
    const total = scripts.reduce((a, s) => a + s.bytes, 0);
    truthy(total < 450 * 1024, `scripts of ${Math.round(total / 1024)} KB (limit 450 KB, was about 1,000 KB before the app was split off)`);
    const dist = path.join(ROOT, 'client/dist/assets');
    const app = fs.readdirSync(dist).find((f) => /^SignedIn-.*\.js$/.test(f));
    truthy(app, 'the signed-in app is its own file');
    truthy(fs.statSync(path.join(dist, app)).size > total * 0.8, 'and it is big, so leaving it out matters');
    await close();
  });

  await check('in the light theme the first view downloads one picture of the top screenshot, not both', async () => {
    const { files, close } = await visit('/');
    const dashboard = files.filter((f) => f.type === 'image' && /dashboard-(light|dark)\.webp$/.test(f.url));
    eq(dashboard.some((f) => /dark/.test(f.url)), false, 'the dark picture');
    eq(dashboard.some((f) => /light/.test(f.url)), true, 'the light picture');
    await close();
  });

  await check('without scripts a reader still gets the message, the questions and the way on', async () => {
    const { page, close } = await visit('/', { scripts: false });
    const text = await page.$eval('body', (b) => b.innerText);
    truthy(/Penny turns your payments, recurring bills, installments and debts into one clear forecast/.test(text), 'the lead sentence');
    truthy(/Is Penny free\?/.test(text) && /Does it connect to my bank\?/.test(text), 'the questions');
    for (const href of ['/login', '/terms', '/privacy', '/contact']) truthy(await page.$(`noscript a[href="${href}"], a[href="${href}"]`), `a link to ${href}`);
    await close();
  });

  await check('the legal and contact pages are named in the tab, from the first moment and after moving there from the home page', async () => {
    for (const [p, title] of [['/terms', 'Terms of use · Penny'], ['/privacy', 'Privacy policy · Penny'], ['/contact', 'Contact us · Penny']]) {
      const { page, close } = await visit(p);
      eq(await page.title(), title, `title of ${p}`);
      eq(await meta(page, 'link[rel=canonical]'), `${BASE}${p}`, `canonical of ${p}`);
      await close();
    }
    const { page, close } = await visit('/');
    await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/terms')?.click());
    await page.waitForFunction(() => location.pathname === '/terms');
    eq(await page.title(), 'Terms of use · Penny', 'title after moving');
    await close();
  });

  await check('the sitemap lists only pages that answer, can be indexed and have a title of their own', async () => {
    const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    eq(locs.length, 4, 'pages in the sitemap');
    const titles = new Set();
    for (const loc of locs) {
      const r = await fetch(loc);
      eq(r.status, 200, loc);
      eq(r.headers.get('x-robots-tag'), null, `${loc} may be indexed`);
      const html = await r.text();
      titles.add(/<title>([^<]*)<\/title>/.exec(html)[1]);
      truthy(!/name="robots"/.test(html), `${loc} has no noindex`);
    }
    eq(titles.size, 4, 'distinct titles');
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    truthy(robots.includes(`Sitemap: ${BASE}/sitemap.xml`), 'robots.txt points to the sitemap');
  });

  await check('the app and the sign-in pages are kept out of search results, in the header and in the page', async () => {
    for (const p of ['/payments', '/login', '/signup', '/budget', '/settings']) {
      const r = await fetch(`${BASE}${p}`);
      eq(r.headers.get('x-robots-tag'), 'noindex, nofollow', p);
      truthy(/<meta name="robots" content="noindex, nofollow"/.test(await r.text()), `${p} says it in the page`);
    }
  });

  await check('the picture shown when the link is shared is real and the right size', async () => {
    const { page, close } = await visit('/');
    const image = await meta(page, 'meta[property="og:image"]');
    eq(image, `${BASE}/landing/og.png`, 'og:image');
    const buf = Buffer.from(await (await fetch(image)).arrayBuffer());
    eq(buf.subarray(1, 4).toString(), 'PNG', 'a PNG');
    eq([buf.readUInt32BE(16), buf.readUInt32BE(20)].join('x'), '1200x630', 'size');
    eq(await meta(page, 'meta[property="og:image:width"]'), '1200', 'declared width');
    await close();
  });

  await check('a signed-in person gets the app after a short wait, and the app\'s own page titles', async () => {
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Seo Tester', email: `seo${Date.now()}@example.com`, username: `seo${Date.now() % 1e7}`, password: 'Tr1cky-Horse!Battery', accept_terms: true }),
    });
    const sid = /sid=([^;]+)/.exec(signup.headers.getSetCookie().join(';'))[1];
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const loaded = [];
    page.on('response', (r) => loaded.push(new URL(r.url()).pathname));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setCookie({ name: 'sid', value: sid, url: BASE });
    await page.goto(`${BASE}/payments`, { waitUntil: 'networkidle0' });
    truthy(loaded.some((u) => /SignedIn-.*\.js$/.test(u)), 'the app was fetched after signing in');
    eq(await page.title(), 'Payments · Penny', 'title of the app page');
    truthy(await page.$('.sidebar, nav'), 'the app is drawn');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    eq(await page.title(), 'Dashboard · Penny', 'title of the dashboard');
    await context.close();
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
  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (/Error|error:/.test(log.replace(/Penny listening.*/g, ''))) console.log(`server log:\n${log}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
