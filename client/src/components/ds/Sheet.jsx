import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui.jsx';
import { useFocusTrap, useMedia } from './hooks.js';

/**
 * A panel that slides in from the right on large screens and rises from the bottom on small ones.
 * It keeps focus inside, closes on Escape or a click on the scrim, and gives focus back when it closes.
 */
export function Sheet({ title, subtitle, onClose, children, width = 420, footer, label }) {
  const ref = useRef(null);
  const small = useMedia('(max-width: 820px)');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useFocusTrap(ref, true);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector('[data-autofocus], input, textarea, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div className="sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${small ? 'sheet-bottom' : 'sheet-side'}`} role="dialog" aria-modal="true" aria-label={label ?? title} ref={ref} style={small ? undefined : { width }}>
        {small && <span className="sheet-grip" aria-hidden="true" />}
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
