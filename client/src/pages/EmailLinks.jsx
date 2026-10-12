import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { Icon } from '../components/ui.jsx';
import { passwordOk } from '../passwordRules.js';
import { Shell } from './Auth.jsx';
import { t } from '../i18n/translate.js';

const home = (user) => (
  <Link to={user ? '/' : '/login'}>{user ? t('Go to the app') : t('Go to sign in')}</Link>
);

/**
 * /verify-email?token=…  — the link in the confirmation email. It works signed in or out.
 * The token is only spent when the button is pressed, so mail scanners that open links cannot use it up.
 */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, setUser } = useAuth();
  const [state, setState] = useState({ status: 'idle', message: '' });

  async function confirm() {
    setState({ status: 'busy', message: '' });
    try {
      await api.post('/auth/email/verify', { token });
      if (user) {
        try {
          setUser((await api.get('/auth/me')).user);
        } catch {
          /* the next page load will pick it up */
        }
      }
      setState({ status: 'done', message: '' });
    } catch (e) {
      setState({ status: 'error', message: e.message });
    }
  }

  return (
    <Shell title={t('Confirm your email')} subtitle={t('One last step to turn on email alerts.')} footer={home(user)}>
      {state.status === 'done' ? (
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>{t('Your email address is confirmed. You can now turn on email alerts under Notifications → Settings.')}</div>
        </div>
      ) : !token ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>{t('This link is incomplete. Open the link from the email again, or ask for a new one in your profile.')}</div>
        </div>
      ) : (
        <>
          {state.status === 'error' && (
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div>{state.message}</div>
            </div>
          )}
          <button className="btn primary block" onClick={confirm} disabled={state.status === 'busy'}>
            {state.status === 'busy' ? t('Confirming…') : t('Confirm my email address')}
          </button>
        </>
      )}
    </Shell>
  );
}

/** /unsubscribe?token=…  — the link at the bottom of every alert email. It works signed in or out. */
export function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'idle', message: '' });

  async function go() {
    setState({ status: 'busy', message: '' });
    try {
      await api.post('/unsubscribe', { token });
      setState({ status: 'done', message: '' });
    } catch (e) {
      setState({ status: 'error', message: e.message });
    }
  }

  return (
    <Shell title={t('Stop email alerts')} subtitle={t('You will no longer get payment alerts by email.')} footer={home(user)}>
      {state.status === 'done' ? (
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>
            {t('Email alerts are off. You will still see notifications in the app. You can turn them back on any time under Notifications → Settings.')}
          </div>
        </div>
      ) : !token ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>{t('This link is incomplete. Use the link at the bottom of one of our emails.')}</div>
        </div>
      ) : (
        <>
          {state.status === 'error' && (
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div>{state.message}</div>
            </div>
          )}
          <button className="btn primary block" onClick={go} disabled={state.status === 'busy'}>
            {state.status === 'busy' ? t('Working…') : t('Turn off email alerts')}
          </button>
        </>
      )}
    </Shell>
  );
}

/**
 * /reset-password?token=…  — the link in the "reset your password" email. It works signed in or out.
 * The page first asks whether the link is still good (which does not use it up), then takes the new password.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user } = useAuth();
  const [link, setLink] = useState(token ? 'checking' : 'invalid'); // checking | good | invalid
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState({ status: 'idle', error: null });

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    api
      .post('/auth/password/check', { token })
      .then((r) => alive && setLink(r.valid ? 'good' : 'invalid'))
      .catch(() => alive && setLink('invalid'));
    return () => {
      alive = false;
    };
  }, [token]);

  const valid = passwordOk(password, {});
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e) {
    e.preventDefault();
    if (!valid) return setState({ status: 'error', error: { message: t('Please choose a password that meets all the requirements below.') } });
    if (confirm !== password) return setState({ status: 'error', error: { message: t('The two passwords do not match.') } });
    setState({ status: 'busy', error: null });
    try {
      await api.post('/auth/password/reset', { token, new_password: password });
      setState({ status: 'done', error: null });
    } catch (err) {
      setState({ status: 'error', error: err });
    }
  }

  const footer = user ? home(user) : <Link to="/login">{t('Back to sign in')}</Link>;
  if (state.status === 'done') {
    return (
      <Shell title={t('Password changed')} subtitle={t('You can sign in with it now.')} footer={null}>
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>{t('Your password was changed and every device was signed out.')}</div>
        </div>
        <button className="btn primary wide" onClick={() => window.location.assign('/login')}>
          {t('Go to sign in')}
        </button>
      </Shell>
    );
  }
  if (link === 'checking') {
    return (
      <Shell title={t('Choose a new password')} subtitle={t('One moment…')} footer={footer}>
        <p className="muted" role="status">{t('Checking your link…')}</p>
      </Shell>
    );
  }
  if (link === 'invalid') {
    return (
      <Shell title={t('This link has expired')} subtitle={t('Reset links work once and last one hour.')} footer={footer}>
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>{t('This reset link is not valid any more, or was already used. Ask for a new one.')}</div>
        </div>
        <Link className="btn primary wide" to="/forgot-password">
          {t('Ask for a new link')}
        </Link>
      </Shell>
    );
  }
  return (
    <Shell title={t('Choose a new password')} subtitle={t('You will be signed out everywhere, then you can sign in with it.')} footer={footer}>
      <form onSubmit={submit} className="form">
        {state.status === 'error' && (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>
              {state.error.message}
              {state.error.problems?.length > 0 && (
                <ul className="problems">
                  {state.error.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <PasswordField label={t('New password')} value={password} onChange={setPassword} autoComplete="new-password" showRules context={{}} />
        <PasswordField label={t('Confirm new password')} value={confirm} onChange={setConfirm} autoComplete="new-password" hint={mismatch ? t('The passwords do not match yet.') : undefined} />
        <button className="btn primary wide" disabled={state.status === 'busy' || !valid || confirm !== password}>
          {state.status === 'busy' ? t('Saving…') : t('Change my password')}
        </button>
      </form>
    </Shell>
  );
}
