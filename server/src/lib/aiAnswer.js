// AI answers for the assistant (docs/DESIGN.md section 42): who may have them, and how a question becomes an answer.
// A budget gets AI answers only when (1) the site has an OpenRouter key, (2) the person asking switched them on, and (3) so did every
// other member of that budget, because the figures sent belong to all of them.

import { query } from '../db.js';
import { aiConfig, askModel, takeAllowance } from './ai.js';
import { AGREED_SQL, gatherOtherBudgets } from './aiBudgets.js';
import { buildFactSheet, gatherAiExtras, SYSTEM_RULES } from './aiFacts.js';
import { N_, currentLanguage, t } from './i18n.js';

export const AI_FOLLOW_UPS = [N_('Give me a summary'), N_('Where does my money go?'), N_('Will I go negative?')];

/**
 * { configured, on (this person), waiting (other members who have not agreed), members, ready } for one budget. A member has agreed when they joined
 * (or made) the budget after the window told them the assistant may use its figures, or when they turned AI answers on themselves.
 */
export async function aiAccess(workspaceId, userId, config = aiConfig()) {
  const { rows } = await query(
    `SELECT m.user_id, COALESCE((p.data->>'ai_answers') = 'true', false) AS on, ${AGREED_SQL} AS agreed
     FROM workspace_members m LEFT JOIN user_preferences p ON p.user_id = m.user_id WHERE m.workspace_id = $1`,
    [workspaceId],
  );
  const on = rows.some((r) => r.user_id === userId && r.on);
  const waiting = rows.filter((r) => r.user_id !== userId && !r.agreed).length;
  return { configured: config.enabled, on, waiting, members: rows.length, ready: config.enabled && on && waiting === 0 };
}

export async function setAiAnswers(userId, on) {
  // turning it off also takes back what was agreed by joining budgets
  if (!on) await query('UPDATE workspace_members SET ai_consent_at = NULL WHERE user_id = $1', [userId]);
  await query(
    `INSERT INTO user_preferences (user_id, data) VALUES ($1, jsonb_build_object('ai_answers', $2::boolean))
     ON CONFLICT (user_id) DO UPDATE SET data = user_preferences.data || EXCLUDED.data, updated_at = now()`,
    [userId, on],
  );
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The last few turns of the conversation, so "and last month?" makes sense. They come from the browser, so they are cut and only used as text. */
export function turnsFrom(history = []) {
  const out = [];
  for (const h of history.slice(-3)) {
    const q = clip(h.q, 300);
    const a = clip(h.a, 700);
    if (q && a) out.push({ role: 'user', content: q }, { role: 'assistant', content: a });
  }
  return out;
}

/** The answer text from the AI service. Throws AiError (see ai.js) when it cannot be had. */
export async function answerWithAi({ question, history, workspaceId, userId, facts, config = aiConfig(), fetchImpl }) {
  takeAllowance(userId, config);
  const extras = await gatherAiExtras(workspaceId, facts, question, userId);
  extras.others = await gatherOtherBudgets({ userId, openId: workspaceId, facts, question });
  const messages = [
    { role: 'system', content: `${SYSTEM_RULES}\nThe app is shown in ${currentLanguage() === 'it' ? 'Italian' : 'English'}: if the question does not make its language clear, answer in that language.\n\n--- Budget summary ---\n${buildFactSheet(facts, extras)}` },
    ...turnsFrom(history),
    { role: 'user', content: clip(question, 300) },
  ];
  return (await askModel(messages, { config, fetchImpl })).text;
}
