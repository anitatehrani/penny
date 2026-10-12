import { useRef, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useApp } from '../../context.jsx';
import { squareAvatar } from '../../images.js';
import { usePrefs } from '../../prefs.jsx';
import { Avatar, avatarTone, initialsOf } from '../Avatar.jsx';
import { Icon, Modal, Segmented } from '../ui.jsx';
import { generatedSvg, illustratedSvg, svgToPng } from './art.js';
import { t } from '../../i18n/translate.js';

const STYLES = [
  { value: 'photo', get label() { return t('Photo'); } },
  { value: 'initials', get label() { return t('Initials'); } },
  { value: 'generated', get label() { return t('Generated'); } },
  { value: 'illustrated', get label() { return t('Illustrated'); } },
];
const COUNT = 8;

function Art({ svg, size }) {
  return <span className="art-avatar" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Choose how you appear to other people: your own photo, plain initials, a generated pattern, or a small illustrated face.
 * Whatever is chosen is saved as your profile picture (generated and illustrated ones are drawn to a small PNG), so
 * everyone sees the same thing.
 */
export default function AvatarPicker({ onClose }) {
  const { user, setUser } = useAuth();
  const { notify } = useApp();
  const { prefs, setPrefs } = usePrefs();
  const input = useRef(null);
  const [style, setStyle] = useState(prefs.avatar_style ?? 'photo');
  const [salt, setSalt] = useState(0);
  const [choice, setChoice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const own = user.avatar_url?.startsWith('/api/avatars/');

  const seedFor = (i) => `${user.username}-${salt}-${i}`;
  const svgFor = (i, size) => (style === 'generated' ? generatedSvg(seedFor(i), size) : illustratedSvg(seedFor(i), size));

  async function save(promise, message) {
    setBusy(true);
    setError(null);
    try {
      const res = await promise();
      setUser(res.user);
      setPrefs({ avatar_style: style });
      notify(message);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  const useDrawn = () => save(async () => api.upload('PUT', '/profile/avatar', await svgToPng(svgFor(choice, 256)), {}), t('Avatar updated'));
  const useInitials = () => save(() => api.del('/profile/avatar'), t('Using your initials'));
  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    save(async () => api.upload('PUT', '/profile/avatar', await squareAvatar(file)), t('Profile picture updated'));
  };

  return (
    <Modal title={t('Choose your avatar')} onClose={onClose}>
      <div className="avatar-picker">
        <div className="avatar-preview">
          {style === 'initials' ? (
            <span className={`avatar initials tone-${avatarTone(user.username)}`} style={{ width: 88, height: 88, fontSize: 32 }} aria-hidden="true">
              {initialsOf(user.name)}
            </span>
          ) : style === 'photo' ? (
            <Avatar user={user} size={88} showStatus={false} />
          ) : (
            <Art svg={svgFor(choice, 88)} size={88} />
          )}
          <div>
            <strong>{user.name}</strong>
            <div className="muted small">@{user.username}</div>
          </div>
        </div>

        <Segmented label={t('Avatar style')} value={style} onChange={setStyle} options={STYLES} />

        {style === 'photo' && (
          <div className="picker-pane">
            <p className="muted small">{t('JPEG, PNG or WebP. It is cropped to a square and shrunk on your device. People who can see your profile can see it.')}</p>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickFile} aria-label={t('Choose a profile picture')} data-testid="avatar-input" />
            <div className="picker-actions">
              <button className="btn primary" onClick={() => input.current.click()} disabled={busy}>
                <Icon name="camera" size={16} /> {user.avatar_url ? t('Upload a new photo') : t('Upload a photo')}
              </button>
              {own && (
                <button className="btn" onClick={useInitials} disabled={busy}>
                  <Icon name="trash" size={16} /> {t('Remove photo')}
                </button>
              )}
            </div>
          </div>
        )}

        {style === 'initials' && (
          <div className="picker-pane">
            <p className="muted small">{t('A colour that is yours, with your initials.')} {user.google_linked ? t('If you connected Google, your Google picture is used when you have no photo.') : ''}</p>
            <div className="picker-actions">
              <button className="btn primary" onClick={useInitials} disabled={busy}>
                {t('Use initials')}
              </button>
            </div>
          </div>
        )}

        {(style === 'generated' || style === 'illustrated') && (
          <div className="picker-pane">
            <div className="picker-grid" role="radiogroup" aria-label={t('{style} avatars', { style })}>
              {Array.from({ length: COUNT }, (_, i) => (
                <button key={`${salt}-${i}`} role="radio" aria-checked={choice === i} aria-label={t('Option {value}', { value: i + 1 })} className={`picker-opt${choice === i ? ' on' : ''}`} onClick={() => setChoice(i)}>
                  <Art svg={svgFor(i, 64)} size={64} />
                </button>
              ))}
            </div>
            <div className="picker-actions">
              <button className="btn primary" onClick={useDrawn} disabled={busy}>
                {t('Use this avatar')}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setSalt((s) => s + 1);
                  setChoice(0);
                }}
                disabled={busy}
              >
                <Icon name="refresh" size={16} /> {t('Show others')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="err-text small" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
