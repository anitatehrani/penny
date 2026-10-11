import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TERMS_VERSION } from '../src/lib/legal.js';
import { HOME_FAQ, homeJsonLd, homeNoscript, normalizePath, pageFor, PUBLIC_PAGES, renderPage, robotsTxt, sitemapXml } from '../src/lib/seo.js';

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client');
const indexHtml = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
const BASE = 'https://penny.example';
const page = (p, base = BASE) => renderPage(indexHtml, p, base);
const tag = (html, re) => re.exec(html)?.[1];
const titleOf = (html) => tag(html, /<title>([^<]*)<\/title>/);
const descOf = (html) => tag(html, /<meta name="description" content="([^"]*)"/);

describe('the public pages', () => {
  it('are the home page, the terms, the privacy policy and the contact page, and each is a page the app really has', () => {
    assert.deepEqual(PUBLIC_PAGES.map((p) => p.path), ['/', '/terms', '/privacy', '/contact']);
    const main = fs.readFileSync(path.join(CLIENT, 'src/main.jsx'), 'utf8');
    for (const p of PUBLIC_PAGES.filter((x) => x.path !== '/')) assert.ok(main.includes(`pathname === '${p.path}'`), `${p.path} is a page of the app`);
  });

  it('each have their own title and description, of a length a search result can show', () => {
    const titles = PUBLIC_PAGES.map((p) => p.title);
    const descriptions = PUBLIC_PAGES.map((p) => p.description);
    assert.equal(new Set(titles).size, titles.length, 'no two pages share a title');
    assert.equal(new Set(descriptions).size, descriptions.length, 'no two pages share a description');
    for (const p of PUBLIC_PAGES) {
      assert.ok(p.title.length >= 10 && p.title.length <= 60, `${p.path} title is ${p.title.length} characters`);
      assert.ok(p.description.length >= 50 && p.description.length <= 160, `${p.path} description is ${p.description.length} characters`);
      assert.ok(p.title.includes('Penny'));
    }
  });

  it('are found with or without a slash, a query or a fragment, and nothing else is', () => {
    assert.equal(pageFor('/terms/')?.path, '/terms');
    assert.equal(pageFor('/privacy?x=1#top')?.path, '/privacy');
    assert.equal(pageFor('/')?.path, '/');
    assert.equal(pageFor('/?month=2026-01')?.path, '/');
    for (const p of ['/payments', '/budget', '/login', '/signup', '/admin', '/u/someone', '/terms/extra', '/api/health']) assert.equal(pageFor(p), null, p);
    assert.deepEqual([normalizePath('//'), normalizePath(''), normalizePath(undefined), normalizePath('/a/b/')], ['/', '/', '/', '/a/b']);
  });
});

describe('the page that is sent', () => {
  it('the home page has its own title, description, address, preview tags, structured data and its text for readers without scripts', () => {
    const html = page('/');
    assert.equal(titleOf(html), PUBLIC_PAGES[0].title);
    assert.equal(descOf(html), PUBLIC_PAGES[0].description);
    assert.match(html, /<link rel="canonical" href="https:\/\/penny\.example\/" \/>/);
    assert.match(html, /<meta property="og:url" content="https:\/\/penny\.example\/" \/>/);
    assert.match(html, /<meta property="og:image" content="https:\/\/penny\.example\/landing\/og\.png" \/>/);
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.match(html, /<noscript>[\s\S]*<h1>[\s\S]*<\/noscript>/);
    assert.ok(!html.includes('__APP_URL__'));
    assert.ok(!/name="robots"/.test(html), 'the home page may be indexed');
  });

  it('the terms, the privacy policy and the contact page each say what they are, with their own address', () => {
    for (const p of PUBLIC_PAGES.slice(1)) {
      const html = page(p.path);
      assert.equal(titleOf(html), p.title);
      assert.equal(descOf(html), p.description);
      assert.ok(html.includes(`<link rel="canonical" href="${BASE}${p.path}" />`));
      assert.ok(html.includes(`<meta property="og:url" content="${BASE}${p.path}" />`));
      assert.ok(!/name="robots"/.test(html));
      assert.ok(!html.includes('application/ld+json') && !html.includes('<noscript>'), 'only the home page has structured data and the extra text');
    }
    assert.equal(page('/terms/'), page('/terms'));
  });

  it('every other address is plain, points to the home page and is marked "do not index"', () => {
    for (const p of ['/payments', '/settings', '/login', '/signup', '/admin', '/u/jane', '/nothing-here']) {
      const html = page(p);
      assert.equal(titleOf(html), 'Penny', p);
      assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/, p);
      assert.ok(html.includes(`<link rel="canonical" href="${BASE}/" />`));
      assert.ok(!html.includes('application/ld+json') && !html.includes('<noscript>'));
    }
  });

  it('cannot be broken out of by an odd address for the site', () => {
    const html = page('/', 'https://x.test/"><script>alert(1)</script>');
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!/<script type="application\/ld\+json">[^<]*<\/script[^>]*>[^<]*<script>alert/.test(html));
    const ld = tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ld && !ld.includes('</script'), 'the structured data cannot end its own script early');
    JSON.parse(ld);
  });

  it('says so when index.html loses a place the server fills, instead of quietly sending a page without it', () => {
    assert.throws(() => renderPage(indexHtml.replace(/<title>[^<]*<\/title>/, ''), '/', BASE), /no title/);
    assert.throws(() => renderPage(indexHtml.replace('<div id="root"></div>', ''), '/', BASE), /no root/);
    assert.throws(() => renderPage(indexHtml.replace(/<meta name="description"[^>]*>/, ''), '/', BASE), /no description/);
  });

  it('the page in the repository already has the home page words, so the development server shows them too', () => {
    assert.equal(titleOf(indexHtml), PUBLIC_PAGES[0].title);
    assert.equal(descOf(indexHtml), PUBLIC_PAGES[0].description);
  });
});

describe('structured data', () => {
  const data = JSON.parse(homeJsonLd(BASE));
  it('describes the site and the web app, with true facts', () => {
    assert.deepEqual(data.map((d) => d['@type']), ['WebSite', 'WebApplication']);
    for (const d of data) {
      assert.equal(d['@context'], 'https://schema.org');
      assert.equal(d.url, `${BASE}/`);
      assert.equal(d.name, 'Penny');
    }
    const app = data[1];
    assert.equal(app.applicationCategory, 'FinanceApplication');
    assert.equal(app.offers.price, '0');
    assert.equal(app.description, PUBLIC_PAGES[0].description);
  });
});

describe('what a reader without scripts sees', () => {
  const text = homeNoscript();
  it('is the same message as the home page, with the way to log in and the legal pages', () => {
    for (const part of ['<h1>', 'href="/login"', 'href="/terms"', 'href="/privacy"', 'href="/contact"', 'No bank login, no ads']) assert.ok(text.includes(part), part);
    assert.equal((text.match(/<h1>/g) || []).length, 1);
    for (const f of HOME_FAQ) assert.ok(text.includes(f.q.replace(/&/g, '&amp;')), f.q);
  });
  it('has the same questions and answers as the home page, word for word', () => {
    const landing = fs.readFileSync(path.join(CLIENT, 'src/pages/Landing.jsx'), 'utf8');
    const faq = new Function(`return ${/const FAQ = (\[[\s\S]*?\n\]);/.exec(landing)[1]}`)();
    assert.deepEqual(HOME_FAQ, faq);
  });
  it('makes no claim the home page does not make', () => {
    const landing = fs.readFileSync(path.join(CLIENT, 'src/pages/Landing.jsx'), 'utf8');
    assert.match(landing, /No bank login, no ads/);
    assert.match(landing, /statement/i);
    assert.match(landing, /Plan each month, category by category/);
    assert.match(landing, /Can I set a budget for each category\?/);
  });
});

describe('the sitemap and robots.txt', () => {
  it('robots.txt lets everything be read except the interface behind the pages, and points to the sitemap', () => {
    assert.equal(robotsTxt(BASE), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${BASE}/sitemap.xml\n`);
  });

  it('the sitemap lists the public pages, with absolute addresses, and nothing else', () => {
    const xml = sitemapXml(BASE);
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, [`${BASE}/`, `${BASE}/terms`, `${BASE}/privacy`, `${BASE}/contact`]);
    for (const l of locs) assert.doesNotThrow(() => new URL(l));
    assert.ok(!/payments|settings|login|admin|api/.test(xml));
    assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
  });

  it('dates only what is really dated: the terms and the privacy policy by their version', () => {
    const xml = sitemapXml(BASE);
    const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    assert.deepEqual(lastmods, [TERMS_VERSION, TERMS_VERSION]);
    for (const d of lastmods) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('escapes what could break the file', () => {
    const xml = sitemapXml('https://x.test/?a=1&b=<2>');
    assert.ok(xml.includes('&amp;') && !xml.includes('<2>'));
  });
});
