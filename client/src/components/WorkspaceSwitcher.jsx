import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../workspace.jsx';
import { AvatarStack, Icon } from './ui.jsx';

/** Pick which budget you are working in: your personal one or a shared group. */
export default function WorkspaceSwitcher({ compact = false }) {
  const { spaces, current, switchTo, isGroup } = useWorkspace();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className={`switcher${compact ? ' compact' : ''}`} ref={box}>
      <button className={`switcher-btn${isGroup ? ' group' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={compact ? `Budget: ${current.name}` : undefined} title={compact ? current.name : undefined}>
        <span className="switcher-icon">
          <Icon name={isGroup ? 'users' : 'user'} size={16} />
        </span>
        {!compact && (
          <>
            <span className="switcher-text">
              <strong>{current.name}</strong>
              <span className="muted small">{isGroup ? `Shared · ${current.members.length} people` : 'Only you'}</span>
            </span>
            <Icon name="chevron" size={16} />
          </>
        )}
      </button>
      {open && (
        <div className="switcher-menu" role="listbox" aria-label="Choose a budget">
          {spaces.map((w) => (
            <button
              key={w.id}
              role="option"
              aria-selected={w.id === current.id}
              className={w.id === current.id ? 'active' : ''}
              onClick={() => {
                switchTo(w.id);
                setOpen(false);
              }}
            >
              <span className={`switcher-icon${w.kind === 'group' ? ' group' : ''}`}>
                <Icon name={w.kind === 'group' ? 'users' : 'user'} size={16} />
              </span>
              <span className="switcher-text">
                <strong>{w.kind === 'personal' ? 'Personal' : w.name}</strong>
                {w.kind === 'group' ? <AvatarStack people={w.members} size={18} limit={5} /> : <span className="muted small">Your private budget</span>}
              </span>
              {w.id === current.id && <Icon name="check" size={16} />}
            </button>
          ))}
          <Link to="/people?tab=groups" className="switcher-manage" onClick={() => setOpen(false)}>
            <Icon name="plus" size={14} /> New or manage groups
          </Link>
        </div>
      )}
    </div>
  );
}
