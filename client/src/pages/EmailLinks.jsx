import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/ui.jsx';
import { Shell } from './Auth.jsx';

const home = (user) => (
  <Link to={user ? '/' : '/login'}>{user ? 'Go to the app' : 'Go to sign in'}</Link>
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
    <Shell title="Confirm your email" subtitle="One last step to turn on email alerts." footer={home(user)}>
      {state.status === 'done' ? (
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>Your email address is confirmed. You can now turn on email alerts under Notifications → Settings.</div>
        </div>
      ) : !token ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>This link is incomplete. Open the link from the email again, or ask for a new one in your profile.</div>
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
            {state.status === 'busy' ? 'Confirming…' : 'Confirm my email address'}
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
    <Shell title="Stop email alerts" subtitle="You will no longer get payment alerts by email." footer={home(user)}>
      {state.status === 'done' ? (
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>
            Email alerts are off. You will still see notifications in the app. You can turn them back on any time under Notifications → Settings.
          </div>
        </div>
      ) : !token ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>This link is incomplete. Use the link at the bottom of one of our emails.</div>
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
            {state.status === 'busy' ? 'Working…' : 'Turn off email alerts'}
          </button>
        </>
      )}
    </Shell>
  );
}
