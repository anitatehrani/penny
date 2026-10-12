import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import GoogleButton from './GoogleButton.jsx';
import PasswordField from './PasswordField.jsx';
import { Field, Icon, Modal } from './ui.jsx';
import { getLanguage, t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

/** Download what Penny holds about you, as a file. (It is a normal download, not an API call, so the browser saves it.) */
async function downloadMyData() {
  const res = await fetch('/api/auth/account/export', { credentials: 'same-origin', headers: { 'X-Language': getLanguage() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || t('The download failed ({status}).', { status: res.status }));
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ?? 'penny-data.json';
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function DeleteDialog({ onClose }) {
  const { user, googleClientId, setUser } = useAuth();
  const [password, setPassword] = useState('');
  const [credential, setCredential] = useState(null); // a fresh Google sign-in, for an account that has no password
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const proof = user.has_password ? password.length > 0 : !!credential;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/account/delete', { confirm: 'DELETE', ...(user.has_password ? { password } : { credential }) });
      setUser(null); // the account is gone: back to the sign-in page
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('Delete my account')} onClose={onClose}>
      <form onSubmit={submit} className="form">
        {error && (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>{error.message}</div>
          </div>
        )}
        <p>{tRich('This deletes your account {bold}, straight away:', { bold: <strong>{t('for good')}</strong> })}</p>
        <ul className="delete-list">
          <li>{t('your payments, recurring items, installments, debts, categories and receipts;')}</li>
          <li>{t('your personal budget, and your profile, photo, settings and notifications;')}</li>
          <li>{t('your sign-in on every device.')}</li>
        </ul>
        <p className="muted">
          {tRich('It cannot be undone. Copies in the backups are overwritten within about six months. If you share a budget with other people, leave it first, otherwise their payments would be taken away. You may want to {download} first.', { download: <button type="button" className="inline-link" onClick={() => downloadMyData().catch((err) => setError(err))}>{t('download your data')}</button> })}
        </p>
        {user.has_password ? (
          <PasswordField label={t('Your password')} value={password} onChange={setPassword} autoComplete="current-password" />
        ) : googleClientId ? (
          <Field label={t('Confirm it is you')} hint={credential ? t('Confirmed with Google.') : t('This account has no password, so confirm with Google.')}>
            <GoogleButton clientId={googleClientId} text="continue_with" onCredential={setCredential} onError={(err) => setError(err)} />
          </Field>
        ) : (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>{t('This account has no password and Google sign-in is not set up here. Set a password first (Account, then Set password).')}</div>
          </div>
        )}
        <Field label={t('Type DELETE to confirm')}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </Field>
        <div className="form-actions left">
          <button className="btn danger" disabled={busy || typed !== 'DELETE' || !proof}>
            {busy ? t('Deleting…') : t('Delete my account')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Settings, Account: the two documents, a copy of your data, and deleting the account (docs/DESIGN.md section 36). */
export default function YourDataCard() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function download() {
    setBusy(true);
    try {
      await downloadMyData();
      notify(t('Your data was downloaded'));
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  }

  return (
    <>
      <section className="card your-data" aria-labelledby="your-data-h">
        <div className="card-head">
          <h2 id="your-data-h">{t('Your data')}</h2>
        </div>
        <p className="muted">
          {tRich('What Penny keeps about you and why is in the {link}; the rules for using it are the {link2}. Questions? Use the {link3}.', { link: <Link to="/privacy">{t('privacy policy')}</Link>, link2: <Link to="/terms">{t('terms of use')}</Link>, link3: <Link to="/contact">{t('contact form')}</Link> })}
        </p>
        <div className="row-actions">
          <button className="btn" onClick={download} disabled={busy}>
            <Icon name="download" size={16} /> {busy ? t('Preparing…') : t('Download my data')}
          </button>
        </div>
        <p className="muted small">{t('A file with everything in your account: your details, your budgets and what is in them. Your photo and receipt files are not included.')}</p>
      </section>

      <section className="card danger-zone" aria-labelledby="delete-h">
        <div className="card-head">
          <h2 id="delete-h">{t('Delete my account')}</h2>
        </div>
        <p className="muted">{t('Removes your account and everything in it, straight away. This cannot be undone.')}</p>
        <div className="row-actions">
          <button className="btn danger" onClick={() => setAsking(true)}>
            <Icon name="trash" size={16} /> {t('Delete my account…')}
          </button>
        </div>
      </section>
      {asking && <DeleteDialog onClose={() => setAsking(false)} />}
    </>
  );
}
