import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { currentBalanceCents } from '../lib/balance.js';
import { todayYMD } from '../lib/dates.js';
import { strictNumber, wrap } from '../lib/http.js';
import { SELECT } from './transactions.js';

const router = Router();

const schema = z.object({ balance: strictNumber.refine((v) => Math.abs(v) <= 9_999_999_999, 'is out of range') });

/**
 * Match Penny's balance to what the bank shows (docs/DESIGN.md section 28). If they differ, one paid payment dated today for the
 * difference is added (income if the bank has more, an expense if it has less); if they match, nothing is added.
 */
router.post(
  '/reconcile',
  wrap(async (req, res) => {
    const { balance } = schema.parse(req.body);
    const ws = req.workspace.id;
    const bankCents = Math.round(balance * 100);
    const out = await withTransaction(async (client) => {
      // one at a time per budget: a second request waits, then sees the balance the first one made
      await client.query('INSERT INTO workspace_settings (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [ws]);
      await client.query('SELECT 1 FROM workspace_settings WHERE workspace_id = $1 FOR UPDATE', [ws]);
      const before = await currentBalanceCents(ws, client);
      const diff = bankCents - before;
      if (diff === 0) return { adjusted: false, difference: 0, balance_before: before / 100, balance_after: before / 100, id: null };
      const { rows } = await client.query(
        `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, source, pay_method)
         VALUES ($1, $2, $1, $3, 'Balance adjustment (matched to the bank)', $4::numeric / 100, NULL, $5, 'paid', 'adjustment', 'cash') RETURNING id`,
        [req.user.id, ws, diff > 0 ? 'income' : 'expense', Math.abs(diff), todayYMD()],
      );
      return { adjusted: true, difference: diff / 100, balance_before: before / 100, balance_after: bankCents / 100, id: rows[0].id };
    });
    const payment = out.id ? (await query(`${SELECT} WHERE t.id = $1 AND t.workspace_id = $2`, [out.id, ws])).rows[0] : null;
    res.json({ adjusted: out.adjusted, difference: out.difference, balance_before: out.balance_before, balance_after: out.balance_after, payment });
  }),
);

export default router;
