import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useDismiss } from './hooks.js';
import { Icon } from '../ui.jsx';

const MenuCtx = createContext({ close: () => {} });

/**
 * A dropdown menu. `trigger(props, open)` returns the button that opens it; spread `props` on it.
 * Keyboard: Enter/Space/ArrowDown opens, arrows move, Home/End jump, Escape closes and returns focus.
 */
export function Menu({ trigger, children, header, align = 'end', width, label, placement = 'bottom' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const list = useRef(null);
  const button = useRef(null);
  const id = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);
  useDismiss(root, open, (why) => close(why === 'escape'));

  useEffect(() => {
    if (open) list.current?.querySelector('[role^="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  const onListKey = (e) => {
    const items = [...list.current.querySelectorAll('[role^="menuitem"]:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    const go = (n) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') close(false);
  };

  const triggerProps = {
    ref: button,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
  };

  return (
    <div className="menu-root" ref={root}>
      {trigger(triggerProps, open)}
      {open && (
        <MenuCtx.Provider value={{ close }}>
          <div className={`menu menu-${align} menu-${placement}`} style={width ? { width } : undefined}>
            {header}
            <div role="menu" id={id} aria-label={label} ref={list} onKeyDown={onListKey}>
              {children}
            </div>
          </div>
        </MenuCtx.Provider>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onSelect, to, danger, disabled, hint, checked, role = 'menuitem' }) {
  const { close } = useContext(MenuCtx);
  const run = () => {
    close(false);
    onSelect?.();
  };
  return (
    <button type="button" role={role} aria-checked={role === 'menuitemradio' ? !!checked : undefined} className={`menu-item${danger ? ' danger' : ''}`} disabled={disabled} onClick={run} data-to={to}>
      {icon && <Icon name={icon} size={16} />}
      <span className="menu-item-text">{children}</span>
      {hint && <kbd className="kbd">{hint}</kbd>}
      {checked && <Icon name="check" size={14} />}
    </button>
  );
}

export const MenuLabel = ({ children }) => (
  <div className="menu-label eyebrow" role="presentation">
    {children}
  </div>
);
export const MenuSeparator = () => <div className="menu-sep" role="separator" />;
