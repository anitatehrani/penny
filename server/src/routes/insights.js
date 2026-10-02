import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { rateLimit } from '../lib/auth.js';
import { answerQuestion } from '../lib/assistant.js';
import { HttpError, wrap } from '../lib/http.js';
import { buildCompare, buildInsights, buildSummary, gatherFacts } from '../lib/insights.js';

/** Budget-scoped: the assistant's insights, month summary, and answers to typed questions. */
const router = Router();

const askLimiter = rateLimit({ windowMs: 60_000, max: 40, keyFn: (req) => `ask:${req.user.id}`, message: 'You are asking quickly. Wait a moment and try again.' });
const keySchema = z.string().regex(/^[a-z0-9:_-]{1,80}$/i, 'Not a valid insight');

router.get(
  '/insights',
  wrap(async (req, res) => {
    const facts = await gatherFacts(req.workspace.id);
    const all = buildInsights(facts);
    const { rows } = await query('SELECT insight_key FROM insight_dismissals WHERE user_id = $1 AND workspace_id = $2', [req.user.id, req.workspace.id]);
    const gone = new Set(rows.map((r) => r.insight_key));
    res.json({
      generated_at: new Date().toISOString(),
      empty: facts.isEmpty,
      currency: facts.currency,
      overdue: { count: facts.overdue.count, total: facts.overdue.total },
      balance: facts.balance,
      insights: all.filter((i) => !gone.has(i.key)),
      dismissed: all.filter((i) => gone.has(i.key)).length,
      summary: buildSummary(facts),
      compare: buildCompare(facts),
    });
  }),
);

router.post(
  '/insights/:key/dismiss',
  wrap(async (req, res) => {
    const key = keySchema.parse(req.params.key);
    await query(
      `INSERT INTO insight_dismissals (user_id, workspace_id, insight_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.user.id, req.workspace.id, key],
    );
    res.status(204).end();
  }),
);

// undo one dismissal (the "Undo" in the toast)
router.delete(
  '/insights/:key/dismiss',
  wrap(async (req, res) => {
    const key = keySchema.parse(req.params.key);
    await query('DELETE FROM insight_dismissals WHERE user_id = $1 AND workspace_id = $2 AND insight_key = $3', [req.user.id, req.workspace.id, key]);
    res.status(204).end();
  }),
);

// bring every dismissed insight of this budget back
router.delete(
  '/insights/dismissed',
  wrap(async (req, res) => {
    await query('DELETE FROM insight_dismissals WHERE user_id = $1 AND workspace_id = $2', [req.user.id, req.workspace.id]);
    res.status(204).end();
  }),
);

router.post(
  '/assistant/ask',
  askLimiter,
  wrap(async (req, res) => {
    const { question } = z.object({ question: z.string().trim().min(1, 'Type a question').max(300, 'Keep it under 300 characters') }).parse(req.body);
    const facts = await gatherFacts(req.workspace.id);
    res.json(await answerQuestion(question, { workspaceId: req.workspace.id, facts }));
  }),
);

export default router;
