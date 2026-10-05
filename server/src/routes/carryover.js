import { Router } from 'express';
import { query } from '../db.js';
import { carriedInto } from '../lib/carryover.js';
import { addMonthsYM, isValidYM } from '../lib/dates.js';
import { HttpError, wrap } from '../lib/http.js';

const router = Router();

/**
 * What was left over from earlier months and is carried into `month`, for the Payments page. Not a stored payment (the running
 * balance already holds this money); see docs/DESIGN.md section 21 for the rule.
 */
router.get(
  '/carryover',
  wrap(async (req, res) => {
    const month = String(req.query.month ?? '');
    if (!isValidYM(month)) throw new HttpError(400, 'month must be YYYY-MM');
    const ws = req.workspace.id;
    const enabled = (await query('SELECT carry_over FROM workspace_settings WHERE workspace_id = $1', [ws])).rows[0]?.carry_over ?? true;
    let cents = 0;
    if (enabled) {
      const { rows } = await query(
        `SELECT to_char(date, 'YYYY-MM') AS m,
                round(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END) * 100)::float8 AS net
         FROM transactions WHERE workspace_id = $1 AND status <> 'skipped' AND date < $2
         GROUP BY 1`,
        [ws, `${month}-01`],
      );
      cents = carriedInto(Object.fromEntries(rows.map((r) => [r.m, r.net])), month);
    }
    res.json({ enabled, month, from_month: addMonthsYM(month, -1), amount: cents / 100 });
  }),
);

export default router;
