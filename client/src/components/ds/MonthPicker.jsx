import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addMonthsYM, currentMonth, monthLabel } from '../../format.js';
import { clampYM, monthChoice, monthsOfYear, nextPickable, yearHasChoice, yearOf } from '../../monthLogic.js';
import { Icon } from '../ui.jsx';
import { t } from '../../i18n/translate.js';

/**
 * A calendar for choosing a month: a year with arrows and twelve month buttons. The current month has a ring, the chosen one is filled,
 * and months that cannot be chosen are greyed out with the reason as a tooltip. It can sit inline (the "Counts in" choice of a card
 * payment) or inside MonthPicker's popup.
 *
 * Keyboard: arrows move between months (skipping the ones that cannot be chosen), Home/End go to the first/last of the year,
 * Page Up/Page Down change the year, Enter or Space choose.
 */
export function MonthCalendar({ value, onChange, min, max, allowed, notAllowedReason, today = currentMonth(), showToday = true, label = t('Choose a month') }) {
  const [year, setYear] = useState(yearOf(value || today));
  const grid = useRef(null);
  const pendingFocus = useRef(null);
  const opts = { min, max, allowed, notAllowedReason };
  useEffect(() => {
    if (value) setYear(yearOf(value));
  }, [value]);

  const months = monthsOfYear(year);
  const pickable = (i) => monthChoice(months[i], opts).ok;
  const cells = () => [...(grid.current?.querySelectorAll('button[data-month]') ?? [])];
  const focusCell = (i) => cells()[i]?.focus();

  // After a year change by keyboard, put focus on the first month that can be chosen in the new year.
  useEffect(() => {
    if (pendingFocus.current == null) return;
    const first = months.findIndex((_, i) => pickable(i));
    pendingFocus.current = null;
    if (first >= 0) focusCell(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const changeYear = (delta, viaKeyboard = false) => {
    if (!yearHasChoice(year + delta, opts)) return;
    if (viaKeyboard) pendingFocus.current = true;
    setYear((y) => y + delta);
  };

  const onKeyDown = (e) => {
    const i = Number(e.target.dataset?.index);
    if (Number.isNaN(i)) return;
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
    if (e.key in moves) {
      e.preventDefault();
      const to = nextPickable(i, moves[e.key], pickable);
      if (to != null) focusCell(to);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const to = months.findIndex((_, k) => pickable(k));
      if (to >= 0) focusCell(to);
    } else if (e.key === 'End') {
      e.preventDefault();
      const to = months.findLastIndex((_, k) => pickable(k));
      if (to >= 0) focusCell(to);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      changeYear(e.key === 'PageUp' ? -1 : 1, true);
    }
  };

  // Only one month is in the tab order: the chosen one, or else the first that can be chosen.
  const chosenIdx = months.indexOf(value);
  const tabIdx = chosenIdx >= 0 && pickable(chosenIdx) ? chosenIdx : months.findIndex((_, i) => pickable(i));

  return (
    <div className="month-cal" role="group" aria-label={label}>
      <div className="month-cal-head">
        <button type="button" className="btn icon ghost" aria-label={t('Previous year, {value}', { value: year - 1 })} disabled={!yearHasChoice(year - 1, opts)} onClick={() => changeYear(-1)}>
          <Icon name="left" size={16} />
        </button>
        <strong className="month-cal-year" aria-live="polite">
          {year}
        </strong>
        <button type="button" className="btn icon ghost" aria-label={t('Next year, {value}', { value: year + 1 })} disabled={!yearHasChoice(year + 1, opts)} onClick={() => changeYear(1)}>
          <Icon name="right" size={16} />
        </button>
      </div>
      <div className="month-cal-grid" ref={grid} onKeyDown={onKeyDown}>
        {months.map((m, i) => {
          const c = monthChoice(m, opts);
          const selected = m === value;
          return (
            <button
              key={m}
              type="button"
              data-month={m}
              data-index={i}
              className={`month-cal-cell${selected ? ' selected' : ''}${m === today ? ' now' : ''}${c.ok ? '' : ' off'}`}
              aria-label={`${monthLabel(m)}${c.ok ? '' : `, ${c.reason}`}`}
              aria-pressed={selected}
              aria-current={m === today ? 'date' : undefined}
              aria-disabled={c.ok ? undefined : true}
              title={c.ok ? undefined : c.reason}
              tabIndex={i === tabIdx ? 0 : -1}
              onClick={() => c.ok && onChange(m)}
            >
              {monthLabel(m, { month: 'short' })}
            </button>
          );
        })}
      </div>
      {showToday && monthChoice(today, opts).ok && (
        <div className="month-cal-foot">
          <button type="button" className="btn sm" onClick={() => onChange(today)}>
            {t('This month')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A button that shows a month and opens a MonthCalendar in a popup (a bottom sheet on a phone). The popup is drawn outside the page flow,
 * so nothing clips it; Escape closes it without also closing a dialog behind it, and Tab stays inside it while it is open.
 */
export function MonthPicker({ value, onChange, min, max, allowed, notAllowedReason, label = t('Choose a month'), className = '', children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const pop = useRef(null);
  const id = useId();

  const place = useCallback(() => {
    if (!button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = pop.current?.offsetWidth ?? 300;
    setPos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8))) });
  }, []);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // When it opens, focus the chosen month. (The popup is placed before it is first drawn, so it is visible at once: a browser ignores
  // focus on an element that is not visible yet. The next-frame retry is for a browser that is slow to show it.)
  useEffect(() => {
    if (!open) return undefined;
    const focusChosen = () => pop.current?.querySelector('button[data-month][tabindex="0"]')?.focus();
    focusChosen();
    const frame = requestAnimationFrame(() => {
      if (!pop.current?.contains(document.activeElement)) focusChosen();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // capture phase, and swallowed: a dialog this popup was opened from must stay open
        e.stopImmediatePropagation();
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab' && pop.current?.contains(document.activeElement)) {
        const items = [...pop.current.querySelectorAll('button:not([disabled])[tabindex="0"], button:not([disabled]):not([data-month])')];
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
  }, [open, close, place]);

  const pick = (m) => {
    onChange(m);
    close(true);
  };

  return (
    <>
      <button type="button" ref={button} className={`month-picker-btn ${className}`.trim()} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
          if (!open) place(); // so the popup has its position the moment it is first drawn
          setOpen((o) => !o);
        }}>
        {children ?? (
          <>
            <Icon name="calendar" size={16} />
            <span>{monthLabel(value)}</span>
            <Icon name="chevron" size={14} />
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div ref={pop} id={id} role="dialog" aria-label={label} className="month-pop" style={pos ? { '--pop-top': `${pos.top}px`, '--pop-left': `${pos.left}px` } : undefined}>
            <MonthCalendar value={value} onChange={pick} min={min} max={max} allowed={allowed} notAllowedReason={notAllowedReason} label={label} />
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Previous / next arrows around a month that opens the calendar, and a way back to this month. `min` and `max` bound where it can go.
 */
export function MonthNav({ month, onChange, min = '2000-01', max = '2100-12' }) {
  const now = currentMonth();
  const prev = addMonthsYM(month, -1);
  const next = addMonthsYM(month, 1);
  return (
    <div className="month-nav">
      <button className="btn icon ghost" onClick={() => onChange(prev)} disabled={prev < min} aria-label={t('Previous month')}>
        <Icon name="left" />
      </button>
      <MonthPicker value={month} onChange={(m) => onChange(clampYM(m, min, max))} min={min} max={max} label={t('Go to a month')} className="month-label" />
      <button className="btn icon ghost" onClick={() => onChange(next)} disabled={next > max} aria-label={t('Next month')}>
        <Icon name="right" />
      </button>
      {month !== now && now >= min && now <= max && (
        <button className="btn sm" onClick={() => onChange(now)}>
          {t('This month')}
        </button>
      )}
    </div>
  );
}
