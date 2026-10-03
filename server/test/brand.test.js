import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pub = (f) => path.join(root, 'client/public', f);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const brand = await import(pathToFileURL(path.join(root, 'client/src/brand/paths.js')).href);

/** Width and height of a PNG, read from its header. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('the logo paths', () => {
  it('are the five letters of "penny" (the y is drawn as two strokes), as plain absolute path commands', () => {
    assert.equal(brand.WORDMARK.length, 6);
    for (const d of brand.WORDMARK) {
      assert.match(d, /^M[\d. ]+(?:[MLHVAC][\d. -]+)*$/, `${d}: only absolute commands and plain numbers`);
    }
    assert.equal(brand.MONOGRAM, brand.WORDMARK[0], 'the monogram is the p');
  });

  it('line up with the stated box (the browser check measures the real drawn size)', () => {
    const [x, y, w, h] = brand.WORDMARK_BOX;
    const half = brand.STROKE / 2;
    for (const d of brand.WORDMARK) {
      const nums = d.replace(/[A-Z]/g, ' ').trim().split(/\s+/).map(Number);
      assert.ok(nums.every(Number.isFinite), d);
    }
    const first = brand.WORDMARK[0].match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number);
    assert.equal(first[0] - half, x, 'the box starts at the left edge of the p stem');
    assert.ok(brand.MONOGRAM_CENTER[0] > x && brand.MONOGRAM_CENTER[0] < x + w / 2, 'the monogram centre is on the p');
    assert.ok(brand.MONOGRAM_CENTER[1] > y && brand.MONOGRAM_CENTER[1] < y + h);
  });

  it('is a wide wordmark, about 3.7 times wider than tall', () => {
    const [, , w, h] = brand.WORDMARK_BOX;
    assert.ok(w / h > 3.5 && w / h < 3.9, `${w}x${h}`);
  });
});

describe('the committed brand files', () => {
  it('draw the favicon from the monogram, adapting to a dark browser theme', () => {
    const svg = fs.readFileSync(pub('favicon.svg'), 'utf8');
    assert.ok(svg.includes(brand.MONOGRAM), 'the favicon is out of date: run node scripts/make-brand-assets.cjs');
    assert.match(svg, /prefers-color-scheme:dark/);
    assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it('draw both standalone wordmarks from every stroke, in ink and in paper', () => {
    for (const [file, colour] of [['brand/penny-wordmark.svg', '#14161a'], ['brand/penny-wordmark-light.svg', '#f1f1ec']]) {
      const svg = fs.readFileSync(pub(file), 'utf8');
      for (const d of brand.WORDMARK) assert.ok(svg.includes(d), `${file} is out of date: run node scripts/make-brand-assets.cjs`);
      assert.ok(svg.includes(`stroke="${colour}"`), file);
      assert.match(svg, /aria-label="Penny"/);
    }
  });

  it('have app icons at the sizes the manifest and the pages promise', () => {
    const sizes = { 'favicon-32.png': 32, 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 };
    for (const [file, n] of Object.entries(sizes)) assert.deepEqual(pngSize(pub(file)), [n, n], file);
  });

  it('list in the manifest only icons that exist, with their true size, and one that is maskable', () => {
    const m = JSON.parse(fs.readFileSync(pub('manifest.webmanifest'), 'utf8'));
    assert.equal(m.name, 'Penny');
    assert.equal(m.short_name, 'Penny');
    assert.equal(m.start_url, '/');
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.length >= 3);
    for (const icon of m.icons) {
      assert.ok(fs.existsSync(pub(icon.src.replace(/^\//, ''))), `${icon.src} exists`);
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(pub(icon.src.replace(/^\//, ''))), [w, h], icon.src);
    }
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
    assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), 'the sizes installable apps require');
  });

  it('are linked from the page, and the old blue chart icon is gone', () => {
    const html = read('client/index.html');
    for (const href of ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/manifest.webmanifest']) assert.ok(html.includes(`href="${href}"`), href);
    assert.match(html, /theme-color[^>]*prefers-color-scheme: dark/);
    assert.doesNotMatch(html, /data:image\/svg\+xml/, 'no inline stand-in icon');
    for (const f of ['client/src/layout/Sidebar.jsx', 'client/src/pages/Auth.jsx']) {
      assert.match(read(f), /<Wordmark /, `${f} draws the wordmark`);
      assert.doesNotMatch(read(f), /className="brand-mark"/, `${f} no longer shows the chart icon as the logo`);
    }
  });

  it('keep the original artwork alongside, for the next time the logo is redrawn', () => {
    const b = fs.readFileSync(path.join(root, 'docs/brand/penny-wordmark.webp'));
    assert.equal(b.subarray(0, 4).toString(), 'RIFF');
    assert.equal(b.subarray(8, 12).toString(), 'WEBP');
  });
});
