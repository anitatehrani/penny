/* Re-makes the pictures on the public home page (client/public/landing): real pages of the demo account in light and dark, and the
 * 1200x630 share image. Run it whenever the screens change enough that the pictures look out of date.
 *
 *   1. start the app on a scratch database and fill it with the demo:   npm run seed:demo
 *   2. cd e2e && npm run landing        (APP_URL, DATABASE_URL and CHROME_PATH work as for the browser checks)
 *   3. rebuild the client (cd client && npx vite build)
 *
 * It changes the demo account (a roomier opening balance so the first picture shows a healthy budget, and two made-up debts for the Debts
 * picture), so never run it against real data: it refuses unless the database name has "scratch" or "demo" in it, or FORCE=1 is set.
 */
const puppeteer = require('puppeteer-core');
const pg = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');

const BASE = process.env.APP_URL || 'http://localhost:3001';
const DB = process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget';
const OUT = path.resolve(__dirname, '../client/public/landing');
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH');
  if (!/scratch|demo/i.test(DB) && process.env.FORCE !== '1') throw new Error('This changes the demo account. Point DATABASE_URL at a scratch database (or set FORCE=1 if you are sure).');
  fs.mkdirSync(OUT, { recursive: true });
  const db = new pg.Pool({ connectionString: DB });
  const alex = (await db.query(`SELECT id FROM users WHERE email = 'alex.morgan@example.com'`)).rows[0];
  if (!alex) throw new Error('no demo account: run npm run seed:demo first');
  const spaces = (await db.query(`SELECT w.id, w.name, w.kind FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 ORDER BY w.id`, [alex.id])).rows;
  const personal = spaces.find((s) => s.kind === 'personal');
  const group = spaces.find((s) => s.kind === 'group' && /home/i.test(s.name)) || spaces.find((s) => s.kind === 'group');
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '2 hours', 'landing-assets')`, [createHash('sha256').update(token).digest('hex'), alex.id]);
  const api = async (method, url, body) => {
    const res = await fetch(`${BASE}/api${url}`, { method, headers: { 'content-type': 'application/json', cookie: `sid=${token}`, 'x-workspace': String(personal.id) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
    return res.json();
  };
  // a roomier balance, so the first thing a visitor sees is a healthy budget (the debts come later, only for their own picture)
  const cur = await api('GET', '/settings');
  await api('PUT', '/settings', { opening_balance: Number(cur.opening_balance) + 4200, currency: cur.currency });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const take = async (name, url, theme, ws) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setCookie({ name: 'sid', value: token, url: BASE });
    await page.evaluateOnNewDocument((key, id) => { try { localStorage.setItem(key, String(id)); } catch { /* ignore */ } }, `workspace:${alex.id}`, ws.id);
    await page.goto(BASE + url, { waitUntil: 'networkidle0' });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, `${name}-${theme}.webp`), type: 'webp', quality: 80 });
    await ctx.close();
  };
  for (const theme of ['light', 'dark']) {
    await take('dashboard', '/', theme, personal);
    await take('forecast', '/forecast', theme, personal);
    await take('payments', '/payments', theme, personal);
    await take('installments', '/installments', theme, personal);
    await take('shared', '/', theme, group);
  }
  const laptop = await api('POST', '/debts', { name: 'Laptop from Sam', total_amount: 900, plan: 'monthly', first_due_date: '2026-11-05', installment_count: 6, count_in_budget: true });
  await api('POST', '/debts', { name: 'Dentist payment plan', total_amount: 420, plan: 'monthly', first_due_date: '2026-10-20', installment_count: 3, count_in_budget: true });
  await api('POST', `/debts/${laptop.id}/payments`, { amount: 150, date: '2026-10-05' });
  for (const theme of ['light', 'dark']) await take('debts', '/debts', theme, personal);

  // the share image: the headline and the dashboard picture on a soft background
  const pub = path.resolve(__dirname, '../client/public');
  const fontFile = path.resolve(__dirname, '../client/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2');
  const wordmark = fs.readFileSync(path.join(pub, 'brand/penny-wordmark.svg'), 'utf8').replace('width="373" height="118"', 'width="190" height="60"');
  const url = (p) => 'file:///' + p.replace(/\\/g, '/');
  const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Geist; src: url('${url(fontFile)}'); font-weight: 100 900; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: Geist, system-ui, sans-serif; }
body { background: #f4f3ee; position: relative; }
.glow { position: absolute; inset: 0; background: radial-gradient(60% 80% at 20% 0%, rgba(31, 95, 196, .16), transparent 70%); }
.left { position: absolute; left: 72px; top: 64px; width: 520px; }
h1 { margin: 44px 0 0; font-size: 70px; line-height: 1.04; letter-spacing: -2.4px; color: #14161a; font-weight: 700; }
p { margin: 26px 0 0; font-size: 29px; line-height: 1.4; color: #474a52; }
.win { position: absolute; left: 640px; top: 96px; width: 760px; border-radius: 18px; overflow: hidden; border: 1px solid #cbc8bc; box-shadow: 0 30px 70px rgba(20, 20, 18, .22); background: #fcfbf8; }
.bar { height: 30px; background: #eeece5; border-bottom: 1px solid #e1dfd6; }
.win img { display: block; width: 100%; }
</style><div class="glow"></div>
<div class="left">${wordmark}<h1>See your money months ahead.</h1><p>Payments, bills, installments and debts in one clear forecast.</p></div>
<div class="win"><div class="bar"></div><img src="${url(path.join(OUT, 'dashboard-light.webp'))}"></div>`;
  const tmp = path.join(require('node:os').tmpdir(), 'penny-og.html');
  fs.writeFileSync(tmp, html);
  const og = await browser.newPage();
  await og.setViewport({ width: 1200, height: 630 });
  await og.goto(url(tmp), { waitUntil: 'networkidle0' });
  await sleep(500);
  await og.screenshot({ path: path.join(OUT, 'og.png'), type: 'png' });

  await browser.close();
  await db.end();
  console.log(`Pictures written to ${OUT}. Now rebuild the client.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
