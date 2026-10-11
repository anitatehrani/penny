import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { initDb, pool } from './db.js';
import { pruneAuditEvents } from './lib/audit.js';
import { pruneContactMessages } from './lib/contact.js';
import { authenticate, impersonationGuard, purgeExpiredSessions, requireAuth, sameOriginOnly } from './lib/auth.js';
import { appUrl } from './lib/mailer.js';
import { startBackupSchedule } from './lib/backup.js';
import { errorHandler, wrap } from './lib/http.js';
import { materializeAll } from './lib/materialize.js';
import { runAlertScan } from './lib/notifications.js';
import { resolveWorkspace } from './lib/workspace.js';
import admin from './routes/admin.js';
import contact from './routes/contact.js';
import inbound from './routes/inbound.js';
import importer from './routes/import.js';
import auth from './routes/auth.js';
import avatars from './routes/avatars.js';
import backups from './routes/backups.js';
import notifications, { publicRouter as publicNotifications } from './routes/notifications.js';
import receipts, { fileRouter as receiptFiles } from './routes/receipts.js';
import cardBills from './routes/cardBills.js';
import reconcile from './routes/reconcile.js';
import safeToSpend from './routes/safeToSpend.js';
import carryover from './routes/carryover.js';
import debts from './routes/debts.js';
import installments from './routes/installments.js';
import people from './routes/people.js';
import profile from './routes/profile.js';
import recurring from './routes/recurring.js';
import reports from './routes/reports.js';
import insights from './routes/insights.js';
import budgets from './routes/budgets.js';
import preferences from './routes/preferences.js';
import settings from './routes/settings.js';
import shared from './routes/shared.js';
import transactions from './routes/transactions.js';
import workspaces from './routes/workspaces.js';
import { renderGuide, renderGuideNotFound, renderGuidesIndex } from './lib/guidePages.js';
import { escapeHtml, pageFor, renderPage, robotsTxt, sitemapXml } from './lib/seo.js';

const app = express();
app.disable('x-powered-by');
// Behind a web server or proxy (a public site), the visitor's address is in a header only that proxy sets: say how many proxies to trust
// (TRUST_PROXY=1), or every visitor looks like the proxy and shares one rate limit. Left unset, the address of the connection is used.
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY.trim();
  app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp === 'false' ? false : tp);
}
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use('/api/inbound', inbound); // parsed e-mail from Brevo: before the ordinary JSON reader, which would refuse a big mail
// a statement's lines (up to 3,000 of them) are bigger than any other request; everything else stays at 100 KB
app.use('/api/import', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));

// API pipeline: public health check -> session lookup -> auth routes (public + account) -> must be signed in
// -> user-level routes (profile, people, groups) -> pick the active budget (membership checked) -> budget routes.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow'); // the interface behind the pages is not for search engines
  next();
});
app.get(
  '/api/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }),
);
app.use('/api', sameOriginOnly, authenticate, impersonationGuard);
app.use('/api/auth', auth);
app.use('/api', publicNotifications); // one-click unsubscribe from an e-mail (signed link, no login)
app.use('/api', contact); // the contact form (anybody may write)
app.use('/api', requireAuth);
for (const r of [profile, avatars, people, workspaces, notifications, receiptFiles, preferences, backups, admin]) app.use('/api', r);
app.use('/api', resolveWorkspace);
for (const r of [settings, carryover, cardBills, safeToSpend, reconcile, transactions, importer, receipts, recurring, installments, debts, reports, shared, insights, budgets]) app.use('/api', r);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// What search engines read first (docs/DESIGN.md section 44): robots.txt and the sitemap carry this site's real address.
app.get('/robots.txt', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(robotsTxt(appUrl()));
});
app.get('/sitemap.xml', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(sitemapXml(appUrl()));
});

// Serve the built React app when present (npm run build).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// The guides (docs/DESIGN.md section 45): ordinary pages written by the server, readable without scripts. They borrow the stylesheet of the built app
// when there is one, and are still complete pages when there is not.
const builtIndex = () => (fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html'), 'utf8') : '');
let guideStyles;
const guideContext = () => ({ base: appUrl(), indexHtml: (guideStyles ??= builtIndex()) });
app.get('/guides', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(renderGuidesIndex(guideContext()));
});
const guideNotFound = (res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.status(404).type('html').send(renderGuideNotFound(guideContext()));
};
app.get('/guides/:slug', (req, res) => {
  const page = renderGuide(req.params.slug, guideContext());
  if (!page) return guideNotFound(res);
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(page);
});
// anything else under /guides/ (an extra part, a mistyped address) is "not found" too, not the app's catch-all page
app.get('/guides/*', (_req, res) => guideNotFound(res));

if (fs.existsSync(dist)) {
  // The page itself goes through here (not through express.static) so the link-preview tags carry this site's real address.
  const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  // each public page gets its own title, description and address; every other address gets the plain page marked "do not index"
  const pages = new Map();
  const pageHtml = (pathname) => {
    const key = pageFor(pathname)?.path ?? '*';
    if (!pages.has(key)) {
      try {
        pages.set(key, renderPage(indexHtml, pathname, appUrl()));
      } catch (e) {
        console.error('seo: could not prepare the page for search engines:', e.message);
        pages.set(key, indexHtml.replaceAll('__APP_URL__', escapeHtml(appUrl())));
      }
    }
    return pages.get(key);
  };
  app.use(express.static(dist, { index: false }));
  app.get('*', (req, res) => {
    // a missing script, picture or file is "not found", not the home page (search engines would take it for a page)
    if (!req.path.startsWith('/u/') && /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json|webmanifest|xml|txt)$/i.test(req.path)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    res.set('Cache-Control', 'no-cache');
    if (!pageFor(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(pageHtml(req.path));
  });
}

app.use(errorHandler);

const port = Number(process.env.PORT) || 3001;

try {
  await initDb();
  await materializeAll();
  await purgeExpiredSessions();
  await pruneAuditEvents();
  await pruneContactMessages();
} catch (err) {
  console.error('Could not initialise the database. Is Postgres running and DATABASE_URL correct?\n', err.message);
  process.exit(1);
}
// Housekeeping: keep the 24-month horizon of recurring payments rolling and drop expired sessions.
setInterval(
  () => Promise.all([materializeAll(), purgeExpiredSessions(), pruneAuditEvents(), pruneContactMessages()]).catch((e) => console.error(e)),
  6 * 60 * 60 * 1000,
).unref();

// Backups of the database: one a day while the server runs (BACKUPS=off switches it off)
startBackupSchedule();

// Alerts: look for due/overdue payments and negative balances, and send e-mail alerts, every hour
// (ALERT_SCAN_MINUTES can shorten that, mainly for testing).
if (process.env.ALERT_SCAN_MINUTES !== 'off') {
  const scanEveryMs = Math.min(2_000_000_000, Math.max(1000, (Number(process.env.ALERT_SCAN_MINUTES) || 60) * 60_000));
  const scan = () => runAlertScan().catch((e) => console.error('alert scan failed:', e.message));
  setTimeout(scan, Math.min(10_000, scanEveryMs)).unref();
  setInterval(scan, scanEveryMs).unref();
}

app.listen(port, () => console.log(`Penny listening on http://localhost:${port}`));
