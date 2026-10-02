import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from '../components/ds/Tooltip.jsx';
import { Icon } from '../components/ui.jsx';
import { dateLabel } from '../format.js';

const SEVERITY = {
  alert: { label: 'Needs attention', icon: 'alert' },
  watch: { label: 'Worth watching', icon: 'eye' },
  good: { label: 'Good news', icon: 'check' },
  info: { label: 'Idea', icon: 'sparkle' },
};

/**
 * One thing the assistant noticed. Plain on the page (a thin signal-coloured rule, no box), with the reasoning one tap away:
 * expand for the numbers behind it, jump to where you can act, ask a follow-up, or dismiss it for the month.
 * The severity is always written out, never carried by colour alone.
 */
export default function AIInsightCard({ insight, onDismiss, onAsk, compact, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const sev = SEVERITY[insight.severity] ?? SEVERITY.info;
  const panelId = `insight-${insight.key.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <article className={`insight sev-${insight.severity}${compact ? ' compact' : ''}${open ? ' open' : ''}`} aria-label={insight.title}>
      <div className="insight-main">
        <div className="insight-meta">
          <span className="insight-tag">
            <Icon name={sev.icon} size={13} /> {sev.label}
          </span>
          {insight.forecast && <span className="badge tone-forecast">Forecast</span>}
        </div>
        <h3 className="insight-title">{insight.title}</h3>
        <p className="insight-body">{insight.body}</p>

        {insight.details?.length > 0 && (
          <div className={`insight-details${open ? ' show' : ''}`} id={panelId} hidden={!open && !compact ? true : undefined}>
            {open && (
              <dl>
                {insight.details.map((d, i) => (
                  <div key={i} className="insight-row">
                    <dt>
                      {d.label}
                      {d.when && <span className="muted"> · {dateLabel(d.when)}</span>}
                    </dt>
                    <dd className={`num ${d.tone ?? ''}`}>{d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        <div className="insight-actions">
          {insight.details?.length > 0 && (
            <button className="insight-link" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}>
              {open ? 'Hide details' : 'Why?'}
              <Icon name="chevron" size={13} />
            </button>
          )}
          {insight.action && (
            <Link className="insight-link" to={insight.action.to}>
              {insight.action.label}
              <Icon name="right" size={13} />
            </Link>
          )}
          {onAsk && insight.ask?.[0] && (
            <button className="insight-link" onClick={() => onAsk(insight.ask[0])}>
              Ask: “{insight.ask[0]}”
            </button>
          )}
        </div>
      </div>
      {onDismiss && (
        <Tooltip label="Dismiss for this month" side="left">
          <button className="btn icon sm ghost insight-x" onClick={() => onDismiss(insight)} aria-label={`Dismiss: ${insight.title}`}>
            <Icon name="x" size={14} />
          </button>
        </Tooltip>
      )}
    </article>
  );
}
