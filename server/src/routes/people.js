import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { rateLimit } from '../lib/auth.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { notify, removeByData, resolveByData } from '../lib/notifications.js';
import { briefUser, normalizePhone, usernameField } from '../lib/profile.js';

const router = Router();

const RELATIONS = z.enum(['partner', 'family', 'friend', 'other']);

const lookupLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  keyFn: (req) => `lookup:${req.user.id}`,
  message: 'Too many searches. Please wait a minute.',
});

/** What the person looking sees of their relationship with `otherId`. */
async function connectionWith(meId, otherId) {
  const { rows } = await query(
    `SELECT id, requester_id, status, relation FROM connections
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [meId, otherId],
  );
  const c = rows[0];
  if (!c) return null;
  if (c.status === 'accepted') return { id: c.id, status: 'connected', relation: c.relation };
  if (c.requester_id === meId) return { id: c.id, status: 'request_sent', relation: c.relation }; // declined looks the same
  if (c.status === 'pending') return { id: c.id, status: 'request_received', relation: c.relation };
  return null; // I declined them earlier: treated as no relationship
}

/** Work out whether the search text is a username, e-mail or phone number and find the (visible) match. */
async function findVisibleUser(text) {
  const raw = text.trim();
  if (!raw) return { user: null };
  if (raw.includes('@') && !raw.startsWith('@')) {
    const { rows } = await query(
      `SELECT * FROM users WHERE lower(email) = $1 AND discoverable AND find_by_email`,
      [raw.toLowerCase()],
    );
    return { user: rows[0] ?? null, by: 'email' };
  }
  if (/^[+\d][\d\s().-]{5,}$/.test(raw)) {
    let phone;
    try {
      phone = normalizePhone(raw);
    } catch (e) {
      return { user: null, hint: e.message, by: 'phone' };
    }
    const { rows } = await query(`SELECT * FROM users WHERE phone = $1 AND discoverable AND find_by_phone`, [phone]);
    return { user: rows[0] ?? null, by: 'phone' };
  }
  const parsed = usernameField.safeParse(raw);
  if (!parsed.success) return { user: null, by: 'username' };
  const { rows } = await query(`SELECT * FROM users WHERE lower(username) = $1 AND discoverable`, [parsed.data]);
  return { user: rows[0] ?? null, by: 'username' };
}

// ---- find people (exact match only, never a browsable list) ----
router.get(
  '/people/lookup',
  lookupLimiter,
  wrap(async (req, res) => {
    const { user, hint, by } = await findVisibleUser(String(req.query.q ?? '').slice(0, 120));
    if (!user) return res.json({ result: null, by, hint: hint ?? null });
    if (user.id === req.user.id) return res.json({ result: null, by, hint: 'That is your own profile.' });
    res.json({ result: { ...briefUser(user), connection: await connectionWith(req.user.id, user.id) }, by });
  }),
);

// Public-ish profile card (used by shared profile links /u/:username).
router.get(
  '/people/:username',
  lookupLimiter,
  wrap(async (req, res) => {
    const parsed = usernameField.safeParse(req.params.username);
    const { rows } = parsed.success
      ? await query(`SELECT * FROM users WHERE lower(username) = $1`, [parsed.data])
      : { rows: [] };
    const user = rows[0];
    const self = user?.id === req.user.id;
    if (!user || (!user.discoverable && !self)) throw new HttpError(404, 'This profile does not exist or is private.');
    res.json({ profile: { ...briefUser(user), self, connection: self ? null : await connectionWith(req.user.id, user.id) } });
  }),
);

// ---- connections ----
router.get(
  '/connections',
  wrap(async (req, res) => {
    const me = req.user.id;
    const { rows } = await query(
      `SELECT c.id, c.relation, c.status, c.created_at, c.requester_id,
              u.name, u.username, u.avatar_url
       FROM connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = $1 THEN c.addressee_id ELSE c.requester_id END
       WHERE c.requester_id = $1 OR c.addressee_id = $1
       ORDER BY lower(u.name)`,
      [me],
    );
    const shape = (r) => ({ id: r.id, relation: r.relation, created_at: r.created_at, user: briefUser(r) });
    res.json({
      accepted: rows.filter((r) => r.status === 'accepted').map(shape),
      incoming: rows.filter((r) => r.status === 'pending' && r.requester_id !== me).map(shape),
      // A declined request still shows as "waiting" to the sender, so declining is quiet.
      outgoing: rows.filter((r) => r.status !== 'accepted' && r.requester_id === me).map(shape),
    });
  }),
);

/** Tell the addressee about a new request, and the requester when it is accepted. */
async function announceRequest(from, toId, connectionId, relation) {
  await notify(toId, {
    kind: 'connection_request',
    title: `${from.name} wants to connect with you`,
    body: `They added you as their ${relation === 'other' ? 'contact' : relation}.`,
    link: '/people',
    data: { connection_id: connectionId, from: briefUser(from), relation },
    dedupeKey: `conn:${connectionId}:${Date.now()}`,
  });
}
async function announceAccepted(by, requesterId, connectionId) {
  await notify(requesterId, {
    kind: 'connection_accepted',
    title: `${by.name} accepted your request`,
    body: 'You can now add each other to payments and invite each other to shared budgets.',
    link: '/people',
    data: { connection_id: connectionId, from: briefUser(by) },
    dedupeKey: `connacc:${connectionId}:${Date.now()}`,
  });
}

router.post(
  '/connections',
  wrap(async (req, res) => {
    const body = z.object({ username: usernameField, relation: RELATIONS.default('friend') }).parse(req.body);
    const me = req.user.id;
    const { rows: found } = await query(`SELECT id FROM users WHERE lower(username) = $1 AND discoverable`, [body.username]);
    const target = found[0];
    if (!target) throw new HttpError(404, 'No visible user with that username.');
    if (target.id === me) throw new HttpError(400, 'You cannot add yourself.');

    const { rows } = await query(
      `SELECT * FROM connections
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [me, target.id],
    );
    const existing = rows[0];
    if (!existing) {
      const created = await query('INSERT INTO connections (requester_id, addressee_id, relation) VALUES ($1, $2, $3) RETURNING id', [me, target.id, body.relation]);
      await announceRequest(req.user, target.id, created.rows[0].id, body.relation);
      return res.status(201).json({ status: 'request_sent' });
    }
    if (existing.status === 'accepted') throw new HttpError(409, 'You are already connected.');
    if (existing.requester_id === me) throw new HttpError(409, 'You already sent this person a request.');
    // They asked me first (or I declined them earlier).
    if (existing.status === 'pending') {
      await query(`UPDATE connections SET status = 'accepted', relation = $2, responded_at = now() WHERE id = $1`, [existing.id, body.relation]);
      await resolveByData(me, 'connection_request', 'connection_id', existing.id);
      await announceAccepted(req.user, existing.requester_id, existing.id);
      return res.json({ status: 'connected' });
    }
    await query(
      `UPDATE connections SET requester_id = $2, addressee_id = $3, relation = $4, status = 'pending', responded_at = NULL, created_at = now()
       WHERE id = $1`,
      [existing.id, me, target.id, body.relation],
    );
    await announceRequest(req.user, target.id, existing.id, body.relation);
    res.status(201).json({ status: 'request_sent' });
  }),
);

router.post(
  '/connections/:id/accept',
  wrap(async (req, res) => {
    const { relation } = z.object({ relation: RELATIONS.optional() }).parse(req.body ?? {});
    const { rows } = await query(
      `UPDATE connections SET status = 'accepted', relation = COALESCE($3, relation), responded_at = now()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending' RETURNING id, requester_id`,
      [idParam(req), req.user.id, relation ?? null],
    );
    if (!rows[0]) throw new HttpError(404, 'Request not found.');
    await resolveByData(req.user.id, 'connection_request', 'connection_id', rows[0].id);
    await announceAccepted(req.user, rows[0].requester_id, rows[0].id);
    res.json({ status: 'connected' });
  }),
);

router.post(
  '/connections/:id/decline',
  wrap(async (req, res) => {
    const { rows } = await query(
      `UPDATE connections SET status = 'declined', responded_at = now()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending' RETURNING id`,
      [idParam(req), req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Request not found.');
    await resolveByData(req.user.id, 'connection_request', 'connection_id', rows[0].id); // declining is quiet: the sender is not told
    res.status(204).end();
  }),
);

router.put(
  '/connections/:id',
  wrap(async (req, res) => {
    const { relation } = z.object({ relation: RELATIONS }).parse(req.body);
    const { rowCount } = await query(
      `UPDATE connections SET relation = $3
       WHERE id = $1 AND status = 'accepted' AND (requester_id = $2 OR addressee_id = $2)`,
      [idParam(req), req.user.id, relation],
    );
    if (!rowCount) throw new HttpError(404, 'Connection not found.');
    res.json({ relation });
  }),
);

// Cancel a request you sent, or remove a connection (either side). Removing also stops payment sharing between the two.
router.delete(
  '/connections/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `DELETE FROM connections WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
         RETURNING id, requester_id, addressee_id, status`,
        [id, req.user.id],
      );
      const c = rows[0];
      if (!c) throw new HttpError(404, 'Connection not found.');
      if (c.status === 'pending' && c.requester_id === req.user.id) {
        // the sender withdrew the request: it disappears from the other person's notifications
        await removeByData(c.addressee_id, 'connection_request', 'connection_id', c.id);
      }
      if (c.status === 'accepted') {
        await client.query(
          `DELETE FROM transaction_participants p USING transactions t
           WHERE p.transaction_id = t.id
             AND ((t.user_id = $1 AND p.user_id = $2) OR (t.user_id = $2 AND p.user_id = $1))`,
          [c.requester_id, c.addressee_id],
        );
      }
    });
    res.status(204).end();
  }),
);

// ---- everything waiting for the user's attention (drives the badge) ----
router.get(
  '/inbox',
  wrap(async (req, res) => {
    const me = req.user.id;
    const [reqs, invites, shared] = await Promise.all([
      query(
        `SELECT c.id, c.relation, c.created_at, u.name, u.username, u.avatar_url
         FROM connections c JOIN users u ON u.id = c.requester_id
         WHERE c.addressee_id = $1 AND c.status = 'pending' ORDER BY c.created_at DESC`,
        [me],
      ),
      query(
        `SELECT i.id, i.created_at, w.id AS workspace_id, w.name AS workspace_name,
                u.name, u.username, u.avatar_url,
                (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count
         FROM workspace_invites i
         JOIN workspaces w ON w.id = i.workspace_id
         JOIN users u ON u.id = i.inviter_id
         WHERE i.invitee_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
        [me],
      ),
      query(
        `SELECT count(*)::int AS n FROM transaction_participants WHERE user_id = $1 AND imported_transaction_id IS NULL`,
        [me],
      ),
    ]);
    res.json({
      connection_requests: reqs.rows.map((r) => ({ id: r.id, relation: r.relation, created_at: r.created_at, user: briefUser(r) })),
      group_invites: invites.rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        workspace: { id: r.workspace_id, name: r.workspace_name, member_count: r.member_count },
        inviter: briefUser(r),
      })),
      shared_waiting: shared.rows[0].n,
    });
  }),
);

export default router;
