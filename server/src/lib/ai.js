import { t } from './i18n.js';
// Asking an outside AI service for an answer (docs/DESIGN.md section 42). Only OpenRouter, only its FREE models, only when the person who runs the
// site has put OPENROUTER_API_KEY in .env, and (see aiAnswer.js) only for budgets whose every member switched it on.
// This file knows nothing about budgets: it sends the messages it is given and returns plain text. The key is never logged or sent anywhere else.

export const DEFAULT_MODELS = ['openrouter/free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free'];
const MAX_MODELS = 3; // what OpenRouter accepts in one request (it tries them in order)
const MAX_ANSWER = 1500;

/** "Free" is checked here, so a mistake in AI_MODELS can never start costing money. */
export const isFreeModel = (id) => {
  const m = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?::([A-Za-z0-9._-]+))?$/.exec(String(id));
  return Boolean(m) && String(id).length <= 100 && (id === 'openrouter/free' || m[1] === 'free');
};

const count = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * What is switched on. `enabled` needs a key and at least one free model. AI_MODELS may name others (comma separated); anything that is
 * not free is dropped, and if nothing free is left the assistant stays off rather than quietly using a default.
 */
export function aiConfig(env = process.env) {
  const key = String(env.OPENROUTER_API_KEY ?? '').trim();
  const asked = String(env.AI_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const models = (asked.length ? asked : DEFAULT_MODELS).filter(isFreeModel).slice(0, MAX_MODELS);
  return {
    enabled: key.length > 0 && models.length > 0,
    key,
    models,
    base: String(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    // 'deny' = only providers that promise not to keep or train on what they are sent. 'allow' is the operator's own decision (README).
    dataCollection: String(env.AI_DATA_COLLECTION ?? '').toLowerCase() === 'allow' ? 'allow' : 'deny',
    // OpenRouter's free models allow only so many questions a day for the whole site, so the site keeps its own count (0 = no limit)
    dailyLimit: count(env.AI_DAILY_LIMIT, 40),
    personDailyLimit: count(env.AI_PERSON_DAILY_LIMIT, 20),
    timeoutMs: count(env.AI_TIMEOUT_MS, 30_000),
    appUrl: String(env.APP_URL ?? ''),
  };
}

/** Why a question could not be answered: 'limit' (ours or theirs), 'policy', 'key', 'timeout', 'down' or 'empty'. */
export class AiError extends Error {
  constructor(kind, detail = '') {
    super(detail || kind);
    this.kind = kind;
  }
}

/** The words shown to the person when the service could not answer (the built-in answer follows). */
export const AI_NOTES = {
  get limit() { return t('The free AI service has reached its limit for now, so this answer comes from Penny’s built-in rules.'); },
  get default() { return t('The AI service could not answer just now, so this answer comes from Penny’s built-in rules.'); },
};
export const aiNote = (kind) => AI_NOTES[kind] ?? AI_NOTES.default;

// ------------------------------------------------------------------------------------------------
// a count of questions per day (in memory: a restart gives a fresh day, which is fine for a limit that only protects a free quota)
// ------------------------------------------------------------------------------------------------
const usage = { day: '', total: 0, people: new Map() };
const roll = () => {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, total: 0, people: new Map() });
};

/** Count one question for this person. Throws AiError('limit') when the day's allowance is used up. */
export function takeAllowance(userId, config = aiConfig()) {
  roll();
  const mine = usage.people.get(userId) ?? 0;
  if ((config.dailyLimit && usage.total >= config.dailyLimit) || (config.personDailyLimit && mine >= config.personDailyLimit)) throw new AiError('limit', t('daily allowance used up'));
  usage.total += 1;
  usage.people.set(userId, mine + 1);
}
export function resetAllowance() {
  usage.day = '';
}

// ------------------------------------------------------------------------------------------------
// the request
// ------------------------------------------------------------------------------------------------
/** Text from the model made safe to show: no hidden "thinking", no markdown marks, a sensible length. */
export function cleanAnswer(raw) {
  let s = String(raw ?? '');
  s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/<\/?think(?:ing)?>/gi, '');
  s = s.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/^#{1,6}\s+/gm, '').replace(/`{1,3}/g, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > MAX_ANSWER) s = `${s.slice(0, MAX_ANSWER).replace(/\s+\S*$/, '')}…`;
  return s;
}

const kindOf = (status, message) => {
  if (status === 401 || status === 403) return 'key';
  if (/data policy|privacy|zero data retention/i.test(message)) return 'policy';
  if (status === 429 || status === 402 || /rate.?limit|free-models-per-day|quota|credits/i.test(message)) return 'limit';
  return 'down';
};

/**
 * Send messages [{ role, content }] and get the answer text. Throws AiError. `fetchImpl` is for tests.
 * Nothing about the request or the answer is logged: only what went wrong (a word and a status).
 */
export async function askModel(messages, opts = {}) {
  try {
    return await askOnce(messages, opts);
  } catch (e) {
    if (!(e instanceof AiError) || e.kind !== 'empty') throw e;
    return askOnce(messages, opts);
  }
}

async function askOnce(messages, { config = aiConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (!config.enabled) throw new AiError('down', 'not set up');
  const body = {
    model: config.models[0],
    ...(config.models.length > 1 ? { models: config.models } : {}),
    messages,
    temperature: 0.2,
    // some free models think silently first and that counts against max_tokens: a small limit left no room for the answer itself
    max_tokens: 2000,
    reasoning: { effort: 'low', exclude: true },
    provider: { data_collection: config.dataCollection, allow_fallbacks: true },
  };
  let res;
  try {
    res = await fetchImpl(`${config.base}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.key}`,
        'content-type': 'application/json',
        ...(config.appUrl ? { 'http-referer': config.appUrl } : {}),
        'x-title': 'Penny',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    throw new AiError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'down', e?.name ?? 'network');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON: handled below */
  }
  const problem = json?.error?.message ? String(json.error.message) : '';
  if (!res.ok || json?.error) {
    const kind = kindOf(Number(json?.error?.code) || res.status, problem);
    throw new AiError(kind, `status ${res.status}${problem ? `: ${problem.slice(0, 160)}` : ''}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  const text = cleanAnswer(Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : content);
  if (!text) throw new AiError('empty', `the model sent no text (${json?.choices?.[0]?.finish_reason ?? 'no reason given'})`);
  return { text, model: typeof json.model === 'string' ? json.model : config.models[0] };
}
