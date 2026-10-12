import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState } from '../components/ds/States.jsx';
import { Sheet } from '../components/ds/Sheet.jsx';
import { Icon, Segmented, Skeleton } from '../components/ui.jsx';
import AIInsightCard from './AIInsightCard.jsx';
import { AiAnswersCard, useAiStatus } from './AiAnswers.jsx';
import { useAssistant } from './assistant.jsx';
import { useInsights } from './insights.jsx';
import { N_, t, tn } from '../i18n/translate.js';

const STARTERS = [N_('Give me a summary'), N_('Will I go negative?'), N_('What is due soon?'), N_('Where does my money go?'), N_('What are my subscriptions?'), N_('How can I save money?')];

function Answer({ entry, onAsk }) {
  if (entry.status === 'pending') {
    return (
      <div className="chat-a pending" aria-live="polite" aria-label={t('Working it out')}>
        <span className="typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="sr-only">{t('Working it out…')}</span>
      </div>
    );
  }
  if (entry.status === 'error') {
    return (
      <div className="chat-a error" role="alert">
        <Icon name="alert" size={16} /> {entry.error}
      </div>
    );
  }
  const a = entry.a;
  return (
    <div className="chat-a" aria-live="polite">
      <p className={a.ai?.used ? 'ai-text' : undefined}>{a.answer}</p>
      {a.ai?.used && (
        <p className="ai-label">
          <Icon name="sparkle" size={12} /> {t('Written by an AI service. It can make mistakes, so check any number that matters.')}
        </p>
      )}
      {a.ai?.note && <p className="ai-label">{a.ai.note}</p>}
      {a.blocks.map((b, i) =>
        b.type === 'rows' && b.rows.length ? (
          <dl className="chat-rows" key={i}>
            {b.rows.map((r, j) => (
              <div key={j} className="chat-row">
                <dt>
                  {r.color && <span className="dot" style={{ background: r.color }} />}
                  {r.label}
                  {r.sub && <span className="muted"> · {r.sub}</span>}
                </dt>
                <dd className={`num ${r.tone ?? ''}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : null,
      )}
      {a.link && (
        <Link className="insight-link" to={a.link.to}>
          {a.link.label} <Icon name="right" size={13} />
        </Link>
      )}
      {a.follow_ups?.length > 0 && (
        <div className="chat-chips">
          {a.follow_ups.slice(0, 4).map((f) => (
            <button key={f} className="chip" onClick={() => onAsk(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssistantPanel() {
  const { closeAssistant, thread, ask: askAny, clear, tab, setTab } = useAssistant();
  const ai = useAiStatus();
  const ask = (q) => askAny(q, { chip: true }); // a button: the built-in answer is exact
  const aiOn = Boolean(ai.status?.ready);
  const { data, loading, error, insights, dismiss, restoreAll, reload } = useInsights();
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread.length, thread.at(-1)?.status, tab]);

  const submit = (e) => {
    e?.preventDefault();
    if (!draft.trim()) return;
    askAny(draft); // typed: may go to the AI service, if it is on
    setDraft('');
  };

  const footer = (
    <form className="ask-form" onSubmit={submit}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={aiOn ? t('Ask anything about your money…') : t('Ask about your money…')} aria-label={t('Ask about your finances')} maxLength={300} data-autofocus />
      <button className="btn primary icon" aria-label={t('Send')} disabled={!draft.trim()}>
        <Icon name="send" size={16} />
      </button>
    </form>
  );

  return (
    <Sheet title={t('Assistant')} subtitle={aiOn ? t('The buttons are worked out here, on this server. Questions you type go to an AI service you turned on.') : t('Worked out from your budget, on this server. Nothing is sent to an outside AI service.')} onClose={closeAssistant} width={460} footer={footer} label={t('Financial assistant')}>
      <div className="assistant">
        <div className="assistant-tabs">
          <Segmented
            label={t('Assistant view')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: t('Overview') },
              { value: 'chat', label: thread.length ? t('Conversation ({length})', { length: thread.length }) : t('Conversation') },
            ]}
          />
          {tab === 'chat' && thread.length > 0 && (
            <button className="nc-link" onClick={clear}>
              {t('Clear')}
            </button>
          )}
        </div>

        {tab === 'overview' && (
          <div className="assistant-overview">
            {error && !data ? (
              <ErrorState error={error} onRetry={reload} compact />
            ) : loading && !data ? (
              <div aria-busy="true">
                <Skeleton w="40%" h={12} />
                <Skeleton w="100%" h={60} />
                <Skeleton w="90%" h={14} />
              </div>
            ) : (
              <>
                <section className="summary-block" aria-label={t('Summary')}>
                  <div className="eyebrow">{data.summary.title}</div>
                  <p>{data.summary.text}</p>
                  {data.summary.stats.length > 0 && (
                    <dl className="stat-grid">
                      {data.summary.stats.map((s) => (
                        <div key={s.label}>
                          <dt className="eyebrow">{s.label}</dt>
                          <dd className={`num ${s.tone ?? ''}`}>{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>

                <section aria-label={t('Assistant insights')}>
                  <div className="eyebrow assistant-h">{t('Insights')}</div>
                  {data.empty ? (
                    <EmptyState art="ledger" title={t('Nothing to analyse yet')} compact>
                      {t('Add a few payments and I will start spotting patterns.')}
                    </EmptyState>
                  ) : insights.length === 0 ? (
                    <EmptyState art="calm" title={t('Nothing needs your attention')} compact>
                      {data.dismissed ? tn(data.dismissed, 'You dismissed {n} insight this month.', 'You dismissed {n} insights this month.') : t('Spending, subscriptions and the forecast all look as expected.')}
                    </EmptyState>
                  ) : (
                    <div className="insight-list">
                      {insights.map((i) => (
                        <AIInsightCard key={i.key} insight={i} compact onDismiss={dismiss} onAsk={ask} />
                      ))}
                    </div>
                  )}
                  {data.dismissed > 0 && insights.length > 0 && (
                    <button className="nc-link" onClick={restoreAll}>
                      {t('Show {dismissed} dismissed', { dismissed: data.dismissed })}
                    </button>
                  )}
                  {data.dismissed > 0 && insights.length === 0 && !data.empty && (
                    <div className="center">
                      <button className="btn sm" onClick={restoreAll}>
                        {t('Show dismissed insights')}
                      </button>
                    </div>
                  )}
                </section>

                <section aria-label={t('Things to ask')}>
                  <div className="eyebrow assistant-h">{t('Try asking')}</div>
                  <div className="chat-chips">
                    {STARTERS.map((s) => (
                      <button key={s} className="chip" onClick={() => ask(s)}>
                        {t(s)}
                      </button>
                    ))}
                  </div>
                </section>
                <AiAnswersCard ai={ai} />
              </>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div className="chat">
            {thread.length === 0 && <AiAnswersCard ai={ai} />}
            {thread.length === 0 ? (
              <EmptyState art="chart" title={t('Ask anything about your budget')} compact>
                {t('For example “How much did I spend on groceries?” or “Will I go negative?”')}
                <span className="chat-chips">
                  {STARTERS.slice(0, 4).map((s) => (
                    <button key={s} className="chip" onClick={() => ask(s)}>
                      {t(s)}
                    </button>
                  ))}
                </span>
              </EmptyState>
            ) : (
              thread.map((entry) => (
                <div key={entry.id} className="chat-turn">
                  <div className="chat-q">{entry.q}</div>
                  <Answer entry={entry} onAsk={ask} />
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
