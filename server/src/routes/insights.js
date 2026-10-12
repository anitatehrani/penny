import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { rateLimit } from '../lib/auth.js';
import { AiError, aiConfig, aiNote } from '../lib/ai.js';
import { AI_FOLLOW_UPS, aiAccess, answerWithAi, setAiAnswers } from '../lib/aiAnswer.js';
import { answerQuestion } from '../lib/assistant.js';
import { HttpError, wrap } from '../lib/http.js';
import { buildCompare, buildInsights, buildSummary, gatherFacts } from '../lib/insights.js';
import { t } from '../lib/i18n.js';

/** Budget-scoped: the assistant's insights, month summary, and answers to typed questions. */
const router = Router();

const askLimiter = rateLimit({ windowMs: 60_000, max: 40, keyFn: (req) => `ask:${req.user.id}`, get message() { return t('You are asking quickly. Wait a moment and try again.'); } });
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

const askSchema = z.object({
  question: z.string().trim().min(1, 'Type a question').max(300, 'Keep it under 300 characters'),
  // a button the person pressed (the built-in answers are exact), as opposed to something they typed
  chip: z.boolean().optional(),
  history: z.array(z.object({ q: z.string().max(400), a: z.string().max(1600) })).max(6).optional(),
});

// The AI service (docs/DESIGN.md section 42): off unless the site has a key, the person switched it on and so did everyone in this budget.
router.get(
  '/assistant/ai',
  wrap(async (req, res) => {
    res.json(await aiAccess(req.workspace.id, req.user.id));
  }),
);

router.put(
  '/assistant/ai',
  wrap(async (req, res) => {
    const { on } = z.object({ on: z.boolean() }).strict().parse(req.body);
    if (req.impersonation) throw new HttpError(403, t('You cannot change this for someone else.'));
    if (on && !aiConfig().enabled) throw new HttpError(400, t('AI answers are not set up on this site.'));
    await setAiAnswers(req.user.id, on);
    res.json(await aiAccess(req.workspace.id, req.user.id));
  }),
);

router.post(
  '/assistant/ask',
  askLimiter,
  wrap(async (req, res) => {
    const { question, chip, history } = askSchema.parse(req.body);
    const facts = await gatherFacts(req.workspace.id);
    // never for someone else's account ("view as"), and never unless the site, this person and everyone in the budget have it on
    const access = req.impersonation ? null : await aiAccess(req.workspace.id, req.user.id);
    const ctx = { workspaceId: req.workspace.id, facts, aiOn: Boolean(access?.ready) };
    // The buttons (their answers are exact) and an empty budget (nothing to say) get the built-in answer, like everyone when the service is off.
    if (chip || facts.isEmpty || !ctx.aiOn) return res.json(await answerQuestion(question, ctx));
    try {
      const answer = await answerWithAi({ question, history, workspaceId: req.workspace.id, userId: req.user.id, facts });
      res.json({ intent: 'ai', answer, blocks: [], follow_ups: AI_FOLLOW_UPS.map((s) => t(s)), ai: { used: true } });
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      // only what went wrong is logged, never the question, the answer or any figure
      console.warn(`[ai] no answer (${e.kind}): ${e.message}`);
      res.json({ ...(await answerQuestion(question, ctx)), ai: { used: false, note: aiNote(e.kind) } });
    }
  }),
);

export default router;
