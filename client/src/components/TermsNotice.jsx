import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from './ui.jsx';

/**
 * A one-time notice for somebody who signed up before the terms and the privacy policy existed (or when an older version applied).
 * It does not lock anything: it asks them to read and accept. Never shown to an admin who is only viewing an account.
 */
export default function TermsNotice() {
  const { user, impersonating, acceptTerms } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user || user.terms_accepted || impersonating) return null;
  return (
    <div className="terms-notice" role="region" aria-label="Terms and privacy policy">
      <Icon name="shield" size={18} />
      <span>
        Penny now has <Link to="/terms">Terms of use</Link> and a <Link to="/privacy">Privacy policy</Link>. Please read them and accept to keep using Penny.
      </span>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await acceptTerms();
          } catch {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'I accept'}
      </button>
    </div>
  );
}
