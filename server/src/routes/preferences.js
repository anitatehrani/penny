import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { wrap } from '../lib/http.js';

/** User-level: interface choices that follow the person around (layout, density, accent, sidebar…), and "active now" status. */
const router = Router();

export const WIDGETS = ['hero', 'insights', 'upcoming', 'spending', 'recurring', 'outlook'];
export const ROUTES = ['dashboard', 'payments', 'recurring', 'installments', 'debts', 'forecast', 'people', 'settings'];
const widget = z.enum(WIDGETS);

const schema = z
  .object({
    layout: z
      .object({
        order: z.array(widget).max(WIDGETS.length).refine((a) => new Set(a).size === a.length, 'no duplicates'),
        hidden: z.array(widget).max(WIDGETS.length).refine((a) => new Set(a).size === a.length, 'no duplicates'),
        sizes: z.record(widget, z.enum(['s', 'm', 'l'])),
      })
      .strict()
      .partial(),
    density: z.enum(['comfortable', 'compact']),
    accent: z.enum(['blue', 'green', 'violet', 'amber', 'rose', 'graphite']),
    sidebar_collapsed: z.boolean(),
    favorites: z.array(z.enum(ROUTES)).max(ROUTES.length).refine((a) => new Set(a).size === a.length, 'no duplicates'),
    avatar_style: z.enum(['photo', 'initials', 'generated', 'illustrated']),
    assistant_intro_seen: z.boolean(),
    collapsed: z.array(widget).max(WIDGETS.length).refine((a) => new Set(a).size === a.length, 'no duplicates'),
  })
  .partial()
  .strict();

router.get(
  '/preferences',
  wrap(async (req, res) => {
    const { rows } = await query('SELECT data FROM user_preferences WHERE user_id = $1', [req.user.id]);
    res.json(rows[0]?.data ?? {});
  }),
);

// Send only what changed; each top-level key is replaced as a whole.
router.put(
  '/preferences',
  wrap(async (req, res) => {
    const patch = schema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO user_preferences (user_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET data = user_preferences.data || EXCLUDED.data, updated_at = now()
       RETURNING data`,
      [req.user.id, JSON.stringify(patch)],
    );
    res.json(rows[0].data);
  }),
);

router.delete(
  '/preferences',
  wrap(async (req, res) => {
    await query('DELETE FROM user_preferences WHERE user_id = $1', [req.user.id]);
    res.status(204).end();
  }),
);

/**
 * Who is around right now: people you are connected to or share a budget with, if they allow it.
 * "Online" means they used the app in the last five minutes.
 */
router.get(
  '/presence',
  wrap(async (req, res) => {
    const me = req.user.id;
    const { rows } = await query(
      `SELECT u.username, u.last_seen_at, (u.last_seen_at > now() - interval '5 minutes') AS online
       FROM users u
       WHERE u.show_status AND u.last_seen_at IS NOT NULL AND u.id <> $1 AND (
         EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted' AND ((c.requester_id = $1 AND c.addressee_id = u.id) OR (c.requester_id = u.id AND c.addressee_id = $1)))
         OR EXISTS (SELECT 1 FROM workspace_members a JOIN workspace_members b ON b.workspace_id = a.workspace_id WHERE a.user_id = $1 AND b.user_id = u.id))`,
      [me],
    );
    const out = Object.fromEntries(rows.map((r) => [r.username, { online: r.online, last_seen: r.last_seen_at }]));
    if (req.user.show_status) out[req.user.username] = { online: true, last_seen: new Date().toISOString() };
    res.json(out);
  }),
);

export default router;
