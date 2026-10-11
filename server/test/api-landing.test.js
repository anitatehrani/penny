import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client, shutdown, startServer } from './helpers.js';

// The home page is part of the built web app, so these checks only make sense where it has been built (npm run build in client/).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const built = fs.existsSync(path.join(dist, 'index.html'));

let srv;
before(async () => {
  if (built) srv = await startServer('landing', { APP_URL: 'https://budget.example' });
});
after(async () => {
  if (srv) await shutdown(srv);
});

describe('the page that is served for every address', { skip: !built && 'the web app has not been built' }, () => {
  it('has the link-preview tags with this site’s own address, whichever address was asked for', async () => {
    const c = new Client(srv.base.replace(/\/api$/, ''));
    for (const url of ['/', '/login', '/terms', '/some/deep/path']) {
      const r = await c.page(url);
      assert.equal(r.status, 200, url);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.equal(r.headers.get('cache-control'), 'no-cache', 'the page itself is never kept: it names the files that change with each build');
      assert.match(r.text, /<meta property="og:image" content="https:\/\/budget\.example\/landing\/og\.png"/, url);
      // each public page names itself; every other address carries the home page's address (and is marked "do not index": see api-seo.test.js)
      assert.ok(r.text.includes(`<meta property="og:url" content="https://budget.example${url === '/terms' ? '/terms' : '/'}" />`), url);
      assert.match(r.text, url === '/terms' ? /<meta name="description" content="The terms for using Penny/ : /<meta name="description" content="Penny is a calm personal budget/, url);
      assert.match(r.text, /<meta name="twitter:card" content="summary_large_image"/);
      assert.ok(!r.text.includes('__APP_URL__'), 'no placeholder is left in what is sent');
    }
  });

  it('serves the pictures, the share image and robots.txt as files, and leaves the API alone', async () => {
    const c = new Client(srv.base.replace(/\/api$/, ''));
    const og = await c.page('/landing/og.png');
    assert.equal(og.status, 200);
    assert.equal(og.headers.get('content-type'), 'image/png');
    for (const f of ['dashboard', 'forecast', 'payments', 'budget', 'import', 'installments', 'debts', 'shared']) {
      for (const theme of ['light', 'dark']) {
        const r = await c.page(`/landing/${f}-${theme}.webp`);
        assert.equal(r.status, 200, `${f}-${theme}`);
        assert.equal(r.headers.get('content-type'), 'image/webp');
      }
    }
    const robots = await c.page('/robots.txt');
    assert.match(robots.text, /^User-agent: \*\nAllow: \/\nDisallow: \/api\//);
    // an address under /api is still the API's, not the web page
    const api = await c.page('/api/not-a-thing');
    assert.ok([401, 404].includes(api.status), `the API answers (${api.status}), not the web page`);
    assert.match(api.headers.get('content-type'), /json/);
  });

  it('the share image is the size link previews expect', () => {
    const png = fs.readFileSync(path.join(dist, 'landing/og.png'));
    assert.equal(png.readUInt32BE(16), 1200, 'width');
    assert.equal(png.readUInt32BE(20), 630, 'height');
  });
});
