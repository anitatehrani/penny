import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import GoogleButton from '../components/GoogleButton.jsx';
import { Wordmark } from '../components/Logo.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { Field, Icon, ThemeToggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useUsernameCheck } from '../hooks.js';
import { passwordOk } from '../passwordRules.js';

export function Shell({ title, subtitle, children, footer }) {
  return (
    <main className="auth-page">
      <div className="auth-theme">
        <ThemeToggle compact />
      </div>
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <Wordmark height={30} />
          <span className="sr-only">Penny</span>
        </Link>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
        <p className="auth-legal">
          <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/contact">Contact</Link>
        </p>
      </div>
    </main>
  );
}

/** The tick box for the two documents: a card with a proper checkbox, so it is easy to see and to hit, also on a phone. */
function ConsentCheck({ checked, onChange }) {
  return (
    <label className={`consent-card${checked ? ' on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="consent-box" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span className="consent-text">
        I agree to the{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer">
          Terms of use
        </a>{' '}
        and the{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          Privacy policy
        </a>
      </span>
    </label>
  );
}

/** "Sign in with Google" for somebody who has no account yet: the account is only made once they accept. */
function GoogleTermsPrompt({ onAccept, onCancel, busy }) {
  const [agree, setAgree] = useState(false);
  return (
    <div className="banner" role="group" aria-label="Accept the terms to create your account">
      <Icon name="shield" />
      <div>
        <p>There is no Penny account for this Google account yet. To create one, please accept the terms.</p>
        <ConsentCheck checked={agree} onChange={setAgree} />
        <div className="form-actions left">
          <button type="button" className="btn primary" disabled={!agree || busy} onClick={onAccept}>
            {busy ? 'Creating…' : 'Create my account'}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleSection({ onError, text, acceptTerms = false, onNeedTerms }) {
  const { googleClientId, loginWithGoogle } = useAuth();
  if (!googleClientId) {
    return <p className="field-hint auth-hint">Google sign-in is not set up on this server yet. See the README ("Google sign-in") to enable it.</p>;
  }
  return (
    <>
      <GoogleButton clientId={googleClientId} text={text} onCredential={(c) => loginWithGoogle(c, acceptTerms).catch((e) => (e.code === 'terms_required' && onNeedTerms ? onNeedTerms(c) : onError(e.message)))} onError={(e) => onError(e.message)} />
      <div className="divider">
        <span>or use your email</span>
      </div>
    </>
  );
}

function ErrorList({ error }) {
  if (!error) return null;
  return (
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
  );
}

function Login() {
  const { login, loginWithGoogle, googleClientId, signupsOpen, passwordResetAvailable } = useAuth();
  const [pendingGoogle, setPendingGoogle] = useState(null); // a Google answer waiting for the terms to be accepted
  const [identifier, setIdentifier] = useState(''); // an email address or a username
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Shell title="Welcome back" subtitle="Sign in to see your budget." footer={signupsOpen ? <>New here? <Link to="/signup">Create an account</Link></> : <>Sign-ups are closed for now.</>}>
      <GoogleSection text="signin_with" onError={(m) => setError(new Error(m))} onNeedTerms={setPendingGoogle} />
      {pendingGoogle && (
        <GoogleTermsPrompt
          busy={busy}
          onCancel={() => setPendingGoogle(null)}
          onAccept={async () => {
            setBusy(true);
            try {
              await loginWithGoogle(pendingGoogle, true);
            } catch (err) {
              setPendingGoogle(null);
              setError(err);
              setBusy(false);
            }
          }}
        />
      )}
      <form onSubmit={submit} className="form" noValidate={false}>
        <ErrorList error={error} />
        <Field label="Email or username">
          <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com or @username" required autoFocus={!googleClientId} />
        </Field>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        {passwordResetAvailable && (
          <p className="auth-forgot">
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        )}
        <button className="btn primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Shell>
  );
}

/** /forgot-password: ask for an e-mail with a link. The answer is the same for every address, and the page says so. */
function ForgotPassword() {
  const { passwordResetAvailable } = useAuth();
  const [address, setAddress] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email: address });
      setSent(true);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  const back = <>Remembered it? <Link to="/login">Back to sign in</Link></>;
  if (!passwordResetAvailable) {
    return (
      <Shell title="Reset your password" subtitle="This is not available yet." footer={back}>
        <p className="muted">Password reset by e-mail is not set up on this server. Ask the person who runs Penny to reset it for you.</p>
      </Shell>
    );
  }
  if (sent) {
    return (
      <Shell title="Check your e-mail" subtitle="Almost there." footer={back}>
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>
            If an account uses <strong>{address.trim().toLowerCase()}</strong>, an e-mail with a link is on its way. The link works once and expires in an hour. It can take a few minutes, and it may land in spam.
          </div>
        </div>
      </Shell>
    );
  }
  return (
    <Shell title="Reset your password" subtitle="Enter the e-mail address of your account and we will send you a link." footer={back}>
      <form onSubmit={submit} className="form">
        <ErrorList error={error} />
        <Field label="Email">
          <input type="email" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus />
        </Field>
        <button className="btn primary wide" disabled={busy || !address.trim()}>
          {busy ? 'Sending…' : 'Send me a link'}
        </button>
      </form>
    </Shell>
  );
}

function Signup() {
  const { signup, loginWithGoogle, googleClientId, signupsOpen } = useAuth();
  const [pendingGoogle, setPendingGoogle] = useState(null); // a Google answer waiting for the terms to be accepted
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const valid = passwordOk(password, { email, name, username });
  const mismatch = confirm.length > 0 && confirm !== password;
  const check = useUsernameCheck(username);

  // Suggest a username from the email once, if the person has not typed one.
  function suggestUsername() {
    if (username || !email.includes('@')) return;
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g, '').replace(/^[._]+/, '').slice(0, 20);
    if (base.length >= 3) setUsername(base);
  }

  async function submit(e) {
    e.preventDefault();
    if (!valid) return setError(new Error('Please choose a password that meets all the requirements below.'));
    if (confirm !== password) return setError(new Error('The two passwords do not match.'));
    setBusy(true);
    setError(null);
    try {
      await signup({ name, email, username, phone: phone.trim() || null, password, accept_terms: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (!signupsOpen) {
    return (
      <Shell title="Sign-ups are closed" subtitle="New accounts cannot be made right now." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
        <p className="muted">Penny is not taking new people yet. If you were invited, ask the person who invited you.</p>
      </Shell>
    );
  }
  return (
    <Shell title="Create your account" subtitle="Keep your payments, plans and forecast in one private place." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <GoogleSection text="signup_with" acceptTerms={accepted} onError={(m) => setError(new Error(m))} onNeedTerms={setPendingGoogle} />
      {pendingGoogle && (
        <GoogleTermsPrompt
          busy={busy}
          onCancel={() => setPendingGoogle(null)}
          onAccept={async () => {
            setBusy(true);
            try {
              await loginWithGoogle(pendingGoogle, true);
            } catch (err) {
              setPendingGoogle(null);
              setError(err);
              setBusy(false);
            }
          }}
        />
      )}
      <form onSubmit={submit} className="form">
        <ErrorList error={error} />
        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} autoFocus={!googleClientId} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={suggestUsername} autoComplete="email" required />
        </Field>
        <Field
          label="Username"
          hint={check.checking ? 'Checking…' : !check.available && username ? check.reason : 'How friends and family find you. Letters, numbers, dots and underscores.'}
        >
          <div className="prefixed">
            <span aria-hidden="true">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
              required
              maxLength={25}
              autoCapitalize="none"
              autoCorrect="off"
              aria-invalid={!!username && !check.available}
            />
          </div>
        </Field>
        <Field label="Phone number (optional)" hint="International format, e.g. +49 170 1234567. Lets people who know your number find you.">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 170 1234567" autoComplete="tel" maxLength={40} />
        </Field>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" showRules context={{ email, name, username }} />
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? 'The passwords do not match yet.' : undefined}
        />
        <ConsentCheck checked={accepted} onChange={setAccepted} />
        <button className="btn primary wide" disabled={busy || !accepted || !valid || confirm !== password || !username || !check.available || check.checking}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </Shell>
  );
}

/** Anything else sends you to sign in; a shared profile link (/u/name) is remembered to open after login. */
function ToLogin() {
  const { pathname } = useLocation();
  try {
    if (pathname.startsWith('/u/')) sessionStorage.setItem('next', pathname);
  } catch {
    /* ignore */
  }
  return <Navigate to="/login" replace />;
}

export default function AuthPages() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="*" element={<ToLogin />} />
    </Routes>
  );
}
