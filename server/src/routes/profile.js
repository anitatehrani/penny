import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { publicUser } from '../lib/auth.js';
import { HttpError, wrap } from '../lib/http.js';
import { phoneField, usernameField } from '../lib/profile.js';

const router = Router();

const schema = z.object({
  name: z.string().trim().min(1, 'is required').max(80),
  username: usernameField,
  phone: phoneField,
  discoverable: z.boolean(),
  find_by_email: z.boolean(),
  find_by_phone: z.boolean(),
  show_status: z.boolean().optional(),
});

router.put(
  '/profile',
  wrap(async (req, res) => {
    const p = schema.parse(req.body);
    try {
      const { rows } = await query(
        `UPDATE users SET name = $1, username = $2, phone = $3, discoverable = $4, find_by_email = $5, find_by_phone = $6,
                          show_status = COALESCE($8, show_status)
         WHERE id = $7 RETURNING *`,
        [p.name, p.username, p.phone, p.discoverable, p.find_by_email, p.find_by_phone, req.user.id, p.show_status ?? null],
      );
      res.json({ user: publicUser(rows[0]) });
    } catch (err) {
      if (err.code === '23505') {
        if (/username/.test(err.constraint ?? '')) throw new HttpError(409, 'That username is taken.');
        if (/phone/.test(err.constraint ?? '')) throw new HttpError(409, 'That phone number is already used by another account.');
      }
      throw err;
    }
  }),
);

export default router;
