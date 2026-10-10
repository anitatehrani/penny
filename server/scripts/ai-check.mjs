/**
 * Check the AI service from the server itself:   node scripts/ai-check.mjs      (Docker: `docker compose exec -T app node scripts/ai-check.mjs`,
 * the live site: `.\penny ai-setup` runs it for you).
 *
 * It sends ONE tiny made-up question (no budget data at all) to the free models in the settings and says in plain words whether an answer came,
 * from which model, or why not. The key is read from the environment and is never printed.
 */
import { aiConfig, askModel, AiError } from '../src/lib/ai.js';

const config = aiConfig();
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.log('No key: OPENROUTER_API_KEY is empty, so the assistant uses only its built-in answers.');
  process.exit(2);
}
if (!config.models.length) {
  console.log('AI_MODELS names no free model (a free model ends in ":free", or is "openrouter/free"), so the AI service stays off.');
  process.exit(2);
}
console.log(`Asking: ${config.models.join(', ')}  (privacy setting: ${config.dataCollection === 'deny' ? 'only providers that do not keep or train on what they get' : 'any free provider, which may keep what it gets'})`);
try {
  const { text, model } = await askModel([
    { role: 'system', content: 'You are a test. Answer with one short friendly sentence.' },
    { role: 'user', content: 'Say that the connection works.' },
  ]);
  console.log(`It works. Answered by ${model}:\n  ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
} catch (e) {
  if (!(e instanceof AiError)) throw e;
  const help = {
    key: 'OpenRouter did not accept the key. Check that it was copied whole, and that it was not deleted on openrouter.ai.',
    policy: 'No free model accepts the privacy setting right now. Free models often keep what they are sent. Penny does not relax this by itself: see the README, "AI answers", before you change AI_DATA_COLLECTION.',
    limit: 'The free quota is used up (or too many questions at once). Try again later; free models allow only so many a day.',
    timeout: 'The service took too long. Try again.',
    empty: 'The model answered with nothing. Try again, or name other free models in AI_MODELS.',
    down: 'The service could not be reached, or the model is not available any more. Try again later, or name other free models in AI_MODELS.',
  }[e.kind];
  console.log(`No answer (${e.kind}). ${help}\n  detail: ${e.message}`);
  process.exit(1);
}
