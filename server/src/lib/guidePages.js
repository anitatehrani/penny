// The guides as web pages (docs/DESIGN.md section 45). They are written by the server as ordinary HTML that needs no scripts: the words are in the page for
// people, screen readers and search engines alike, and the page is light. They wear the same stylesheet as the rest of Penny (found in the built index.html)
// and the look of the terms and privacy pages. All text is escaped; only **bold** and links to addresses on this site are allowed in the content.

import { GUIDES, GUIDES_INDEX, guideBySlug } from '../content/guides.js';
import { escapeHtml } from './seo.js';
import { signupsOpen } from './signups.js';

const esc = escapeHtml;
const LABEL = 'Penny';

/** Escaped text with **bold** and [links](/to/this/site) made into markup. */
export function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\((\/[a-z0-9/_-]*)\)/g, (_m, label, href) => `<a href="${href}">${label}</a>`)
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

const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function blocksHtml(blocks) {
  return blocks
    .map((b) => {
      if (typeof b === 'string') return `<p>${inline(b)}</p>`;
      if (b.ul) return `<ul>${b.ul.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
      if (b.ol) return `<ol>${b.ol.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
      if (b.example) {
        const rows = b.example.rows.map(([label, value]) => `<tr><th scope="row">${inline(label)}</th><td>${esc(value)}</td></tr>`).join('');
        return `<table class="g-example"><caption>${esc(b.example.title)}</caption><tbody>${rows}</tbody></table>${b.example.note ? `<p class="g-note">${inline(b.example.note)}</p>` : ''}`;
      }
      return `<p class="g-note">${inline(b.note)}</p>`;
    })
    .join('\n');
}

/** The stylesheet tags of the built app, so the guides look like the rest of Penny. Empty when the client has not been built. */
export const stylesFrom = (indexHtml) => (String(indexHtml ?? '').match(/<link rel="stylesheet"[^>]*>/g) ?? []).join('\n    ');

const THEME_SCRIPT = `try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}`;
const json = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

function shell({ base, styles, title, description, path, ogType = 'website', robots = null, current = 'guides', jsonLd = [], body }) {
  const url = `${base}${path}`;
  return `<!doctype html>
<html lang="en">
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
    <link rel="canonical" href="${esc(url)}" />${robots ? `\n    <meta name="robots" content="${esc(robots)}" />` : ''}
    <meta property="og:type" content="${ogType}" />
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
    <a class="skip-link" href="#main">Skip to the text</a>
    <div class="legal-page">
      <header class="legal-top">
        <a class="legal-brand" href="/" aria-label="Penny, home">
          <img class="g-mark g-mark-light" src="/brand/penny-wordmark.svg" alt="" width="82" height="26" />
          <img class="g-mark g-mark-dark" src="/brand/penny-wordmark-light.svg" alt="" width="82" height="26" />
        </a>
        <nav class="legal-nav" aria-label="Pages">
          <a href="/guides"${current === 'guides' ? ' aria-current="page"' : ''}>Guides</a>
          <a href="/terms">Terms of use</a>
          <a href="/privacy">Privacy policy</a>
          <a href="/contact">Contact</a>
        </nav>
      </header>
      <main class="legal-main" id="main">
${body}
        <p class="legal-back"><a href="/">Back to the home page</a></p>
      </main>
    </div>
  </body>
</html>
`;
}

const crumbs = (base, trail) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base}${path}` })),
});

const cta = () => `<section class="g-cta" aria-labelledby="g-try">
          <h2 id="g-try">Try Penny</h2>
          <p>Penny is a calm personal budget that shows your balance months ahead. Free to use, no ads, and no bank login.</p>
          <p class="g-cta-buttons">${signupsOpen() ? '<a class="btn primary" href="/signup">Sign up free</a> ' : ''}<a class="btn${signupsOpen() ? '' : ' primary'}" href="/login">Log in</a></p>
          ${signupsOpen() ? '' : '<p class="muted small">Sign-ups are closed for now. If you already have an account, log in.</p>'}
        </section>`;

/** One guide as a complete page, or null when there is no such guide. */
export function renderGuide(slug, { base, indexHtml }) {
  const g = guideBySlug(slug);
  if (!g) return null;
  const path = `/guides/${g.slug}`;
  const related = g.related.map((s) => guideBySlug(s)).filter(Boolean);
  const body = `        <article class="legal-article guide">
          <nav class="g-crumbs" aria-label="Breadcrumb"><a href="/">Penny</a> <span aria-hidden="true">›</span> <a href="/guides">Guides</a></nav>
          <h1>${esc(g.title)}</h1>
          <p class="legal-updated">Updated ${longDate(g.updated)} · ${readMinutes(g)} min read</p>
          <p class="legal-lead">${inline(g.intro)}</p>
${g.sections.map((s) => `          <section>\n          <h2>${esc(s.h)}</h2>\n${blocksHtml(s.blocks)}\n          </section>`).join('\n')}
          <section class="g-penny">
          <h2>${esc(g.penny.h)}</h2>
          <p>${inline(g.penny.text)}</p>
          </section>
          ${cta()}
          <section aria-labelledby="g-more">
          <h2 id="g-more">More guides</h2>
          <ul class="g-related">${related.map((r) => `<li><a href="/guides/${r.slug}">${esc(r.title)}</a><span class="muted small"> ${esc(r.description)}</span></li>`).join('')}</ul>
          </section>
          <p class="g-disclaimer muted small">This guide is general information, not financial advice.</p>
        </article>`;
  return shell({
    base,
    styles: stylesFrom(indexHtml),
    title: `${g.title} · ${LABEL}`,
    description: g.description,
    path,
    ogType: 'article',
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: g.title,
        description: g.description,
        datePublished: g.updated,
        dateModified: g.updated,
        inLanguage: 'en',
        mainEntityOfPage: { '@type': 'WebPage', '@id': `${base}${path}` },
        image: `${base}/landing/og.png`,
        author: { '@type': 'Organization', name: LABEL, url: `${base}/` },
        publisher: { '@type': 'Organization', name: LABEL, url: `${base}/`, logo: { '@type': 'ImageObject', url: `${base}/icon-512.png` } },
      },
      crumbs(base, [[LABEL, '/'], ['Guides', '/guides'], [g.title, path]]),
    ],
  });
}

/** The list of all guides. */
export function renderGuidesIndex({ base, indexHtml }) {
  const body = `        <article class="legal-article guide">
          <nav class="g-crumbs" aria-label="Breadcrumb"><a href="/">Penny</a></nav>
          <h1>Budgeting guides</h1>
          <p class="legal-lead">${esc(GUIDES_INDEX.intro)}</p>
          <ul class="g-list">
${GUIDES.map((g) => `            <li><a href="/guides/${g.slug}"><strong>${esc(g.title)}</strong><span>${esc(g.description)}</span></a><small class="muted">${readMinutes(g)} min read</small></li>`).join('\n')}
          </ul>
          ${cta()}
        </article>`;
  return shell({
    base,
    styles: stylesFrom(indexHtml),
    title: GUIDES_INDEX.title,
    description: GUIDES_INDEX.description,
    path: '/guides',
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Budgeting guides',
        description: GUIDES_INDEX.description,
        url: `${base}/guides`,
        inLanguage: 'en',
        hasPart: GUIDES.map((g) => ({ '@type': 'Article', headline: g.title, url: `${base}/guides/${g.slug}` })),
      },
      crumbs(base, [[LABEL, '/'], ['Guides', '/guides']]),
    ],
  });
}

/** A guide that does not exist: a page that says so and offers the real ones. Marked "do not index"; the server answers 404. */
export function renderGuideNotFound({ base, indexHtml }) {
  const body = `        <article class="legal-article guide">
          <h1>That guide does not exist</h1>
          <p class="legal-lead">It may have moved, or the address may be mistyped. These are the guides there are:</p>
          <ul class="g-related">${GUIDES.map((g) => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a></li>`).join('')}</ul>
        </article>`;
  return shell({ base, styles: stylesFrom(indexHtml), title: `Guide not found · ${LABEL}`, description: 'That guide does not exist.', path: '/guides', robots: 'noindex, nofollow', body });
}
