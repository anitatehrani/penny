import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { rateLimit } from '../lib/auth.js';
import { addDays, todayYMD } from '../lib/dates.js';
import { HttpError, idParam, money, txType, wrap, ymd } from '../lib/http.js';
import { findDuplicates } from '../lib/importDuplicates.js';
import { memoryOf, ruleKey, suggest } from '../lib/importCategorize.js';
import { LABELS, normalize } from '../lib/merchants.js';
import { notifyMany } from '../lib/notifications.js';
import { redact } from '../lib/redact.js';
import { catName } from '../lib/categoryNames.js';
import { t, tn } from '../lib/i18n.js';

/**
 * Importing a bank statement (docs/DESIGN.md section 41). The browser has already read the file; what arrives here is the list of lines the
 * person is looking at, never the file. Preview answers with categories and duplicates and keeps nothing; commit saves, in one transaction.
 */
const router = Router();

export const MAX_LINES = 3000;
const FIRST_DAY = '2000-01-01';

const day = ymd.refine((d) => d >= FIRST_DAY && d <= addDays(todayYMD(), 366), 'is outside the years Penny accepts');
const words = (max) => z.string().max(2000).transform((s) => redact(s)).transform((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s));

const previewLine = z.object({
  i: z.number().int().min(0).max(1_000_000),
  date: day,
  description: words(200),
  note: words(300).optional().default(''),
  amount: money,
  type: txType,
  bank_category: words(80).optional().default(''),
  reference: z.string().max(80).optional().default(''),
});
const previewBody = z.object({ rows: z.array(previewLine).min(1, 'There is nothing to import.').max(MAX_LINES, `Penny imports up to ${MAX_LINES} lines at a time.`) });

const previewLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyFn: (req) => `import-preview:${req.user.id}`, get message() { return t('You have read a lot of statements this hour. Try again later.'); } });
const commitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyFn: (req) => `import-commit:${req.user.id}`, get message() { return t('You have imported a lot this hour. Try again later.'); } });

// ---------------------------------------------------------------------------------------------------------------------------------
// References: how the same line is recognised the next time
// ---------------------------------------------------------------------------------------------------------------------------------

const fingerprint = (r) => createHash('sha256').update(`${r.date}|${r.type}|${Math.round(Number(r.amount) * 100)}|${normalize(r.description)}`).digest('hex').slice(0, 20);
const cleanRef = (s) => String(s ?? '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
const REF = /^(id|fp):[A-Za-z0-9._:-]{4,70}(~\d{1,4})?$/;

/** The bank's own id when there is one, otherwise a fingerprint; the same one twice in a file gets a number so both can be kept. */
export function assignRefs(rows) {
  const seen = new Map();
  return rows.map((r) => {
    const id = cleanRef(r.reference);
    const base = id.length >= 6 ? `id:${id}` : `fp:${fingerprint(r)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What the budget already knows
// ---------------------------------------------------------------------------------------------------------------------------------

const categoriesOf = async (ws, db = { query }) => (await db.query('SELECT id, name, kind, color FROM categories WHERE workspace_id = $1 ORDER BY id', [ws])).rows;

async function memoryFor(ws) {
  const [rules, history] = await Promise.all([
    query('SELECT merchant_key, kind, category_id, hits FROM import_rules WHERE workspace_id = $1', [ws]),
    query(
      `SELECT description, type, category_id FROM transactions
       WHERE workspace_id = $1 AND category_id IS NOT NULL AND source <> 'adjustment' AND status <> 'skipped' ORDER BY date DESC, id DESC LIMIT 6000`,
      [ws],
    ),
  ]);
  return memoryOf(rules.rows, history.rows);
}

async function existingFor(ws, lines, refs) {
  const dates = lines.map((l) => l.date).sort();
  const { rows } = await query(
    `SELECT id, date, amount, type, description, status, source, import_ref FROM transactions
     WHERE workspace_id = $1 AND status <> 'skipped' AND source <> 'adjustment'
       AND ((date BETWEEN $2 AND $3) OR import_ref = ANY($4::text[]))`,
    [ws, addDays(dates[0], -5), addDays(dates[dates.length - 1], 5), refs],
  );
  return rows;
}

const brief = (tt) => ({ id: tt.id, date: tt.date, description: tt.description, amount: tt.amount, status: tt.status, scheduled: tt.source === 'recurring' || tt.source === 'installment' });
const defaultAction = { imported: 'skip', same: 'skip', scheduled: 'settle', similar: 'import' };

// ---------------------------------------------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------------------------------------------

router.post(
  '/import/preview',
  previewLimiter,
  wrap(async (req, res) => {
    const { rows } = previewBody.parse(req.body ?? {});
    const ws = req.workspace.id;
    const refs = assignRefs(rows);
    const [categories, memory] = await Promise.all([categoriesOf(ws), memoryFor(ws)]);
    const existing = await existingFor(ws, rows, refs);
    const dups = findDuplicates(rows.map((r, n) => ({ ...r, ref: refs[n] })), existing);
    const answers = rows.map((r, n) => {
      const s = suggest({ description: r.description, note: r.note, type: r.type, bank_category: r.bank_category }, categories, memory);
      const d = dups.get(r.i);
      return {
        i: r.i,
        ref: refs[n],
        merchant: s.merchant,
        brand: s.brand,
        category: s.category,
        source: s.source,
        confidence: s.confidence,
        review: s.review,
        reason: s.reason,
        transfer: s.transfer,
        duplicate: d ? { kind: d.kind, tx: brief(d.tx), amount_differs: !!d.amount_differs, action: defaultAction[d.kind] } : null,
      };
    });
    res.json({ rows: answers, taught: (await query('SELECT count(*)::int AS n FROM import_rules WHERE workspace_id = $1', [ws])).rows[0].n });
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------------------------------------------------------------

const commitLine = z.object({
  date: day,
  description: words(200).refine((s) => s.length > 0, 'is required'),
  note: words(300).optional().default(''),
  amount: money,
  type: txType,
  category_id: z.number().int().positive().nullable().optional(),
  new_category: z.object({ name: z.string().trim().min(1).max(60) }).nullable().optional(),
  ref: z.string().regex(REF, 'is not a valid reference').optional(),
  key: z.string().max(80).optional().default(''),
  action: z.enum(['import', 'settle']).default('import'),
  settle_id: z.number().int().positive().optional(),
  taught: z.boolean().optional().default(false),
});
const commitBody = z.object({
  kind: z.enum(['csv', 'xlsx', 'pdf', 'html']).default('csv'),
  remember: z.boolean().default(true),
  rows: z.array(commitLine).min(1, 'There is nothing to import.').max(MAX_LINES, `Penny imports up to ${MAX_LINES} lines at a time.`),
});

const colourOf = (name) => Object.values(LABELS).find((l) => normalize(l.name) === normalize(name))?.color ?? '#6b7280';

router.post(
  '/import/commit',
  commitLimiter,
  wrap(async (req, res) => {
    const body = commitBody.parse(req.body ?? {});
    const ws = req.workspace.id;
    const user = req.user;
    const today = todayYMD();
    for (const r of body.rows) {
      if (r.action === 'settle' && !r.settle_id) throw new HttpError(400, t('rows: a payment to mark as paid needs its id.'));
      if (r.category_id && r.new_category) throw new HttpError(400, t('rows: a line has either a category or a new one, not both.'));
    }
    const result = await withTransaction(async (client) => {
      // categories: the ones named by id must be this budget's and of the line's kind; the new ones are found or made
      const own = await categoriesOf(ws, client);
      const byId = new Map(own.map((c) => [c.id, c]));
      const made = new Map(); // "kind:name" -> category
      const created = [];
      const categoryOf = async (r) => {
        if (r.category_id) {
          const c = byId.get(r.category_id);
          if (!c) throw new HttpError(400, t('Unknown category.'));
          if (c.kind !== r.type) throw new HttpError(400, c.kind === 'income' ? t('{name} is a category for income, so it cannot hold an expense.', { name: catName(c.name) }) : t('{name} is a category for spending, so it cannot hold income.', { name: catName(c.name) }));
          return c.id;
        }
        if (!r.new_category) return null;
        const name = r.new_category.name;
        const k = `${r.type}:${normalize(name)}`;
        if (made.has(k)) return made.get(k).id;
        const found = own.find((c) => c.kind === r.type && normalize(c.name) === normalize(name));
        if (found) {
          made.set(k, found);
          return found.id;
        }
        if (created.length >= 25) throw new HttpError(400, t('This import would create too many new categories. Choose existing ones for some lines.'));
        const ins = await client.query('INSERT INTO categories (workspace_id, user_id, name, kind, color) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, kind, color', [ws, user.id, name, r.type, colourOf(name)]);
        made.set(k, ins.rows[0]);
        created.push(ins.rows[0]);
        return ins.rows[0].id;
      };

      const batch = (await client.query('INSERT INTO import_batches (workspace_id, user_id, kind) VALUES ($1, $2, $3) RETURNING id', [ws, user.id, body.kind])).rows[0].id;

      // lines to add
      const adds = [];
      for (const r of body.rows.filter((x) => x.action === 'import')) adds.push({ r, category: await categoryOf(r) });
      const refs = assignRefs(adds.map(({ r }) => ({ ...r, reference: '' })));
      let inserted = [];
      if (adds.length) {
        const col = (f) => adds.map(f);
        const { rows } = await client.query(
          `INSERT INTO transactions (user_id, workspace_id, member_id, type, description, amount, category_id, date, status, note, pay_method, source, import_batch_id, import_ref)
           SELECT $1, $2, $1, t.type, t.description, t.amount, t.category_id, t.date, t.status, NULLIF(t.note, ''), 'cash', 'manual', $3, t.ref
           FROM unnest($4::text[], $5::text[], $6::numeric[], $7::int[], $8::date[], $9::text[], $10::text[], $11::text[]) AS t(type, description, amount, category_id, date, status, note, ref)
           ON CONFLICT (workspace_id, import_ref) WHERE import_ref IS NOT NULL DO NOTHING
           RETURNING id, type, amount, date`,
          [
            user.id, ws, batch,
            col(({ r }) => r.type), col(({ r }) => r.description), col(({ r }) => r.amount), col(({ category }) => category), col(({ r }) => r.date),
            col(({ r }) => (r.date <= today ? 'paid' : 'pending')), col(({ r }) => r.note),
            col(({ r }, n) => r.ref ?? refs[n]),
          ],
        );
        inserted = rows;
      }

      // scheduled payments the person chose to mark as paid
      const settled = [];
      for (const r of body.rows.filter((x) => x.action === 'settle')) {
        const now = (await client.query('SELECT id, status, date, amount, type, import_ref FROM transactions WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [r.settle_id, ws])).rows[0];
        if (!now || now.status !== 'pending' || now.type !== r.type) continue;
        // the line's reference goes on the payment too, unless another payment already has it
        const upd = await client.query(
          `UPDATE transactions SET status = 'paid', date = $1, amount = $2, updated_at = now(),
                  import_ref = CASE WHEN $3::text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions o WHERE o.workspace_id = $5 AND o.import_ref = $3::text) THEN $3::text ELSE import_ref END
           WHERE id = $4 AND workspace_id = $5 RETURNING id`,
          [r.date, r.amount, r.ref ?? null, r.settle_id, ws],
        );
        if (upd.rowCount) settled.push({ id: now.id, status: now.status, date: now.date, amount: now.amount });
      }

      // what the person taught Penny
      let learned = 0;
      if (body.remember) {
        for (const r of body.rows) {
          if (!r.taught || r.action !== 'import') continue;
          const cid = await categoryOf(r);
          const key = ruleKey(r.key || r.description);
          if (!cid || key.length < 3) continue;
          await client.query(
            `INSERT INTO import_rules (workspace_id, merchant_key, kind, category_id, user_id) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (workspace_id, merchant_key, kind) DO UPDATE SET category_id = EXCLUDED.category_id, hits = import_rules.hits + 1, user_id = EXCLUDED.user_id, updated_at = now()`,
            [ws, key, r.type, cid, user.id],
          );
          learned++;
        }
      }

      const totalIn = inserted.filter((tt) => tt.type === 'income').reduce((s, tt) => s + tt.amount, 0);
      const totalOut = inserted.filter((tt) => tt.type === 'expense').reduce((s, tt) => s + tt.amount, 0);
      const dates = inserted.map((tt) => tt.date).sort();
      await client.query(
        'UPDATE import_batches SET added = $1, settled = $2, total_in = $3, total_out = $4, first_date = $5, last_date = $6 WHERE id = $7',
        [inserted.length, JSON.stringify(settled), Math.round(totalIn * 100) / 100, Math.round(totalOut * 100) / 100, dates[0] ?? null, dates[dates.length - 1] ?? null, batch],
      );
      if (!inserted.length && !settled.length) {
        await client.query('DELETE FROM import_batches WHERE id = $1', [batch]);
      }
      return {
        batch_id: inserted.length || settled.length ? batch : null,
        added: inserted.length,
        settled: settled.length,
        skipped: body.rows.length - inserted.length - settled.length,
        created_categories: created,
        learned,
        first_date: dates[0] ?? null,
        last_date: dates[dates.length - 1] ?? null,
        total_in: Math.round(totalIn * 100) / 100,
        total_out: Math.round(totalOut * 100) / 100,
      };
    });
    res.status(201).json(result);
    // one note to the other members of a shared budget, not one for every line
    if (result.batch_id && req.workspace.kind === 'group') {
      query('SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id <> $2', [ws, user.id])
        .then(({ rows }) =>
          notifyMany(rows.map((r) => r.user_id), {
            kind: 'group_activity',
            title: () => tn(result.added, '{name} imported {n} payment', '{name} imported {n} payments', { name: user.name }),
            body: () => t('From a bank statement, in {name}', { name: req.workspace.name }),
            link: '/payments',
            data: { workspace_id: ws, batch_id: result.batch_id },
            dedupeKey: `import:${result.batch_id}`,
          }),
        )
        .catch((e) => console.error('import:', e.message));
    }
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// Imports so far, and undoing one
// ---------------------------------------------------------------------------------------------------------------------------------

router.get(
  '/import/batches',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT b.id, b.created_at, b.kind, b.added, b.total_in, b.total_out, b.first_date, b.last_date, jsonb_array_length(b.settled)::int AS settled, u.name AS by,
              (SELECT count(*)::int FROM transactions t WHERE t.import_batch_id = b.id) AS remaining
       FROM import_batches b LEFT JOIN users u ON u.id = b.user_id
       WHERE b.workspace_id = $1 AND b.created_at > now() - interval '90 days'
       ORDER BY b.created_at DESC, b.id DESC LIMIT 10`,
      [req.workspace.id],
    );
    res.json(rows.filter((b) => b.remaining > 0 || b.settled > 0));
  }),
);

router.delete(
  '/import/batches/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const ws = req.workspace.id;
    const out = await withTransaction(async (client) => {
      const batch = (await client.query('SELECT id, settled FROM import_batches WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, ws])).rows[0];
      if (!batch) throw new HttpError(404, t('That import was not found. It may already be undone.'));
      let restored = 0;
      for (const s of batch.settled) {
        const r = await client.query(
          `UPDATE transactions SET status = $1, date = $2, amount = $3, import_ref = NULL, updated_at = now() WHERE id = $4 AND workspace_id = $5 RETURNING id`,
          [s.status, s.date, s.amount, s.id, ws],
        );
        restored += r.rowCount;
      }
      const removed = (await client.query('DELETE FROM transactions WHERE import_batch_id = $1 AND workspace_id = $2', [id, ws])).rowCount;
      await client.query('DELETE FROM import_batches WHERE id = $1', [id]);
      return { removed, restored };
    });
    res.json(out);
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// What Penny remembers
// ---------------------------------------------------------------------------------------------------------------------------------

router.get(
  '/import/rules',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT r.id, r.merchant_key, r.kind, r.hits, r.updated_at, c.id AS category_id, c.name AS category_name, c.color AS category_color
       FROM import_rules r JOIN categories c ON c.id = r.category_id WHERE r.workspace_id = $1 ORDER BY r.updated_at DESC, r.id DESC LIMIT 1000`,
      [req.workspace.id],
    );
    res.json(rows);
  }),
);

router.delete(
  '/import/rules',
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM import_rules WHERE workspace_id = $1', [req.workspace.id]);
    res.json({ removed: rowCount });
  }),
);

router.delete(
  '/import/rules/:id',
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM import_rules WHERE id = $1 AND workspace_id = $2', [idParam(req), req.workspace.id]);
    if (!rowCount) throw new HttpError(404, t('That rule was not found.'));
    res.json({ removed: 1 });
  }),
);

export default router;
