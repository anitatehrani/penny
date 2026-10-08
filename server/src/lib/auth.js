import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { record } from './audit.js';
import { HttpError } from './http.js';

export const COOKIE_NAME = 'sid';
/** How long an admin's "view as" lasts (docs/DESIGN.md section 33). After that the session is the admin's own again. */
export const IMPERSONATION_MINUTES = 30;
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      /* malformed %-escape: use the raw text, it will simply not match any session */
    }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}

const isSecure = (req) =>
  process.env.COOKIE_SECURE === 'true' || req.secure || req.headers['x-forwarded-proto'] === 'https';

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSeconds}`];
  if (isSecure(req)) flags.push('Secure');
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; ${flags.join('; ')}`);
}

export async function createSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [hashToken(token), userId, SESSION_DAYS, String(req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  setSessionCookie(req, res, token, SESSION_DAYS * 86_400);
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  setSessionCookie(req, res, '', 0);
}

/** The signed-in user's own account (never sent to anyone else). */
export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  username: u.username,
  phone: u.phone ?? null,
  avatar_url: u.avatar_url,
  email_verified: !!u.email_verified_at,
  discoverable: u.discoverable,
  show_status: u.show_status,
  find_by_email: u.find_by_email,
  find_by_phone: u.find_by_phone,
  has_password: !!u.password_hash,
  google_linked: !!u.google_id,
  is_admin: !!u.is_admin,
});

/** Attach req.user when the request carries a valid session cookie (does not reject anonymous requests). */
const lastSeenWritten = new Map(); // user id -> ms of the last write, so "active now" costs one update a minute

export async function authenticate(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      const { rows } = await query(
        `SELECT u.*, s.expires_at, s.acting_as, s.acting_started_at, s.acting_read_only, s.acting_reason
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      );
      // A suspended account has no sessions (suspending ends them), and one that somehow still has one is treated as signed out.
      if (rows[0] && !rows[0].suspended_at) {
        req.user = rows[0];
        req.sessionHash = hashToken(token);
        // An admin who is "viewing as" somebody: for this request the user IS that person (their budgets, their view), and `req.admin` is the
        // real admin. It ends by itself after IMPERSONATION_MINUTES, or when the admin stops being an admin.
        if (rows[0].acting_as) {
          const endsAt = new Date(rows[0].acting_started_at).getTime() + IMPERSONATION_MINUTES * 60_000;
          const target = rows[0].is_admin && Date.now() < endsAt ? (await query('SELECT * FROM users WHERE id = $1', [rows[0].acting_as])).rows[0] : null;
          if (target && !target.is_admin) {
            req.admin = rows[0];
            req.user = target;
            req.impersonation = { reason: rows[0].acting_reason, read_only: rows[0].acting_read_only, started_at: rows[0].acting_started_at, expires_at: new Date(endsAt).toISOString(), admin_id: rows[0].id, admin_name: rows[0].name };
          } else {
            await clearActing(req.sessionHash);
          }
        }
        // "active now" is about the person at the keyboard (the session's owner), so a person who is only being looked at is never marked active
        if (!['/health'].includes(req.path) && Date.now() - (lastSeenWritten.get(rows[0].id) ?? 0) > 60_000) {
          lastSeenWritten.set(rows[0].id, Date.now());
          query('UPDATE users SET last_seen_at = now() WHERE id = $1', [rows[0].id]).catch(() => {});
        }
        // Sliding expiry: renew at most once a day.
        if (new Date(rows[0].expires_at).getTime() - Date.now() < (SESSION_DAYS - 1) * DAY_MS) {
          await query('UPDATE sessions SET expires_at = now() + make_interval(days => $2) WHERE token_hash = $1', [
            req.sessionHash,
            SESSION_DAYS,
          ]);
          setSessionCookie(req, res, token, SESSION_DAYS * 86_400);
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** End an admin's "view as" on this session. */
export const clearActing = (sessionHash) =>
  query('UPDATE sessions SET acting_as = NULL, acting_started_at = NULL, acting_read_only = true, acting_reason = NULL WHERE token_hash = $1', [sessionHash]);

// While an admin is viewing as somebody, every request that changes something is checked here, on the server (the page only hides buttons).
// Read-only (the default): nothing changes at all. With "allow changes": only the person's budget data, never who they are, how they sign
// in, their friends, their budgets' members, or what they are told, so viewing as someone can never become taking over their account.
const ACTING_WRITES = ['/api/transactions', '/api/recurring', '/api/installments', '/api/debts', '/api/categories', '/api/settings', '/api/card-bills', '/api/reconcile'];
const ACTING_ALWAYS = ['/api/auth/impersonation/stop', '/api/auth/logout', '/api/assistant/ask']; // ending it, and a question that only reads

export function impersonationGuard(req, _res, next) {
  const imp = req.impersonation;
  if (!imp || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.baseUrl + req.path;
  if (ACTING_ALWAYS.includes(path)) return next();
  if (imp.read_only) return next(new HttpError(403, 'You are viewing this account in read-only mode, so nothing can be changed. Exit to go back to your own account.'));
  if (!ACTING_WRITES.some((p) => path === p || path.startsWith(`${p}/`))) return next(new HttpError(403, 'That cannot be done while viewing as someone else.'));
  record('admin_acted_as', { req, userId: req.user.id, actorId: req.admin.id, detail: `${req.method} ${path}` });
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  next();
}

/**
 * Only admins (docs/DESIGN.md section 33). Everyone else gets "not found", the same as for a page that does not exist, so the admin API
 * does not announce itself. Being an admin is a column that only the command line sets.
 */
export function requireAdmin(req, _res, next) {
  if (!req.user?.is_admin) return next(new HttpError(404, 'Not found'));
  next();
}

/** CSRF defence for cookie auth: state-changing requests must come from our own origin. */
export function sameOriginOnly(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new HttpError(403, 'Bad origin.'));
    }
    if (host !== req.headers.host) return next(new HttpError(403, 'Cross-site request blocked.'));
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    return next(new HttpError(403, 'Cross-site request blocked.'));
  }
  next();
}

/** Tiny in-memory limiter: `max` hits per `windowMs` for the key returned by `keyFn`. */
export function rateLimit({ windowMs, max, keyFn, message = 'Too many attempts. Please wait a few minutes and try again.', onLimit }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      if (entry.count === max + 1) onLimit?.(req); // once per window, so a flood does not become a flood of log lines
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return next(new HttpError(429, message));
    }
    next();
  };
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= now()');
}
