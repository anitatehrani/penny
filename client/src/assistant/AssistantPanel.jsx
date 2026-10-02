import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState } from '../components/ds/States.jsx';
import { Sheet } from '../components/ds/Sheet.jsx';
import { Icon, Segmented, Skeleton } from '../components/ui.jsx';
import AIInsightCard from './AIInsightCard.jsx';
import { useAssistant } from './assistant.jsx';
import { useInsights } from './insights.jsx';

const STARTERS = ['Give me a summary', 'Will I go negative?', 'What is due soon?', 'Where does my money go?', 'What are my subscriptions?', 'How can I save money?'];

function Answer({ entry, onAsk }) {
  if (entry.status === 'pending') {
    return (
      <div className="chat-a pending" aria-live="polite" aria-label="Working it out">
        <span className="typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="sr-only">Working it out…</span>
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
      <p>{a.answer}</p>
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
  const { closeAssistant, thread, ask, clear, tab, setTab } = useAssistant();
  const { data, loading, error, insights, dismiss, restoreAll, reload } = useInsights();
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread.length, thread.at(-1)?.status, tab]);

  const submit = (e) => {
    e?.preventDefault();
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  const footer = (
    <form className="ask-form" onSubmit={submit}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about your money…" aria-label="Ask about your finances" maxLength={300} data-autofocus />
      <button className="btn primary icon" aria-label="Send" disabled={!draft.trim()}>
        <Icon name="send" size={16} />
      </button>
    </form>
  );

  return (
    <Sheet title="Assistant" subtitle="Worked out from your budget, on this server. Nothing is sent to an outside AI service." onClose={closeAssistant} width={460} footer={footer} label="Financial assistant">
      <div className="assistant">
        <div className="assistant-tabs">
          <Segmented
            label="Assistant view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'chat', label: thread.length ? `Conversation (${thread.length})` : 'Conversation' },
            ]}
          />
          {tab === 'chat' && thread.length > 0 && (
            <button className="nc-link" onClick={clear}>
              Clear
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
                <section className="summary-block" aria-label="Summary">
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

                <section aria-label="Assistant insights">
                  <div className="eyebrow assistant-h">Insights</div>
                  {data.empty ? (
                    <EmptyState art="ledger" title="Nothing to analyse yet" compact>
                      Add a few payments and I will start spotting patterns.
                    </EmptyState>
                  ) : insights.length === 0 ? (
                    <EmptyState art="calm" title="Nothing needs your attention" compact>
                      {data.dismissed ? `You dismissed ${data.dismissed} insight${data.dismissed === 1 ? '' : 's'} this month.` : 'Spending, subscriptions and the forecast all look as expected.'}
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
                      Show {data.dismissed} dismissed
                    </button>
                  )}
                  {data.dismissed > 0 && insights.length === 0 && !data.empty && (
                    <div className="center">
                      <button className="btn sm" onClick={restoreAll}>
                        Show dismissed insights
                      </button>
                    </div>
                  )}
                </section>

                <section aria-label="Things to ask">
                  <div className="eyebrow assistant-h">Try asking</div>
                  <div className="chat-chips">
                    {STARTERS.map((s) => (
                      <button key={s} className="chip" onClick={() => ask(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div className="chat">
            {thread.length === 0 ? (
              <EmptyState art="chart" title="Ask anything about your budget" compact>
                For example “How much did I spend on groceries?” or “Will I go negative?”
                <span className="chat-chips">
                  {STARTERS.slice(0, 4).map((s) => (
                    <button key={s} className="chip" onClick={() => ask(s)}>
                      {s}
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
