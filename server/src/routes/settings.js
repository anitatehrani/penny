import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { HttpError, idParam, strictNumber, text, wrap } from '../lib/http.js';

const router = Router();

// ---- settings (per budget: personal or group) ----
const settingsSchema = z.object({
  opening_balance: strictNumber.refine((v) => v >= -9_999_999_999 && v <= 9_999_999_999, 'is out of range'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code'),
});

router.get(
  '/settings',
  wrap(async (req, res) => {
    await query('INSERT INTO workspace_settings (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.workspace.id]);
    const { rows } = await query('SELECT opening_balance, currency FROM workspace_settings WHERE workspace_id = $1', [req.workspace.id]);
    res.json(rows[0]);
  }),
);

router.put(
  '/settings',
  wrap(async (req, res) => {
    const s = settingsSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO workspace_settings (workspace_id, opening_balance, currency) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, currency = EXCLUDED.currency
       RETURNING opening_balance, currency`,
      [req.workspace.id, Math.round(s.opening_balance * 100) / 100, s.currency],
    );
    res.json(rows[0]);
  }),
);

// ---- categories ----
const categorySchema = z.object({
  name: text(60),
  kind: z.enum(['income', 'expense']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #2a78d6'),
});

router.get(
  '/categories',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.name, c.kind, c.color, c.created_at,
              (SELECT count(*)::int FROM transactions t WHERE t.category_id = c.id) AS usage_count
       FROM categories c WHERE c.workspace_id = $1 ORDER BY c.kind, c.name`,
      [req.workspace.id],
    );
    res.json(rows);
  }),
);

router.post(
  '/categories',
  wrap(async (req, res) => {
    const c = categorySchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO categories (workspace_id, user_id, name, kind, color) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, kind, color, created_at`,
      [req.workspace.id, req.user.id, c.name, c.kind, c.color],
    );
    res.status(201).json(rows[0]);
  }),
);

router.put(
  '/categories/:id',
  wrap(async (req, res) => {
    const c = categorySchema.parse(req.body);
    const { rows } = await query(
      `UPDATE categories SET name = $1, kind = $2, color = $3 WHERE id = $4 AND workspace_id = $5
       RETURNING id, name, kind, color, created_at`,
      [c.name, c.kind, c.color, idParam(req), req.workspace.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Category not found');
    res.json(rows[0]);
  }),
);

router.delete(
  '/categories/:id',
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM categories WHERE id = $1 AND workspace_id = $2', [idParam(req), req.workspace.id]);
    if (!rowCount) throw new HttpError(404, 'Category not found');
    res.status(204).end();
  }),
);

export default router;
