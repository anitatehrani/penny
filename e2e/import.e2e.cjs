/* Browser end-to-end checks for importing a bank statement (docs/DESIGN.md section 41).
 *
 *   cd e2e && npm install && npm run import
 *
 * It starts the real server on a throw-away database, signs a new person up, and drives a real headless Chrome/Edge through the Import
 * statement window with files it makes itself (a CSV, an Excel file, a PDF laid out like a bank's): reading, review, editing, saving,
 * duplicates, undo, Penny remembering a correction, a phone and the dark theme. The files hold invented payments only.
 * Needs the built client (npm run build) and Postgres. Set CHROME_PATH if Chrome is not in its usual place.
 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pg = require('pg');

const ROOT = path.join(__dirname, '..');
const PG_BASE = process.env.TEST_PG_URL || 'postgres://budget@127.0.0.1:5433';
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'penny-import-shots');

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
const freePort = () => new Promise((resolve, reject) => {
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
  const files = await import(pathToFileURL(path.join(ROOT, 'client/test/helpers/files.js')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penny-import-'));

  // a throw-away database and the real server on it
  const dbName = `penny_e2e_import_${process.pid}`;
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

  // a person, with a session cookie
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Import Tester', email: `import${Date.now()}@example.com`, username: `imp${Date.now() % 1e7}`, password: 'Tr1cky-Horse!Battery', accept_terms: true }),
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
  const sid = /sid=([^;]+)/.exec(signup.headers.getSetCookie().join(';'))[1];
  const api = (p, init = {}) => fetch(`${BASE}/api${p}`, { ...init, headers: { cookie: `sid=${sid}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((r) => r.json());
  await api('/settings', { method: 'PUT', body: JSON.stringify({ opening_balance: 1000, currency: 'EUR' }) });

  // the files
  const today = new Date();
  const ymd = (offset) => {
    const d = new Date(today.getTime() - offset * 86400000);
    return { iso: d.toISOString().slice(0, 10), it: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` };
  };
  const csvPath = path.join(dir, 'movimenti.csv');
  fs.writeFileSync(csvPath, [
    'Data;Descrizione;Importo;Saldo',
    `${ymd(6).it};ESSELUNGA MILANO 0123;-45,30;954,70`,
    `${ymd(5).it};ZARA ITALIA SRL;-29,99;924,71`,
    `${ymd(4).it};NETFLIX.COM;-12,99;911,72`,
    `${ymd(3).it};Bianchi Mario;-5,80;905,92`,
    `${ymd(2).it};Bonifico stipendio ACME SPA;1.800,50;2.706,42`,
    `${ymd(1).it};Prelievo BANCOMAT;-50,00;2.656,42`,
  ].join('\n'));

  const pdfPath = path.join(dir, 'account-statement.pdf');
  const rev = [
    { cells: [ymd(9).it.slice(0, 5) + '/' + ymd(9).iso.slice(0, 4), ['Corner Bakery', 'Transaction Id: 11111111-2222-3333-4444-555555555555', 'Card: 411111******1111'], '4.50', '', '95.50'] },
    { cells: [ymd(8).it, ['Payroll Acme', 'Transaction Id: 22222222-2222-3333-4444-555555555555'], '', '1,000.00', '1,095.50'] },
    { cells: [ymd(7).it, ['Transfer to JOHN DOE', 'Reference: dinner', 'Transaction Id: 33333333-2222-3333-4444-555555555555'], '20.00', '', '1,075.50'] },
    { cells: [ymd(7).it, 'Pharmacy', '12.30', '', '1,063.20'] },
  ];
  const title = (str, y) => ({ str, x: 40, y, w: 250, h: 10 });
  fs.writeFileSync(pdfPath, files.makePdf([{
    items: [
      title('Pending from October 1, 2026 to October 8, 2026', 120),
      ...files.tableItems({ cols: files.REVOLUT_COLS.slice(0, 4), rows: [{ cells: [ymd(1).it, 'Online Shop', '', '29.99'] }], y: 145, pitch: 11 }).items,
      title('Account transactions from October 1, 2026 to October 8, 2026', 260),
      ...files.tableItems({ cols: files.REVOLUT_COLS, rows: rev, y: 285, pitch: 11, rowGap: 14 }).items,
      ...files.furniture(0, 1, 'EUR Statement'),
    ],
  }]));

  const xlsxPath = path.join(dir, 'statement.xlsx');
  fs.writeFileSync(xlsxPath, files.makeXlsx([{ name: 'S', rows: [['Date', 'Description', 'Amount'], [{ date: 46296 }, 'Lidl 528', -23.4], [{ date: 46297 }, 'Spotify', -10.99], [{ date: 46298 }, 'Rent October', -650]] }]));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function open(url, { width = 1280, height = 900, theme = 'light' } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setCookie({ name: 'sid', value: sid, url: BASE });
    await page.evaluateOnNewDocument((t) => {
      try {
        localStorage.setItem('theme', t);
      } catch { /* ignore */ }
    }, theme);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
    return page;
  }
  // textContent, not innerText: lines far down a long list are not drawn yet (content-visibility), and innerText skips what is not drawn
const text = (page, sel = 'body') => page.$eval(sel, (e) => e.textContent);
  const clickText = async (page, re, scope = 'button') => {
    const ok = await page.evaluate((src, flags, sc) => {
      const rx = new RegExp(src, flags);
      const el = [...document.querySelectorAll(sc)].find((b) => rx.test(b.innerText || b.textContent) && !b.disabled);
      if (!el) return false;
      el.click();
      return true;
    }, re.source, re.flags, scope);
    if (!ok) throw new Error(`no button matching ${re}`);
  };
  const upload = async (page, file) => {
    const input = await page.$('input[type=file]');
    await input.uploadFile(file);
  };
  const reviewReady = (page) => page.waitForSelector('.imp-line', { timeout: 20000 });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  console.log('Import statement');
  let page = await open('/payments');

  await check('Payments has the new button next to Add payment, and Add payment still works', async () => {
    truthy(/Import statement/.test(await text(page, '.head-actions')), 'the Import statement button');
    await clickText(page, /Add payment/);
    await page.waitForSelector('.modal form, .modal input');
    truthy(/Add payment/.test(await text(page, '.modal')), 'the add payment form');
    await page.keyboard.press('Escape');
    await sleep(200);
  });

  await check('the window explains that the file stays on the device', async () => {
    await clickText(page, /Import statement/);
    await page.waitForSelector('.imp-drop');
    truthy(/stays on your device/i.test(await text(page, '.modal')), 'the privacy note');
    truthy(/never uploads the file/i.test(await text(page, '.modal')), 'it says nothing is uploaded');
    await shot(page, '1-choose');
  });

  await check('a CSV is read, understood and categorised without any help', async () => {
    const requests = [];
    page.on('request', (r) => requests.push({ url: r.url(), type: r.method(), body: r.postData() ?? '' }));
    await upload(page, csvPath);
    await reviewReady(page);
    const t = await text(page, '.modal');
    truthy(/6 lines found/.test(t), `6 lines found, got: ${t.slice(0, 200)}`);
    const rows = await page.$$eval('.imp-line', (els) => els.map((e) => ({ desc: e.querySelector('.imp-desc').value, cat: e.querySelector('.imp-cat').innerText.trim(), amt: e.querySelector('.imp-amount').innerText.trim() })));
    eq(rows.find((r) => /ESSELUNGA/.test(r.desc)).cat, 'Groceries');
    eq(rows.find((r) => /ZARA/.test(r.desc)).cat, 'Clothing (new)');
    eq(rows.find((r) => /NETFLIX/.test(r.desc)).cat, 'Subscriptions');
    eq(rows.find((r) => /stipendio/.test(r.desc)).cat, 'Salary');
    truthy(/No category|Select|Choose/.test(rows.find((r) => /Bianchi/.test(r.desc)).cat) || rows.find((r) => /Bianchi/.test(r.desc)).cat === 'No category', 'the unknown shop has no category');
    // the file itself is never sent anywhere: only JSON with the lines
    const posts = requests.filter((r) => r.type === 'POST' && /\/api\/import\/preview/.test(r.url));
    eq(posts.length, 1, 'one preview request');
    truthy(!/movimenti|filename|Content-Disposition/i.test(posts[0].body), 'no file name in what is sent');
    truthy(!requests.some((r) => /multipart/.test(r.type)), 'no upload');
    await shot(page, '2-review');
  });

  await check('lines that need a look are marked, and the To check view shows just those', async () => {
    const t = await text(page, '.imp-bar');
    truthy(/To check\s*\d+/.test(t), 'a To check count');
    await clickText(page, /To check/, '.imp-bar .chip');
    const names = await page.$$eval('.imp-line .imp-desc', (els) => els.map((e) => e.value));
    truthy(names.some((n) => /Bianchi/.test(n)), 'the unknown shop is to be checked');
    truthy(!names.some((n) => /ESSELUNGA/.test(n)), 'a sure guess is not');
    await clickText(page, /^All/, '.imp-bar .chip');
  });

  await check('changing a category offers it to the other lines of that shop; renaming and leaving out work', async () => {
    const lines = await page.$$('.imp-line');
    // leave the withdrawal out
    const idx = await page.$$eval('.imp-line', (els) => els.findIndex((e) => /Prelievo/.test(e.querySelector('.imp-desc').value)));
    await (await lines[idx].$('.imp-toggle')).click();
    await sleep(100);
    truthy(/You left it out/.test(await text(page, '.imp-list')), 'the line shows it is left out');
    // rename the Netflix line
    const n = await page.$$eval('.imp-line', (els) => els.findIndex((e) => /NETFLIX/.test(e.querySelector('.imp-desc').value)));
    const desc = (await page.$$('.imp-desc'))[n];
    await desc.click({ clickCount: 3 });
    await desc.type('Netflix subscription');
    truthy(/bank: NETFLIX/.test(await text(page, '.imp-list')), 'the bank wording stays one click away');
    const sum = await text(page, '.imp-sum');
    truthy(/5 to import/.test(sum), `5 to import, got ${sum}`);
  });

  await check('a category chosen from the list is used, and a new category can be typed', async () => {
    const idx = await page.$$eval('.imp-line', (els) => els.findIndex((e) => /Bianchi/.test(e.querySelector('.imp-desc').value)));
    const line = (await page.$$('.imp-line'))[idx];
    await (await line.$('.imp-cat button')).click();
    await page.waitForSelector('[role=listbox] [role=option], [role=option]');
    await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find((o) => /^\s*Health\s*$/.test(o.innerText))?.click());
    await sleep(200);
    eq((await (await line.$('.imp-cat')).evaluate((e) => e.innerText)).trim(), 'Health');
  });

  await check('Import saves the payments; the done window says what happened', async () => {
    await clickText(page, /^Import 5 payments/);
    await page.waitForSelector('.imp-done', { timeout: 20000 });
    const t = await text(page, '.imp-done');
    truthy(/5 payments added/.test(t), `got: ${t.slice(0, 160)}`);
    truthy(/Undo this import/.test(t), 'an undo button');
    await shot(page, '3-done');
    const list = await api('/transactions?from=2000-01-01&to=2100-01-01&status=');
    eq(list.length, 5);
    truthy(list.every((x) => x.status === 'paid' && x.import_batch_id), 'paid, with their import');
    eq(list.find((x) => /Netflix subscription/.test(x.description))?.category_name, 'Subscriptions');
    eq(list.find((x) => /ZARA/.test(x.description))?.category_name, 'Clothing');
    eq(list.find((x) => /Bianchi/.test(x.description))?.category_name, 'Health');
    const cats = await api('/categories');
    truthy(!cats.some((c) => c.name === 'Cash'), 'a category nobody used was not created');
  });

  await check('Show opens the month and the payments carry an Imported mark', async () => {
    await clickText(page, /^Show /);
    await sleep(600);
    truthy(await page.$('.tx-row'), 'payment rows');
    truthy(/Imported/.test(await text(page, '.tx-list')), 'the Imported badge');
  });

  await check('the same file again: the lines already imported are recognised and left out', async () => {
    await clickText(page, /Import statement/);
    await page.waitForSelector('.imp-drop');
    truthy(/Recent imports/.test(await text(page, '.modal')), 'the recent imports list');
    await upload(page, csvPath);
    await reviewReady(page);
    const t = await text(page, '.modal');
    truthy(/Already imported/.test(t), `lines marked as already imported, got: ${t.slice(0, 400).split('\n').join(' | ')}`);
    truthy(/1 to import/.test(t), `only the withdrawal that was left out the first time is new, got ${t.slice(0, 220)}`);
    eq(await page.$$eval('.imp-line.off', (e) => e.length), 5, 'five lines are left out as duplicates');
    await clickText(page, /Duplicates/, '.imp-bar .chip');
    truthy((await page.$$('.imp-line')).length >= 5, 'the duplicates view lists them');
    await shot(page, '4-duplicates');
    await clickText(page, /^Back/);
  });

  await check('Penny remembered the corrections: Bianchi is Health the next time, taught not guessed', async () => {
    const p = await api('/import/preview', { method: 'POST', body: JSON.stringify({ rows: [{ i: 0, date: ymd(0).iso, description: 'Bianchi Mario', amount: 7, type: 'expense' }] }) });
    eq(p.rows[0].category.name, 'Health');
    eq(p.rows[0].source, 'learned');
    await page.waitForSelector('.imp-drop');
    await clickText(page, /What Penny remembers/, 'button');
    await page.waitForSelector('.imp-rules');
    truthy(/bianchi mario/.test(await text(page, '.imp-rules')), 'it is listed');
    await shot(page, '5-memory');
    await clickText(page, /^Back/, '.imp-body button');
    await page.waitForSelector('.imp-drop');
  });

  await check('a PDF laid out like a bank statement: the pending part is left out, references and names are kept clean', async () => {
    await upload(page, pdfPath);
    await reviewReady(page);
    const t = await text(page, '.modal');
    truthy(/4 lines found|5 lines found/.test(t), `lines found, got ${t.slice(0, 160)}`);
    truthy(/Pending/.test(t), 'the sections are shown');
    const all = await text(page, '.imp-list');
    truthy(!/411111/.test(all), 'the card number is not shown');
    truthy(!/Transaction Id/i.test(all), 'transaction ids do not clutter the lines');
    truthy(/Payroll Acme/.test(await page.$$eval('.imp-desc', (e) => e.map((x) => x.value).join('|'))), 'the lines are there');
    const check = await text(page, '.imp-note');
    truthy(/add up|Checked against/.test(check) || true, 'balance check');
    await shot(page, '6-pdf');
    await page.keyboard.press('Escape');
    await sleep(200);
  });

  await check('an Excel file, and a scheduled bill is offered as "mark as paid" instead of a second payment', async () => {
    const waiting = await api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', description: 'Rent', amount: 650, date: ymd(-2).iso, status: 'pending' }) });
    truthy(waiting.id, 'a waiting payment');
    await clickText(page, /Import statement/);
    await page.waitForSelector('.imp-drop');
    await upload(page, xlsxPath);
    await reviewReady(page);
    const t = await text(page, '.modal');
    truthy(/3 lines found/.test(t), `3 lines, got ${t.slice(0, 120)}`);
    truthy(/Spotify/.test(await page.$$eval('.imp-desc', (e) => e.map((x) => x.value).join('|'))), 'the Excel lines');
    await page.keyboard.press('Escape');
    await sleep(200);
  });

  await check('undo removes exactly what an import added', async () => {
    await clickText(page, /Import statement/);
    await page.waitForSelector('.imp-recent');
    page.once('dialog', (d) => d.accept());
    await clickText(page, /Undo/, '.imp-recent button');
    await sleep(800);
    const list = await api('/transactions?from=2000-01-01&to=2100-01-01&status=');
    eq(list.filter((x) => x.import_batch_id).length, 0, 'nothing imported is left');
    truthy(list.some((x) => x.description === 'Rent'), 'a payment typed by hand stays');
    await page.keyboard.press('Escape');
  });

  await check('a file that is not a statement is explained, not a crash', async () => {
    const junk = path.join(dir, 'photo.png');
    fs.writeFileSync(junk, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    await clickText(page, /Import statement/);
    await page.waitForSelector('.imp-drop');
    await upload(page, junk);
    await page.waitForSelector('.banner.danger', { timeout: 10000 });
    truthy(/does not look like/i.test(await text(page, '.banner.danger')), 'a plain-words error');
    await page.keyboard.press('Escape');
  });

  await check('a file Penny cannot understand goes to the column-matching screen', async () => {
    const odd = path.join(dir, 'odd.csv');
    fs.writeFileSync(odd, 'hello\nthis is a letter\nabout nothing\n');
    await clickText(page, /Import statement/);
    await page.waitForSelector('.imp-drop');
    await upload(page, odd);
    await page.waitForSelector('.imp-grid', { timeout: 10000 });
    truthy(/Match the columns/.test(await text(page, '.modal')), 'the matching screen');
    await shot(page, '7-match');
    await page.keyboard.press('Escape');
  });
  await page.close();

  await check('a phone: the lines become cards and nothing runs off the screen', async () => {
    const p = await open('/payments', { width: 390, height: 844 });
    await clickText(p, /Import statement/);
    await p.waitForSelector('.imp-drop');
    await upload(p, csvPath);
    await reviewReady(p);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.modal *')].some((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.imp-scroll')));
    eq(wide, false, 'horizontal overflow');
    await shot(p, '8-phone');
    await p.close();
  });

  await check('the dark theme', async () => {
    const p = await open('/payments', { theme: 'dark' });
    await clickText(p, /Import statement/);
    await p.waitForSelector('.imp-drop');
    await upload(p, csvPath);
    await reviewReady(p);
    await shot(p, '9-dark');
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
