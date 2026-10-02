import { useId, useState } from 'react';
import { passwordChecks } from '../passwordRules.js';

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z';
const EYE_OFF = 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.2 3.8M6.5 7.6C3.9 9.3 2 12 2 12s3.6 6 10 6c1.5 0 2.9-.3 4.1-.8M9.9 9.9a3 3 0 004.2 4.2';

/** Password input with show/hide and (optionally) a live checklist of the password format rules. */
export default function PasswordField({ label, value, onChange, autoComplete, showRules, context, required = true, hint }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const checks = showRules ? passwordChecks(value, context) : [];
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="pw-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          maxLength={128}
          aria-describedby={showRules ? `${id}-rules` : undefined}
        />
        <button type="button" className="pw-toggle" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={visible ? EYE_OFF : EYE} />
          </svg>
        </button>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
      {showRules && (
        <ul className="pw-rules" id={`${id}-rules`} aria-live="polite">
          {checks.map((c) => (
            <li key={c.id} className={c.ok ? 'ok' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={c.ok ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 12h12'} />
              </svg>
              <span>
                {c.label}
                <span className="sr-only">{c.ok ? ' — met' : ' — not met yet'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
