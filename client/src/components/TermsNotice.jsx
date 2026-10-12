import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from './ui.jsx';
import { t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

/**
 * A one-time notice for somebody who signed up before the terms and the privacy policy existed (or when an older version applied).
 * It does not lock anything: it asks them to read and accept. Never shown to an admin who is only viewing an account.
 */
export default function TermsNotice() {
  const { user, impersonating, acceptTerms } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user || user.terms_accepted || impersonating) return null;
  return (
    <div className="terms-notice" role="region" aria-label={t('Terms and privacy policy')}>
      <Icon name="shield" size={18} />
      <span>
        {tRich('Penny now has {link} and a {link2}. Please read them and accept to keep using Penny.', { link: <Link to="/terms">{t('Terms of use')}</Link>, link2: <Link to="/privacy">{t('Privacy policy')}</Link> })}
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
        {busy ? t('Saving…') : t('I accept')}
      </button>
    </div>
  );
}
