import { pool, query, withTransaction } from '../db.js';
import { alertEmail, formatMoney } from './emailTemplates.js';
import { forecastForWorkspace } from './forecastService.js';
import { appUrl, sendMail } from './mailer.js';
import { addDays, addMonthsYM, monthOf, monthStart, todayYMD } from './dates.js';
import { budgetForMonth } from './budget.js';
import { buildInsights, gatherFacts, makeFmt, monthName, periodFigures } from './insights.js';
import { signToken } from './secret.js';
import { catName } from './categoryNames.js';
import { languageOfUser, localeOf, runForUser, runWithLanguage, t, tn } from './i18n.js';

/** Which in-app switch controls each kind of notification (null = always shown). */
export const KIND_PREF = {
  payment_due: 'due_soon',
  payment_overdue: 'overdue',
  balance_warning: 'balance_warning',
  forecast_warning: 'forecast_warning',
  budget_alert: 'budget_alerts',
  ai_insight: 'ai_insights',
  summary_weekly: 'weekly_summary',
  summary_monthly: 'monthly_summary',
  security: 'security_alerts',
  connection_request: 'friend_requests',
  connection_accepted: 'friend_requests',
  group_invite: 'group_invites',
  group_change: 'group_invites',
  payment_shared: 'shared_payments',
  group_activity: 'group_activity',
  system: null,
};
/** Which e-mail switch controls each kind (null = never e-mailed). */
export const KIND_EMAIL_PREF = {
  payment_due: 'email_due',
  payment_overdue: 'email_overdue',
  balance_warning: 'email_balance',
  forecast_warning: 'email_forecast',
  budget_alert: null, // in the app only
  ai_insight: 'email_ai',
  summary_weekly: 'email_weekly',
  summary_monthly: 'email_monthly',
  security: 'email_security',
  connection_request: 'email_social',
  connection_accepted: 'email_social',
  group_invite: 'email_social',
  group_change: 'email_social',
  payment_shared: 'email_social',
  group_activity: 'email_group_activity',
  system: null,
};
export const KINDS = Object.keys(KIND_PREF);
/** Time-sensitive kinds are silenced while alerts are paused; social events still arrive. */
const PAUSABLE = new Set(['payment_due', 'payment_overdue', 'balance_warning', 'forecast_warning', 'budget_alert', 'ai_insight', 'summary_weekly', 'summary_monthly', 'group_activity']);

export async function getSettings(userId, db = pool) {
  await db.query('INSERT INTO notification_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  return (await db.query('SELECT * FROM notification_settings WHERE user_id = $1', [userId])).rows[0];
}

const isPaused = (s) => !!s.paused_until && new Date(s.paused_until) > new Date();

/** A title or body may be a function: it is called when the notification is stored, in the language of the person who gets it. */
async function insertNotification(db, userId, n) {
  const lang = await languageOfUser(userId);
  const text = (v) => (typeof v === 'function' ? runWithLanguage(lang, v) : v);
  const title = text(n.title);
  const body = text(n.body);
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, data, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [userId, n.kind, title.slice(0, 200), body?.slice(0, 500) ?? null, n.link ?? null, JSON.stringify(n.data ?? {}), n.dedupeKey ?? null],
  );
  return rows[0]?.id ?? null;
}

/**
 * Create one notification for a user, if they have that kind switched on. Repeating the same dedupeKey does nothing,
 * so events can be reported more than once without piling up. Returns the id, or null if nothing was created.
 */
export async function notify(userId, n, { db = pool } = {}) {
  const s = await getSettings(userId, db);
  const pref = KIND_PREF[n.kind];
  if (pref && !s[pref]) return null;
  if (PAUSABLE.has(n.kind) && isPaused(s)) return null;
  const id = await insertNotification(db, userId, n);
  if (id && s.email_enabled && s.email_frequency === 'instant') scheduleInstantEmail(userId);
  return id;
}

export const notifyMany = (userIds, n, opts) => Promise.all([...new Set(userIds)].map((id) => notify(id, n, opts)));

/** Mark a notification as dealt with (e.g. the friend request was answered). */
export const resolveNotification = (userId, dedupeKey) =>
  query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND dedupe_key = $2', [userId, dedupeKey]);

/** Mark a person's notifications of one kind as dealt with, matching a value stored in the notification's data. */
export const resolveByData = (userId, kind, field, value) =>
  query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND kind = $2 AND data ->> $3 = $4', [userId, kind, field, String(value)]);
export const removeByData = (userId, kind, field, value) =>
  query('DELETE FROM notifications WHERE user_id = $1 AND kind = $2 AND data ->> $3 = $4', [userId, kind, field, String(value)]);

/** Remove a notification whose subject no longer exists (e.g. the request was withdrawn). */
export const removeNotification = (userId, dedupeKey) => query('DELETE FROM notifications WHERE user_id = $1 AND dedupe_key = $2', [userId, dedupeKey]);

/** Due/overdue notifications for payments that were paid, deleted or moved are no longer something to act on. */
export async function resolveStale(userId = null) {
  await query(
    `UPDATE notifications n SET read_at = now()
     WHERE n.read_at IS NULL AND n.kind IN ('payment_due', 'payment_overdue') AND ($1::int IS NULL OR n.user_id = $1)
       AND NOT EXISTS (SELECT 1 FROM transactions t
                       WHERE t.id = (n.data ->> 'transaction_id')::int AND t.status = 'pending' AND t.date::text = n.data ->> 'date')`,
    [userId],
  );
}

// ------------------------------------------------------------------------------------------------
// e-mail
// ------------------------------------------------------------------------------------------------
export async function unsubscribeUrlFor(userId) {
  return `${appUrl()}/unsubscribe?token=${await signToken({ u: userId, p: 'unsub' })}`;
}
/** The API address mail clients POST to for one-click unsubscribe (the page link above is for people). */
export async function oneClickUnsubscribeUrl(userId) {
  return `${appUrl()}/api/unsubscribe?token=${await signToken({ u: userId, p: 'unsub' })}`;
}

const timers = new Map();
/** Instant mode: wait a moment so several events that arrive together go out as one e-mail. */
function scheduleInstantEmail(userId) {
  if (timers.has(userId)) return;
  const tt = setTimeout(() => {
    timers.delete(userId);
    sendPendingEmails(userId, { trigger: 'instant' }).catch((e) => console.error('instant e-mail failed:', e.message));
  }, 1500);
  tt.unref?.();
  timers.set(userId, tt);
}

async function localTime(tz) {
  const { rows } = await query(`SELECT extract(hour FROM (now() AT TIME ZONE $1))::int AS hour, to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS today`, [tz]);
  return rows[0];
}

async function logEmail(userId, to, subject, kind, status, error = null) {
  await query('INSERT INTO email_log (user_id, to_email, subject, kind, status, error) VALUES ($1, $2, $3, $4, $5, $6)', [userId, to, subject, kind, status, error?.slice(0, 300) ?? null]);
}

/**
 * Send the user's waiting alerts by e-mail, if they asked for e-mail and verified their address.
 * trigger: 'scan' (the periodic job: sends the daily digest when it is time, or instant mail) | 'instant' (just after an event).
 */
export async function sendPendingEmails(userId, { trigger = 'scan' } = {}) {
  return runForUser(userId, () => sendPendingEmailsIn(userId, trigger));
}

async function sendPendingEmailsIn(userId, trigger) {
  return withTransaction(async (client) => {
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(7002, $1) AS ok', [userId]);
    if (!lock.rows[0].ok) return { sent: 0, reason: 'busy' };
    const s = await getSettings(userId, client);
    const user = (await client.query('SELECT id, name, email, email_verified_at FROM users WHERE id = $1', [userId])).rows[0];
    if (!user || !s.email_enabled || !user.email_verified_at) return { sent: 0, reason: 'off' };

    const local = await localTime(s.timezone);
    if (s.email_frequency === 'daily') {
      if (trigger !== 'scan') return { sent: 0, reason: 'daily' };
      const doneToday = s.last_digest_on && String(s.last_digest_on).slice(0, 10) >= local.today;
      if (local.hour < s.email_hour || doneToday) return { sent: 0, reason: 'not time' };
    }

    const kinds = KINDS.filter((k) => KIND_EMAIL_PREF[k] && s[KIND_EMAIL_PREF[k]] && !(PAUSABLE.has(k) && isPaused(s)));
    if (!kinds.length) return { sent: 0, reason: 'no kinds' };
    const items = (
      await client.query(
        `SELECT id, kind, title, body, link, data FROM notifications
         WHERE user_id = $1 AND emailed_at IS NULL AND read_at IS NULL AND created_at > now() - interval '3 days' AND kind = ANY($2)
         ORDER BY created_at LIMIT 50`,
        [userId, kinds],
      )
    ).rows;
    if (!items.length) return { sent: 0, reason: 'nothing' };

    const mail = alertEmail({ name: user.name, items, today: local.today, unsubscribeUrl: await unsubscribeUrlFor(userId) });
    const unsub = await oneClickUnsubscribeUrl(userId);
    try {
      const res = await sendMail({
        to: user.email,
        ...mail,
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      await logEmail(userId, user.email, mail.subject, 'alert', res.status);
    } catch (err) {
      await logEmail(userId, user.email, mail.subject, 'alert', 'failed', err.message);
      return { sent: 0, error: err.message };
    }
    await client.query('UPDATE notifications SET emailed_at = now() WHERE id = ANY($1)', [items.map((i) => i.id)]);
    if (s.email_frequency === 'daily') await client.query('UPDATE notification_settings SET last_digest_on = $2 WHERE user_id = $1', [userId, local.today]);
    return { sent: items.length };
  });
}

// ------------------------------------------------------------------------------------------------
// the periodic scan
// ------------------------------------------------------------------------------------------------
const nice = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(localeOf(), { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Look for payments that are due soon or overdue, and budgets heading below zero, and notify the people concerned.
 * Per-person overrides decide which payments count: payment > recurring item / installment plan > category > default.
 */
export async function runAlertScan({ userId = null } = {}) {
  let created = 0;
  await resolveStale(userId);

  const { rows } = await query(
    `WITH me AS (
       SELECT u.id AS user_id,
              COALESCE(s.timezone, 'UTC') AS tz,
              COALESCE(s.lead_days, 3) AS lead,
              COALESCE(s.include_income, false) AS inc,
              COALESCE(s.due_soon, true) AS want_due,
              COALESCE(s.overdue, true) AS want_overdue
       FROM users u LEFT JOIN notification_settings s ON s.user_id = u.id
       WHERE ($1::int IS NULL OR u.id = $1) AND (s.paused_until IS NULL OR s.paused_until <= now())
     )
     SELECT me.user_id, me.want_due, me.want_overdue, t.id AS transaction_id, t.description, t.amount, t.type, t.date::text AS date,
            t.workspace_id, w.name AS workspace, w.kind AS workspace_kind, COALESCE(ws.currency, 'USD') AS currency,
            to_char(now() AT TIME ZONE me.tz, 'YYYY-MM-DD') AS today,
            (t.date - (now() AT TIME ZONE me.tz)::date) AS days_left,
            COALESCE(ot.mode, orr.mode, op.mode, oc.mode, CASE WHEN t.type = 'income' AND NOT me.inc THEN 'off' ELSE 'on' END) AS mode,
            COALESCE(ot.days, orr.days, op.days, oc.days, me.lead) AS days
     FROM me
     JOIN workspace_members m ON m.user_id = me.user_id
     JOIN transactions t ON t.workspace_id = m.workspace_id AND t.status = 'pending'
     JOIN workspaces w ON w.id = t.workspace_id
     LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
     LEFT JOIN alert_overrides ot  ON ot.user_id  = me.user_id AND ot.target_type  = 'transaction' AND ot.target_id  = t.id
     LEFT JOIN alert_overrides orr ON orr.user_id = me.user_id AND orr.target_type = 'recurring'   AND orr.target_id = t.recurring_id
     LEFT JOIN alert_overrides op  ON op.user_id  = me.user_id AND op.target_type  = 'installment' AND op.target_id  = t.installment_plan_id
     LEFT JOIN alert_overrides oc  ON oc.user_id  = me.user_id AND oc.target_type  = 'category'    AND oc.target_id  = t.category_id
     WHERE t.date BETWEEN (now() AT TIME ZONE me.tz)::date - 45 AND (now() AT TIME ZONE me.tz)::date + 60`,
    [userId],
  );

  for (const r of rows) {
    if (r.mode !== 'on') continue;
    const overdue = r.days_left < 0;
    if (overdue ? !r.want_overdue : !r.want_due || r.days_left > r.days) continue;
    const data = { transaction_id: r.transaction_id, description: r.description, amount: r.amount, currency: r.currency, type: r.type, date: r.date, workspace_id: r.workspace_id, workspace: r.workspace_kind === 'group' ? r.workspace : null };
    const id = await insertNotification(pool, r.user_id, {
      kind: overdue ? 'payment_overdue' : 'payment_due',
      title: () =>
        overdue
          ? t('{description} is overdue', { description: r.description })
          : r.days_left === 0
            ? t('{description} is due today', { description: r.description })
            : r.days_left === 1
              ? t('{description} is due tomorrow', { description: r.description })
              : t('{description} is due on {date}', { description: r.description, date: nice(r.date) }),
      body: () => `${formatMoney(r.amount, r.currency)}${r.workspace_kind === 'group' ? ` · ${r.workspace}` : ''}`,
      link: `/payments?month=${r.date.slice(0, 7)}`,
      data,
      dedupeKey: `${overdue ? 'overdue' : 'due'}:${r.transaction_id}:${r.date}`,
    });
    if (id) created += 1;
  }

  created += await scanBalances(userId);
  created += await scanBudgets(userId);
  created += await scanInsights(userId);

  // e-mail whoever wants it (daily digests when it is their time, instant mail for the rest)
  const mailUsers = await query(`SELECT user_id FROM notification_settings WHERE email_enabled AND ($1::int IS NULL OR user_id = $1)`, [userId]);
  for (const u of mailUsers.rows) await sendPendingEmails(u.user_id, { trigger: 'scan' }).catch((e) => console.error('e-mail failed:', e.message));

  if (userId === null) await housekeeping();
  return { created };
}

/**
 * Tell people when a category of this month's budget is nearly used up (80%) or over (100%), once for each, in the app. Whoever is in the
 * budget and has budget alerts on is told; a budget with no limits set costs nothing here.
 */
async function scanBudgets(userId) {
  let created = 0;
  const month = monthOf(todayYMD());
  const { rows: spaces } = await query(
    `SELECT w.id, w.name, w.kind,
            COALESCE((SELECT json_agg(m.user_id) FROM workspace_members m LEFT JOIN notification_settings s ON s.user_id = m.user_id
                      WHERE m.workspace_id = w.id AND COALESCE(s.budget_alerts, true) AND (s.paused_until IS NULL OR s.paused_until <= now())
                        AND ($1::int IS NULL OR m.user_id = $1)), '[]'::json) AS users
     FROM workspaces w
     WHERE EXISTS (SELECT 1 FROM category_budgets b WHERE b.workspace_id = w.id)
       AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND ($1::int IS NULL OR m.user_id = $1))`,
    [userId],
  );
  for (const w of spaces) {
    if (!w.users.length) continue;
    const view = await budgetForMonth(w.id, month);
    for (const l of view.lines) {
      if (l.budget === null || l.id === null) continue;
      const over = l.spent > l.budget + 0.005;
      const near = !over && l.budget > 0 && l.spent >= 0.8 * l.budget;
      if (!over && !near) continue;
      const level = over ? 100 : 80;
      for (const uid of w.users) {
        const monthText = () => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(localeOf(), { month: 'long', timeZone: 'UTC' });
        const where = () => (w.kind === 'group' ? ` · ${w.name}` : '');
        const id = await insertNotification(pool, uid, {
          kind: 'budget_alert',
          title: () => (over ? t('{name} is over its budget', { name: catName(l.name) }) : t('{name} has used {percent}% of its budget', { name: catName(l.name), percent: l.percent })),
          body: () =>
            over
              ? t('{spent} spent of {budget} for {month}.{where}', { spent: formatMoney(l.spent, view.currency), budget: formatMoney(l.budget, view.currency), month: monthText(), where: where() })
              : t('{left} left of {budget} for {month}.{where}', { left: formatMoney(l.left, view.currency), budget: formatMoney(l.budget, view.currency), month: monthText(), where: where() }),
          link: '/budget',
          data: { workspace_id: w.id, category_id: l.id, month, level, spent: l.spent, budget: l.budget },
          dedupeKey: `budget:${w.id}:${l.id}:${month}:${level}`,
        });
        if (id) created += 1;
      }
    }
  }
  return created;
}

async function scanBalances(userId) {
  let created = 0;
  const { rows: wanting } = await query(
    `SELECT m.workspace_id, w.name, w.kind,
            json_agg(json_build_object('id', m.user_id, 'low', COALESCE(s.balance_warning, true), 'forecast', COALESCE(s.forecast_warning, true))) AS users
     FROM workspace_members m
     JOIN workspaces w ON w.id = m.workspace_id
     LEFT JOIN notification_settings s ON s.user_id = m.user_id
     WHERE (COALESCE(s.balance_warning, true) OR COALESCE(s.forecast_warning, true)) AND (s.paused_until IS NULL OR s.paused_until <= now())
       AND ($1::int IS NULL OR m.user_id = $1)
       AND EXISTS (SELECT 1 FROM transactions t WHERE t.workspace_id = m.workspace_id AND t.status = 'pending')
     GROUP BY m.workspace_id, w.name, w.kind`,
    [userId],
  );
  for (const w of wanting) {
    const f = await forecastForWorkspace(w.workspace_id, { past: 0, months: 6 });
    const warn = f.insights.firstNegativeMonth;
    const now = f.months[0];
    for (const u of w.users) {
      if (f.currentBalance < 0) {
        if (!u.low) continue;
        const id = await insertNotification(pool, u.id, {
          kind: 'balance_warning',
          title: () => t('{label} is below zero', { label: w.kind === 'group' ? w.name : t('Your balance') }),
          body: () => (w.kind === 'group' ? t('Currently {amount} in {name}.', { amount: formatMoney(f.currentBalance, f.currency), name: w.name }) : t('Currently {amount}.', { amount: formatMoney(f.currentBalance, f.currency) })),
          link: '/forecast',
          data: { workspace_id: w.workspace_id, month: now.month, balance: f.currentBalance },
          dedupeKey: `negnow:${w.workspace_id}:${now.month}`,
        });
        if (id) created += 1;
      } else if (f.minBalance > 0 && f.currentBalance < f.minBalance) {
        if (!u.low) continue;
        const id = await insertNotification(pool, u.id, {
          kind: 'balance_warning',
          title: () => t('{label} is below your safety buffer', { label: w.kind === 'group' ? w.name : t('Your balance') }),
          body: () => (w.kind === 'group' ? t('Currently {amount}; your buffer is {buffer} in {name}.', { amount: formatMoney(f.currentBalance, f.currency), buffer: formatMoney(f.minBalance, f.currency), name: w.name }) : t('Currently {amount}; your buffer is {buffer}.', { amount: formatMoney(f.currentBalance, f.currency), buffer: formatMoney(f.minBalance, f.currency) })),
          link: '/forecast',
          data: { workspace_id: w.workspace_id, month: now.month, balance: f.currentBalance, buffer: f.minBalance },
          dedupeKey: `lowbuffer:${w.workspace_id}:${now.month}`,
        });
        if (id) created += 1;
      } else if (warn && u.forecast) {
        const monthLabel = () => new Date(`${warn.month}-15T12:00:00Z`).toLocaleDateString(localeOf(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const id = await insertNotification(pool, u.id, {
          kind: 'forecast_warning',
          title: () => warn.balance < 0 ? t('{value} is projected to go negative in {monthLabel}', { value: w.kind === 'group' ? w.name : t('Your balance'), monthLabel: monthLabel() }) : t('{value} is projected to go below your safety buffer in {monthLabel}', { value: w.kind === 'group' ? w.name : t('Your balance'), monthLabel: monthLabel() }),
          body: () => t('Expected to reach {formatMoney}. Review upcoming payments in the forecast.', { formatMoney: formatMoney(warn.balance, f.currency) }),
          link: '/forecast',
          data: { workspace_id: w.workspace_id, month: warn.month, balance: warn.balance },
          dedupeKey: `balance:${w.workspace_id}:${warn.month}`,
        });
        if (id) created += 1;
      }
    }
  }
  return created;
}

// ------------------------------------------------------------------------------------------------
// assistant insights and weekly / monthly summaries
// ------------------------------------------------------------------------------------------------
const mondayOf = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -back);
};
// Insights the other alerts already cover are left out, so the same warning does not arrive twice.
const COVERED_ELSEWHERE = new Set(['overdue', 'below-zero', 'below-buffer', 'forecast-negative', 'saved', 'savings']);

/**
 * Once a day per person (in their own time zone): tell them about the one or two most useful new insights, and
 * send the weekly / monthly summary when its day comes. Only the person's own (personal) budget is summarised.
 */
async function scanInsights(userId) {
  let created = 0;
  await query('INSERT INTO notification_settings (user_id) SELECT id FROM users WHERE ($1::int IS NULL OR id = $1) ON CONFLICT DO NOTHING', [userId]);
  const { rows } = await query(
    `SELECT s.user_id, s.weekly_day, s.ai_insights, s.weekly_summary, s.monthly_summary, s.last_insight_on::text AS last_insight_on,
            to_char(now() AT TIME ZONE s.timezone, 'YYYY-MM-DD') AS today,
            extract(dow FROM now() AT TIME ZONE s.timezone)::int AS dow,
            (SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
             WHERE m.user_id = s.user_id AND w.kind = 'personal' LIMIT 1) AS ws
     FROM notification_settings s
     WHERE (s.ai_insights OR s.weekly_summary OR s.monthly_summary) AND (s.paused_until IS NULL OR s.paused_until <= now())
       AND ($1::int IS NULL OR s.user_id = $1)`,
    [userId],
  );
  for (const r of rows) {
    created += await runForUser(r.user_id, () => insightsFor(r));
  }
  return created;
}

/** The insights and summaries for one person (called in their language). */
async function insightsFor(r) {
  let created = 0;
  {
    if (!r.ws) return created;
    let facts = null;
    const getFacts = async () => (facts ??= await gatherFacts(r.ws, { today: r.today }));

    if (r.ai_insights && r.last_insight_on !== r.today) {
      const f = await getFacts();
      if (!f.isEmpty) {
        const picks = buildInsights(f)
          .filter((i) => !COVERED_ELSEWHERE.has(i.type) && (i.severity === 'alert' || i.severity === 'watch'))
          .slice(0, 2);
        for (const i of picks) {
          const id = await notify(r.user_id, {
            kind: 'ai_insight',
            title: i.title,
            body: i.body,
            link: i.action?.to ?? '/',
            data: { insight_key: i.key, workspace_id: r.ws },
            dedupeKey: i.type === 'week-ahead' ? `insight:week-ahead:${mondayOf(r.today)}` : `insight:${i.key}`,
          });
          if (id) created += 1;
        }
      }
      await query('UPDATE notification_settings SET last_insight_on = $2 WHERE user_id = $1', [r.user_id, r.today]);
    }

    if (r.weekly_summary) {
      const back = (r.dow - r.weekly_day + 7) % 7;
      if (back <= 1) {
        const boundary = addDays(r.today, -back);
        const f = await getFacts();
        const fmt = makeFmt(f.currency);
        const last = await periodFigures(r.ws, addDays(boundary, -7), boundary);
        const before = await periodFigures(r.ws, addDays(boundary, -14), addDays(boundary, -7));
        const ahead = f.upcoming.filter((u) => u.date < addDays(boundary, 7));
        const aheadTotal = ahead.reduce((sum, u) => sum + u.amount, 0);
        const change = before.expenses >= 20 ? Math.round(((last.expenses - before.expenses) / before.expenses) * 100) : null;
        const id = await notify(r.user_id, {
          kind: 'summary_weekly',
          title: () => t('Your week in review'),
          body: () => {
            const spent = fmt(last.expenses);
            const received = fmt(last.income);
            const pct = change === null ? null : `${change >= 0 ? '+' : '−'}${Math.abs(change)}%`;
            const first =
              pct === null
                ? tn(last.expenseCount, 'You spent {spent} across {n} payment and received {received}.', 'You spent {spent} across {n} payments and received {received}.', { spent, received })
                : tn(last.expenseCount, 'You spent {spent} across {n} payment ({pct} vs the week before) and received {received}.', 'You spent {spent} across {n} payments ({pct} vs the week before) and received {received}.', { spent, received, pct });
            const second = ahead.length ? tn(ahead.length, '{n} payment is due in the coming week ({total}).', '{n} payments are due in the coming week ({total}).', { total: fmt(aheadTotal) }) : t('Nothing is due in the coming week.');
            return `${first} ${second}`;
          },
          link: '/',
          data: { workspace_id: r.ws, from: addDays(boundary, -7), to: boundary },
          dedupeKey: `weekly:${boundary}`,
        });
        if (id) created += 1;
      }
    }

    if (r.monthly_summary && Number(r.today.slice(8)) <= 2) {
      const month = r.today.slice(0, 7);
      const prev = addMonthsYM(month, -1);
      const f = await getFacts();
      const fmt = makeFmt(f.currency);
      const cur = await periodFigures(r.ws, monthStart(prev), monthStart(month));
      const earlier = await periodFigures(r.ws, monthStart(addMonthsYM(month, -2)), monthStart(prev));
      if (cur.income || cur.expenses) {
        const top = (
          await query(
            `SELECT COALESCE(c.name, 'Uncategorized') AS name, sum(t.amount)::float AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.status = 'paid' AND t.date >= $2 AND t.date < $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
            [r.ws, monthStart(prev), monthStart(month)],
          )
        ).rows[0];
        const change = earlier.expenses >= 50 ? Math.round(((cur.expenses - earlier.expenses) / earlier.expenses) * 100) : null;
        const id = await notify(r.user_id, {
          kind: 'summary_monthly',
          title: () => t('{monthName} in review', { monthName: monthName(prev) }),
          body: () => {
            const income = fmt(cur.income);
            const expenses = fmt(cur.expenses);
            const left = fmt(cur.income - cur.expenses);
            const pct = change === null ? null : `${change >= 0 ? '+' : '−'}${Math.abs(change)}%`;
            const first = pct === null ? t('{income} came in and {expenses} went out, which left {left}.', { income, expenses, left }) : t('{income} came in and {expenses} went out ({pct} vs the month before), which left {left}.', { income, expenses, left, pct });
            return top ? `${first} ${t('Biggest category: {name} ({amount}).', { name: catName(top.name), amount: fmt(top.total) })}` : first;
          },
          link: '/',
          data: { workspace_id: r.ws, month: prev },
          dedupeKey: `monthly:${prev}`,
        });
        if (id) created += 1;
      }
    }
  }
  return created;
}

export async function housekeeping() {
  await query(`DELETE FROM notifications WHERE (read_at IS NOT NULL AND read_at < now() - interval '60 days') OR created_at < now() - interval '180 days'`);
  await query(`DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day'`);
  await query(`DELETE FROM email_log WHERE created_at < now() - interval '90 days'`);
  // overrides pointing at things that no longer exist
  await query(`DELETE FROM alert_overrides o WHERE
    (o.target_type = 'transaction' AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.id = o.target_id)) OR
    (o.target_type = 'recurring'   AND NOT EXISTS (SELECT 1 FROM recurring_rules x WHERE x.id = o.target_id)) OR
    (o.target_type = 'installment' AND NOT EXISTS (SELECT 1 FROM installment_plans x WHERE x.id = o.target_id)) OR
    (o.target_type = 'category'    AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.id = o.target_id))`);
}
