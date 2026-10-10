// The person's OTHER budgets, for the AI summary (docs/DESIGN.md section 42). Someone who asks from one budget may mean another ("what did Mo and I
// pay in our shared budget?"). A budget is included in detail only when everyone in it has agreed that the assistant may use its figures: by joining
// or making it after being told so (workspace_members.ai_consent_at), or by turning AI answers on themselves. Otherwise only its name is given,
// with the reason, so the assistant can say why it cannot see it.

import { query } from '../db.js';
import { addMonthsYM } from './dates.js';
import { personNamer, safeName } from './aiFacts.js';

const MAX_LISTED = 6;
const MAX_DETAILED = 4;

/** SQL: has this member agreed (joined with the notice, or turned AI answers on)? `m` is workspace_members, `p` is user_preferences. */
export const AGREED_SQL = `(m.ai_consent_at IS NOT NULL OR COALESCE((p.data->>'ai_answers') = 'true', false))`;

export async function gatherOtherBudgets({ userId, openId, facts, question }) {
  const { rows: list } = await query(
    `SELECT w.id, w.name, w.kind, COALESCE(ws.currency, 'USD') AS currency, count(m.user_id)::int AS members,
            count(*) FILTER (WHERE NOT ${AGREED_SQL})::int AS not_agreed
     FROM workspace_members me
     JOIN workspaces w ON w.id = me.workspace_id
     JOIN workspace_members m ON m.workspace_id = w.id
     LEFT JOIN user_preferences p ON p.user_id = m.user_id
     LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
     WHERE me.user_id = $1 AND w.id <> $2
     GROUP BY w.id, ws.currency ORDER BY (w.kind = 'group') DESC, lower(w.name) LIMIT ${MAX_LISTED}`,
    [userId, openId],
  );
  const who = personNamer(question);
  const out = [];
  let detailed = 0;
  for (const w of list) {
    const base = { name: safeName(w.name, 40), shared: w.kind === 'group', members: w.members, currency: w.currency, waiting: w.not_agreed };
    if (w.not_agreed > 0 || detailed >= MAX_DETAILED) {
      out.push(base);
      continue;
    }
    detailed += 1;
    const prev = addMonthsYM(facts.month, -1);
    const [totals, cats, latest] = await Promise.all([
      query(
        `SELECT to_char(date, 'YYYY-MM') AS month, type, sum(amount)::float AS total FROM transactions
         WHERE workspace_id = $1 AND status IN ('paid', 'pending') AND to_char(date, 'YYYY-MM') IN ($2, $3)
           AND ((type = 'expense' AND source NOT IN ('adjustment', 'loan')) OR (type = 'income' AND source NOT IN ('adjustment', 'debt')))
         GROUP BY 1, 2`,
        [w.id, facts.month, prev],
      ),
      query(
        `SELECT COALESCE(c.name, 'Uncategorized') AS name, sum(t.amount)::float AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.status IN ('paid', 'pending') AND t.source NOT IN ('adjustment', 'loan') AND to_char(t.date, 'YYYY-MM') = $2
         GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
        [w.id, facts.month],
      ),
      query(
        `SELECT t.description, t.amount::float AS amount, t.date::text AS date, u.id AS uid, u.name, u.username
         FROM transactions t JOIN users u ON u.id = t.user_id
         WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.status = 'paid' AND t.source NOT IN ('adjustment', 'loan') AND t.date <= $2
         ORDER BY t.date DESC, t.id DESC LIMIT 10`,
        [w.id, facts.today],
      ),
    ]);
    const sum = (month, type) => totals.rows.filter((r) => r.month === month && r.type === type).reduce((a, r) => a + r.total, 0);
    out.push({
      ...base,
      detail: {
        month: { expenses: sum(facts.month, 'expense'), income: sum(facts.month, 'income') },
        prev: { expenses: sum(prev, 'expense'), income: sum(prev, 'income') },
        categories: cats.rows,
        latest: latest.rows.map((r) => ({ description: r.description, amount: r.amount, date: r.date, by: r.uid === userId ? 'the person' : who(r) })),
      },
    });
  }
  return out;
}
