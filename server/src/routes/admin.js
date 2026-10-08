import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { EVENT_KINDS, record } from '../lib/audit.js';
import { IMPERSONATION_MINUTES, rateLimit, requireAdmin } from '../lib/auth.js';
import { backupStatus } from '../lib/backup.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { appUrl, mailMode } from '../lib/mailer.js';
import { notify } from '../lib/notifications.js';
import { signupsOpen } from '../lib/signups.js';
import { verifyPassword } from '../lib/password.js';
import { deleteUserAccount, sharedBudgetCount } from '../lib/userAdmin.js';

/**
 * The admin dashboard's API (docs/DESIGN.md section 33). Everything here is about accounts and how the service is running: there is no route
 * that returns a payment, an amount, a debt, a note, a category or budget name, or a receipt, and none should be added.
 * Every route answers 404 to anyone who is not an admin.
 */
const router = Router();
router.use('/admin', requireAdmin);

const PAGE = 25;
const EVENT_PAGE = 50;
const version = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return null;
  }
})();

const withKind = (e) => ({ ...e, label: EVENT_KINDS[e.kind]?.label ?? e.kind, tone: EVENT_KINDS[e.kind]?.tone ?? '' });
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const USER_SELECT = `
  SELECT u.id, u.name, u.username, u.email, u.email_verified_at, u.created_at, u.last_login_at, u.last_seen_at,
         u.google_id IS NOT NULL AS google_linked, u.password_hash IS NOT NULL AS has_password,
         u.suspended_at, u.suspended_reason, u.is_admin,
         (SELECT count(*)::int FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = u.id AND w.kind = 'group') AS shared_budgets,
         (SELECT count(*)::int FROM transactions t WHERE t.user_id = u.id) AS payments
  FROM users u`;

/** A person as the admin sees them: who they are and how they use the service, as counts. Never a password hash, never any content. */
const shapeUser = (r) => ({
  id: r.id,
  name: r.name,
  username: r.username,
  email: r.email,
  email_verified: !!r.email_verified_at,
  created_at: r.created_at,
  last_login_at: r.last_login_at,
  last_seen_at: r.last_seen_at,
  google_linked: r.google_linked,
  has_password: r.has_password,
  suspended: !!r.suspended_at,
  suspended_at: r.suspended_at,
  suspended_reason: r.suspended_reason,
  is_admin: r.is_admin,
  shared_budgets: r.shared_budgets,
  payments: r.payments,
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------------------------------------------
router.get(
  '/admin/overview',
  wrap(async (_req, res) => {
    const [people, content, signups, events, recent] = await Promise.all([
      query(`SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS new_24h,
                    count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d,
                    count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new_30d,
                    count(*) FILTER (WHERE last_seen_at > now() - interval '24 hours')::int AS active_24h,
                    count(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::int AS active_7d,
                    count(*) FILTER (WHERE last_seen_at > now() - interval '30 days')::int AS active_30d,
                    count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS email_confirmed,
                    count(*) FILTER (WHERE google_id IS NOT NULL)::int AS google,
                    count(*) FILTER (WHERE password_hash IS NOT NULL)::int AS password,
                    count(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended,
                    count(*) FILTER (WHERE is_admin)::int AS admins
             FROM users`),
      query(`SELECT (SELECT count(*) FROM workspaces WHERE kind = 'personal')::int AS personal_budgets,
                    (SELECT count(*) FROM workspaces WHERE kind = 'group')::int AS shared_budgets,
                    (SELECT count(*) FROM transactions)::int AS payments,
                    (SELECT count(*) FROM receipts)::int AS receipts,
                    (SELECT COALESCE(sum(size_bytes), 0) FROM receipts)::float8 AS receipt_bytes`),
      query(`SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS count
             FROM generate_series(current_date - 29, current_date, interval '1 day') d
             LEFT JOIN (SELECT created_at::date AS day, count(*) AS n FROM users WHERE created_at >= current_date - 29 GROUP BY 1) c ON c.day = d::date
             ORDER BY d`),
      query(`SELECT count(*) FILTER (WHERE kind IN ('login', 'google_signin'))::int AS sign_ins,
                    count(*) FILTER (WHERE kind = 'login_failed')::int AS failed_sign_ins,
                    count(*) FILTER (WHERE kind IN ('signup', 'google_signup'))::int AS sign_ups,
                    count(*) FILTER (WHERE kind = 'rate_limited')::int AS rate_limited
             FROM audit_events WHERE at > now() - interval '24 hours'`),
      query(`SELECT e.id, e.at, e.kind, e.detail, e.source, e.user_id, u.name AS user_name, u.username AS user_username
             FROM audit_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.at DESC, e.id DESC LIMIT 8`),
    ]);

    const b = backupStatus();
    const checks = [
      { id: 'cookie', ok: process.env.COOKIE_SECURE === 'true', text: 'Secure cookies are on', hint: 'Set COOKIE_SECURE=true in .env once the site is served over HTTPS.' },
      { id: 'url', ok: !/localhost|127\.0\.0\.1/.test(appUrl()), text: 'The public address is set', hint: 'Set APP_URL to the real address, or the links in e-mails point at your own computer.' },
      { id: 'mail', ok: mailMode() === 'smtp', text: 'A real mail server is set', hint: 'Set SMTP_HOST (and the other SMTP_ settings). Without it e-mails are only saved in a folder, so nobody receives them.' },
      { id: 'backups', ok: !!b.enabled && !b.problem && !!b.last_at, text: 'Backups are on and recent', hint: b.problem || 'Backups are off or none has been made yet.' },
      { id: 'proxy', ok: !!process.env.TRUST_PROXY, text: 'The proxy setting is present', hint: 'Set TRUST_PROXY=1 when a web server sits in front of Penny, or every visitor looks like one address to the rate limits and the activity log.' },
    ];

    res.json({
      people: people.rows[0],
      content: content.rows[0],
      signups_by_day: signups.rows,
      last_24h: events.rows[0],
      recent: recent.rows.map(withKind),
      checks,
    });
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------------------------
const listQuery = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'suspended', 'unconfirmed', 'admins']).default('all'),
  sort: z.enum(['newest', 'seen', 'name']).default('newest'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
const ORDER = { newest: 'u.created_at DESC, u.id DESC', seen: 'u.last_seen_at DESC NULLS LAST, u.id DESC', name: 'lower(u.name), u.id' };

router.get(
  '/admin/users',
  wrap(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where = [];
    const params = [];
    if (q.q) {
      params.push(`%${escapeLike(q.q)}%`);
      where.push(`(u.name ILIKE $1 ESCAPE '\\' OR u.username ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\')`);
    }
    if (q.status === 'active') where.push('u.suspended_at IS NULL');
    if (q.status === 'suspended') where.push('u.suspended_at IS NOT NULL');
    if (q.status === 'unconfirmed') where.push('u.email_verified_at IS NULL');
    if (q.status === 'admins') where.push('u.is_admin');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await query(`SELECT count(*)::int AS n FROM users u ${clause}`, params)).rows[0].n;
    const { rows } = await query(`${USER_SELECT} ${clause} ORDER BY ${ORDER[q.sort]} LIMIT ${PAGE} OFFSET ${(q.page - 1) * PAGE}`, params);
    res.json({ users: rows.map(shapeUser), total, page: q.page, pages: Math.max(1, Math.ceil(total / PAGE)), page_size: PAGE });
  }),
);

router.get(
  '/admin/users/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const row = (await query(`${USER_SELECT} WHERE u.id = $1`, [id])).rows[0];
    if (!row) throw new HttpError(404, 'Person not found');
    const [devices, events, shared] = await Promise.all([
      query('SELECT count(*)::int AS n, max(created_at) AS latest FROM sessions WHERE user_id = $1 AND expires_at > now()', [id]),
      query(`SELECT id, at, kind, detail, source FROM audit_events WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT 15`, [id]),
      sharedBudgetCount(id),
    ]);
    const user = shapeUser(row);
    res.json({
      user,
      devices: devices.rows[0].n,
      latest_device_at: devices.rows[0].latest,
      shared_with_others: shared,
      can_delete: shared === 0 && !user.is_admin && user.id !== req.user.id,
      events: events.rows.map(withKind),
    });
  }),
);

/** The person an action is about: it must exist and be somebody else who is not an admin. */
async function actionTarget(req) {
  const id = idParam(req);
  const row = (await query(`${USER_SELECT} WHERE u.id = $1`, [id])).rows[0];
  if (!row) throw new HttpError(404, 'Person not found');
  if (row.id === req.user.id) throw new HttpError(400, 'You cannot do this to your own account.');
  if (row.is_admin) throw new HttpError(400, 'This person is an admin. Take their admin role away first (.\\penny remove-admin).');
  return row;
}

router.post(
  '/admin/users/:id/suspend',
  wrap(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
    const row = await actionTarget(req);
    if (!row.suspended_at) {
      await query('UPDATE users SET suspended_at = now(), suspended_reason = $2 WHERE id = $1', [row.id, reason || null]);
      await query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
      await record('admin_suspend', { req, userId: row.id, actorId: req.user.id, detail: reason ? `reason: ${reason}` : null });
    }
    res.json({ user: shapeUser((await query(`${USER_SELECT} WHERE u.id = $1`, [row.id])).rows[0]) });
  }),
);

router.post(
  '/admin/users/:id/unsuspend',
  wrap(async (req, res) => {
    const row = await actionTarget(req);
    if (row.suspended_at) {
      await query('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = $1', [row.id]);
      await record('admin_unsuspend', { req, userId: row.id, actorId: req.user.id });
    }
    res.json({ user: shapeUser((await query(`${USER_SELECT} WHERE u.id = $1`, [row.id])).rows[0]) });
  }),
);

// "View as" (docs/DESIGN.md section 33). This is the one way an admin can see a person's money, so it has the most care: the admin must say why
// and type their own password again, it lasts 30 minutes, it is read-only unless the admin chooses otherwise (and even then only budget data
// can change, see impersonationGuard), it is in the activity log, and the person is told in the app. Admins cannot be viewed.
const viewAsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `viewas:${req.user.id}`, message: 'Too many tries. Wait a few minutes and try again.' });
router.post(
  '/admin/users/:id/view-as',
  viewAsLimiter,
  wrap(async (req, res) => {
    const body = z
      .object({
        reason: z.string().trim().min(5, 'Say why, in a few words.').max(200),
        password: z.string().max(1000).optional(),
        read_only: z.boolean().default(true),
      })
      .parse(req.body ?? {});
    const row = await actionTarget(req);
    if (req.user.password_hash) {
      const ok = body.password ? await verifyPassword(body.password, req.user.password_hash) : false;
      if (!ok) throw new HttpError(403, 'That password is not correct.'); // 403, not 401: a wrong password here must not sign the admin out
    }
    await query('UPDATE sessions SET acting_as = $2, acting_started_at = now(), acting_read_only = $3, acting_reason = $4 WHERE token_hash = $1', [req.sessionHash, row.id, body.read_only, body.reason]);
    await record('admin_impersonate_start', { req, userId: row.id, actorId: req.user.id, detail: `${body.read_only ? 'read-only' : 'could make changes'}: ${body.reason}` });
    await notify(row.id, {
      kind: 'security',
      title: 'An admin viewed your account',
      body: `A Penny admin signed in to your account to help with: "${body.reason}". It was ${body.read_only ? 'read-only, so nothing was changed' : 'allowed to change budget data'}. If you do not expect this, contact support.`,
      link: '/settings?tab=account',
      dedupeKey: `admin-view:${Date.now()}`,
    });
    res.json({ ok: true, minutes: IMPERSONATION_MINUTES, read_only: body.read_only });
  }),
);

router.post(
  '/admin/users/:id/sign-out',
  wrap(async (req, res) => {
    const row = await actionTarget(req);
    const { rowCount } = await query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
    await record('admin_signout', { req, userId: row.id, actorId: req.user.id, detail: `${rowCount} device${rowCount === 1 ? '' : 's'} signed out` });
    res.json({ signed_out: rowCount });
  }),
);

router.delete(
  '/admin/users/:id',
  wrap(async (req, res) => {
    const { confirm } = z.object({ confirm: z.string().trim().max(100) }).parse(req.body ?? {});
    const row = await actionTarget(req);
    if (confirm.toLowerCase() !== row.username.toLowerCase()) throw new HttpError(400, 'Type their username to confirm.');
    const shared = await sharedBudgetCount(row.id);
    if (shared > 0) {
      throw new HttpError(
        409,
        `This person is in ${shared} shared budget${shared === 1 ? '' : 's'} with other people. Deleting them would remove their payments, or the budget itself, from those people. Suspend the account instead, or ask them to leave the shared budgets first.`,
      );
    }
    await deleteUserAccount(row.id);
    await record('admin_delete', { req, actorId: req.user.id, detail: `deleted account #${row.id}` });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------------------------------------------------
const eventQuery = z.object({
  kind: z.enum(['all', ...Object.keys(EVENT_KINDS)]).default('all'),
  user_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

router.get(
  '/admin/events',
  wrap(async (req, res) => {
    const q = eventQuery.parse(req.query);
    const where = [];
    const params = [];
    if (q.kind !== 'all') {
      params.push(q.kind);
      where.push(`e.kind = $${params.length}`);
    }
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`e.user_id = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await query(`SELECT count(*)::int AS n FROM audit_events e ${clause}`, params)).rows[0].n;
    const { rows } = await query(
      `SELECT e.id, e.at, e.kind, e.source, e.detail, e.user_id, e.actor_id,
              u.name AS user_name, u.username AS user_username, a.name AS actor_name, a.username AS actor_username
       FROM audit_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN users a ON a.id = e.actor_id
       ${clause} ORDER BY e.at DESC, e.id DESC LIMIT ${EVENT_PAGE} OFFSET ${(q.page - 1) * EVENT_PAGE}`,
      params,
    );
    res.json({
      events: rows.map(withKind),
      total,
      page: q.page,
      pages: Math.max(1, Math.ceil(total / EVENT_PAGE)),
      kinds: Object.entries(EVENT_KINDS).map(([kind, v]) => ({ kind, label: v.label })),
    });
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------------------------------------------------------------
router.get(
  '/admin/system',
  wrap(async (_req, res) => {
    const [db, tables, mail, failures] = await Promise.all([
      query(`SELECT pg_database_size(current_database())::float8 AS bytes, (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections`),
      query(`SELECT relname AS name, n_live_tup::float8 AS rows, pg_total_relation_size(relid)::float8 AS bytes FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`),
      query(`SELECT count(*) FILTER (WHERE status IN ('sent', 'preview'))::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed
             FROM email_log WHERE created_at > now() - interval '24 hours'`),
      query(`SELECT created_at, kind, to_email, error FROM email_log WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5`),
    ]);
    const mem = process.memoryUsage();
    res.json({
      app: { version, node: process.version, uptime_seconds: Math.round(process.uptime()), memory_bytes: mem.rss, signups_open: signupsOpen() },
      database: { ok: true, bytes: db.rows[0].bytes, connections: db.rows[0].connections, tables: tables.rows },
      backups: backupStatus(),
      mail: { mode: mailMode(), sent_24h: mail.rows[0].sent, failed_24h: mail.rows[0].failed, recent_failures: failures.rows },
    });
  }),
);

export default router;
