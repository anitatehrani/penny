// The guides as web pages (docs/DESIGN.md sections 45 and 46). They are written by the server as ordinary HTML that needs no scripts: the words are in the page for
// people, screen readers and search engines alike, and the page is light. They wear the same stylesheet as the rest of Penny (found in the built index.html)
// and the look of the terms and privacy pages. All text is escaped; only **bold** and links to addresses on this site are allowed in the content.
// Each guide has an address per language (/guides/x, /it/guides/x): the writing is English in guides.js and Italian in the dictionary.

import { GUIDES, GUIDES_INDEX, guideBySlug } from '../content/guides.js';
import { LANGUAGES, localeOf, runWithLanguage, t, withLang } from './i18n.js';
import { alternateLinks, escapeHtml, OG_LOCALE } from './seo.js';
import { signupsOpen } from './signups.js';

const esc = escapeHtml;
const LABEL = 'Penny';
// the addresses of this site that exist in every language (the others, like /login, are the app's)
const PUBLIC = (href) => href === '/' || href === '/terms' || href === '/privacy' || href === '/contact' || href === '/guides' || href.startsWith('/guides/');

/** Escaped text with **bold** and [links](/to/this/site) made into markup; a link to a public page goes to the page in the same language. */
export function inline(text, lang = 'en') {
  return esc(text)
    .replace(/\[([^\]]+)\]\((\/[a-z0-9/_-]*)\)/g, (_m, label, href) => `<a href="${PUBLIC(href) ? withLang(href, lang) : href}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
const plain = (text) => String(text).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '');

const textOf = (block) => {
  if (typeof block === 'string') return [block];
  if (block.ul || block.ol) return block.ul ?? block.ol;
  if (block.example) return [block.example.title, ...block.example.rows.flat(), block.example.note ?? ''];
  return [block.note ?? ''];
};
/** The words of a guide, as a person would count them. */
export function wordCount(g) {
  const parts = [g.title, g.intro, ...g.sections.flatMap((s) => [s.h, ...s.blocks.flatMap(textOf)]), g.penny?.h ?? '', g.penny?.text ?? ''];
  return parts.map(plain).join(' ').split(/\s+/).filter(Boolean).length;
}
export const readMinutes = (g) => Math.max(2, Math.round(wordCount(g) / 200));

// the numbers in the examples are written the English way in guides.js; in Italian the point and the comma swap places
const number = (v, lang) => (lang === 'it' ? String(v).replace(/[.,]/g, (c) => (c === ',' ? '.' : ',')) : String(v));
const longDate = (iso, lang) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === 'en' ? 'en-GB' : localeOf(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function blocksHtml(blocks, lang) {
  const i = (text) => inline(t(text), lang);
  return blocks
    .map((b) => {
      if (typeof b === 'string') return `<p>${i(b)}</p>`;
      if (b.ul) return `<ul>${b.ul.map((x) => `<li>${i(x)}</li>`).join('')}</ul>`;
      if (b.ol) return `<ol>${b.ol.map((x) => `<li>${i(x)}</li>`).join('')}</ol>`;
      if (b.example) {
        const rows = b.example.rows.map(([label, value]) => `<tr><th scope="row">${i(label)}</th><td>${esc(number(value, lang))}</td></tr>`).join('');
        return `<table class="g-example"><caption>${esc(t(b.example.title))}</caption><tbody>${rows}</tbody></table>${b.example.note ? `<p class="g-note">${i(b.example.note)}</p>` : ''}`;
      }
      return `<p class="g-note">${i(b.note)}</p>`;
    })
    .join('\n');
}

/** The stylesheet tags of the built app, so the guides look like the rest of Penny. Empty when the client has not been built. */
export const stylesFrom = (indexHtml) => (String(indexHtml ?? '').match(/<link rel="stylesheet"[^>]*>/g) ?? []).join('\n    ');

const THEME_SCRIPT = `try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}`;
const json = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

function shell({ lang, base, styles, title, description, path, ogType = 'website', robots = null, current = 'guides', jsonLd = [], body }) {
  const to = (p) => withLang(p, lang);
  const url = `${base}${to(path)}`;
  const alternates = robots ? [] : alternateLinks(base, path);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#f4f3ee" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0e0f0d" media="(prefers-color-scheme: dark)" />
    <meta name="color-scheme" content="light dark" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(url)}" />${alternates.map((a) => `\n    ${a}`).join('')}${robots ? `\n    <meta name="robots" content="${esc(robots)}" />` : ''}
    <meta property="og:type" content="${ogType}" />
    <meta property="og:locale" content="${OG_LOCALE[lang]}" />
    <meta property="og:site_name" content="${LABEL}" />
    <meta property="og:title" content="${esc(title.replace(/ · Penny$/, ''))}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(base)}/landing/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <script>${THEME_SCRIPT}</script>
    ${styles}${jsonLd.map((d) => `\n    <script type="application/ld+json">${json(d)}</script>`).join('')}
  </head>
  <body>
    <a class="skip-link" href="#main">${esc(t('Skip to the text'))}</a>
    <div class="legal-page">
      <header class="legal-top">
        <a class="legal-brand" href="${to('/')}" aria-label="${esc(t('Penny, home'))}">
          <img class="g-mark g-mark-light" src="/brand/penny-wordmark.svg" alt="" width="82" height="26" />
          <img class="g-mark g-mark-dark" src="/brand/penny-wordmark-light.svg" alt="" width="82" height="26" />
        </a>
        <nav class="legal-nav" aria-label="${esc(t('Pages'))}">
          <a href="${to('/guides')}"${current === 'guides' ? ' aria-current="page"' : ''}>${esc(t('Guides'))}</a>
          <a href="${to('/terms')}">${esc(t('Terms of use'))}</a>
          <a href="${to('/privacy')}">${esc(t('Privacy policy'))}</a>
          <a href="${to('/contact')}">${esc(t('Contact'))}</a>
          <span class="lang-links" role="group" aria-label="${esc(t('Language'))}">${LANGUAGES.map((l) => `<a href="${withLang(path, l)}" lang="${l}" hreflang="${l}"${l === lang ? ' aria-current="true" class="on"' : ''}>${l === 'it' ? 'Italiano' : 'English'}</a>`).join('')}</span>
        </nav>
      </header>
      <main class="legal-main" id="main">
${body}
        <p class="legal-back"><a href="${to('/')}">${esc(t('Back to the home page'))}</a></p>
      </main>
    </div>
  </body>
</html>
`;
}

const crumbs = (base, trail, lang) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base}${withLang(path, lang)}` })),
});

const cta = (lang) => `<section class="g-cta" aria-labelledby="g-try">
          <h2 id="g-try">${esc(t('Try Penny'))}</h2>
          <p>${esc(t('Penny is a calm personal budget that shows your balance months ahead. Free to use, no ads, and no bank login.'))}</p>
          <p class="g-cta-buttons">${signupsOpen() ? `<a class="btn primary" href="/signup">${esc(t('Sign up free'))}</a> ` : ''}<a class="btn${signupsOpen() ? '' : ' primary'}" href="/login">${esc(t('Log in'))}</a></p>
          ${signupsOpen() ? '' : `<p class="muted small">${esc(t('Sign-ups are closed for now. If you already have an account, log in.'))}</p>`}
        </section>`;

/** One guide as a complete page, or null when there is no such guide. */
export function renderGuide(slug, { base, indexHtml, lang = 'en' }) {
  const g = guideBySlug(slug);
  if (!g) return null;
  return runWithLanguage(lang, () => {
    const path = `/guides/${g.slug}`;
    const to = (p) => withLang(p, lang);
    const related = g.related.map((s) => guideBySlug(s)).filter(Boolean);
    const title = t(g.title);
    const body = `        <article class="legal-article guide">
          <nav class="g-crumbs" aria-label="${esc(t('Breadcrumb'))}"><a href="${to('/')}">Penny</a> <span aria-hidden="true">›</span> <a href="${to('/guides')}">${esc(t('Guides'))}</a></nav>
          <h1>${esc(title)}</h1>
          <p class="legal-updated">${esc(t('Updated {date}', { date: longDate(g.updated, lang) }))} · ${esc(t('{n} min read', { n: readMinutes(g) }))}</p>
          <p class="legal-lead">${inline(t(g.intro), lang)}</p>
${g.sections.map((s) => `          <section>\n          <h2>${esc(t(s.h))}</h2>\n${blocksHtml(s.blocks, lang)}\n          </section>`).join('\n')}
          <section class="g-penny">
          <h2>${esc(t(g.penny.h))}</h2>
          <p>${inline(t(g.penny.text), lang)}</p>
          </section>
          ${cta(lang)}
          <section aria-labelledby="g-more">
          <h2 id="g-more">${esc(t('More guides'))}</h2>
          <ul class="g-related">${related.map((r) => `<li><a href="${to(`/guides/${r.slug}`)}">${esc(t(r.title))}</a><span class="muted small"> ${esc(t(r.description))}</span></li>`).join('')}</ul>
          </section>
          <p class="g-disclaimer muted small">${esc(t('This guide is general information, not financial advice.'))}</p>
        </article>`;
    return shell({
      lang,
      base,
      styles: stylesFrom(indexHtml),
      title: `${title} · ${LABEL}`,
      description: t(g.description),
      path,
      ogType: 'article',
      body,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description: t(g.description),
          datePublished: g.updated,
          dateModified: g.updated,
          inLanguage: lang,
          mainEntityOfPage: { '@type': 'WebPage', '@id': `${base}${to(path)}` },
          image: `${base}/landing/og.png`,
          author: { '@type': 'Organization', name: LABEL, url: `${base}/` },
          publisher: { '@type': 'Organization', name: LABEL, url: `${base}/`, logo: { '@type': 'ImageObject', url: `${base}/icon-512.png` } },
        },
        crumbs(base, [[LABEL, '/'], [t('Guides'), '/guides'], [title, path]], lang),
      ],
    });
  });
}

/** The list of all guides. */
export function renderGuidesIndex({ base, indexHtml, lang = 'en' }) {
  return runWithLanguage(lang, () => {
    const to = (p) => withLang(p, lang);
    const body = `        <article class="legal-article guide">
          <nav class="g-crumbs" aria-label="${esc(t('Breadcrumb'))}"><a href="${to('/')}">Penny</a></nav>
          <h1>${esc(t('Budgeting guides'))}</h1>
          <p class="legal-lead">${esc(t(GUIDES_INDEX.intro))}</p>
          <ul class="g-list">
${GUIDES.map((g) => `            <li><a href="${to(`/guides/${g.slug}`)}"><strong>${esc(t(g.title))}</strong><span>${esc(t(g.description))}</span></a><small class="muted">${esc(t('{n} min read', { n: readMinutes(g) }))}</small></li>`).join('\n')}
          </ul>
          ${cta(lang)}
        </article>`;
    return shell({
      lang,
      base,
      styles: stylesFrom(indexHtml),
      title: t(GUIDES_INDEX.title),
      description: t(GUIDES_INDEX.description),
      path: '/guides',
      body,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: t('Budgeting guides'),
          description: t(GUIDES_INDEX.description),
          url: `${base}${to('/guides')}`,
          inLanguage: lang,
          hasPart: GUIDES.map((g) => ({ '@type': 'Article', headline: t(g.title), url: `${base}${to(`/guides/${g.slug}`)}` })),
        },
        crumbs(base, [[LABEL, '/'], [t('Guides'), '/guides']], lang),
      ],
    });
  });
}

/** A guide that does not exist: a page that says so and offers the real ones. Marked "do not index"; the server answers 404. */
export function renderGuideNotFound({ base, indexHtml, lang = 'en' }) {
  return runWithLanguage(lang, () => {
    const to = (p) => withLang(p, lang);
    const body = `        <article class="legal-article guide">
          <h1>${esc(t('That guide does not exist'))}</h1>
          <p class="legal-lead">${esc(t('It may have moved, or the address may be mistyped. These are the guides there are:'))}</p>
          <ul class="g-related">${GUIDES.map((g) => `<li><a href="${to(`/guides/${g.slug}`)}">${esc(t(g.title))}</a></li>`).join('')}</ul>
        </article>`;
    return shell({ lang, base, styles: stylesFrom(indexHtml), title: `${t('Guide not found')} · ${LABEL}`, description: t('That guide does not exist.'), path: '/guides', robots: 'noindex, nofollow', body });
  });
}
