import express, { Router } from 'express';
import { query } from '../db.js';
import { publicUser } from '../lib/auth.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { AVATAR_MAX_BYTES, AVATAR_TYPES, detectType } from '../lib/images.js';
import { t } from '../lib/i18n.js';

const router = Router();

const raw = express.raw({ type: AVATAR_TYPES, limit: AVATAR_MAX_BYTES });

// Upload a profile picture (the browser crops and shrinks it first; the server checks the bytes again).
router.put(
  '/profile/avatar',
  raw,
  wrap(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(415, t('Send the picture as a JPEG, PNG or WebP image.'));
    const mime = detectType(buf);
    if (!AVATAR_TYPES.includes(mime)) throw new HttpError(415, t('That file is not a JPEG, PNG or WebP image.'));
    await query(
      `INSERT INTO user_avatars (user_id, mime, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
      [req.user.id, mime, buf],
    );
    // the version in the URL changes with every upload so browsers never show a stale picture
    const { rows } = await query(`UPDATE users SET avatar_url = '/api/avatars/' || id || '?v=' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint WHERE id = $1 RETURNING *`, [req.user.id]);
    res.json({ user: publicUser(rows[0]) });
  }),
);

// Remove it again (falls back to the Google picture, if there is one, otherwise to initials).
router.delete(
  '/profile/avatar',
  wrap(async (req, res) => {
    await query('DELETE FROM user_avatars WHERE user_id = $1', [req.user.id]);
    const { rows } = await query('UPDATE users SET avatar_url = google_picture WHERE id = $1 RETURNING *', [req.user.id]);
    res.json({ user: publicUser(rows[0]) });
  }),
);

/**
 * Serve someone's picture to people who can already see them: themselves, anyone while they are discoverable,
 * their connections (including pending requests), people sharing a budget, a pending group invitation,
 * or a payment shared between them.
 */
router.get(
  '/avatars/:id',
  wrap(async (req, res) => {
    const owner = idParam(req);
    const me = req.user.id;
    const { rows } = await query(
      `SELECT a.mime, a.data FROM user_avatars a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1 AND (
         $1 = $2 OR u.discoverable
         OR EXISTS (SELECT 1 FROM connections c WHERE (c.requester_id = $1 AND c.addressee_id = $2) OR (c.requester_id = $2 AND c.addressee_id = $1))
         OR EXISTS (SELECT 1 FROM workspace_members m1 JOIN workspace_members m2 ON m2.workspace_id = m1.workspace_id WHERE m1.user_id = $1 AND m2.user_id = $2)
         OR EXISTS (SELECT 1 FROM workspace_invites i WHERE i.status = 'pending' AND ((i.inviter_id = $1 AND i.invitee_id = $2) OR (i.inviter_id = $2 AND i.invitee_id = $1)))
         OR EXISTS (SELECT 1 FROM transaction_participants p JOIN transactions t ON t.id = p.transaction_id
                    WHERE (t.user_id = $1 AND p.user_id = $2) OR (t.user_id = $2 AND p.user_id = $1)))`,
      [owner, me],
    );
    if (!rows[0]) throw new HttpError(404, t('No picture.'));
    res.set({
      'Content-Type': rows[0].mime,
      'Cache-Control': 'private, max-age=31536000, immutable', // the URL carries a version, so this is safe
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Length': String(rows[0].data.length),
    });
    res.send(rows[0].data);
  }),
);

export default router;
