import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GUIDES, GUIDES_INDEX, guideBySlug } from '../src/content/guides.js';
import { inline, readMinutes, renderGuide, renderGuideNotFound, renderGuidesIndex, stylesFrom, wordCount } from '../src/lib/guidePages.js';
import { SITEMAP_PAGES, sitemapXml } from '../src/lib/seo.js';

// The guides (docs/DESIGN.md section 45): what is written, and the pages made from it.
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client');
const indexHtml = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8').replace('</head>', '<link rel="stylesheet" crossorigin href="/assets/index-test.css">\n  </head>');
const BASE = 'https://penny.example';
const ctx = { base: BASE, indexHtml };
const text = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const tag = (html, re) => re.exec(html)?.[1];
const allText = (g) => JSON.stringify(g);
const SITE_PATHS = new Set(['/', '/signup', '/login', '/terms', '/privacy', '/contact', '/guides', ...GUIDES.map((g) => `/guides/${g.slug}`)]);
const linksIn = (s) => [...String(s).matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]);

describe('what is written', () => {
  it('has five guides, each with an address, a title and a description of a length a search result can show', () => {
    assert.equal(GUIDES.length, 5);
    for (const g of GUIDES) {
      assert.match(g.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, g.slug);
      assert.ok(g.title.length >= 20 && g.title.length <= 55, `${g.slug}: title is ${g.title.length} characters`);
      assert.ok(g.description.length >= 100 && g.description.length <= 160, `${g.slug}: description is ${g.description.length} characters`);
      assert.ok(g.intro.length > 100, g.slug);
      assert.match(g.updated, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(new Date(`${g.updated}T00:00:00Z`) <= new Date(), `${g.slug} is not dated in the future`);
    }
    for (const key of ['slug', 'title', 'description']) assert.equal(new Set(GUIDES.map((g) => g[key])).size, GUIDES.length, `${key} is different for each`);
    assert.ok(GUIDES_INDEX.description.length <= 160 && GUIDES_INDEX.title.length <= 60);
  });

  it('are short: a few minutes each, with sections, and "How Penny helps" only at the end', () => {
    for (const g of GUIDES) {
      const words = wordCount(g);
      assert.ok(words >= 380 && words <= 1000, `${g.slug} has ${words} words`);
      assert.ok(g.sections.length >= 3 && g.sections.length <= 8, `${g.slug}: ${g.sections.length} sections`);
      for (const s of g.sections) assert.ok(s.h.length > 5 && s.blocks.length > 0, `${g.slug}: ${s.h}`);
      assert.equal(g.penny.h, 'How Penny helps');
      assert.ok(/Penny/.test(g.penny.text) && g.penny.text.length > 150);
      assert.ok(readMinutes(g) >= 2 && readMinutes(g) <= 6, `${g.slug}: ${readMinutes(g)} minutes`);
    }
  });

  it('help by themselves: Penny is not named before the part that says how it helps, except in a link to another guide', () => {
    for (const g of GUIDES) {
      const before = JSON.stringify({ intro: g.intro, sections: g.sections });
      assert.ok(!/\bPenny\b/.test(before), `${g.slug} names Penny before "How Penny helps"`);
    }
  });

  it('keep an honest tone: no promises, no invented figures, no pressure', () => {
    const banned = [/guarantee/i, /get rich/i, /risk[- ]free/i, /studies show/i, /research shows/i, /experts agree/i, /scientists/i, /\b\d+% of (people|americans|europeans|couples)\b/i, /best app/i, /act now/i, /limited time/i, /you must/i, /never fail/i];
    for (const g of GUIDES) for (const re of banned) assert.ok(!re.test(allText(g)), `${g.slug} contains ${re}`);
  });

  it('say that the amounts in examples are made up, wherever there is an example', () => {
    let seen = 0;
    for (const g of GUIDES) {
      for (const s of g.sections) {
        for (const b of s.blocks) {
          if (!b.example) continue;
          seen += 1;
          assert.match(b.example.title, /made[- ]up|made up|example/i, `${g.slug}: ${b.example.title}`);
          assert.ok(b.example.rows.length >= 3 && b.example.rows.every((r) => r.length === 2 && r[0] && r[1]));
        }
      }
    }
    assert.ok(seen >= 4, 'the guides have worked examples');
  });

  it('only link to pages that exist on this site, and to other guides that exist', () => {
    for (const g of GUIDES) {
      const links = [...linksIn(g.intro), ...linksIn(g.penny.text), ...g.sections.flatMap((s) => s.blocks.flatMap((b) => (typeof b === 'string' ? linksIn(b) : [])))];
      for (const l of links) assert.ok(SITE_PATHS.has(l), `${g.slug} links to ${l}`);
      assert.ok(g.related.length >= 2 && g.related.every((r) => guideBySlug(r) && r !== g.slug), `${g.slug}: related guides exist and are other guides`);
    }
  });

  it('say true things about Penny: each feature named is one the home page claims too', () => {
    const landing = fs.readFileSync(path.join(CLIENT, 'src/pages/Landing.jsx'), 'utf8');
    const pennyText = GUIDES.map((g) => g.penny.text).join(' ');
    const claims = [
      [/Forecast page/, /A forecast you can trust|Know your balance before you get there/],
      [/up to two years ahead/, /Up to two years ahead/],
      [/Import statement/, /Bring in a bank statement/],
      [/never uploaded/, /never uploaded/],
      [/shared budget/, /Budget together/],
      [/80%/, /80%/],
      [/Monthly budget/, /Monthly budget/],
    ];
    for (const [inGuide, onHome] of claims) if (inGuide.test(pennyText)) assert.match(landing, onHome, `the home page does not back up ${inGuide}`);
  });
});

describe('inline marks', () => {
  it('escapes everything, and makes only **bold** and links on this site', () => {
    assert.equal(inline('a <b>x</b> & "y"'), 'a &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    assert.equal(inline('see [the guide](/guides/can-i-afford-it) now'), 'see <a href="/guides/can-i-afford-it">the guide</a> now');
    assert.equal(inline('**Do this.** Then that'), '<strong>Do this.</strong> Then that');
    for (const bad of ['[x](https://evil.example)', '[x](javascript:alert(1))', '[x](//evil.example)', '[x](/a" onclick="b)', '[x](/A/B)']) {
      assert.ok(!inline(bad).includes('<a '), bad);
    }
  });
});

describe('a guide as a page', () => {
  const g = GUIDES[0];
  const html = renderGuide(g.slug, ctx);
  it('is a complete page with one main heading, its own title and address, and the words in the HTML itself', () => {
    assert.match(html, /^<!doctype html>/);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.equal(tag(html, /<h1>([^<]*)<\/h1>/), g.title);
    assert.equal(tag(html, /<title>([^<]*)<\/title>/), `${g.title} · Penny`);
    assert.equal(tag(html, /<meta name="description" content="([^"]*)"/), g.description);
    assert.ok(html.includes(`<link rel="canonical" href="${BASE}/guides/${g.slug}" />`));
    assert.ok(html.includes(`<meta property="og:url" content="${BASE}/guides/${g.slug}" />`));
    assert.ok(html.includes('<meta property="og:type" content="article" />'));
    assert.ok(!/name="robots"/.test(html), 'a guide may be indexed');
    assert.ok(!/<script[^>]+src=/.test(html), 'it needs no script file');
    const visible = text(html);
    for (const s of g.sections) assert.ok(visible.includes(s.h.split(' ').slice(0, 4).join(' ')), s.h);
    assert.ok(wordCount(g) > 380 && text(html).split(/\s+/).length > wordCount(g) * 0.9, 'the whole guide is in the page');
  });

  it('wears the stylesheet of the app, the way home, and a skip link', () => {
    assert.ok(html.includes('<link rel="stylesheet" crossorigin href="/assets/index-test.css">'));
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main class="legal-main" id="main">/);
    assert.match(html, /<a class="legal-brand" href="\/" aria-label="Penny, home">/);
    assert.match(html, /<html lang="en">/);
  });

  it('has structured data that parses: the article, who wrote it and when, and the way back', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(blocks.map((b) => b['@type']), ['Article', 'BreadcrumbList']);
    const [article, crumbs] = blocks;
    assert.equal(article.headline, g.title);
    assert.equal(article.datePublished, g.updated);
    assert.equal(article.mainEntityOfPage['@id'], `${BASE}/guides/${g.slug}`);
    assert.equal(article.author['@type'], 'Organization', 'no made-up person is named');
    assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ['Penny', 'Guides', g.title]);
    assert.ok(crumbs.itemListElement.every((c) => c.item.startsWith(BASE)));
  });

  it('shows the example as a table with a caption, so it reads on a phone and to a screen reader', () => {
    assert.match(html, /<table class="g-example"><caption>An example \(the amounts are made up\)<\/caption>/);
    assert.match(html, /<th scope="row">Income<\/th><td>2,400<\/td>/);
  });

  it('ends with a way to try Penny that fits whether sign-ups are open, and with the other guides', () => {
    assert.match(html, /<a class="btn primary" href="\/signup">Sign up free<\/a>/);
    const before = process.env.SIGNUPS;
    process.env.SIGNUPS = 'closed';
    const closed = renderGuide(g.slug, ctx);
    if (before === undefined) delete process.env.SIGNUPS;
    else process.env.SIGNUPS = before;
    assert.ok(!closed.includes('/signup'), 'no sign-up link when sign-ups are closed');
    assert.match(closed, /Sign-ups are closed for now/);
    assert.match(closed, /<a class="btn primary" href="\/login">Log in<\/a>/);
    for (const r of g.related) assert.ok(html.includes(`href="/guides/${r}"`), r);
    assert.match(html, /general information, not financial advice/);
  });

  it('cannot be broken out of by an odd site address', () => {
    const page = renderGuide(g.slug, { base: 'https://x.test/"><script>alert(1)</script>', indexHtml });
    assert.ok(!page.includes('<script>alert(1)</script>'));
    for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  });

  it('is still a whole page when the client has not been built', () => {
    const page = renderGuide(g.slug, { base: BASE, indexHtml: '' });
    assert.equal(tag(page, /<h1>([^<]*)<\/h1>/), g.title);
    assert.ok(!page.includes('rel="stylesheet"'));
  });

  it('is made for every guide, and for none that does not exist', () => {
    for (const x of GUIDES) assert.ok(renderGuide(x.slug, ctx), x.slug);
    for (const bad of ['nope', '', '../etc/passwd', 'how-to-plan-a-monthly-budget/extra', null, undefined]) assert.equal(renderGuide(bad, ctx), null, String(bad));
    assert.ok(renderGuide(g.slug.toUpperCase(), ctx), 'the address is not case sensitive');
  });
});

describe('the list of guides', () => {
  const html = renderGuidesIndex(ctx);
  it('names every guide, links to it, and says how long it takes', () => {
    assert.equal(tag(html, /<title>([^<]*)<\/title>/), GUIDES_INDEX.title);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    for (const g of GUIDES) {
      assert.ok(html.includes(`<a href="/guides/${g.slug}">`), g.slug);
      assert.ok(html.includes(g.title) && html.includes(g.description));
    }
    assert.equal((html.match(/min read/g) || []).length, GUIDES.length);
    assert.ok(html.includes(`<link rel="canonical" href="${BASE}/guides" />`));
    assert.ok(html.includes('aria-current="page"'), 'the menu shows where you are');
  });
  it('has structured data for the collection and the way back', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(blocks.map((b) => b['@type']), ['CollectionPage', 'BreadcrumbList']);
    assert.equal(blocks[0].hasPart.length, GUIDES.length);
  });
});

describe('a guide that does not exist', () => {
  it('says so, offers the real ones and is kept out of search results', () => {
    const html = renderGuideNotFound(ctx);
    assert.match(html, /That guide does not exist/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
    for (const g of GUIDES) assert.ok(html.includes(`/guides/${g.slug}`));
  });
});

describe('the stylesheet', () => {
  afterEach(() => {});
  it('is taken from the built page, and is empty when there is none', () => {
    assert.equal(stylesFrom('<head><link rel="stylesheet" href="/a.css"><link rel="stylesheet" crossorigin href="/b.css"></head>'), '<link rel="stylesheet" href="/a.css">\n    <link rel="stylesheet" crossorigin href="/b.css">');
    assert.equal(stylesFrom('<head></head>'), '');
    assert.equal(stylesFrom(undefined), '');
  });
});

describe('the sitemap', () => {
  it('lists the guides page and each guide, dated when they were written', () => {
    const xml = sitemapXml(BASE);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.includes(`${BASE}/guides`));
    for (const g of GUIDES) {
      assert.ok(locs.includes(`${BASE}/guides/${g.slug}`), g.slug);
      assert.ok(xml.includes(`<loc>${BASE}/guides/${g.slug}</loc>\n    <lastmod>${g.updated}</lastmod>`), `${g.slug} is dated`);
    }
    for (const g of GUIDES) assert.ok(locs.includes(`${BASE}/it/guides/${g.slug}`), `${g.slug} in Italian`);
    assert.equal(locs.length, SITEMAP_PAGES.length * 2, 'every page in both languages');
    assert.equal(new Set(locs).size, locs.length, 'no address twice');
  });
});
