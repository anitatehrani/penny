import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar, Field, Icon, ThemeToggle } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { useUsernameCheck } from '../hooks.js';
import AvatarPicker from '../components/avatar/AvatarPicker.jsx';
import EmailStatus from '../components/EmailStatus.jsx';

function AvatarEditor({ user, name }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="avatar-editor">
      <Avatar user={{ ...user, name }} size={72} status="online" />
      <div className="avatar-editor-body">
        <strong>{name}</strong>
        <div className="muted">@{user.username}</div>
        <div className="avatar-actions">
          <button type="button" className="btn sm" onClick={() => setPicking(true)}>
            <Icon name="camera" size={16} /> Change avatar
          </button>
        </div>
        <p className="field-hint">Use your own photo, your initials, a generated pattern or a small illustration.</p>
      </div>
      {picking && <AvatarPicker onClose={() => setPicking(false)} />}
    </div>
  );
}

function ShareProfile({ user }) {
  const { notify } = useApp();
  const url = `${window.location.origin}/u/${user.username}`;
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: 'svg', margin: 1, width: 168, errorCorrectionLevel: 'M' }).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      notify('Profile link copied');
    } catch {
      notify('Could not copy automatically. Select the link and copy it.', 'error');
    }
  }
  async function share() {
    try {
      await navigator.share({ title: `${user.name} on Penny`, text: `Add me on Penny: @${user.username}`, url });
    } catch {
      /* the user closed the share sheet */
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Share your profile</h2>
      </div>
      <p className="muted">
        Send this link or let someone scan the code. They sign in (or sign up) and can send you a connection request. You decide whether to accept.
      </p>
      {!user.discoverable && (
        <div className="banner warn">
          <Icon name="alert" />
          <div>Your profile is hidden right now, so this link will not work. Turn on “Let people find me” above and save.</div>
        </div>
      )}
      <div className="share-box">
        <div className="share-main">
          <div className="share-link">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Your profile link" />
            <button className="btn" onClick={copy}>
              <Icon name="copy" size={16} /> Copy
            </button>
            {navigator.share && (
              <button className="btn" onClick={share}>
                <Icon name="share" size={16} /> Share
              </button>
            )}
          </div>
          <p className="field-hint">
            Others can also find you by your username <strong>@{user.username}</strong>
            {user.find_by_email && user.discoverable ? ', your email' : ''}
            {user.phone && user.find_by_phone && user.discoverable ? ' or your phone number' : ''}.
          </p>
        </div>
        {svg && <div className="qr" role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
    </section>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const { notify } = useApp();
  const [form, setForm] = useState({
    name: user.name,
    username: user.username,
    phone: user.phone ?? '',
    discoverable: user.discoverable,
    find_by_email: user.find_by_email,
    find_by_phone: user.find_by_phone,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const check = useUsernameCheck(form.username, user.username);

  const dirty =
    form.name !== user.name ||
    form.username !== user.username ||
    (form.phone || '') !== (user.phone || '') ||
    form.discoverable !== user.discoverable ||
    form.find_by_email !== user.find_by_email ||
    form.find_by_phone !== user.find_by_phone;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.put('/profile', { ...form, phone: form.phone.trim() || null });
      setUser(res.user);
      setForm((f) => ({ ...f, username: res.user.username, phone: res.user.phone ?? '' }));
      notify('Profile saved');
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Your profile</h1>
          <p className="muted">How other people see and find you, and how you share your profile.</p>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>Profile picture</h2>
        </div>
        <AvatarEditor user={user} name={form.name || user.name} />
      </section>

      <form className="card form" onSubmit={save}>
        <div className="card-head">
          <h2>About you</h2>
        </div>
        {error && (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>{error.message}</div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Your name">
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
          </Field>
          <Field
            label="Username"
            hint={
              check.checking ? 'Checking…' : !check.available ? check.reason : '3–24 characters: letters, numbers, dots and underscores. This is how people find you.'
            }
          >
            <div className="prefixed">
              <span aria-hidden="true">@</span>
              <input
                value={form.username}
                onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                required
                maxLength={25}
                aria-invalid={!check.available}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Email" hint="Used to sign in. You can't change it here.">
            <input value={user.email} disabled />
          </Field>
          <Field label="Phone number (optional)" hint="International format, e.g. +49 170 1234567. It is not verified.">
            <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+49 170 1234567" maxLength={40} autoComplete="tel" />
          </Field>
        </div>
        <EmailStatus />

        <h3 className="account-sub">Who can find you</h3>
        <label className="check">
          <input type="checkbox" checked={form.discoverable} onChange={(e) => set({ discoverable: e.target.checked })} />
          <span>
            Let people find me
            <span className="muted block small">When off, nobody can find you by username, email or phone, and your profile link stops working. Existing connections are not affected.</span>
          </span>
        </label>
        <label className={`check${form.discoverable ? '' : ' disabled'}`}>
          <input type="checkbox" checked={form.find_by_email} disabled={!form.discoverable} onChange={(e) => set({ find_by_email: e.target.checked })} />
          <span>Allow finding me by my email address</span>
        </label>
        <label className={`check${form.discoverable ? '' : ' disabled'}`}>
          <input type="checkbox" checked={form.find_by_phone} disabled={!form.discoverable} onChange={(e) => set({ find_by_phone: e.target.checked })} />
          <span>Allow finding me by my phone number</span>
        </label>
        <p className="field-hint">People only ever see your name and @username, never your email or phone number. You always approve connection requests yourself.</p>

        <div className="form-actions left">
          <button className="btn primary" disabled={busy || !dirty || !check.available || check.checking}>
            Save profile
          </button>
        </div>
      </form>

      <ShareProfile user={user} />

      <section className="card">
        <div className="card-head">
          <h2>Appearance</h2>
        </div>
        <div className="account-row">
          <span className="muted">Choose a light or dark look, or follow your device.</span>
          <ThemeToggle />
        </div>
      </section>
    </>
  );
}
