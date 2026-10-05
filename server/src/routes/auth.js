import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { verificationEmail } from '../lib/emailTemplates.js';
import { appUrl, mailMode, sendMail } from '../lib/mailer.js';
import { notify } from '../lib/notifications.js';
import { z } from 'zod';
import { query } from '../db.js';
import { createUser, signInWithGoogleProfile } from '../lib/accounts.js';
import { createSession, destroySession, publicUser, rateLimit, requireAuth } from '../lib/auth.js';
import { HttpError, wrap } from '../lib/http.js';
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '../lib/password.js';
import { phoneField, usernameField } from '../lib/profile.js';

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const email = z.string().trim().toLowerCase().email('must be a valid email address').max(254);
const nameField = z.string().trim().min(1, 'is required').max(80);

const attemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyFn: (req) => `${req.ip}:${normalizeLogin(req.body?.identifier ?? req.body?.email)}`,
});
// Once the account is known, guesses are counted against the account itself, so alternating between its email and its username
// does not give anyone twice the attempts.
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyFn: (req) => `${req.ip}:account:${req.loginUserId}`,
});
const limitAccount = (req, res, userId) =>
  new Promise((resolve, reject) => {
    req.loginUserId = userId;
    accountLimiter(req, res, (err) => (err ? reject(err) : resolve()));
  });
const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyFn: (req) => req.ip });

/** What was typed to sign in, tidied: trimmed, lower case, and a leading @ dropped from a username ("@alex" is "alex"). */
function normalizeLogin(value) {
  const v = String(value ?? '').trim().toLowerCase().slice(0, 300);
  return v.startsWith('@') && !v.slice(1).includes('@') ? v.slice(1) : v;
}

function passwordProblems(res, problems) {
  return res.status(400).json({ error: 'That password does not meet the requirements.', problems });
}

async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new HttpError(503, 'Google sign-in is not configured on this server.');
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    return ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Google sign-in could not be verified. Please try again.');
  }
}

router.get('/config', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: publicUser(req.user) });
});

router.get(
  '/username-available',
  ipLimiter,
  wrap(async (req, res) => {
    const parsed = usernameField.safeParse(String(req.query.u ?? ''));
    if (!parsed.success) return res.json({ available: false, reason: parsed.error.issues[0].message });
    const { rowCount } = await query('SELECT 1 FROM users WHERE lower(username) = $1', [parsed.data]);
    res.json({ available: !rowCount, reason: rowCount ? 'That username is taken.' : null });
  }),
);

router.post(
  '/signup',
  attemptLimiter,
  wrap(async (req, res) => {
    const body = z
      .object({ name: nameField, email, username: usernameField, phone: phoneField, password: z.string().max(1000) })
      .parse(req.body);
    const problems = validatePassword(body.password, body);
    if (problems.length) return passwordProblems(res, problems);

    let user;
    try {
      user = await createUser({
        email: body.email,
        name: body.name,
        username: body.username,
        phone: body.phone,
        passwordHash: await hashPassword(body.password),
      });
    } catch (err) {
      if (err.code === '23505') {
        if (/username/.test(err.constraint ?? '')) throw new HttpError(409, 'That username is taken.');
        if (/phone/.test(err.constraint ?? '')) throw new HttpError(409, 'That phone number is already used by another account.');
        throw new HttpError(409, 'An account with this email already exists. Try signing in.');
      }
      throw err;
    }
    await createSession(req, res, user.id);
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  '/login',
  attemptLimiter,
  wrap(async (req, res) => {
    // The person types an email address or a username. `identifier` is the field; `email` is its old name and still works.
    const body = z
      .object({
        identifier: z.string().trim().min(1, 'is required').max(254).optional(),
        email: z.string().trim().min(1, 'is required').max(254).optional(),
        password: z.string().min(1).max(1000),
      })
      .refine((b) => b.identifier || b.email, { path: ['identifier'], message: 'Enter your email address or username.' })
      .parse(req.body);
    const typed = normalizeLogin(body.identifier ?? body.email);
    const byEmail = typed.includes('@'); // usernames never contain an @
    if (byEmail && !email.safeParse(typed).success) throw new HttpError(400, 'Enter a valid email address or a username.');
    const { rows } = await query(`SELECT * FROM users WHERE lower(${byEmail ? 'email' : 'username'}) = $1`, [typed]);
    const user = rows[0];
    if (user) await limitAccount(req, res, user.id);
    const ok = user?.password_hash ? await verifyPassword(body.password, user.password_hash) : false;
    if (!user?.password_hash) await verifyAgainstDummy(body.password);
    if (!ok) throw new HttpError(401, 'Invalid email, username or password.');
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await createSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  wrap(async (req, res) => {
    await destroySession(req, res);
    res.status(204).end();
  }),
);

// Google sign-in AND sign-up: the same call creates the account the first time.
router.post(
  '/google',
  ipLimiter,
  wrap(async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(20).max(5000) }).parse(req.body);
    const profile = await verifyGoogleCredential(credential);
    const { user, created } = await signInWithGoogleProfile(profile, { query });
    await createSession(req, res, user.id);
    res.status(created ? 201 : 200).json({ user: publicUser(user), created });
  }),
);

// ---- signed-in account management ----
router.post(
  '/google/link',
  requireAuth,
  ipLimiter,
  wrap(async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(20).max(5000) }).parse(req.body);
    const profile = await verifyGoogleCredential(credential);
    const taken = await query('SELECT id FROM users WHERE google_id = $1 AND id <> $2', [profile.sub, req.user.id]);
    if (taken.rows[0]) throw new HttpError(409, 'That Google account is already connected to another user.');
    const { rows } = await query(
      'UPDATE users SET google_id = $1, google_picture = $2, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3 RETURNING *',
      [profile.sub, profile.picture ?? null, req.user.id],
    );
    await notify(req.user.id, { kind: 'security', title: 'A Google account was connected', body: 'You can now sign in with Google. If this was not you, change your password.', link: '/settings?tab=account', dedupeKey: `google-link:${Date.now()}` });
    res.json({ user: publicUser(rows[0]) });
  }),
);

router.delete(
  '/google',
  requireAuth,
  wrap(async (req, res) => {
    if (!req.user.password_hash) throw new HttpError(400, 'Set a password first, otherwise you could not sign in again.');
    const { rows } = await query('UPDATE users SET google_id = NULL WHERE id = $1 RETURNING *', [req.user.id]);
    await notify(req.user.id, { kind: 'security', title: 'Google sign-in was disconnected', body: 'You now sign in with your email and password only.', link: '/settings?tab=account', dedupeKey: `google-unlink:${Date.now()}` });
    res.json({ user: publicUser(rows[0]) });
  }),
);

router.put(
  '/password',
  requireAuth,
  attemptLimiter,
  wrap(async (req, res) => {
    const body = z
      .object({ current_password: z.string().max(1000).optional(), new_password: z.string().max(1000) })
      .parse(req.body);
    if (req.user.password_hash) {
      const ok = body.current_password && (await verifyPassword(body.current_password, req.user.password_hash));
      if (!ok) throw new HttpError(401, 'Your current password is not correct.');
    }
    const problems = validatePassword(body.new_password, req.user);
    if (problems.length) return passwordProblems(res, problems);
    const { rows } = await query('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *', [
      await hashPassword(body.new_password),
      req.user.id,
    ]);
    // Sign out every other device.
    await query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, req.sessionHash]);
    await notify(req.user.id, { kind: 'security', title: 'Your password was changed', body: 'Other devices were signed out. If this was not you, reset your password and check your account.', link: '/settings?tab=account', dedupeKey: `password:${Date.now()}` });
    res.json({ user: publicUser(rows[0]) });
  }),
);

// ---- e-mail confirmation (needed before e-mail alerts can be switched on) ----
const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const verifyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, keyFn: (req) => `verifymail:${req.user?.id ?? req.ip}`, message: 'Too many confirmation e-mails. Try again in an hour.' });

router.post(
  '/email/send-verification',
  requireAuth,
  verifyLimiter,
  wrap(async (req, res) => {
    const user = (await query('SELECT id, name, email, email_verified_at FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (user.email_verified_at) return res.json({ verified: true });
    const token = randomBytes(32).toString('base64url');
    await query(`DELETE FROM email_tokens WHERE user_id = $1 AND purpose = 'verify'`, [user.id]);
    await query(`INSERT INTO email_tokens (token_hash, user_id, purpose, email, expires_at) VALUES ($1, $2, 'verify', $3, now() + interval '24 hours')`, [sha256(token), user.id, user.email]);
    const link = `${appUrl()}/verify-email?token=${token}`;
    const mail = verificationEmail({ name: user.name, link });
    try {
      const r = await sendMail({ to: user.email, ...mail });
      await query(`INSERT INTO email_log (user_id, to_email, subject, kind, status) VALUES ($1, $2, $3, 'verify', $4)`, [user.id, user.email, mail.subject, r.status]);
    } catch (err) {
      await query(`INSERT INTO email_log (user_id, to_email, subject, kind, status, error) VALUES ($1, $2, $3, 'verify', 'failed', $4)`, [user.id, user.email, mail.subject, err.message.slice(0, 300)]);
      throw new HttpError(502, 'The confirmation e-mail could not be sent. Check the mail server settings.');
    }
    // Without a mail server nothing leaves this machine, so the link is handed back for local testing.
    res.json({ sent: true, mode: mailMode(), ...(mailMode() === 'preview' ? { dev_link: link } : {}) });
  }),
);

router.post(
  '/email/verify',
  ipLimiter,
  wrap(async (req, res) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const { rows } = await query(`DELETE FROM email_tokens WHERE token_hash = $1 AND purpose = 'verify' AND expires_at > now() RETURNING user_id, email`, [sha256(token)]);
    if (!rows[0]) throw new HttpError(400, 'This confirmation link is not valid or has expired.');
    await query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 AND lower(email) = lower($2)', [rows[0].user_id, rows[0].email]);
    await notify(rows[0].user_id, { kind: 'system', title: 'E-mail address confirmed', body: 'You can now turn on e-mail alerts for upcoming payments.', link: '/notifications?tab=settings', dedupeKey: `verified:${Date.now()}` });
    res.json({ ok: true });
  }),
);

export default router;
