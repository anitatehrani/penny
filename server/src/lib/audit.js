import { createHmac } from 'node:crypto';
import { query } from '../db.js';
import { getSecret } from './secret.js';

/** Everything the audit log can say, in the words the admin sees (docs/DESIGN.md section 33). `tone` colours the badge. */
export const EVENT_KINDS = {
  signup: { label: 'Signed up', tone: 'ok' },
  login: { label: 'Signed in', tone: '' },
  login_failed: { label: 'Failed sign-in', tone: 'warn' },
  login_blocked: { label: 'Sign-in blocked (suspended)', tone: 'neg' },
  google_signin: { label: 'Signed in with Google', tone: '' },
  google_signup: { label: 'Signed up with Google', tone: 'ok' },
  password_changed: { label: 'Changed password', tone: '' },
  email_verified: { label: 'Confirmed e-mail', tone: 'ok' },
  rate_limited: { label: 'Turned away (too many tries)', tone: 'warn' },
  admin_suspend: { label: 'Suspended by an admin', tone: 'neg' },
  admin_unsuspend: { label: 'Reinstated by an admin', tone: 'ok' },
  admin_signout: { label: 'Signed out everywhere by an admin', tone: '' },
  admin_delete: { label: 'Account deleted by an admin', tone: 'neg' },
  admin_impersonate_start: { label: 'An admin viewed their account', tone: 'warn' },
  admin_impersonate_stop: { label: 'An admin stopped viewing their account', tone: '' },
  admin_acted_as: { label: 'An admin made a change as them', tone: 'neg' },
  admin_grant: { label: 'Made an admin', tone: 'warn' },
  admin_revoke: { label: 'No longer an admin', tone: '' },
};

/** A short hash of where a request came from: enough to see that many failures came from one place, not enough to say who or where. */
export async function sourceTag(req) {
  const ip = req?.ip || req?.socket?.remoteAddress || '';
  if (!ip) return null;
  return createHmac('sha256', await getSecret()).update(String(ip)).digest('hex').slice(0, 10);
}

/**
 * Write one event. Never throws and never makes the request wait for a failure: a log that cannot be written must not stop a person signing in.
 * `detail` is a short sentence; it is cut to 300 characters and must never hold what a person typed.
 */
export async function record(kind, { req, userId = null, actorId = null, detail = null } = {}) {
  try {
    const source = req ? await sourceTag(req) : null;
    await query('INSERT INTO audit_events (kind, user_id, actor_id, source, detail) VALUES ($1, $2, $3, $4, $5)', [kind, userId, actorId, source, detail ? String(detail).slice(0, 300) : null]);
  } catch (err) {
    console.error('audit: could not record', kind, '-', err.message);
  }
}

export const AUDIT_DAYS = 90;
export const pruneAuditEvents = (db = { query }) => db.query(`DELETE FROM audit_events WHERE at < now() - make_interval(days => $1)`, [AUDIT_DAYS]);
