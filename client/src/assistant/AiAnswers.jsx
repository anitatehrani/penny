import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';
import { N_, t, tn } from '../i18n/translate.js';

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

/** Shown where a shared budget is made or joined, only when the AI service exists on this site. Saying yes there counts as agreeing (docs/DESIGN.md section 42). */
export const SHARED_AI_NOTICE =
  N_('About the AI assistant: anyone in a shared budget can ask the assistant questions about it if they turn AI answers on. When they do, a summary of the budget (amounts, categories and payment names, with account and card numbers taken out) is sent to a free AI service. By making or joining this budget you agree to that for this budget only. Turning AI answers off in Settings takes your agreement back.');

const WHAT_IS_SENT =
  N_('Penny sends it your question and a short summary of this budget: amounts, categories, payment names and dates. Account and card numbers are taken out of the payment names first, and Penny does not add your name or e-mail address.');

/** The explanation and the switch. `full` is the longer version for the Settings page. */
export function AiAnswersCard({ ai, full = false, bare = false }) {
  const { status, busy, error, turn } = ai;
  if (!status?.configured) return null;
  const others = status.waiting;
  return (
    <section className={`ai-card${status.on ? ' on' : ''}${bare ? ' bare' : ''}`} aria-label={t('AI answers')}>
      <div className="ai-head">
        <Icon name="sparkle" size={16} />
        <strong>{status.ready ? t('AI answers are on') : status.on ? t('AI answers: waiting for the others') : t('Smarter answers (optional)')}</strong>
      </div>
      {!status.on && (
        <>
          <p>
            {t('Right now I answer from fixed rules, on this server. If you turn this on, the questions you type are answered by a free AI service called OpenRouter, so I can handle questions I could not understand before. {WHAT_IS_SENT}', { WHAT_IS_SENT: t(WHAT_IS_SENT) })}
          </p>
          <p className="muted">{t('An AI can make mistakes, so check any number that matters. You can turn this off at any time.')}</p>
          {status.members > 1 && <p className="muted">{t('This budget is shared. The assistant uses its figures only when everyone in it has agreed: by joining it after being told about the AI assistant, or by turning AI answers on themselves.')}</p>}
        </>
      )}
      {status.on && status.ready && (
        <p>
          {t('The questions you type go to a free AI service (OpenRouter). {WHAT_IS_SENT} The buttons are still answered here on the server.', { WHAT_IS_SENT: t(WHAT_IS_SENT) })}
        </p>
      )}
      {status.on && !status.ready && (
        <p>
          {tn(others, 'You turned it on, but one other person in this budget has not agreed yet.', 'You turned it on, but {n} other people in this budget have not agreed yet.')}{' '}
          {t('People agree by joining a shared budget after being told about the AI assistant, or by turning AI answers on themselves. Until everyone has, nothing is sent and I use my built-in answers.')}
        </p>
      )}
      {status.on && <p className="muted">{t('Turning this off also takes back anything you agreed to by joining a shared budget.')}</p>}
      {full && status.on && <p className="muted">{t('When it is on, a question you type is not saved by Penny beyond this conversation, and Penny does not keep the service’s answer.')}</p>}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <button className={`btn sm${status.on ? '' : ' primary'}`} onClick={() => turn(!status.on)} disabled={busy} aria-pressed={status.on}>
        {status.on ? t('Turn off AI answers') : t('Turn on AI answers')}
      </button>
    </section>
  );
}
