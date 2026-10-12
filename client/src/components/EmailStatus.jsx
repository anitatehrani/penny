import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { Icon } from './ui.jsx';
import { t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

/** Whether the sign-in email address is confirmed, with a button to send the confirmation link. */
export default function EmailStatus() {
  const { user } = useAuth();
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null); // { mode, dev_link? }

  async function send() {
    setBusy(true);
    try {
      const res = await api.post('/auth/email/send-verification');
      setSent(res);
      notify(res.mode === 'preview' ? t('No mail server is set up, so the link is shown below instead.') : t('Confirmation link sent to {email}', { email: user.email }));
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  }

  if (user.email_verified) {
    return (
      <p className="email-status ok">
        <Icon name="check" size={16} /> {t('Your email address is confirmed.')} <Link to="/notifications?tab=settings">{t('Email alert settings')}</Link>
      </p>
    );
  }
  return (
    <div className="email-status pending">
      <p>
        <Icon name="mail" size={16} /> {t('Your email address is not confirmed yet. Confirm it to receive email alerts for upcoming payments.')}
      </p>
      <button type="button" className="btn sm" onClick={send} disabled={busy}>
        {sent ? t('Send again') : t('Send confirmation link')}
      </button>
      {sent?.dev_link && (
        <p className="field-hint">
          {tRich('No mail server is configured on this machine, so nothing was emailed. For testing, {link}.', { link: <a href={sent.dev_link}>{t('open the confirmation link')}</a> })}
        </p>
      )}
      {sent && !sent.dev_link && <p className="field-hint">{t('Check your inbox (and spam folder). The link works for 24 hours.')}</p>}
    </div>
  );
}
