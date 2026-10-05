import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { initDb, pool } from './db.js';
import { authenticate, purgeExpiredSessions, requireAuth, sameOriginOnly } from './lib/auth.js';
import { errorHandler, wrap } from './lib/http.js';
import { materializeAll } from './lib/materialize.js';
import { runAlertScan } from './lib/notifications.js';
import { resolveWorkspace } from './lib/workspace.js';
import auth from './routes/auth.js';
import avatars from './routes/avatars.js';
import notifications, { publicRouter as publicNotifications } from './routes/notifications.js';
import receipts, { fileRouter as receiptFiles } from './routes/receipts.js';
import carryover from './routes/carryover.js';
import debts from './routes/debts.js';
import installments from './routes/installments.js';
import people from './routes/people.js';
import profile from './routes/profile.js';
import recurring from './routes/recurring.js';
import reports from './routes/reports.js';
import insights from './routes/insights.js';
import preferences from './routes/preferences.js';
import settings from './routes/settings.js';
import shared from './routes/shared.js';
import transactions from './routes/transactions.js';
import workspaces from './routes/workspaces.js';

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use(express.json({ limit: '100kb' }));

// API pipeline: public health check -> session lookup -> auth routes (public + account) -> must be signed in
// -> user-level routes (profile, people, groups) -> pick the active budget (membership checked) -> budget routes.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.get(
  '/api/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }),
);
app.use('/api', sameOriginOnly, authenticate);
app.use('/api/auth', auth);
app.use('/api', publicNotifications); // one-click unsubscribe from an e-mail (signed link, no login)
app.use('/api', requireAuth);
for (const r of [profile, avatars, people, workspaces, notifications, receiptFiles, preferences]) app.use('/api', r);
app.use('/api', resolveWorkspace);
for (const r of [settings, carryover, transactions, receipts, recurring, installments, debts, reports, shared, insights]) app.use('/api', r);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app when present (npm run build).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

const port = Number(process.env.PORT) || 3001;

try {
  await initDb();
  await materializeAll();
  await purgeExpiredSessions();
} catch (err) {
  console.error('Could not initialise the database. Is Postgres running and DATABASE_URL correct?\n', err.message);
  process.exit(1);
}
// Housekeeping: keep the 24-month horizon of recurring payments rolling and drop expired sessions.
setInterval(
  () => Promise.all([materializeAll(), purgeExpiredSessions()]).catch((e) => console.error(e)),
  6 * 60 * 60 * 1000,
).unref();

// Alerts: look for due/overdue payments and negative balances, and send e-mail alerts, every hour
// (ALERT_SCAN_MINUTES can shorten that, mainly for testing).
if (process.env.ALERT_SCAN_MINUTES !== 'off') {
  const scanEveryMs = Math.min(2_000_000_000, Math.max(1000, (Number(process.env.ALERT_SCAN_MINUTES) || 60) * 60_000));
  const scan = () => runAlertScan().catch((e) => console.error('alert scan failed:', e.message));
  setTimeout(scan, Math.min(10_000, scanEveryMs)).unref();
  setInterval(scan, scanEveryMs).unref();
}

app.listen(port, () => console.log(`Penny listening on http://localhost:${port}`));
