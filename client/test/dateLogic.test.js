import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysYMD,
  addMonthsYMD,
  clampDate,
  dateChoice,
  daysInMonth,
  isYMD,
  monthGrid,
  moveCursor,
  pageFor,
  weekdayIndex,
  weekdayLabels,
  weekEndOf,
  weekStartOf,
} from '../src/dateLogic.js';

describe('what counts as a date', () => {
  it('accepts real days and refuses the rest', () => {
    assert.equal(isYMD('2031-02-28'), true);
    assert.equal(isYMD('2028-02-29'), true, 'a leap year');
    for (const bad of ['2031-02-29', '2031-02-30', '2031-13-01', '2031-00-10', '31-02-2031', '2031-1-1', '', null, undefined, 20310101]) assert.equal(isYMD(bad), false, String(bad));
  });
  it('knows how long months are', () => {
    assert.deepEqual([daysInMonth(2031, 2), daysInMonth(2028, 2), daysInMonth(2031, 4), daysInMonth(2031, 12)], [28, 29, 30, 31]);
  });
});

describe('moving by days and months', () => {
  it('adds days across month and year ends, and backwards', () => {
    assert.equal(addDaysYMD('2031-01-31', 1), '2031-02-01');
    assert.equal(addDaysYMD('2031-12-31', 1), '2032-01-01');
    assert.equal(addDaysYMD('2032-03-01', -1), '2032-02-29');
    assert.equal(addDaysYMD('2031-10-26', 7), '2031-11-02');
  });
  it('is not moved by daylight saving: a day is always one day', () => {
    // the clocks change on these days in Europe and in the US
    assert.equal(addDaysYMD('2031-03-29', 1), '2031-03-30');
    assert.equal(addDaysYMD('2031-10-25', 1), '2031-10-26');
    assert.equal(addDaysYMD('2031-03-08', 1), '2031-03-09');
    assert.equal(addDaysYMD('2031-11-01', 1), '2031-11-02');
  });
  it('adds months and keeps the day, or the last day of a shorter month', () => {
    assert.equal(addMonthsYMD('2031-01-15', 1), '2031-02-15');
    assert.equal(addMonthsYMD('2031-01-31', 1), '2031-02-28');
    assert.equal(addMonthsYMD('2032-01-31', 1), '2032-02-29');
    assert.equal(addMonthsYMD('2031-03-31', -1), '2031-02-28');
    assert.equal(addMonthsYMD('2031-12-10', 1), '2032-01-10');
    assert.equal(addMonthsYMD('2031-01-10', -1), '2030-12-10');
    assert.equal(addMonthsYMD('2031-02-28', 12), '2032-02-28');
    assert.equal(addMonthsYMD('2032-02-29', 12), '2033-02-28', 'a leap day a year on');
  });
});

describe('weeks', () => {
  it('says how far into the week a day is, with Monday or Sunday first', () => {
    assert.equal(weekdayIndex('2024-01-01'), 0, 'a Monday');
    assert.equal(weekdayIndex('2024-01-07'), 6, 'a Sunday');
    assert.equal(weekdayIndex('2024-01-07', 0), 0, 'a Sunday, Sunday first');
    assert.equal(weekdayIndex('2024-01-01', 0), 1);
  });
  it('finds the start and end of the week', () => {
    assert.equal(weekStartOf('2026-10-08'), '2026-10-05', 'Thursday 8 Oct 2026 -> Monday 5th');
    assert.equal(weekEndOf('2026-10-08'), '2026-10-11');
    assert.equal(weekStartOf('2026-10-11'), '2026-10-05', 'a Sunday belongs to the week before');
    assert.equal(weekStartOf('2026-10-08', 0), '2026-10-04');
  });
  it('names the weekdays in the order of the page', () => {
    const mon = weekdayLabels(1, 'en');
    assert.deepEqual(mon, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const sun = weekdayLabels(0, 'en');
    assert.equal(sun[0], 'Sun');
    assert.equal(sun[6], 'Sat');
  });
});

describe("a month's page", () => {
  it('is always six whole weeks of seven days', () => {
    for (const ym of ['2026-02', '2026-10', '2028-02', '2031-03', '2027-05', '2026-11']) {
      const g = monthGrid(ym);
      assert.equal(g.length, 42, ym);
      assert.equal(weekdayIndex(g[0].ymd), 0, `${ym} starts on a Monday`);
      for (let i = 1; i < 42; i++) assert.equal(g[i].ymd, addDaysYMD(g[i - 1].ymd, 1), `${ym} is one day after the other`);
    }
  });
  it('shows the month itself in the middle and the neighbours faded', () => {
    const g = monthGrid('2026-10'); // 1 Oct 2026 is a Thursday
    assert.equal(g[0].ymd, '2026-09-28');
    assert.deepEqual(g.slice(0, 3).map((c) => c.inMonth), [false, false, false]);
    assert.equal(g[3].ymd, '2026-10-01');
    assert.equal(g[3].inMonth, true);
    assert.equal(g.filter((c) => c.inMonth).length, 31);
    assert.equal(g.filter((c) => c.inMonth)[30].ymd, '2026-10-31');
    assert.equal(g[41].ymd, '2026-11-08');
  });
  it('handles a month that starts on the first day of the week, and February in a leap year', () => {
    const g = monthGrid('2026-06'); // 1 June 2026 is a Monday
    assert.equal(g[0].ymd, '2026-06-01');
    assert.equal(monthGrid('2028-02').filter((c) => c.inMonth).length, 29);
    assert.equal(monthGrid('2027-02').filter((c) => c.inMonth).length, 28);
  });
  it('can start on Sunday', () => {
    const g = monthGrid('2026-10', 0);
    assert.equal(g[0].ymd, '2026-09-27');
    assert.equal(weekdayIndex(g[0].ymd, 0), 0);
  });
});

describe('which days can be picked', () => {
  it('limits by min and max, inclusive, with the reason', () => {
    assert.deepEqual(dateChoice('2026-10-08', {}), { ok: true });
    assert.deepEqual(dateChoice('2026-10-08', { min: '2026-10-08' }), { ok: true });
    assert.deepEqual(dateChoice('2026-10-07', { min: '2026-10-08' }), { ok: false, reason: 'Too early' });
    assert.deepEqual(dateChoice('2026-10-09', { max: '2026-10-08' }), { ok: false, reason: 'Too late' });
    assert.deepEqual(dateChoice('2026-10-08', { min: '', max: '' }), { ok: true }, 'empty means no limit');
  });
  it('keeps a day inside the limits', () => {
    assert.equal(clampDate('2026-01-01', '2026-10-08', ''), '2026-10-08');
    assert.equal(clampDate('2030-01-01', '', '2026-10-08'), '2026-10-08');
    assert.equal(clampDate('2026-10-01', '2026-09-01', '2026-12-01'), '2026-10-01');
  });
});

describe('the keyboard', () => {
  const at = '2026-10-08';
  it('arrows move a day or a week, and cross month ends', () => {
    assert.equal(moveCursor(at, 'ArrowRight'), '2026-10-09');
    assert.equal(moveCursor(at, 'ArrowLeft'), '2026-10-07');
    assert.equal(moveCursor(at, 'ArrowDown'), '2026-10-15');
    assert.equal(moveCursor(at, 'ArrowUp'), '2026-10-01');
    assert.equal(moveCursor('2026-10-31', 'ArrowRight'), '2026-11-01');
    assert.equal(moveCursor('2026-11-01', 'ArrowLeft'), '2026-10-31');
  });
  it('Home and End go to the ends of the week', () => {
    assert.equal(moveCursor(at, 'Home'), '2026-10-05');
    assert.equal(moveCursor(at, 'End'), '2026-10-11');
  });
  it('Page Up and Down move a month, with Shift a year, keeping the day when there is one', () => {
    assert.equal(moveCursor(at, 'PageDown'), '2026-11-08');
    assert.equal(moveCursor(at, 'PageUp'), '2026-09-08');
    assert.equal(moveCursor('2026-01-31', 'PageDown'), '2026-02-28');
    assert.equal(moveCursor(at, 'PageDown', { shift: true }), '2027-10-08');
    assert.equal(moveCursor(at, 'PageUp', { shift: true }), '2025-10-08');
  });
  it('stays where it is when the move would leave the allowed days, or the key is not a movement', () => {
    assert.equal(moveCursor(at, 'ArrowLeft', { min: at }), at);
    assert.equal(moveCursor(at, 'ArrowRight', { max: at }), at);
    assert.equal(moveCursor(at, 'PageDown', { max: '2026-10-31' }), at);
    assert.equal(moveCursor(at, 'a'), at);
    assert.equal(moveCursor(at, 'Enter'), at);
  });
});

describe('which month the page opens on', () => {
  it('is the value, else today, else the nearest allowed day', () => {
    assert.equal(pageFor('2027-03-15', '2026-10-08'), '2027-03');
    assert.equal(pageFor('', '2026-10-08'), '2026-10');
    assert.equal(pageFor(undefined, '2026-10-08'), '2026-10');
    assert.equal(pageFor('', '2026-10-08', { min: '2027-02-01' }), '2027-02', 'today is too early, so the first allowed month');
    assert.equal(pageFor('', '2026-10-08', { max: '2026-01-31' }), '2026-01');
    assert.equal(pageFor('nonsense', '2026-10-08'), '2026-10');
  });
});
