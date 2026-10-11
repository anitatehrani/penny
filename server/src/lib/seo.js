// Being found by search engines (docs/DESIGN.md section 44): what each public page is called and says about itself, the sitemap, robots.txt,
// and the page text for people and programs that do not run scripts. Penny is one page that React draws, so the server writes the parts a
// search engine reads first (title, description, address, the first words) into the page it sends.

import { TERMS_VERSION } from './legal.js';

export const SITE_NAME = 'Penny';
const HOME_TITLE = 'Penny: a personal budget with a forecast months ahead';
const HOME_DESCRIPTION = 'Penny is a calm personal budget that forecasts your balance months ahead. Payments, bills, installments and debts in one place. Free, no ads, no bank login.';

/** The pages anybody may read, and so the only ones that belong in a search engine. */
export const PUBLIC_PAGES = [
  { path: '/', title: HOME_TITLE, description: HOME_DESCRIPTION, priority: '1.0', changefreq: 'monthly' },
  { path: '/terms', title: 'Terms of use · Penny', description: 'The terms for using Penny, a personal budget app: what you agree to, what the person who runs it does, and what they do not do.', priority: '0.3', changefreq: 'yearly', lastmod: TERMS_VERSION },
  { path: '/privacy', title: 'Privacy policy · Penny', description: 'What Penny keeps about you, who can see it, how long it is kept, and how to download or delete everything.', priority: '0.3', changefreq: 'yearly', lastmod: TERMS_VERSION },
  { path: '/contact', title: 'Contact us · Penny', description: 'Write to the person who runs Penny: a question, a problem or an idea.', priority: '0.4', changefreq: 'yearly' },
];

/** The same questions and answers as the home page (client/src/pages/Landing.jsx; a test keeps the two equal). */
export const HOME_FAQ = [
  { q: "Is Penny free?", a: "Yes. You can sign up and use it without paying." },
  { q: "Does it connect to my bank?", a: "No, on purpose, so Penny never sees your bank login. You enter payments yourself, set them to repeat, or import a statement file from your bank. When your real balance and Penny's drift apart, \"Match my bank balance\" fixes it in one step." },
  { q: "Can I import a bank statement?", a: "Yes: a PDF or a spreadsheet file (CSV or Excel), from any bank. Penny works out the layout by itself (it reads English, Italian, German, French, Spanish, Portuguese and Dutch headings), suggests a category for each line and lets you check everything before it saves. The file is read in your browser and never uploaded, and one click undoes an import." },
  { q: "Who can see my data?", a: "You, and the people you share a budget with, in that budget only. The person who runs the site sees account basics, not what your payments are or their amounts. They can look inside your account only to help you, with a written reason, and you are told when it happens." },
  { q: "Can I share a budget with my partner or family?", a: "Yes. Make a shared budget and invite people you are connected with. You can also split single payments between people." },
  { q: "What if I want to leave?", a: "Download everything as a file, then delete your account, both in Settings. Deleting is immediate and complete." },
  { q: "Does it work on my phone?", a: "Yes. It runs in your phone's browser and can be added to your home screen." },
];

const HOME_POINTS = [
  'A forecast that shows your balance month by month, so you see a tight month before you are in it.',
  'Payments, recurring bills, installments and debts in one place.',
  'Import a bank statement (PDF, CSV or Excel) from any bank instead of typing each payment.',
  'Share a budget with a partner or family, and split single payments.',
  'No bank login, no ads, and your data is yours to download or delete.',
];

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "/terms/" and "/terms" are the same page; the query and the fragment are not part of it. */
export function normalizePath(p) {
  const clean = String(p ?? '/').split('?')[0].split('#')[0] || '/';
  return clean.length > 1 ? clean.replace(/\/+$/, '') || '/' : clean;
}
export const pageFor = (pathname) => PUBLIC_PAGES.find((p) => p.path === normalizePath(pathname)) ?? null;

export function robotsTxt(base) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;
}

export function sitemapXml(base) {
  const urls = PUBLIC_PAGES.map(
    (p) => `  <url>\n    <loc>${escapeHtml(base + (p.path === '/' ? '/' : p.path))}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Structured data for the home page, as JSON that cannot end its script tag early. */
export function homeJsonLd(base) {
  const data = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${base}/`, inLanguage: 'en' },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      url: `${base}/`,
      description: HOME_DESCRIPTION,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Any (in a web browser)',
      browserRequirements: 'Requires JavaScript',
      inLanguage: 'en',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ];
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** What a reader without scripts sees on the home page: the same message as the page, as plain text with links. */
export function homeNoscript() {
  return `<noscript>
<main style="max-width:42rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.5">
<h1>Penny: see your money months ahead, not just where it went</h1>
<p>Penny turns your payments, recurring bills, installments and debts into one clear forecast. No bank login, no ads, no selling your data. Free to use. It needs JavaScript to run in your browser.</p>
<ul>${HOME_POINTS.map((p) => `<li>${escText(p)}</li>`).join('')}</ul>
<h2>Good to know</h2>
${HOME_FAQ.map((f) => `<h3>${escText(f.q)}</h3><p>${escText(f.a)}</p>`).join('\n')}
<p><a href="/login">Log in</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/contact">Contact</a></p>
</main>
</noscript>`;
}

/**
 * The page the server sends for an address: the built index.html with this page's title, description, address and, for the home page, its
 * structured data and its text for readers without scripts. Pages that are not public (the app, the sign-in pages) are marked "do not index".
 * Throws if the page no longer has a spot this function fills, so a change to index.html cannot quietly lose the tags.
 */
export function renderPage(indexHtml, pathname, base) {
  const page = pageFor(pathname);
  const title = page?.title ?? SITE_NAME;
  const description = page?.description ?? HOME_DESCRIPTION;
  const url = `${base}${page ? (page.path === '/' ? '/' : page.path) : '/'}`;
  let html = indexHtml.replaceAll('__APP_URL__', escapeHtml(base));
  const swap = (re, to, what) => {
    if (!re.test(html)) throw new Error(`index.html has no ${what}`);
    html = html.replace(re, () => to);
  };
  swap(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`, 'title');
  swap(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`, 'description');
  swap(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(page && page.path !== '/' ? title : 'Penny: see your money months ahead')}" />`, 'og:title');
  swap(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`, 'og:description');
  swap(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeHtml(url)}" />`, 'og:url');
  const extra = [`<link rel="canonical" href="${escapeHtml(url)}" />`];
  if (!page) extra.push('<meta name="robots" content="noindex, nofollow" />');
  if (page?.path === '/') extra.push(`<script type="application/ld+json">${homeJsonLd(base)}</script>`);
  swap(/<\/head>/, `    ${extra.join('\n    ')}\n  </head>`, 'head');
  if (page?.path === '/') swap(/<div id="root"><\/div>/, `<div id="root"></div>\n    ${homeNoscript()}`, 'root');
  return html;
}
