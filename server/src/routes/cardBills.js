import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { addMonthsYM, isValidYM, monthEnd, monthStart } from '../lib/dates.js';
import { HttpError, strictNumber, wrap } from '../lib/http.js';
import { planRollover } from '../lib/rollover.js';
import { t } from '../lib/i18n.js';

const router = Router();

const pad = (n) => String(n).padStart(2, '0');
const toCents = (v) => Math.round(Number(v) * 100);
const longMonth = (ym) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The day the card bill is paid in `month`: the budget's card pay day (1 to 28, so it exists in every month). */
async function billDay(client, workspaceId, month) {
  const { rows } = await client.query('SELECT card_pay_day FROM workspace_settings WHERE workspace_id = $1', [workspaceId]);
  return `${month}-${pad(rows[0]?.card_pay_day ?? 10)}`;
}

/** The unpaid credit card payments on the bill of `month`, newest purchase first, and whether each can roll over. */
async function loadBill(client, workspaceId, month, lock = false) {
  const { rows } = await client.query(
    `SELECT t.id, t.description, t.amount::float8 AS amount, t.date, t.charged_on,
            (t.installment_plan_id IS NULL AND t.debt_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM transaction_participants p WHERE p.transaction_id = t.id)) AS movable
     FROM transactions t
     WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.pay_method = 'credit_card' AND t.status = 'pending'
       AND t.date >= $2 AND t.date <= $3
     ORDER BY t.charged_on DESC, t.id DESC ${lock ? 'FOR UPDATE OF t' : ''}`,
    [workspaceId, monthStart(month), monthEnd(month)],
  );
  const items = rows.map((r) => ({ ...r, cents: toCents(r.amount) }));
  const sum = (list) => list.reduce((s, r) => s + r.cents, 0);
  return { items, total: sum(items), movable: sum(items.filter((r) => r.movable)), fixed: sum(items.filter((r) => !r.movable)) };
}

router.get(
  '/card-bills',
  wrap(async (req, res) => {
    const month = String(req.query.month ?? '');
    if (!isValidYM(month)) throw new HttpError(400, t('month must be YYYY-MM'));
    const bill = await loadBill({ query }, req.workspace.id, month);
    res.json({
      month,
      bill_date: await billDay({ query }, req.workspace.id, month),
      items: bill.items.map((r) => ({ id: r.id, description: r.description, amount: r.amount, charged_on: r.charged_on, movable: r.movable })),
      total: bill.total / 100,
      movable: bill.movable / 100,
      fixed: bill.fixed / 100,
    });
  }),
);

const rolloverSchema = z.object({
  bill_month: z.string().refine(isValidYM, 'must be YYYY-MM'),
  to_month: z.string().refine(isValidYM, 'must be YYYY-MM'),
  pay_now: strictNumber.refine((v) => v >= 0 && v <= 9_999_999_999, 'must be 0 or more'),
  interest: strictNumber.refine((v) => v >= 0 && v <= 9_999_999_999, 'must be 0 or more').default(0),
});

router.post(
  '/card-bills/rollover',
  wrap(async (req, res) => {
    const body = rolloverSchema.parse(req.body);
    if (body.to_month <= body.bill_month) throw new HttpError(400, t('The rest has to move to a later month than this bill.'));
    if (body.to_month > addMonthsYM(body.bill_month, 12)) throw new HttpError(400, t('A card bill cannot be more than a year after this one.'));
    const ws = req.workspace.id;
    const payNow = toCents(body.pay_now);
    const interest = toCents(body.interest);

    const result = await withTransaction(async (client) => {
      const bill = await loadBill(client, ws, body.bill_month, true);
      if (bill.total <= 0) throw new HttpError(400, t('There is nothing left to pay on that bill.'));
      if (payNow >= bill.total) throw new HttpError(400, t('You are paying the whole bill, so there is nothing to roll over.'));
      const rest = bill.total - payNow;
      if (rest > bill.movable) {
        throw new HttpError(
          400,
          t('Only {toFixed} of this bill can move to a later one (fixed installments, debt payments and shared payments stay). Pay at least {toFixed2} now.', { toFixed: (bill.movable / 100).toFixed(2), toFixed2: ((bill.total - bill.movable) / 100).toFixed(2) }),
        );
      }
      const newDay = await billDay(client, ws, body.to_month);
      const oldDay = await billDay(client, ws, body.bill_month);
      const { steps } = planRollover(bill.items.filter((r) => r.movable).map((r) => ({ id: r.id, cents: r.cents })), rest);

      let moved = 0;
      let split = 0;
      for (const step of steps) {
        if (step.action === 'move') {
          await client.query('UPDATE transactions SET date = $1, updated_at = now() WHERE id = $2', [newDay, step.id]);
          moved += 1;
        } else {
          // the part you pay now stays; the part that moves becomes a new payment on the later bill
          const keep = bill.items.find((r) => r.id === step.id).cents - step.cents;
          await client.query(
            `INSERT INTO transactions
               (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, source, pay_method, charged_on)
             SELECT user_id, workspace_id, member_id, type, description || ' (rest)', $2::numeric / 100, category_id, $3::date, 'pending', note, source, pay_method, charged_on
             FROM transactions WHERE id = $1`,
            [step.id, step.cents, newDay],
          );
          await client.query('UPDATE transactions SET amount = $1::numeric / 100, updated_at = now() WHERE id = $2', [keep, step.id]);
          split += 1;
        }
      }

      let interestId = null;
      if (interest > 0) {
        const anyRow = bill.items.find((r) => r.movable) ?? bill.items[0];
        const owner = (await client.query('SELECT user_id, member_id FROM transactions WHERE id = $1', [anyRow.id])).rows[0];
        const { rows } = await client.query(
          `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, source, pay_method, charged_on)
           VALUES ($1, $2, $3, 'expense', $4, $5::numeric / 100, NULL, $6, 'pending', 'manual', 'credit_card', $7) RETURNING id`,
          [owner.user_id, ws, owner.member_id, `Card interest (rest of the ${longMonth(body.bill_month)} bill)`, interest, newDay, oldDay],
        );
        interestId = rows[0].id;
      }
      return { moved, split, rolled: rest / 100, interest: interest / 100, to_date: newDay, interest_id: interestId };
    });
    res.json(result);
  }),
);

export default router;
