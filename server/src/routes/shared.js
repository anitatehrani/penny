import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { todayYMD } from '../lib/dates.js';
import { categoryId, HttpError, idParam, wrap } from '../lib/http.js';
import { assertOwnCategory } from '../lib/ownership.js';
import { briefUser } from '../lib/profile.js';
import { t } from '../lib/i18n.js';

const router = Router();

// Payments other people added the current user to. Shows only what the person needs: what, when, how much, their share.
router.get(
  '/shared',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT t.id, t.type, t.description, t.amount, t.date, t.status, p.share, p.imported_transaction_id,
              u.name, u.username, u.avatar_url
       FROM transaction_participants p
       JOIN transactions t ON t.id = p.transaction_id
       JOIN users u ON u.id = t.user_id
       WHERE p.user_id = $1
       ORDER BY t.date DESC, t.id DESC LIMIT 500`,
      [req.user.id],
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        description: r.description,
        amount: r.amount,
        date: r.date,
        status: r.status,
        my_share: r.share,
        imported: r.imported_transaction_id != null,
        shared_by: briefUser(r),
      })),
    );
  }),
);

// Copy my share of a shared payment into the budget I am currently looking at.
router.post(
  '/shared/:id/import',
  wrap(async (req, res) => {
    const id = idParam(req);
    const body = z.object({ status: z.enum(['paid', 'pending']).optional(), category_id: categoryId }).parse(req.body ?? {});
    await assertOwnCategory(req.workspace.id, body.category_id);
    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT t.type, t.description, t.date, p.share, p.imported_transaction_id, u.name
         FROM transaction_participants p
         JOIN transactions t ON t.id = p.transaction_id
         JOIN users u ON u.id = t.user_id
         WHERE p.transaction_id = $1 AND p.user_id = $2 FOR UPDATE OF p`,
        [id, req.user.id],
      );
      const s = rows[0];
      if (!s) throw new HttpError(404, t('Shared payment not found.'));
      if (s.imported_transaction_id) throw new HttpError(409, t('You already added this to a budget.'));
      if (!(s.share > 0)) throw new HttpError(400, t('Your share of this payment is 0, so there is nothing to add.'));
      const status = body.status ?? (s.date <= todayYMD() ? 'paid' : 'pending');
      const tx = (
        await client.query(
          `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note)
           VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [req.user.id, req.workspace.id, s.type, `${s.description} (with ${s.name})`.slice(0, 200), s.share, body.category_id ?? null, s.date, status, 'Added from a shared payment'],
        )
      ).rows[0];
      await client.query('UPDATE transaction_participants SET imported_transaction_id = $3 WHERE transaction_id = $1 AND user_id = $2', [id, req.user.id, tx.id]);
      return tx.id;
    });
    res.status(201).json({ transaction_id: created });
  }),
);

export default router;
