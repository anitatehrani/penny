import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { passwordOk } from '../passwordRules.js';
import GoogleButton from './GoogleButton.jsx';
import PasswordField from './PasswordField.jsx';
import { Avatar, Icon } from './ui.jsx';
import { t } from '../i18n/translate.js';

function PasswordForm({ user, onDone }) {
  const { notify } = useApp();
  const { setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ctx = { email: user.email, name: user.name, username: user.username };

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.put('/auth/password', { current_password: user.has_password ? current : undefined, new_password: next });
      setUser(res.user);
      notify(user.has_password ? t('Password changed. Other devices were signed out.') : t('Password set'));
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form account-form">
      {error && (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>
            {error.message}
            {error.problems?.length > 0 && (
              <ul className="problems">
                {error.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {user.has_password && <PasswordField label={t('Current password')} value={current} onChange={setCurrent} autoComplete="current-password" />}
      <PasswordField label={t('New password')} value={next} onChange={setNext} autoComplete="new-password" showRules context={ctx} />
      <PasswordField label={t('Confirm new password')} value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <div className="form-actions left">
        <button className="btn primary" disabled={busy || !passwordOk(next, ctx) || next !== confirm}>
          {user.has_password ? t('Change password') : t('Set password')}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

export default function AccountCard() {
  const { user, setUser, logout, googleClientId } = useAuth();
  const { notify } = useApp();
  const [changing, setChanging] = useState(false);

  async function link(credential) {
    try {
      setUser((await api.post('/auth/google/link', { credential })).user);
      notify(t('Google account connected'));
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function unlink() {
    if (!window.confirm(t('Disconnect Google? You will sign in with your email and password instead.'))) return;
    try {
      setUser((await api.del('/auth/google')).user);
      notify(t('Google disconnected'));
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Account')}</h2>
        <button className="btn sm" onClick={logout}>
          <Icon name="logout" size={14} /> {t('Sign out')}
        </button>
      </div>
      <div className="account-id">
        <Avatar user={user} size={44} />
        <div>
          <strong>{user.name}</strong>
          <div className="muted">{user.email}</div>
        </div>
      </div>

      <h3 className="account-sub">{t('Password')}</h3>
      {changing ? (
        <PasswordForm user={user} onDone={() => setChanging(false)} />
      ) : (
        <div className="account-row">
          <span className="muted">{user.has_password ? t('Protected with a password.') : t('No password yet — you sign in with Google.')}</span>
          <button className="btn sm" onClick={() => setChanging(true)}>
            {user.has_password ? t('Change password') : t('Set a password')}
          </button>
        </div>
      )}

      <h3 className="account-sub">{t('Google')}</h3>
      <div className="account-row">
        {user.google_linked ? (
          <>
            <span>{t('Connected. You can sign in with Google.')}</span>
            <button className="btn sm" onClick={unlink} disabled={!user.has_password} title={user.has_password ? '' : t('Set a password first')}>
              {t('Disconnect')}
            </button>
          </>
        ) : googleClientId ? (
          <>
            <span className="muted">{t('Connect Google to sign in with one click.')}</span>
            <GoogleButton clientId={googleClientId} text="continue_with" onCredential={link} />
          </>
        ) : (
          <span className="muted">{t('Google sign-in is not set up on this server (see README).')}</span>
        )}
      </div>
    </section>
  );
}
