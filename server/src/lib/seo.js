// Being found by search engines (docs/DESIGN.md section 44): what each public page is called and says about itself, the sitemap, robots.txt,
// and the page text for people and programs that do not run scripts. Penny is one page that React draws, so the server writes the parts a
// search engine reads first (title, description, address, the first words) into the page it sends.

import { GUIDES } from '../content/guides.js';
import { LANGUAGES, N_, runWithLanguage, splitLangPath, t, withLang } from './i18n.js';
import { TERMS_VERSION } from './legal.js';

export const SITE_NAME = 'Penny';
const HOME_TITLE = N_('Penny: a personal budget with a forecast months ahead');
const HOME_DESCRIPTION = N_('Penny is a calm personal budget that forecasts your balance months ahead. Payments, bills, installments and debts in one place. Free, no ads, no bank login.');

/** The pages anybody may read, and so the only ones that belong in a search engine. */
export const PUBLIC_PAGES = [
  { path: '/', title: HOME_TITLE, description: HOME_DESCRIPTION, priority: '1.0', changefreq: 'monthly' },
  { path: '/terms', title: N_('Terms of use · Penny'), description: N_('The terms for using Penny, a personal budget app: what you agree to, what the person who runs it does, and what they do not do.'), priority: '0.3', changefreq: 'yearly', lastmod: TERMS_VERSION },
  { path: '/privacy', title: N_('Privacy policy · Penny'), description: N_('What Penny keeps about you, who can see it, how long it is kept, and how to download or delete everything.'), priority: '0.3', changefreq: 'yearly', lastmod: TERMS_VERSION },
  { path: '/contact', title: N_('Contact us · Penny'), description: N_('Write to the person who runs Penny: a question, a problem or an idea.'), priority: '0.4', changefreq: 'yearly' },
];

/** The same questions and answers as the home page (client/src/pages/Landing.jsx; a test keeps the two equal). */
export const HOME_FAQ = [
  { q: N_("Is Penny free?"), a: N_("Yes. You can sign up and use it without paying. A budget app that doesn't cost money, imagine that.") },
  { q: N_("Does it connect to my bank?"), a: N_("No, on purpose, so Penny never sees your bank login. You enter payments yourself, set them to repeat, or import a statement file from your bank. When your real balance and Penny's drift apart, \"Match my bank balance\" fixes it in one step.") },
  { q: N_("Can I import a bank statement?"), a: N_("Yes: a PDF or a spreadsheet file (CSV or Excel), from any bank. Penny works out the layout by itself (it reads English, Italian, German, French, Spanish, Portuguese and Dutch headings), suggests a category for each line and lets you check everything before it saves. The file is read in your browser and never uploaded, and one click undoes an import.") },
  { q: N_("Can I set a budget for each category?"), a: N_("Yes. Give each category an amount for the month, or let Penny suggest amounts from what you usually spend. Penny shows how much is spent and left, tells you which categories are heading over, and warns you in the app at 80% and when a category goes over. You can also look back at a finished month.") },
  { q: N_("Who can see my data?"), a: N_("You, and the people you share a budget with, in that budget only. The person who runs the site sees account basics, not what your payments are or their amounts. They can look inside your account only to help you, with a written reason, and you are told when it happens.") },
  { q: N_("Can I share a budget with my partner or family?"), a: N_("Yes. Make a shared budget and invite people you are connected with. You can also split single payments between people.") },
  { q: N_("What if I want to leave?"), a: N_("No hard feelings. Download everything as a file, then delete your account, both in Settings. Deleting is immediate and complete.") },
  { q: N_("Does it work on my phone?"), a: N_("Yes. It runs in your phone's browser and can be added to your home screen, so your balance is one thumb away.") },
];

const HOME_POINTS = [
  N_('A forecast that shows your balance month by month, so you see a tight month before you are in it.'),
  N_('Payments, recurring bills, installments and debts in one place.'),
  N_('Import a bank statement (PDF, CSV or Excel) from any bank instead of typing each payment.'),
  N_('A monthly budget for each category: how much is spent and left, and a warning before a category runs over.'),
  N_('Share a budget with a partner or family, and split single payments.'),
  N_('No bank login, no ads, and your data is yours to download or delete.'),
];

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "/terms/" and "/terms" are the same page; the query and the fragment are not part of it. */
export function normalizePath(p) {
  const clean = String(p ?? '/').split('?')[0].split('#')[0] || '/';
  return clean.length > 1 ? clean.replace(/\/+$/, '') || '/' : clean;
}
/** The public page an address is, in its language ("/it/terms" is the Italian terms): { ...page, lang, url }. Null for anything else. */
export function pageFor(pathname) {
  const { lang, path } = splitLangPath(normalizePath(pathname));
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  return page ? { ...page, lang, url: withLang(page.path, lang) } : null;
}

export function robotsTxt(base) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;
}

/** Every address that belongs in a search engine: the public pages of the app, the guides page and each guide (dated by when it was last updated). */
export const SITEMAP_PAGES = [
  ...PUBLIC_PAGES,
  { path: '/guides', priority: '0.8', changefreq: 'monthly', lastmod: GUIDES.map((g) => g.updated).sort().at(-1) },
  ...GUIDES.map((g) => ({ path: `/guides/${g.slug}`, priority: '0.7', changefreq: 'yearly', lastmod: g.updated })),
];

/** Each page in every language, each with links to the others (hreflang), so a search engine shows the right one to each reader. */
export function sitemapXml(base) {
  const loc = (path, lang) => escapeHtml(base + (path === '/' && lang === 'en' ? '/' : withLang(path, lang)));
  const urls = SITEMAP_PAGES.flatMap((p) =>
    LANGUAGES.map((lang) => {
      const alternates = [...LANGUAGES.map((l) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${loc(p.path, l)}"/>`), `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${loc(p.path, 'en')}"/>`].join('');
      return `  <url>\n    <loc>${loc(p.path, lang)}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>${alternates}\n  </url>`;
    }),
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

/** Structured data for the home page (in the language of the page), as JSON that cannot end its script tag early. */
export function homeJsonLd(base, lang = 'en') {
  return runWithLanguage(lang, () => {
    const home = `${base}${lang === 'en' ? '/' : withLang('/', lang)}`;
    const data = [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: home, inLanguage: lang },
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE_NAME,
        url: home,
        description: t(HOME_DESCRIPTION),
        applicationCategory: 'FinanceApplication',
        operatingSystem: t('Any (in a web browser)'),
        browserRequirements: t('Requires JavaScript'),
        inLanguage: lang,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    ];
    return JSON.stringify(data).replace(/</g, '\\u003c');
  });
}

/** What a reader without scripts sees on the home page: the same message as the page, as plain text with links. */
export function homeNoscript(lang = 'en') {
  return runWithLanguage(lang, () => {
    const to = (path) => withLang(path, lang);
    return `<noscript>
<main style="max-width:42rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.5">
<h1>${escText(t('Penny: see your money months ahead, not just where it went'))}</h1>
<p>${escText(t('Penny turns your payments, recurring bills, installments and debts into one clear forecast. No bank login, no ads, no selling your data. Free to use. It needs JavaScript to run in your browser.'))}</p>
<ul>${HOME_POINTS.map((p) => `<li>${escText(t(p))}</li>`).join('')}</ul>
<h2>${escText(t('Good to know'))}</h2>
${HOME_FAQ.map((f) => `<h3>${escText(t(f.q))}</h3><p>${escText(t(f.a))}</p>`).join('\n')}
<p><a href="/login">${escText(t('Log in'))}</a> · <a href="${to('/guides')}">${escText(t('Guides'))}</a> · <a href="${to('/terms')}">${escText(t('Terms'))}</a> · <a href="${to('/privacy')}">${escText(t('Privacy'))}</a> · <a href="${to('/contact')}">${escText(t('Contact'))}</a></p>
</main>
</noscript>`;
  });
}

/** The links to the other languages of a page (so search engines show each reader the right one), and the tags that name the language. */
export function alternateLinks(base, path) {
  const loc = (lang) => escapeHtml(base + (path === '/' && lang === 'en' ? '/' : withLang(path, lang)));
  return [...LANGUAGES.map((l) => `<link rel="alternate" hreflang="${l}" href="${loc(l)}" />`), `<link rel="alternate" hreflang="x-default" href="${loc('en')}" />`];
}
export const OG_LOCALE = { en: 'en_US', it: 'it_IT' };

/**
 * The page the server sends for an address: the built index.html with this page's title, description, address and, for the home page, its
 * structured data and its text for readers without scripts. A page has one address per language (/it/terms), each saying which language it is
 * in and where the others are. Pages that are not public (the app, the sign-in pages) are marked "do not index".
 * Throws if the page no longer has a spot this function fills, so a change to index.html cannot quietly lose the tags.
 */
export function renderPage(indexHtml, pathname, base) {
  const page = pageFor(pathname);
  const lang = page?.lang ?? splitLangPath(normalizePath(pathname)).lang;
  return runWithLanguage(lang, () => {
    const title = page ? t(page.title) : SITE_NAME;
    const description = page ? t(page.description) : t(HOME_DESCRIPTION);
    const url = `${base}${page ? (page.path === '/' && lang === 'en' ? '/' : page.url) : '/'}`;
    let html = indexHtml.replaceAll('__APP_URL__', escapeHtml(base));
    const swap = (re, to, what) => {
      if (!re.test(html)) throw new Error(`index.html has no ${what}`);
      html = html.replace(re, () => to);
    };
    swap(/<html lang="[^"]*"/, `<html lang="${lang}"`, 'html lang');
    swap(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`, 'title');
    swap(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`, 'description');
    swap(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(page && page.path !== '/' ? title : t('Penny: see your money months ahead'))}" />`, 'og:title');
    swap(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`, 'og:description');
    swap(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeHtml(url)}" />`, 'og:url');
    const extra = [`<link rel="canonical" href="${escapeHtml(url)}" />`, `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`];
    if (!page) extra.push('<meta name="robots" content="noindex, nofollow" />');
    else extra.push(...alternateLinks(base, page.path));
    if (page?.path === '/') extra.push(`<script type="application/ld+json">${homeJsonLd(base, lang)}</script>`);
    swap(/<\/head>/, `    ${extra.join('\n    ')}\n  </head>`, 'head');
    if (page?.path === '/') swap(/<div id="root"><\/div>/, `<div id="root"></div>\n    ${homeNoscript(lang)}`, 'root');
    return html;
  });
}
