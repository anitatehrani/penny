import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar, Field, Icon, ThemeToggle } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { useUsernameCheck } from '../hooks.js';
import AvatarPicker from '../components/avatar/AvatarPicker.jsx';
import EmailStatus from '../components/EmailStatus.jsx';
import { t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

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
            <Icon name="camera" size={16} /> {t('Change avatar')}
          </button>
        </div>
        <p className="field-hint">{t('Use your own photo, your initials, a generated pattern or a small illustration.')}</p>
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
      notify(t('Profile link copied'));
    } catch {
      notify(t('Could not copy automatically. Select the link and copy it.'), 'error');
    }
  }
  async function share() {
    try {
      await navigator.share({ title: t('{name} on Penny', { name: user.name }), text: t('Add me on Penny: @{username}', { username: user.username }), url });
    } catch {
      /* the user closed the share sheet */
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Share your profile')}</h2>
      </div>
      <p className="muted">
        {t('Send this link or let someone scan the code. They sign in (or sign up) and can send you a connection request. You decide whether to accept.')}
      </p>
      {!user.discoverable && (
        <div className="banner warn">
          <Icon name="alert" />
          <div>{t('Your profile is hidden right now, so this link will not work. Turn on “Let people find me” above and save.')}</div>
        </div>
      )}
      <div className="share-box">
        <div className="share-main">
          <div className="share-link">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('Your profile link')} />
            <button className="btn" onClick={copy}>
              <Icon name="copy" size={16} /> {t('Copy')}
            </button>
            {navigator.share && (
              <button className="btn" onClick={share}>
                <Icon name="share" size={16} /> {t('Share')}
              </button>
            )}
          </div>
          <p className="field-hint">
            {tRich(
              user.find_by_email && user.discoverable && user.phone && user.find_by_phone
                ? 'Others can also find you by your username {username}, your email or your phone number.'
                : user.find_by_email && user.discoverable
                  ? 'Others can also find you by your username {username} or your email.'
                  : user.phone && user.find_by_phone && user.discoverable
                    ? 'Others can also find you by your username {username} or your phone number.'
                    : 'Others can also find you by your username {username}.',
              { username: <strong>@{user.username}</strong> },
            )}
          </p>
        </div>
        {svg && <div className="qr" role="img" aria-label={t('QR code for {url}', { url })} dangerouslySetInnerHTML={{ __html: svg }} />}
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
      notify(t('Profile saved'));
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('Your profile')}</h1>
          <p className="muted">{t('How other people see and find you, and how you share your profile.')}</p>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>{t('Profile picture')}</h2>
        </div>
        <AvatarEditor user={user} name={form.name || user.name} />
      </section>

      <form className="card form" onSubmit={save}>
        <div className="card-head">
          <h2>{t('About you')}</h2>
        </div>
        {error && (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>{error.message}</div>
          </div>
        )}
        <div className="form-grid">
          <Field label={t('Your name')}>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
          </Field>
          <Field
            label={t('Username')}
            hint={
              check.checking ? t('Checking…') : !check.available ? check.reason : t('3–24 characters: letters, numbers, dots and underscores. This is how people find you.')
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
          <Field label={t('Email')} hint={t('Used to sign in. You can\'t change it here.')}>
            <input value={user.email} disabled />
          </Field>
          <Field label={t('Phone number (optional)')} hint={t('International format, e.g. +49 170 1234567. It is not verified.')}>
            <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+49 170 1234567" maxLength={40} autoComplete="tel" />
          </Field>
        </div>
        <EmailStatus />

        <h3 className="account-sub">{t('Who can find you')}</h3>
        <label className="check">
          <input type="checkbox" checked={form.discoverable} onChange={(e) => set({ discoverable: e.target.checked })} />
          <span>
            {t('Let people find me')}
            <span className="muted block small">{t('When off, nobody can find you by username, email or phone, and your profile link stops working. Existing connections are not affected.')}</span>
          </span>
        </label>
        <label className={`check${form.discoverable ? '' : ' disabled'}`}>
          <input type="checkbox" checked={form.find_by_email} disabled={!form.discoverable} onChange={(e) => set({ find_by_email: e.target.checked })} />
          <span>{t('Allow finding me by my email address')}</span>
        </label>
        <label className={`check${form.discoverable ? '' : ' disabled'}`}>
          <input type="checkbox" checked={form.find_by_phone} disabled={!form.discoverable} onChange={(e) => set({ find_by_phone: e.target.checked })} />
          <span>{t('Allow finding me by my phone number')}</span>
        </label>
        <p className="field-hint">{t('People only ever see your name and @username, never your email or phone number. You always approve connection requests yourself.')}</p>

        <div className="form-actions left">
          <button className="btn primary" disabled={busy || !dirty || !check.available || check.checking}>
            {t('Save profile')}
          </button>
        </div>
      </form>

      <ShareProfile user={user} />

      <section className="card">
        <div className="card-head">
          <h2>{t('Appearance')}</h2>
        </div>
        <div className="account-row">
          <span className="muted">{t('Choose a light or dark look, or follow your device.')}</span>
          <ThemeToggle />
        </div>
      </section>
    </>
  );
}
