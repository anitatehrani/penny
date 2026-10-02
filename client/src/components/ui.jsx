import { useEffect, useRef, useState } from 'react';
import { addMonthsYM, currentMonth, monthLabel } from '../format.js';
import { useApp } from '../context.jsx';
import { useTheme } from '../theme.js';
import { Avatar } from './Avatar.jsx';

export { Avatar };

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.01',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  trend: 'M3 17l6-6 4 4 8-9M15 6h6v6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  skip: 'M5 5l14 14M5 19L19 5',
  x: 'M6 6l12 12M18 6L6 18',
  logout: 'M10 4H5a1 1 0 00-1 1v14a1 1 0 001 1h5M15 8l4 4-4 4M19 12H9',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M15.5 3.1a3.5 3.5 0 010 6.8',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
  copy: 'M9 9h11v11H9zM5 15V5a1 1 0 011-1h10',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  chevron: 'M6 9l6 6 6-6',
  bell: 'M6 9a6 6 0 0112 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 004 0',
  bellOff: 'M9.3 4.6A6 6 0 0118 9c0 2.2.4 3.8.9 4.9M6.3 6.3C6.1 7.1 6 8 6 9c0 6-2.5 7.5-2.5 7.5H15M10 20a2 2 0 004 0M3 3l18 18',
  paperclip: 'M20 11.5l-8 8a5 5 0 01-7-7l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  mail: 'M3 6h18v12H3zM3 7l9 6.5L21 7',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5h.01',
  upload: 'M12 16V4M7 8l5-5 5 5M5 20h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  command: 'M9 6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3V6z',
  signal: 'M4 15c3 0 3-6 6-6s3 8 6 8 3-6 6-6',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  panelLeft: 'M3 5h18v14H3zM9 5v14M13 10l2 2-2 2',
  panelRight: 'M3 5h18v14H3zM9 5v14M17 10l-2 2 2 2',
  logout2: 'M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M18 13l-6 6-6-6',
  arrowUp: 'M7 17L17 7M9 7h8v8',
  arrowDown: 'M7 7l10 10M17 9v8H9',
  minus: 'M5 12h14',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8L12 3z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
  palette: 'M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3c0-6-4-11-8-11zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  layout: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  send: 'M4 12l16-8-6 16-2-7-8-1z',
  refresh: 'M20 11a8 8 0 00-14-4M4 4v4h4M4 13a8 8 0 0014 4M20 20v-4h-4',
  eyeOff: 'M3 3l18 18M10.6 6.2A9.8 9.8 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.7M6.5 7.6C3.6 9.5 2 12 2 12s4 7 10 7c1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 004.2 4.2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
};

/** Overlapping avatars for a list of people (max `limit` shown, then "+n"). */
export function AvatarStack({ people, size = 24, limit = 4 }) {
  const shown = people.slice(0, limit);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack" role="group" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.username} user={p} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar initials more" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // the dialog's effect must run once, not on every parent render
  useEffect(() => {
    const opener = document.activeElement; // give focus back here when the dialog closes
    const focusable = () =>
      [...(ref.current?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? [])].filter(
        (el) => el.offsetParent !== null,
      );
    const onKey = (e) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab') return;
      // keep Tab inside the dialog
      const items = focusable();
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (!ref.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MonthNav({ month, onChange }) {
  return (
    <div className="month-nav">
      <button className="btn icon ghost" onClick={() => onChange(addMonthsYM(month, -1))} aria-label="Previous month">
        <Icon name="left" />
      </button>
      <strong className="month-label">{monthLabel(month)}</strong>
      <button className="btn icon ghost" onClick={() => onChange(addMonthsYM(month, 1))} aria-label="Next month">
        <Icon name="right" />
      </button>
      {month !== currentMonth() && (
        <button className="btn sm" onClick={() => onChange(currentMonth())}>
          This month
        </button>
      )}
    </div>
  );
}

export function CategorySelect({ kind, value, onChange, allowAll, allLabel = 'All categories', label = 'Category' }) {
  const { categories } = useApp();
  const list = kind ? categories.filter((c) => c.kind === kind) : categories;
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{allowAll ? allLabel : 'No category'}</option>
      {allowAll && <option value="none">Uncategorized</option>}
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {kind ? c.name : `${c.name} (${c.kind})`}
        </option>
      ))}
    </select>
  );
}

export function CategoryDot({ color, name }) {
  return (
    <span className="cat">
      <span className="dot" style={{ background: color || 'var(--ink-3)' }} />
      {name || 'Uncategorized'}
    </span>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? `active ${o.tone ?? ''}` : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const THEME_OPTIONS = [
  ['light', 'Light', 'sun'],
  ['dark', 'Dark', 'moon'],
  ['system', 'System', 'monitor'],
];

/** Light / Dark / System switch. `compact` shows icons only (sidebar, sign-in page). */
export function ThemeToggle({ compact }) {
  const [pref, setPref] = useTheme();
  return (
    <div className={`segmented theme-toggle${compact ? ' compact' : ''}`} role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={`${label} theme`}
          title={`${label}${value === 'system' ? ' (follow your device)' : ''}`}
          className={pref === value ? 'active' : ''}
          onClick={() => setPref(value)}
        >
          <Icon name={icon} size={16} />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

/** An on/off switch (use instead of a checkbox for settings that apply immediately). */
export function Switch({ checked, onChange, label, disabled, id }) {
  return (
    <button type="button" role="switch" id={id} aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}

/** Grey placeholder shapes while data loads. */
export function Skeleton({ w, h = 14, r, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function Empty({ title, children, icon }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> Loading…
    </div>
  );
}

export function ErrorBox({ error }) {
  return (
    <div className="banner danger" role="alert">
      <Icon name="alert" />
      <div>{error.message}</div>
    </div>
  );
}
