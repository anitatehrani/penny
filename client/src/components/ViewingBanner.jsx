import { useEffect, useState } from 'react';
import { minutesLeft } from '../adminLogic.js';
import { useAuth } from '../auth.jsx';
import { Icon } from './ui.jsx';

/**
 * Shown on every page while an admin is viewing as somebody (docs/DESIGN.md section 33): who, how (read-only or not), for how much longer, and
 * the way out. It cannot be dismissed, so nobody can forget which account they are in.
 */
export default function ViewingBanner() {
  const { impersonating, user, stopViewing } = useAuth();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!impersonating) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [impersonating]);
  if (!impersonating) return null;
  const left = minutesLeft(impersonating.expires_at, now);
  return (
    <div className={`viewing-bar${impersonating.read_only ? '' : ' can-write'}`} role="status">
      <Icon name="shield" size={16} />
      <span className="viewing-text">
        You are viewing <strong>{user.name}</strong> (@{user.username}) as an admin <span className="viewing-sep">·</span>{' '}
        <strong>{impersonating.read_only ? 'read-only' : 'changes allowed'}</strong> <span className="viewing-sep">·</span>{' '}
        {left > 0 ? `${left} min left` : 'time is up'}
      </span>
      <button className="btn sm" onClick={stopViewing}>
        Exit and go back to my account
      </button>
    </div>
  );
}
