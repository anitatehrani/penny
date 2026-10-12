import { useEffect, useState } from 'react';
import { usePresenceOf } from '../presence.jsx';
import { avatarTone, initialsOf } from './avatar/identity.js';
import { t } from '../i18n/translate.js';

export { avatarTone, initialsOf };

/**
 * A person's picture, or their initials on a colour that is theirs alone.
 * `status` ('online') draws the small "active now" dot; if it is not given and the person lets others see it,
 * it is looked up from the presence feed. Hover rings are done in CSS.
 */
export function Avatar({ user, size = 32, status, showStatus = true }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user.avatar_url]); // a new picture gets a fresh try
  const live = usePresenceOf(showStatus && size >= 24 ? user.username : null);
  const state = status ?? live;
  const common = { width: size, height: size };
  return (
    <span className="avatar-wrap" style={common}>
      {user.avatar_url && !broken ? (
        <img className="avatar" src={user.avatar_url} alt="" {...common} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span className={`avatar initials tone-${avatarTone(user.username || user.name)}`} style={{ ...common, fontSize: Math.max(10, Math.round(size * 0.38)) }} aria-hidden="true">
          {initialsOf(user.name)}
        </span>
      )}
      {state && <span className={`presence ${state}`} role="img" aria-label={state === 'online' ? t('Active now') : t('Away')} />}
    </span>
  );
}
