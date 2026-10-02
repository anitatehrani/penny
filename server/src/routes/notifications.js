import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { canAccessTarget, TARGET_TABLES } from '../lib/alerts.js';
import { rateLimit } from '../lib/auth.js';
import { testEmail } from '../lib/emailTemplates.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { mailMode, sendMail } from '../lib/mailer.js';
import { getSettings, KINDS, oneClickUnsubscribeUrl, resolveStale, runAlertScan, unsubscribeUrlFor } from '../lib/notifications.js';
import { verifyToken } from '../lib/secret.js';

/** Signed-in routes: the notification list, settings and per-payment alert choices. */
const router = Router();
/** Public routes (the one-click unsubscribe link in every e-mail). */
export const publicRouter = Router();

const mailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, keyFn: (req) => `testmail:${req.user.id}`, message: 'Too many test e-mails. Try again in an hour.' });
const refreshLimiter = rateLimit({ windowMs: 60_000, max: 12, keyFn: (req) => `refresh:${req.user.id}`, message: 'Please wait a moment before refreshing again.' });

// ---------------------------------------------------------------- the list
router.get(
  '/notifications',
  wrap(async (req, res) => {
    await resolveStale(req.user.id);
    const kind = req.query.kind ? z.enum(KINDS).parse(String(req.query.kind)) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = req.query.before ? z.coerce.number().int().positive().parse(req.query.before) : null;
    const unreadOnly = req.query.status === 'unread';
    const { rows } = await query(
      `SELECT id, kind, title, body, link, data, created_at, read_at,
              (kind IN ('payment_due', 'payment_overdue') AND EXISTS (
                 SELECT 1 FROM transactions t WHERE t.id = (data ->> 'transaction_id')::int AND t.status = 'pending' AND t.date::text = data ->> 'date')) AS actionable
       FROM notifications
       WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2) AND ($3::bigint IS NULL OR id < $3) AND (NOT $4 OR read_at IS NULL)
       ORDER BY id DESC LIMIT $5`,
      [req.user.id, kind, before, unreadOnly, limit],
    );
    const unread = (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n;
    res.json({ items: rows, unread, has_more: rows.length === limit });
  }),
);

router.get(
  '/notifications/summary',
  wrap(async (req, res) => {
    await resolveStale(req.user.id);
    const { rows } = await query(
      `SELECT count(*)::int AS unread, max(id) AS latest_id,
              (SELECT title FROM notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY id DESC LIMIT 1) AS latest_title
       FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id],
    );
    res.json(rows[0]);
  }),
);

router.post(
  '/notifications/refresh',
  refreshLimiter,
  wrap(async (req, res) => {
    res.json(await runAlertScan({ userId: req.user.id }));
  }),
);

router.post(
  '/notifications/read-all',
  wrap(async (req, res) => {
    const { rowCount } = await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json({ updated: rowCount });
  }),
);

router.delete(
  '/notifications',
  wrap(async (req, res) => {
    // only already-read ones: "clear read"
    const { rowCount } = await query('DELETE FROM notifications WHERE user_id = $1 AND read_at IS NOT NULL', [req.user.id]);
    res.json({ deleted: rowCount });
  }),
);

// ---------------------------------------------------------------- settings
const flag = z.boolean();
const settingsSchema = z
  .object({
    due_soon: flag,
    overdue: flag,
    balance_warning: flag,
    forecast_warning: flag,
    ai_insights: flag,
    weekly_summary: flag,
    monthly_summary: flag,
    security_alerts: flag,
    friend_requests: flag,
    group_invites: flag,
    shared_payments: flag,
    group_activity: flag,
    include_income: flag,
    lead_days: z.number().int().min(0).max(60),
    paused_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)').nullable(),
    browser_push: flag,
    email_enabled: flag,
    email_frequency: z.enum(['daily', 'instant']),
    email_hour: z.number().int().min(0).max(23),
    timezone: z.string().min(1).max(64),
    email_due: flag,
    email_overdue: flag,
    email_balance: flag,
    email_forecast: flag,
    email_ai: flag,
    email_weekly: flag,
    email_monthly: flag,
    email_security: flag,
    weekly_day: z.number().int().min(0).max(6),
    email_social: flag,
    email_group_activity: flag,
  })
  .partial()
  .strict();

async function settingsPayload(user) {
  const s = await getSettings(user.id);
  const paused = !!s.paused_until && new Date(s.paused_until) > new Date();
  const until = paused
    ? (await query(`SELECT to_char((($1::timestamptz - interval '1 second') AT TIME ZONE $2), 'YYYY-MM-DD') AS d`, [s.paused_until, s.timezone])).rows[0].d
    : null;
  const { paused_until, last_digest_on, last_insight_on, user_id, ...rest } = s;
  return { ...rest, paused: paused, paused_until_date: until, email: user.email, email_verified: !!user.email_verified_at, mail_mode: mailMode() };
}

router.get(
  '/notifications/settings',
  wrap(async (req, res) => {
    const fresh = (await query('SELECT id, email, email_verified_at FROM users WHERE id = $1', [req.user.id])).rows[0];
    res.json(await settingsPayload(fresh));
  }),
);

router.put(
  '/notifications/settings',
  wrap(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const current = await getSettings(req.user.id);
    const user = (await query('SELECT id, email, email_verified_at FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (body.email_enabled && !user.email_verified_at) throw new HttpError(400, 'Confirm your e-mail address first, then turn e-mail alerts on.');
    if (body.timezone !== undefined) {
      const ok = await query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [body.timezone]);
      if (!ok.rowCount) throw new HttpError(400, 'Unknown time zone.');
    }
    const { paused_until, ...plain } = body;
    const sets = [];
    const params = [req.user.id];
    for (const [k, v] of Object.entries(plain)) {
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
    if (paused_until !== undefined) {
      if (paused_until === null) sets.push('paused_until = NULL');
      else {
        params.push(paused_until);
        params.push(plain.timezone ?? current.timezone);
        // paused through the end of that day in the person's own time zone
        sets.push(`paused_until = (($${params.length - 1}::date + 1)::timestamp AT TIME ZONE $${params.length})`);
      }
    }
    // switching e-mail on again starts a fresh digest cycle instead of replaying old items
    if (plain.email_enabled === true && !current.email_enabled) {
      sets.push(`last_digest_on = NULL`);
      await query(`UPDATE notifications SET emailed_at = now() WHERE user_id = $1 AND emailed_at IS NULL AND created_at < now() - interval '1 hour'`, [req.user.id]);
    }
    if (sets.length) await query(`UPDATE notification_settings SET ${sets.join(', ')} WHERE user_id = $1`, params);
    res.json(await settingsPayload(user));
  }),
);

router.post(
  '/notifications/test-email',
  mailLimiter,
  wrap(async (req, res) => {
    const user = (await query('SELECT id, name, email, email_verified_at FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!user.email_verified_at) throw new HttpError(400, 'Confirm your e-mail address first.');
    const mail = testEmail({ name: user.name, unsubscribeUrl: await unsubscribeUrlFor(user.id) });
    try {
      const r = await sendMail({
        to: user.email,
        ...mail,
        headers: { 'List-Unsubscribe': `<${await oneClickUnsubscribeUrl(user.id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      await query(`INSERT INTO email_log (user_id, to_email, subject, kind, status) VALUES ($1, $2, $3, 'test', $4)`, [user.id, user.email, mail.subject, r.status]);
      res.json({ status: r.status, preview_file: r.file ? r.file.split(/[\\/]/).pop() : null });
    } catch (err) {
      await query(`INSERT INTO email_log (user_id, to_email, subject, kind, status, error) VALUES ($1, $2, $3, 'test', 'failed', $4)`, [user.id, user.email, mail.subject, err.message.slice(0, 300)]);
      throw new HttpError(502, 'The e-mail could not be sent. Check the mail server settings.');
    }
  }),
);

router.get(
  '/notifications/emails',
  wrap(async (req, res) => {
    const { rows } = await query('SELECT id, subject, kind, status, created_at FROM email_log WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [req.user.id]);
    res.json(rows);
  }),
);

// ---------------------------------------------------------------- one notification
router.post(
  '/notifications/:id/read',
  wrap(async (req, res) => {
    const { rowCount } = await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [idParam(req), req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Notification not found.');
    res.status(204).end();
  }),
);
router.post(
  '/notifications/:id/unread',
  wrap(async (req, res) => {
    const { rowCount } = await query('UPDATE notifications SET read_at = NULL WHERE id = $1 AND user_id = $2', [idParam(req), req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Notification not found.');
    res.status(204).end();
  }),
);
router.delete(
  '/notifications/:id',
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [idParam(req), req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Notification not found.');
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- which payments alert me
const SOURCE_SQL = `CASE WHEN ot.mode IS NOT NULL THEN 'payment' WHEN orr.mode IS NOT NULL THEN 'recurring item'
                         WHEN op.mode IS NOT NULL THEN 'installment plan' WHEN oc.mode IS NOT NULL THEN 'category' ELSE 'default' END`;

/** Payments coming up (and recently overdue) in every budget the person belongs to, with the alert rule that applies. */
router.get(
  '/alerts/upcoming',
  wrap(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
    const s = await getSettings(req.user.id);
    const { rows } = await query(
      `SELECT t.id, t.type, t.description, t.amount, t.date::text AS date, t.workspace_id, w.name AS workspace, w.kind AS workspace_kind,
              COALESCE(ws.currency, 'USD') AS currency, t.category_id, c.name AS category_name, c.color AS category_color,
              t.recurring_id, t.installment_plan_id, t.source,
              COALESCE(ot.mode, orr.mode, op.mode, oc.mode, CASE WHEN t.type = 'income' AND NOT $2 THEN 'off' ELSE 'on' END) AS mode,
              ${SOURCE_SQL} AS source_of_rule,
              COALESCE(ot.days, orr.days, op.days, oc.days, $3) AS days,
              ot.mode AS own_mode, ot.days AS own_days
       FROM workspace_members m
       JOIN transactions t ON t.workspace_id = m.workspace_id AND t.status = 'pending'
       JOIN workspaces w ON w.id = t.workspace_id
       LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN alert_overrides ot  ON ot.user_id  = m.user_id AND ot.target_type  = 'transaction' AND ot.target_id  = t.id
       LEFT JOIN alert_overrides orr ON orr.user_id = m.user_id AND orr.target_type = 'recurring'   AND orr.target_id = t.recurring_id
       LEFT JOIN alert_overrides op  ON op.user_id  = m.user_id AND op.target_type  = 'installment' AND op.target_id  = t.installment_plan_id
       LEFT JOIN alert_overrides oc  ON oc.user_id  = m.user_id AND oc.target_type  = 'category'    AND oc.target_id  = t.category_id
       WHERE m.user_id = $1 AND t.date BETWEEN current_date - 45 AND current_date + $4::int
       ORDER BY t.date, t.id LIMIT 500`,
      [req.user.id, s.include_income, s.lead_days, days],
    );
    res.json({ defaults: { lead_days: s.lead_days, include_income: s.include_income, paused: !!s.paused_until && new Date(s.paused_until) > new Date() }, items: rows });
  }),
);

/** Every override the person has set, with a readable name for what it applies to. */
router.get(
  '/alerts/overrides',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT o.target_type, o.target_id, o.mode, o.days,
              COALESCE(t.description, r.description, p.description, c.name) AS label, t.date::text AS date
       FROM alert_overrides o
       LEFT JOIN transactions t ON o.target_type = 'transaction' AND t.id = o.target_id
       LEFT JOIN recurring_rules r ON o.target_type = 'recurring' AND r.id = o.target_id
       LEFT JOIN installment_plans p ON o.target_type = 'installment' AND p.id = o.target_id
       LEFT JOIN categories c ON o.target_type = 'category' AND c.id = o.target_id
       WHERE o.user_id = $1 ORDER BY o.target_type, label`,
      [req.user.id],
    );
    res.json(rows.filter((r) => r.label));
  }),
);

const overrideSchema = z.object({ mode: z.enum(['on', 'off']), days: z.number().int().min(0).max(60).nullable().optional() });
const target = (req) => {
  const type = z.enum(Object.keys(TARGET_TABLES)).safeParse(req.params.type);
  if (!type.success) throw new HttpError(400, 'Unknown alert target.');
  return [type.data, idParam(req)];
};

router.put(
  '/alerts/:type/:id',
  wrap(async (req, res) => {
    const [type, id] = target(req);
    const body = overrideSchema.parse(req.body);
    if (!(await canAccessTarget(req.user.id, type, id))) throw new HttpError(404, 'Not found.');
    const { rows } = await query(
      `INSERT INTO alert_overrides (user_id, target_type, target_id, mode, days) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET mode = EXCLUDED.mode, days = EXCLUDED.days
       RETURNING target_type, target_id, mode, days`,
      [req.user.id, type, id, body.mode, body.days ?? null],
    );
    res.json(rows[0]);
  }),
);

router.delete(
  '/alerts/:type/:id',
  wrap(async (req, res) => {
    const [type, id] = target(req);
    await query('DELETE FROM alert_overrides WHERE user_id = $1 AND target_type = $2 AND target_id = $3', [req.user.id, type, id]);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- public: one-click unsubscribe from e-mail
publicRouter.post(
  '/unsubscribe',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyFn: (req) => req.ip }),
  wrap(async (req, res) => {
    const token = req.body?.token ?? req.query.token;
    const payload = await verifyToken(token);
    if (!payload || payload.p !== 'unsub' || !Number.isInteger(payload.u)) throw new HttpError(400, 'This link is not valid.');
    await query('INSERT INTO notification_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [payload.u]);
    await query('UPDATE notification_settings SET email_enabled = false WHERE user_id = $1', [payload.u]);
    res.json({ ok: true });
  }),
);

export default router;
