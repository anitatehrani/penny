import { useState } from 'react';
import AIInsightCard from '../../assistant/AIInsightCard.jsx';
import { useAssistant } from '../../assistant/assistant.jsx';
import { useInsights } from '../../assistant/insights.jsx';
import { ErrorState } from '../../components/ds/States.jsx';
import { Icon, Skeleton } from '../../components/ui.jsx';
import { t, tn } from '../../i18n/translate.js';

/**
 * The assistant on the dashboard. It says something only when there is something to say: at most two insights,
 * the most urgent first, each dismissible and expandable. A one-line command bar lets you ask anything else.
 * The month summary is one tap away, folded by default.
 */
export default function InsightsWidget() {
  const { data, loading, error, insights, dismiss, reload } = useInsights();
  const { openAssistant, ask } = useAssistant();
  const [draft, setDraft] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);

  if (error && !data) return <ErrorState error={error} onRetry={reload} compact />;
  if (loading && !data) {
    return (
      <div className="insights-widget" aria-busy="true" aria-label={t('Loading insights')}>
        <Skeleton w="100%" h={74} r={8} />
      </div>
    );
  }
  const top = insights.slice(0, 2);
  const more = insights.length - top.length;

  const submit = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    ask(draft);
    openAssistant({ tab: 'chat' });
    setDraft('');
  };

  return (
    <div className="insights-widget">
      {top.length > 0 ? (
        <div className="insight-list">
          {top.map((i) => (
            <AIInsightCard key={i.key} insight={i} onDismiss={dismiss} onAsk={(q) => openAssistant({ ask: q, chip: true })} />
          ))}
        </div>
      ) : (
        <p className="insights-calm">
          <Icon name="check" size={15} />{' '}
          {data.dismissed ? t('Nothing needs your attention (you dismissed {n}). Spending, bills and the forecast look as expected.', { n: data.dismissed }) : t('Nothing needs your attention. Spending, bills and the forecast look as expected.')}
        </p>
      )}

      <div className="insights-foot">
        <form className="ask-inline" onSubmit={submit}>
          <Icon name="signal" size={16} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('Ask about my finances…  e.g. “What changed this month?”')} aria-label={t('Ask about my finances')} maxLength={300} />
          {draft.trim() && (
            <button className="btn sm primary" aria-label={t('Ask')}>
              {t('Ask')}
            </button>
          )}
        </form>
        <div className="insights-links">
          <button className="link-quiet" onClick={() => setSummaryOpen((o) => !o)} aria-expanded={summaryOpen}>
            {data.summary.title}
            <Icon name="chevron" size={13} />
          </button>
          {more > 0 && (
            <button className="link-quiet" onClick={() => openAssistant()}>
              {tn(more, '{n} more insight', '{n} more insights')}
            </button>
          )}
        </div>
      </div>

      <div className={`section-collapse${summaryOpen ? '' : ' closed'}`}>
        <div>
          <div className="summary-inline">
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
          </div>
        </div>
      </div>
    </div>
  );
}
