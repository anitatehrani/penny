import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GUIDES } from '../src/content/guides.js';
import { shutdown, startServer } from './helpers.js';

// The guides as a visitor, or a search engine, meets them (docs/DESIGN.md section 45), through the real server.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist/index.html');
const built = fs.existsSync(DIST);
const SITE = 'https://penny.example';
let srv;
before(async () => {
  srv = await startServer('guides', { APP_URL: SITE });
});
after(async () => {
  await shutdown(srv);
});

const get = (p, init) => fetch(srv.base + p, { redirect: 'manual', ...init });
const BOT = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };

describe('the list of guides', () => {
  it('is a page anybody can read, with no cookie and no sign-in, and it may be indexed', async () => {
    const r = await get('/guides', { headers: BOT });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/html/);
    assert.equal(r.headers.get('x-robots-tag'), null);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    const html = await r.text();
    assert.match(html, /<title>Budgeting guides in plain words · Penny<\/title>/);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}/guides" />`));
    for (const g of GUIDES) assert.ok(html.includes(`href="/guides/${g.slug}"`), g.slug);
    assert.ok(!html.includes('__APP_URL__'));
  });

  it('is the same page with a slash at the end, whatever the case, and when only the headers are asked for', async () => {
    assert.equal((await get('/guides/')).status, 200);
    assert.equal((await get('/GUIDES')).status, 200);
    const head = await get('/guides', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});

describe('each guide', () => {
  it('answers with its own page: title, address, text, structured data, and no scripts to run', async () => {
    for (const g of GUIDES) {
      const r = await get(`/guides/${g.slug}`, { headers: BOT });
      assert.equal(r.status, 200, g.slug);
      assert.equal(r.headers.get('x-robots-tag'), null, g.slug);
      const html = await r.text();
      assert.ok(html.includes(`<title>${g.title} · Penny</title>`), g.slug);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE}/guides/${g.slug}" />`), g.slug);
      assert.ok(html.includes(`<h1>${g.title}</h1>`), g.slug);
      assert.equal((html.match(/application\/ld\+json/g) || []).length, 2, g.slug);
      assert.ok(!/<script[^>]+src=/.test(html), `${g.slug} needs no script file`);
      assert.ok(html.length > 6000, `${g.slug} holds the text of the guide`);
    }
  });

  it('is found with a slash at the end or in capitals, and canonical stays the one address', async () => {
    const html = await (await get('/guides/Can-I-Afford-It/')).text();
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}/guides/can-i-afford-it" />`));
  });

  it('wears the stylesheet of the app when the client is built', { skip: built ? false : 'the client is not built (npm run build)' }, async () => {
    const html = await (await get('/guides/can-i-afford-it')).text();
    assert.match(html, /<link rel="stylesheet"[^>]*href="\/assets\/index-[^"]+\.css"/);
    const css = /<link rel="stylesheet"[^>]*href="(\/assets\/index-[^"]+\.css)"/.exec(html)[1];
    const sheet = await get(css);
    assert.equal(sheet.status, 200);
    const text = await sheet.text();
    for (const rule of ['.g-example', '.g-cta', '.g-mark-dark', '.legal-article']) assert.ok(text.includes(rule), `the stylesheet has ${rule}`);
    for (const pic of ['/brand/penny-wordmark.svg', '/brand/penny-wordmark-light.svg']) assert.equal((await get(pic)).status, 200, pic);
  });
});

describe('an address that is not a guide', () => {
  it('is "not found" for people and for search engines, and says what there is instead', async () => {
    for (const p of ['/guides/nope', '/guides/how-to-plan-a-monthly-budget/extra', '/guides/..%2Fsecret', '/guides/%00', '/guides/<script>alert(1)</script>']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', p);
      const html = await r.text();
      assert.match(html, /That guide does not exist/, p);
      assert.ok(!html.includes('alert(1)'), `${p}: the address is not echoed into the page`);
      assert.ok(html.includes('/guides/can-i-afford-it'), p);
    }
  });
});

describe('who can see them', () => {
  it('signed in or not, the same page: it does not depend on a session', async () => {
    const a = await (await get('/guides/can-i-afford-it')).text();
    const b = await (await get('/guides/can-i-afford-it', { headers: { cookie: 'sid=not-a-real-session' } })).text();
    assert.equal(a, b);
  });

  it('are not part of the interface: nothing under /api serves them, and a post to them is refused', async () => {
    assert.ok([401, 404].includes((await get('/api/guides')).status), 'the interface does not serve them');
    const post = await get('/guides', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.ok([404, 405].includes(post.status), `a post gave ${post.status}`);
  });
});

describe('the sitemap', () => {
  it('lists them, each dated by when it was written', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    assert.ok(xml.includes(`<loc>${SITE}/guides</loc>`));
    for (const g of GUIDES) assert.ok(xml.includes(`<loc>${SITE}/guides/${g.slug}</loc>\n    <lastmod>${g.updated}</lastmod>`), g.slug);
  });

  it('only lists addresses that really answer 200 and may be indexed', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, ''));
    assert.ok(locs.length >= 10);
    for (const p of locs) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get('x-robots-tag'), null, p);
    }
  });
});
