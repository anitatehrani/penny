import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import GoogleButton from './GoogleButton.jsx';
import PasswordField from './PasswordField.jsx';
import { Field, Icon, Modal } from './ui.jsx';

/** Download what Penny holds about you, as a file. (It is a normal download, not an API call, so the browser saves it.) */
async function downloadMyData() {
  const res = await fetch('/api/auth/account/export', { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `The download failed (${res.status}).`);
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
    <Modal title="Delete my account" onClose={onClose}>
      <form onSubmit={submit} className="form">
        {error && (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>{error.message}</div>
          </div>
        )}
        <p>This deletes your account <strong>for good</strong>, straight away:</p>
        <ul className="delete-list">
          <li>your payments, recurring items, installments, debts, categories and receipts;</li>
          <li>your personal budget, and your profile, photo, settings and notifications;</li>
          <li>your sign-in on every device.</li>
        </ul>
        <p className="muted">
          It cannot be undone. Copies in the backups are overwritten within about six months. If you share a budget with other people, leave it first,
          otherwise their payments would be taken away. You may want to <button type="button" className="inline-link" onClick={() => downloadMyData().catch((err) => setError(err))}>download your data</button> first.
        </p>
        {user.has_password ? (
          <PasswordField label="Your password" value={password} onChange={setPassword} autoComplete="current-password" />
        ) : googleClientId ? (
          <Field label="Confirm it is you" hint={credential ? 'Confirmed with Google.' : 'This account has no password, so confirm with Google.'}>
            <GoogleButton clientId={googleClientId} text="continue_with" onCredential={setCredential} onError={(err) => setError(err)} />
          </Field>
        ) : (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>This account has no password and Google sign-in is not set up here. Set a password first (Account, then Set password).</div>
          </div>
        )}
        <Field label="Type DELETE to confirm">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </Field>
        <div className="form-actions left">
          <button className="btn danger" disabled={busy || typed !== 'DELETE' || !proof}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
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
      notify('Your data was downloaded');
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  }

  return (
    <>
      <section className="card your-data" aria-labelledby="your-data-h">
        <div className="card-head">
          <h2 id="your-data-h">Your data</h2>
        </div>
        <p className="muted">
          What Penny keeps about you and why is in the <Link to="/privacy">privacy policy</Link>; the rules for using it are the <Link to="/terms">terms of use</Link>. Questions? Use the <Link to="/contact">contact form</Link>.
        </p>
        <div className="row-actions">
          <button className="btn" onClick={download} disabled={busy}>
            <Icon name="download" size={16} /> {busy ? 'Preparing…' : 'Download my data'}
          </button>
        </div>
        <p className="muted small">A file with everything in your account: your details, your budgets and what is in them. Your photo and receipt files are not included.</p>
      </section>

      <section className="card danger-zone" aria-labelledby="delete-h">
        <div className="card-head">
          <h2 id="delete-h">Delete my account</h2>
        </div>
        <p className="muted">Removes your account and everything in it, straight away. This cannot be undone.</p>
        <div className="row-actions">
          <button className="btn danger" onClick={() => setAsking(true)}>
            <Icon name="trash" size={16} /> Delete my account…
          </button>
        </div>
      </section>
      {asking && <DeleteDialog onClose={() => setAsking(false)} />}
    </>
  );
}
