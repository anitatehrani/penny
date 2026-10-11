import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { shutdown, startServer } from './helpers.js';

// What a search engine meets when it visits (docs/DESIGN.md section 44), through the real server.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist/index.html');
const built = fs.existsSync(DIST); // the pages need the built client (npm run build); robots.txt and the sitemap do not
const SITE = 'https://penny.example';
let srv;
before(async () => {
  srv = await startServer('seo', { APP_URL: SITE });
});
after(async () => {
  await shutdown(srv);
});

const get = (p, init) => fetch(srv.base + p, { redirect: 'manual', ...init });
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

describe('robots.txt and the sitemap', () => {
  it('robots.txt names this site\'s own sitemap, and is plain text', async () => {
    const r = await get('/robots.txt');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/plain/);
    const text = await r.text();
    assert.match(text, /^User-agent: \*\nAllow: \/\nDisallow: \/api\/\n/);
    assert.ok(text.includes(`Sitemap: ${SITE}/sitemap.xml`));
  });

  it('the sitemap is XML that lists the four public pages at the site\'s own address', async () => {
    const r = await get('/sitemap.xml');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^application\/xml/);
    assert.match(r.headers.get('cache-control'), /max-age/);
    const xml = await r.text();
    assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), [`${SITE}/`, `${SITE}/terms`, `${SITE}/privacy`, `${SITE}/contact`]);
    assert.ok(!xml.includes('<html'), 'not the app page');
  });

  it('both can be fetched without signing in, by a program that sends no cookies', async () => {
    for (const p of ['/robots.txt', '/sitemap.xml']) {
      const r = await get(p, { headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } });
      assert.equal(r.status, 200, p);
    }
  });
});

describe('the interface behind the pages', () => {
  it('is marked "do not index", whether it answers or refuses', async () => {
    for (const p of ['/api/health', '/api/auth/config', '/api/transactions', '/api/nothing-here']) {
      const r = await get(p);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', p);
    }
  });
});

describe('the pages', { skip: built ? false : 'the client is not built (npm run build)' }, () => {
  it('the home page has its own title, description, address and structured data in the HTML itself', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), null, 'the home page may be indexed');
    const html = await r.text();
    assert.equal(titleOf(html), 'Penny: a personal budget with a forecast months ahead');
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}/" />`));
    assert.ok(html.includes(`<meta property="og:image" content="${SITE}/landing/og.png" />`));
    assert.ok(html.includes('<noscript>') && html.includes('<h1>Penny: see your money months ahead'));
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.equal(ld[1]['@type'], 'WebApplication');
    assert.ok(/<script type="module"[^>]*src="\/assets\/index-[^"]+\.js"/.test(html), 'the app script is still there');
  });

  it('the legal and contact pages have their own title and address, and may be indexed', async () => {
    const wanted = { '/terms': 'Terms of use · Penny', '/privacy': 'Privacy policy · Penny', '/contact': 'Contact us · Penny' };
    for (const [p, title] of Object.entries(wanted)) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get('x-robots-tag'), null, p);
      const html = await r.text();
      assert.equal(titleOf(html), title);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE}${p}" />`), p);
    }
  });

  it('a trailing slash and a query are the same page, with the address of the page itself', async () => {
    const a = await (await get('/terms/')).text();
    assert.ok(a.includes(`<link rel="canonical" href="${SITE}/terms" />`));
    const b = await (await get('/?month=2026-01&x=1')).text();
    assert.ok(b.includes(`<link rel="canonical" href="${SITE}/" />`));
  });

  it('every page of the app, and every sign-in page, is marked "do not index" in the header and in the page', async () => {
    for (const p of ['/payments', '/budget', '/recurring', '/settings', '/admin', '/notifications', '/forecast', '/people', '/login', '/signup', '/forgot-password', '/reset-password?token=x', '/verify-email', '/u/someone', '/never-heard-of-it']) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', p);
      const html = await r.text();
      assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/, p);
      assert.equal(titleOf(html), 'Penny', p);
      assert.ok(!html.includes('application/ld+json'), p);
    }
  });

  it('a missing script, style or picture is "not found", not the home page; a person with a dot in their name is still a page', async () => {
    for (const p of ['/assets/nothing-1234.js', '/assets/nothing.css', '/landing/missing.webp', '/favicon.ico', '/old/page.png', '/sitemap-old.xml', '/notes.txt']) {
      assert.equal((await get(p)).status, 404, p);
    }
    const r = await get('/u/jane.doe');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<div id="root">/);
  });

  it('files that exist are still sent as they are, with a cacheable address', async () => {
    const manifest = await get('/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.ok(JSON.parse(await manifest.text()).name);
    const og = await get('/landing/og.png');
    assert.equal(og.status, 200);
    assert.match(og.headers.get('content-type'), /image\/png/);
  });

  it('a program that only asks for the headers gets them too', async () => {
    const r = await get('/payments', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await get('/terms', { method: 'HEAD' })).headers.get('x-robots-tag'), null);
  });

  it('a page is not cached for long, so a new version is seen at once', async () => {
    assert.equal((await get('/')).headers.get('cache-control'), 'no-cache');
  });
});
