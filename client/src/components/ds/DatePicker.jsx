import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDaysYMD, addMonthsYMD, clampDate, dateChoice, daysInMonth, isYMD, monthGrid, moveCursor, pageFor, weekdayLabels } from '../../dateLogic.js';
import { addMonthsYM, dateLabel, monthLabel, todayYMD } from '../../format.js';
import { Icon } from '../ui.jsx';
import { MonthCalendar } from './MonthPicker.jsx';

const FULL = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
const SHOWN = { day: 'numeric', month: 'short', year: 'numeric' };

/** Can any day of this month ("YYYY-MM") be picked? Used to grey out the month arrows at the ends of the allowed range. */
const yearHasChoice = (year, { min, max }) => (!min || `${year}-12-31` >= min) && (!max || `${year}-01-01` <= max);
const monthHasChoice = (ym, { min, max }) => dateChoice(`${ym}-01`, { min: '', max }).ok && dateChoice(addDaysYMD(`${addMonthsYM(ym, 1)}-01`, -1), { min, max: '' }).ok;

/**
 * Our own date picker, in place of the browser's (docs/DESIGN.md section 32). A button that looks like the other form fields and shows the
 * day ("Thu, 15 Oct 2026"); it opens a calendar page with the month as a title (click it to jump to another month or year), arrows,
 * Monday-first weeks, today ringed and the chosen day filled. Days outside min..max are struck through with the reason as a tooltip.
 *
 * `value` and `onChange` are "YYYY-MM-DD", exactly like the native input they replace. `label` names the field for screen readers.
 * Keyboard: arrows move a day or a week, Home and End go to the ends of the week, Page Up and Page Down change month (Shift: year),
 * Enter or Space choose, Escape closes it without closing a dialog behind it, Tab stays inside it while it is open.
 */
export default function DatePicker({ value, onChange, min = '', max = '', label = 'Date', id, disabled = false, placeholder = 'Pick a date', compact = false, className = '' }) {
  const today = todayYMD();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [view, setView] = useState('days'); // 'days' | 'months'
  const [page, setPage] = useState(() => pageFor(value, today, { min, max }));
  const [cursor, setCursor] = useState(today);
  const button = useRef(null);
  const pop = useRef(null);
  const wantFocus = useRef(false);
  const popId = useId();
  const limits = { min, max };
  const valid = isYMD(value);

  const place = useCallback(() => {
    if (!button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = pop.current?.offsetWidth ?? 300;
    const height = pop.current?.offsetHeight ?? 390;
    const below = window.innerHeight - r.bottom;
    const top = below < height + 12 && r.top > height + 12 ? r.top - height - 6 : r.bottom + 6;
    setPos({ top: Math.round(Math.max(8, top)), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8))) });
  }, []);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setPos(null);
    setView('days');
    if (returnFocus) button.current?.focus();
  }, []);

  const openIt = () => {
    const start = valid && dateChoice(value, limits).ok ? value : clampDate(today, min, max);
    setCursor(start);
    setPage(start.slice(0, 7));
    setView('days');
    wantFocus.current = true;
    place();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, view, page, place]);

  // Put focus on the day the keyboard is on, after opening and after every move.
  useEffect(() => {
    if (!open || view !== 'days' || !wantFocus.current) return;
    const el = pop.current?.querySelector(`button[data-ymd="${cursor}"]`);
    if (el) {
      el.focus();
      wantFocus.current = false;
    }
  }, [open, view, cursor, page]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // capture phase, and swallowed: a dialog this popup was opened from must stay open
        e.stopImmediatePropagation();
        e.preventDefault();
        if (view === 'months') setView('days');
        else close(true);
      } else if (e.key === 'Tab' && pop.current?.contains(document.activeElement)) {
        const items = [...pop.current.querySelectorAll('button:not([disabled]):not([tabindex="-1"])')];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement);
        const next = e.shiftKey ? items[(at - 1 + items.length) % items.length] : items[(at + 1) % items.length];
        e.preventDefault();
        e.stopImmediatePropagation();
        next.focus();
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
  }, [open, view, close, place]);

  const pick = (ymd) => {
    onChange(ymd);
    close(true);
  };

  const goMonth = (delta) => {
    const to = addMonthsYMD(cursor, delta);
    setPage(to.slice(0, 7));
    setCursor(clampDate(to, min, max));
  };
  const goYear = (delta) => setPage((p) => addMonthsYM(p, delta));

  const onGridKey = (e) => {
    if (!e.target.dataset?.ymd) return;
    const to = moveCursor(cursor, e.key, { shift: e.shiftKey, min, max });
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      if (to !== cursor) {
        wantFocus.current = true;
        setCursor(to);
        setPage(to.slice(0, 7));
      }
    }
  };

  const grid = open ? monthGrid(page) : [];
  const names = weekdayLabels(1);
  const todayOk = dateChoice(today, limits).ok;
  // In the day view the arrows move a month, in the month view a year.
  const step = view === 'months' ? 12 : 1;
  const prevOk = view === 'months' ? yearHasChoice(Number(page.slice(0, 4)) - 1, limits) : monthHasChoice(addMonthsYM(page, -1), limits);
  const nextOk = view === 'months' ? yearHasChoice(Number(page.slice(0, 4)) + 1, limits) : monthHasChoice(addMonthsYM(page, 1), limits);
  // Only one day is in the tab order: the one the keyboard is on (when it is on this page), else the first day of the page.
  const tabDay = grid.some((c) => c.ymd === cursor && c.inMonth) ? cursor : grid.find((c) => c.inMonth && dateChoice(c.ymd, limits).ok)?.ymd;

  return (
    <>
      <button
        type="button"
        ref={button}
        id={id}
        disabled={disabled}
        className={`filter-btn ${compact ? 'as-inline' : 'as-field'} date-btn${valid ? '' : ' empty'} ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${label}: ${valid ? dateLabel(value, FULL) : 'not set'}`}
        onClick={() => (open ? close(false) : openIt())}
      >
        <Icon name="calendar" size={16} />
        <span className="filter-btn-text" title={valid ? dateLabel(value, FULL) : undefined}>{valid ? dateLabel(value, SHOWN) : placeholder}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={pop} id={popId} role="dialog" aria-label={label} className="date-pop" style={pos ? { '--pop-top': `${pos.top}px`, '--pop-left': `${pos.left}px` } : undefined}>
            <div className="date-head">
              <button type="button" className="btn icon ghost" aria-label={view === 'months' ? 'Previous year' : 'Previous month'} disabled={!prevOk} onClick={() => (view === 'months' ? goYear(-step) : goMonth(-1))}>
                <Icon name="left" size={16} />
              </button>
              <button type="button" className="date-title" aria-live="polite" aria-expanded={view === 'months'} aria-label={`${monthLabel(page)}, choose another month or year`} onClick={() => setView((v) => (v === 'days' ? 'months' : 'days'))}>
                {view === 'months' ? page.slice(0, 4) : monthLabel(page)}
                <Icon name="chevron" size={13} />
              </button>
              <button type="button" className="btn icon ghost" aria-label={view === 'months' ? 'Next year' : 'Next month'} disabled={!nextOk} onClick={() => (view === 'months' ? goYear(step) : goMonth(1))}>
                <Icon name="right" size={16} />
              </button>
            </div>
            {view === 'months' ? (
              <MonthCalendar
                value={page}
                today={today.slice(0, 7)}
                min={min ? min.slice(0, 7) : undefined}
                max={max ? max.slice(0, 7) : undefined}
                showToday={false}
                label="Choose a month"
                onChange={(m) => {
                  // the same day of the chosen month (or its last day), kept inside the allowed days
                  const day = Math.min(Number(cursor.slice(8)), daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7))));
                  wantFocus.current = true;
                  setPage(m);
                  setCursor(clampDate(`${m}-${String(day).padStart(2, '0')}`, min, max));
                  setView('days');
                }}
              />
            ) : (
              <>
                <div className="date-week" aria-hidden="true">
                  {names.map((n, i) => (
                    <span key={i}>{n}</span>
                  ))}
                </div>
                <div className="date-grid" role="grid" aria-label={monthLabel(page)} onKeyDown={onGridKey}>
                  {grid.map((c) => {
                    const choice = dateChoice(c.ymd, limits);
                    const selected = valid && c.ymd === value;
                    return (
                      <button
                        key={c.ymd}
                        type="button"
                        role="gridcell"
                        data-ymd={c.ymd}
                        className={`date-cell${c.inMonth ? '' : ' outside'}${selected ? ' selected' : ''}${c.ymd === today ? ' today' : ''}${choice.ok ? '' : ' off'}`}
                        aria-label={`${dateLabel(c.ymd, FULL)}${choice.ok ? '' : `, ${choice.reason.toLowerCase()}`}`}
                        aria-selected={selected}
                        aria-current={c.ymd === today ? 'date' : undefined}
                        aria-disabled={choice.ok ? undefined : true}
                        title={choice.ok ? undefined : choice.reason}
                        tabIndex={c.ymd === tabDay ? 0 : -1}
                        onClick={() => choice.ok && pick(c.ymd)}
                      >
                        {c.day}
                      </button>
                    );
                  })}
                </div>
                <div className="date-foot">
                  <button type="button" className="btn sm" disabled={!todayOk} onClick={() => pick(today)}>
                    Today
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
