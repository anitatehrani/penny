import { Icon } from '../ui.jsx';
import { useOnline } from './hooks.js';
import { t } from '../../i18n/translate.js';

/**
 * What a place looks like when there is nothing in it, or something went wrong.
 * `art` picks one of a few small inline illustrations (drawn with the current text colours so they work in both themes).
 */
const ART = {
  ledger: (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <rect x="14" y="10" width="68" height="52" rx="6" className="art-fill" />
      <path d="M26 26h44M26 38h30M26 50h38" className="art-line" />
      <circle cx="74" cy="46" r="10" className="art-dot" />
      <path d="M70 46l3 3 6-7" className="art-check" />
    </svg>
  ),
  calm: (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M8 52c14-14 24-14 40 0s28 14 40 0" className="art-line" />
      <path d="M8 40c14-14 24-14 40 0s28 14 40 0" className="art-line soft" />
      <circle cx="68" cy="20" r="9" className="art-dot" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M32 50V34a16 16 0 0132 0v16l6 6H26l6-6z" className="art-fill" />
      <path d="M42 62a6 6 0 0012 0" className="art-line" />
      <circle cx="66" cy="22" r="6" className="art-dot" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M14 58h68" className="art-line" />
      <rect x="20" y="38" width="10" height="20" rx="2" className="art-fill" />
      <rect x="38" y="26" width="10" height="32" rx="2" className="art-fill" />
      <rect x="56" y="14" width="10" height="44" rx="2" className="art-dot" />
    </svg>
  ),
  offline: (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M18 34a42 42 0 0160 0M28 44a28 28 0 0140 0M38 54a14 14 0 0120 0" className="art-line" />
      <path d="M14 14l68 46" className="art-line danger" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M48 12l34 54H14L48 12z" className="art-fill" />
      <path d="M48 34v14M48 56v.01" className="art-line danger" />
    </svg>
  ),
};

export function EmptyState({ icon, art, title, children, action, compact }) {
  return (
    <div className={`state${compact ? ' compact' : ''}`}>
      {art ? (
        <span className="state-art">{ART[art]}</span>
      ) : icon ? (
        <span className="state-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <strong>{title}</strong>
      {children && <p className="muted small">{children}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

/** Something failed to load: say what, offer a retry, and be calm about it. */
export function ErrorState({ error, onRetry, title = t('This did not load'), compact }) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const network = offline || /failed to fetch|networkerror|load failed/i.test(error?.message ?? '');
  return (
    <div className={`state error${compact ? ' compact' : ''}`} role="alert">
      <span className="state-art">{ART[network ? 'offline' : 'error']}</span>
      <strong>{network ? t('Can’t reach the server') : title}</strong>
      <p className="muted small">{network ? t('Check your connection. Nothing is lost; your data is safe.') : error?.message ?? t('Something went wrong. Please try again.')}</p>
      {onRetry && (
        <div className="state-action">
          <button className="btn sm" onClick={onRetry}>
            <Icon name="repeat" size={14} /> {t('Try again')}
          </button>
        </div>
      )}
    </div>
  );
}

/** A slim banner that appears only while the device is offline. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="alert" size={16} />
      <span>{t('You are offline. What you see may be out of date, and changes will not be saved until you reconnect.')}</span>
    </div>
  );
}
