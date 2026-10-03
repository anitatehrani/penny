/**
 * Draws the favicon, app icons and standalone wordmark files into client/public from the paths in client/src/brand/paths.js.
 *
 *   node scripts/make-brand-assets.cjs      (needs Chrome or Edge, and `cd e2e && npm install` once, for puppeteer-core)
 *
 * The generated files are committed, so you only run this when the logo changes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const out = path.join(root, 'client/public');
const INK = '#14161a';
const PAPER = '#f1f1ec';

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));

(async () => {
  const { WORDMARK, MONOGRAM, MONOGRAM_CENTER, STROKE, WORDMARK_BOX } = await import(pathToFileURL(path.join(root, 'client/src/brand/paths.js')).href);
  const [cx, cy] = MONOGRAM_CENTER;
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), text);
  };

  /** The monogram on a square. `scale` sets how big the p is; `round` clips the corners (off for maskable and iOS icons, which are masked by the system). */
  const square = ({ size, round, scale, bg = INK, fg = PAPER, adaptive = false }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
${adaptive ? `  <style>.bg{fill:${bg}}.g{stroke:${fg}}@media (prefers-color-scheme:dark){.bg{fill:${fg}}.g{stroke:${bg}}}</style>\n` : ''}  <rect ${adaptive ? 'class="bg"' : `fill="${bg}"`} width="512" height="512"${round ? ' rx="116"' : ''}/>
  <path ${adaptive ? 'class="g"' : `stroke="${fg}"`} d="${MONOGRAM}" transform="translate(256 256) scale(${scale}) translate(${-cx} ${-cy})" fill="none" stroke-width="${STROKE + 4}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

  const [bx, by, bw, bh] = WORDMARK_BOX;
  const pad = 24;
  const wordmark = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx - pad} ${by - pad} ${bw + 2 * pad} ${bh + 2 * pad}" width="${Math.round((bw + 2 * pad) / 2)}" height="${Math.round((bh + 2 * pad) / 2)}" fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Penny">
  <title>Penny</title>
${WORDMARK.map((d) => `  <path d="${d}"/>`).join('\n')}
</svg>
`;

  write('favicon.svg', square({ size: 512, round: true, scale: 1.55, adaptive: true }));
  write('brand/penny-wordmark.svg', wordmark(INK));
  write('brand/penny-wordmark-light.svg', wordmark(PAPER));

  const pngs = [
    ['favicon-32.png', 32, { round: true, scale: 1.6 }],
    ['icon-192.png', 192, { round: true, scale: 1.55 }],
    ['icon-512.png', 512, { round: true, scale: 1.55 }],
    ['icon-maskable-512.png', 512, { round: false, scale: 1.4 }],
    ['apple-touch-icon.png', 180, { round: false, scale: 1.5 }],
  ];

  if (!CHROME) throw new Error('Chrome or Edge not found: set CHROME_PATH');
  const puppeteer = require(path.join(root, 'e2e/node_modules/puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  for (const [file, size, opts] of pngs) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0;background:transparent">${square({ size, ...opts })}</body>`);
    await page.screenshot({ path: path.join(out, file), omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log('wrote favicon.svg, brand/*.svg and', pngs.map((p) => p[0]).join(', '), 'to client/public');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
