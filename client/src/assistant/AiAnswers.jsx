import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';

/**
 * AI answers are optional and off until a person turns them on (docs/DESIGN.md section 42). This file holds what they are told, and the switch.
 * The server decides whether the service exists at all: when it does not, nothing here is shown.
 */

export function useAiStatus(workspaceId) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setStatus(null);
    api
      .get('/assistant/ai')
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const turn = useCallback(async (on) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.put('/assistant/ai', { on }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, turn };
}

const WHAT_IS_SENT =
  'Penny sends it your question and a short summary of this budget: amounts, categories, payment names and dates. Account and card numbers are taken out of the payment names first, and Penny does not add your name or e-mail address.';

/** The explanation and the switch. `full` is the longer version for the Settings page. */
export function AiAnswersCard({ ai, full = false, bare = false }) {
  const { status, busy, error, turn } = ai;
  if (!status?.configured) return null;
  const others = status.waiting;
  return (
    <section className={`ai-card${status.on ? ' on' : ''}${bare ? ' bare' : ''}`} aria-label="AI answers">
      <div className="ai-head">
        <Icon name="sparkle" size={16} />
        <strong>{status.ready ? 'AI answers are on' : status.on ? 'AI answers: waiting for the others' : 'Smarter answers (optional)'}</strong>
      </div>
      {!status.on && (
        <>
          <p>
            Right now I answer from fixed rules, on this server. If you turn this on, the questions you type are answered by a free AI service called OpenRouter, so I can
            handle questions I could not understand before. {WHAT_IS_SENT}
          </p>
          <p className="muted">An AI can make mistakes, so check any number that matters. You can turn this off at any time.</p>
          {status.members > 1 && <p className="muted">This budget is shared, so it only works when everyone in it has turned it on, because the summary covers the whole budget.</p>}
        </>
      )}
      {status.on && status.ready && (
        <p>
          The questions you type go to a free AI service (OpenRouter). {WHAT_IS_SENT} The buttons are still answered here on the server.
        </p>
      )}
      {status.on && !status.ready && (
        <p>
          You turned it on, but {others === 1 ? 'one other person' : `${others} other people`} in this budget {others === 1 ? 'has' : 'have'} not yet. Until everyone has, nothing is sent
          and I use my built-in answers.
        </p>
      )}
      {full && status.on && <p className="muted">When it is on, a question you type is not saved by Penny beyond this conversation, and Penny does not keep the service’s answer.</p>}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <button className={`btn sm${status.on ? '' : ' primary'}`} onClick={() => turn(!status.on)} disabled={busy} aria-pressed={status.on}>
        {status.on ? 'Turn off AI answers' : 'Turn on AI answers'}
      </button>
    </section>
  );
}
