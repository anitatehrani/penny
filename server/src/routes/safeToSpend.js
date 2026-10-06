import { Router } from 'express';
import { query } from '../db.js';
import { currentBalanceCents } from '../lib/balance.js';
import { addDays, todayYMD } from '../lib/dates.js';
import { wrap } from '../lib/http.js';
import { safeToSpend } from '../lib/safeToSpend.js';

const router = Router();

/** How much can be spent a day until the next income (docs/DESIGN.md section 27). */
router.get(
  '/safe-to-spend',
  wrap(async (req, res) => {
    const ws = req.workspace.id;
    const today = todayYMD();
    const settings = (await query('SELECT min_balance FROM workspace_settings WHERE workspace_id = $1', [ws])).rows[0];
    // overdue and upcoming alike, but not further than the longest horizon plus a day: nothing later can matter
    const { rows } = await query(
      `SELECT type, date, description, round(amount * 100)::float8 AS cents
       FROM transactions WHERE workspace_id = $1 AND status = 'pending' AND date <= $2
         AND NOT (type = 'income' AND source = 'debt') -- a friend paying you back is not something to count on
       ORDER BY date, id`,
      [ws, addDays(today, 63)],
    );
    res.json(
      safeToSpend({
        today,
        balanceCents: await currentBalanceCents(ws),
        bufferCents: Math.round(Number(settings?.min_balance ?? 0) * 100),
        pending: rows.map((r) => ({ type: r.type, date: r.date, description: r.description, cents: Number(r.cents) })),
      }),
    );
  }),
);

export default router;
