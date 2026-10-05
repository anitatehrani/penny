import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterOptions, groupOptions, labelOf, moveHighlight } from '../../filterLogic.js';
import { Avatar, Icon } from '../ui.jsx';

/**
 * A filter dropdown: a button that shows what is chosen and opens a list in a popup. With many options the list has a search box
 * (type to narrow it, arrows to move, Enter to choose). Options are { value, label, group?, dot?, person? }; the option with value ''
 * is "no filter", and when something else is chosen the button is highlighted so you can see at a glance what is filtering.
 *
 * The popup is drawn outside the page flow so nothing clips it, flips above the button when there is no room below, and is a
 * bottom sheet on a phone. Escape closes it (without also closing a dialog behind it) and gives focus back to the button.
 */
export default function FilterSelect({ label, value, onChange, options, icon, searchable = options.length > 7, searchLabel, variant = 'filter', disabled = false, id: buttonId }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const pop = useRef(null);
  const field = useRef(null); // the search box, or the list itself when there is no search box
  const id = useId();

  const shown = useMemo(() => filterOptions(options, term), [options, term]);
  const runs = useMemo(() => groupOptions(shown), [shown]);
  const current = String(value ?? '');
  const active = variant === 'filter' && current !== '';

  const place = useCallback(() => {
    if (!button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = Math.max(r.width, 260);
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const flip = below < 260 && above > below;
    setPos({
      left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8))),
      width: Math.round(width),
      ...(flip ? { bottom: Math.round(window.innerHeight - r.top + 6) } : { top: Math.round(r.bottom + 6) }),
      maxHeight: Math.max(180, Math.min(420, flip ? above : below)),
    });
  }, []);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setPos(null);
    setTerm('');
    if (returnFocus) button.current?.focus();
  }, []);

  const openPop = () => {
    place(); // so the popup has its place the moment it is first drawn (focus does not work on something that is not visible yet)
    setTerm('');
    setHi(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  const choose = (o) => {
    onChange(o.value);
    close(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const focusField = () => field.current?.focus();
    focusField();
    const frame = requestAnimationFrame(() => {
      if (!pop.current?.contains(document.activeElement)) focusField();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation(); // a dialog this was opened from must stay open
        e.preventDefault();
        close(true);
      }
    };
    const onDown = (e) => {
      if (!pop.current?.contains(e.target) && !button.current?.contains(e.target)) close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close, place]);

  // keep the highlighted option in view
  useEffect(() => {
    if (open && hi >= 0) pop.current?.querySelector(`#${CSS.escape(`${id}-o${hi}`)}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, hi, id]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => moveHighlight(h, e.key === 'ArrowDown' ? 1 : -1, shown.length));
    } else if (e.key === 'Home' || e.key === 'End') {
      if (!searchable || e.ctrlKey) {
        e.preventDefault();
        setHi(e.key === 'Home' ? 0 : shown.length - 1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[hi]) choose(shown[hi]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close(true);
    }
  };

  const onType = (e) => {
    setTerm(e.target.value);
    setHi(0); // the best match is the first one
  };

  const idx = new Map(shown.map((o, i) => [o, i]));
  const listProps = { role: 'listbox', id: `${id}-list`, 'aria-label': label, 'aria-activedescendant': hi >= 0 && shown[hi] ? `${id}-o${hi}` : undefined };

  return (
    <>
      <button
        type="button"
        ref={button}
        id={buttonId}
        disabled={disabled}
        className={`filter-btn${variant === 'filter' ? '' : ` as-${variant}`}${active ? ' active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        aria-label={`${label}: ${labelOf(options, current)}`}
        onClick={() => (open ? close(false) : openPop())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openPop();
          }
        }}
      >
        {icon && <Icon name={icon} size={16} />}
        {variant !== 'filter' && (() => { const o = options.find((x) => x.value === current) ?? options[0]; return o?.person ? <Avatar user={o.person} size={20} showStatus={false} /> : o?.dot !== undefined ? <span className="dot" style={{ background: o.dot || 'var(--ink-3)' }} /> : null; })()}
        <span className="filter-btn-text">{labelOf(options, current)}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={`${id}-pop`}
            className="filter-pop"
            role="dialog"
            aria-label={`${label} options`}
            style={pos ? { '--pop-left': `${pos.left}px`, '--pop-width': `${pos.width}px`, '--pop-top': pos.top != null ? `${pos.top}px` : 'auto', '--pop-bottom': pos.bottom != null ? `${pos.bottom}px` : 'auto', '--pop-max': `${pos.maxHeight}px` } : undefined}
            onKeyDown={onKeyDown}
          >
            {searchable && (
              <div className="filter-search">
                <Icon name="search" size={16} />
                <input
                  ref={field}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={`${id}-list`}
                  aria-activedescendant={listProps['aria-activedescendant']}
                  aria-autocomplete="list"
                  aria-label={searchLabel ?? `Search ${label.toLowerCase()}`}
                  placeholder={searchLabel ?? `Search ${label.toLowerCase()}…`}
                  autoComplete="off"
                  spellCheck="false"
                  value={term}
                  onChange={onType}
                />
              </div>
            )}
            {shown.length === 0 && (
              <div className="filter-none" role="status">
                Nothing matches “{term.trim()}”
              </div>
            )}
            <div className="filter-list" ref={searchable ? undefined : field} tabIndex={searchable ? undefined : 0} hidden={shown.length === 0} {...listProps}>
              {runs.map((run, r) => (
                <div key={`${run.group}-${r}`} role={run.group ? 'group' : 'presentation'} aria-label={run.group || undefined}>
                  {run.group && (
                    <div className="filter-group" aria-hidden="true">
                      {run.group}
                    </div>
                  )}
                  {run.options.map((o) => {
                    const i = idx.get(o);
                    return (
                      <div
                        key={o.value}
                        id={`${id}-o${i}`}
                        role="option"
                        aria-selected={o.value === current}
                        className={`filter-opt${i === hi ? ' hi' : ''}${o.value === current ? ' chosen' : ''}`}
                        onMouseMove={() => i !== hi && setHi(i)}
                        onMouseDown={(e) => e.preventDefault() /* keep focus in the box */}
                        onClick={() => choose(o)}
                      >
                        {o.person ? <Avatar user={o.person} size={22} showStatus={false} /> : o.dot !== undefined ? <span className="dot" style={{ background: o.dot || 'var(--ink-3)' }} /> : null}
                        <span className="filter-opt-text">{o.label}</span>
                        {o.value === current && <Icon name="check" size={15} />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="sr-only" aria-live="polite">
              {term.trim() ? `${shown.length} ${shown.length === 1 ? 'match' : 'matches'}` : ''}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
