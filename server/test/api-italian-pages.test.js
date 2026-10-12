import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GUIDES } from '../src/content/guides.js';
import { shutdown, startServer } from './helpers.js';

// The public pages in Italian (docs/DESIGN.md section 46): their own addresses, written in the HTML itself, each pointing to the other language.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist/index.html');
const built = fs.existsSync(DIST);
const SITE = 'https://penny.example';
let srv;
before(async () => {
  srv = await startServer('italianpages', { APP_URL: SITE });
});
after(async () => {
  await shutdown(srv);
});
const get = (p, init) => fetch(srv.base + p, { redirect: 'manual', ...init });

describe('the guides in Italian', () => {
  it('the list is Italian, says so, may be indexed, and points to the English one', async () => {
    const r = await get('/it/guides');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), null);
    const html = await r.text();
    assert.match(html, /<html lang="it">/);
    assert.match(html, /<title>Guide al budget in parole semplici · Penny<\/title>/);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}/it/guides" />`));
    assert.ok(html.includes(`hreflang="en" href="${SITE}/guides"`) && html.includes(`hreflang="it" href="${SITE}/it/guides"`));
    assert.ok(html.includes('property="og:locale" content="it_IT"'));
    for (const g of GUIDES) assert.ok(html.includes(`href="/it/guides/${g.slug}"`), g.slug);
    assert.ok(!html.includes('href="/guides/'), 'no link back to the English guides except the language switch');
  });

  it('each guide is Italian all the way through, with its links in Italian too, and a date in Italian', async () => {
    for (const g of GUIDES) {
      const r = await get(`/it/guides/${g.slug}`);
      assert.equal(r.status, 200, g.slug);
      const html = await r.text();
      assert.match(html, /<html lang="it">/);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE}/it/guides/${g.slug}" />`), g.slug);
      assert.match(html, /Aggiornata il \d{1,2} \p{L}+ \d{4}/u);
      assert.match(html, /min di lettura/);
      assert.ok(html.includes('"inLanguage":"it"'));
      assert.ok(!/\b(Updated|min read|Try Penny|More guides)\b/.test(html), `English left in ${g.slug}`);
      assert.ok(!/href="\/(guides|terms|privacy|contact)\b/.test(html.replace(/<span class="lang-links"[\s\S]*?<\/span>/, '')), `a link to the English page in ${g.slug}`);
    }
  });

  it('the English guide stays English and has its own address and its alternates', async () => {
    const html = await (await get(`/guides/${GUIDES[0].slug}`)).text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /Updated \d{1,2} \w+ \d{4}/);
    assert.ok(html.includes(`hreflang="it" href="${SITE}/it/guides/${GUIDES[0].slug}"`));
  });

  it('an Italian guide that does not exist is refused, in Italian, and not indexed', async () => {
    for (const p of ['/it/guides/nope', '/it/guides/a/b']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(await r.text(), /Questa guida non esiste/);
    }
  });

  it('the numbers in an example are written the Italian way', async () => {
    const html = await (await get('/it/guides/budgeting-as-a-couple')).text();
    assert.ok(html.includes('<td>3.000</td>') && !html.includes('<td>3,000</td>'));
  });
});

describe('the other public pages in Italian', { skip: !built && 'the app is not built' }, () => {
  it('the terms have an Italian address with Italian tags, and the home page too', async () => {
    const terms = await (await get('/it/terms')).text();
    assert.match(terms, /<html lang="it">/);
    assert.match(terms, /<title>Termini d’uso · Penny<\/title>/);
    assert.ok(terms.includes(`<link rel="canonical" href="${SITE}/it/terms" />`));
    const home = await (await get('/it')).text();
    assert.match(home, /<html lang="it">/);
    assert.ok(home.includes(`<link rel="canonical" href="${SITE}/it" />`));
    assert.match(home, /<noscript>[\s\S]*Buono a sapersi/);
    assert.ok(home.includes('"inLanguage":"it"'));
  });

  it('the English pages are unchanged, and an unknown Italian address is not indexed', async () => {
    const home = await (await get('/')).text();
    assert.match(home, /<html lang="en">/);
    assert.ok(home.includes(`<link rel="canonical" href="${SITE}/" />`));
    const r = await get('/it/nowhere');
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
});
