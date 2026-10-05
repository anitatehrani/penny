import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addMonthsYM } from '../src/format.js';
import {
  clampYM, compareFromSummaries, dashboardBounds, dashboardMonth, forecastWindow, isYM, maxYM, minYM, monthChoice, monthDiff, monthFigures, monthsOfYear, nextPickable, outlook, windowAround, yearHasChoice, yearOf,
} from '../src/monthLogic.js';

describe('months', () => {
  it('recognises a real month and nothing else', () => {
    for (const ok of ['2026-01', '2026-12', '1999-07']) assert.equal(isYM(ok), true, ok);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-05', '', 'soon', null, undefined, 202601, ['2026-01']]) assert.equal(isYM(bad), false, String(bad));
  });
  it('counts whole months between two, in either direction, across years', () => {
    assert.equal(monthDiff('2026-10', '2026-10'), 0);
    assert.equal(monthDiff('2026-10', '2027-02'), 4);
    assert.equal(monthDiff('2027-02', '2026-10'), -4);
    assert.equal(monthDiff('2025-12', '2026-01'), 1);
    assert.equal(monthDiff('2024-01', '2026-12'), 35);
  });
  it('lists the twelve months of a year, and picks the earlier or later of two', () => {
    assert.deepEqual(monthsOfYear(2026), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    assert.equal(yearOf('2027-03'), 2027);
    assert.equal(minYM('2026-03', '2025-11'), '2025-11');
    assert.equal(maxYM('2026-03', '2025-11'), '2026-03');
  });
  it('keeps a month inside a range', () => {
    assert.equal(clampYM('2030-01', '2026-01', '2027-01'), '2027-01');
    assert.equal(clampYM('2020-01', '2026-01', '2027-01'), '2026-01');
    assert.equal(clampYM('2026-06', '2026-01', '2027-01'), '2026-06');
    assert.equal(clampYM('2026-06'), '2026-06', 'no bounds');
  });
});

describe('which months can be picked', () => {
  it('everything is open without limits', () => {
    assert.deepEqual(monthChoice('2026-10'), { ok: true });
  });
  it('says why a month is out of range, and the edges themselves are fine', () => {
    const o = { min: '2026-03', max: '2027-03' };
    assert.deepEqual(monthChoice('2026-02', o), { ok: false, reason: 'Too far back' });
    assert.deepEqual(monthChoice('2027-04', o), { ok: false, reason: 'Too far ahead' });
    assert.equal(monthChoice('2026-03', o).ok, true);
    assert.equal(monthChoice('2027-03', o).ok, true);
  });
  it('can be limited to a list of months, with its own reason', () => {
    const o = { allowed: ['2026-11', '2026-12'], notAllowedReason: 'The bill cannot fall before you buy it' };
    assert.equal(monthChoice('2026-11', o).ok, true);
    assert.deepEqual(monthChoice('2026-10', o), { ok: false, reason: 'The bill cannot fall before you buy it' });
    assert.equal(monthChoice('2026-10', { allowed: [] }).reason, 'Not available', 'a default reason');
  });
  it('knows whether a year has anything to pick, which decides if the year arrows work', () => {
    const o = { min: '2026-03', max: '2027-03' };
    assert.equal(yearHasChoice(2025, o), false);
    assert.equal(yearHasChoice(2026, o), true);
    assert.equal(yearHasChoice(2027, o), true);
    assert.equal(yearHasChoice(2028, o), false);
    assert.equal(yearHasChoice(2026, { allowed: ['2027-05'] }), false);
    assert.equal(yearHasChoice(2027, { allowed: ['2027-05'] }), true);
  });
});

describe('moving around the month grid with the keyboard', () => {
  const all = () => true;
  it('moves along a row and down a column of a 4 by 3 grid', () => {
    assert.equal(nextPickable(4, 1, all), 5);
    assert.equal(nextPickable(4, -1, all), 3);
    assert.equal(nextPickable(4, 4, all), 8);
    assert.equal(nextPickable(4, -4, all), 0);
  });
  it('stops at the edges instead of wrapping', () => {
    assert.equal(nextPickable(0, -1, all), null);
    assert.equal(nextPickable(11, 1, all), null);
    assert.equal(nextPickable(9, 4, all), null);
    assert.equal(nextPickable(2, -4, all), null);
  });
  it('skips months that cannot be picked', () => {
    const only = (set) => (i) => set.includes(i);
    assert.equal(nextPickable(2, 1, only([2, 5, 6])), 5);
    assert.equal(nextPickable(6, -1, only([2, 5, 6])), 5);
    assert.equal(nextPickable(2, 4, only([2, 6, 10])), 6);
    assert.equal(nextPickable(6, 4, only([2, 6])), null, 'nothing further down');
  });
});

describe('the months the dashboard can show', () => {
  it('reach 12 back and 24 ahead of today', () => {
    assert.deepEqual(dashboardBounds('2026-10'), { min: '2025-10', max: '2028-10' });
    assert.deepEqual(dashboardBounds('2026-01'), { min: '2025-01', max: '2028-01' });
  });
  it('take the month from the address, and fall back to this month for anything wrong or out of reach', () => {
    assert.equal(dashboardMonth('2027-02', '2026-10'), '2027-02');
    assert.equal(dashboardMonth('2025-10', '2026-10'), '2025-10', 'the edge');
    assert.equal(dashboardMonth('2025-09', '2026-10'), '2026-10', 'one too far back');
    assert.equal(dashboardMonth('2028-10', '2026-10'), '2028-10');
    assert.equal(dashboardMonth('2028-11', '2026-10'), '2026-10', 'one too far ahead');
    for (const bad of [null, undefined, '', 'soon', '2026-13', '2026-1', '<script>']) assert.equal(dashboardMonth(bad, '2026-10'), '2026-10');
  });
});

describe('how much forecast to ask for', () => {
  it('is the usual 5 back and 6 ahead when looking at this month', () => {
    assert.deepEqual(forecastWindow('2026-10', '2026-10'), { past: 5, months: 6 });
  });
  it('reaches back far enough for a past month and its four months before', () => {
    assert.deepEqual(forecastWindow('2026-10', '2026-04'), { past: 10, months: 6 });
    assert.deepEqual(forecastWindow('2026-10', '2026-07'), { past: 7, months: 6 });
  });
  it('reaches ahead far enough for a future month and its three months after', () => {
    assert.deepEqual(forecastWindow('2026-10', '2027-04'), { past: 5, months: 9 });
    assert.deepEqual(forecastWindow('2026-10', '2028-10'), { past: 5, months: 24 }, 'capped at what the server allows');
  });
  it('never asks for more than the server allows, even at the edges of the range', () => {
    const { min, max } = dashboardBounds('2026-10');
    for (const m of [min, max]) {
      const w = forecastWindow('2026-10', m);
      assert.ok(w.past >= 0 && w.past <= 12 && w.months >= 1 && w.months <= 24, JSON.stringify(w));
    }
    assert.equal(forecastWindow('2026-10', min).past, 12);
  });
  it('always covers the chosen month itself', () => {
    const { min, max } = dashboardBounds('2026-10');
    for (let m = min; m <= max; m = addMonthsYM(m, 1)) {
      const w = forecastWindow('2026-10', m);
      assert.ok(monthDiff('2026-10', m) >= -w.past && monthDiff('2026-10', m) <= w.months, m);
    }
  });
});

describe('the forecast months around a chosen month', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: addMonthsYM('2026-01', i), kind: i < 9 ? 'actual' : i === 9 ? 'current' : 'forecast', income: 1000, expenses: 800, estimatedIncome: 0, estimatedExpenses: i > 9 ? 50 : 0, endBalance: 100 * (i + 1) }));
  it('takes four before and three after by default', () => {
    assert.deepEqual(windowAround(months, '2026-06').map((m) => m.month), ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });
  it('is shorter at the ends of what is available, and empty for a month that is not there', () => {
    assert.deepEqual(windowAround(months, '2026-01').map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04']);
    assert.deepEqual(windowAround(months, '2026-12').map((m) => m.month), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    assert.deepEqual(windowAround(months, '2031-01'), []);
  });
  it('gives one month\'s figures, with the estimates for a month to come, and the balance at its start', () => {
    const f = monthFigures(months, '2026-11');
    assert.deepEqual(f, { month: '2026-11', kind: 'forecast', income: 1000, expenses: 850, net: 150, endBalance: 1100, startBalance: 1000 });
    const past = monthFigures(months, '2026-04');
    assert.deepEqual([past.kind, past.net, past.startBalance, past.endBalance], ['actual', 200, 300, 400]);
  });
  it('works out the starting balance for the first month it has, and is null for a month it does not have', () => {
    assert.equal(monthFigures(months, '2026-01').startBalance, -100, 'ends at 100 after a net of 200');
    assert.equal(monthFigures(months, '2030-01'), null);
  });
});

describe('spending for any month from two summaries', () => {
  const cur = { byCategory: [{ category_id: 1, name: 'Rent', color: '#111', total: 1000 }, { category_id: 2, name: 'Food', color: '#222', total: 300.1 }, { category_id: null, name: 'Uncategorized', color: '#333', total: 7 }] };
  const prev = { byCategory: [{ category_id: 1, name: 'Rent', color: '#111', total: 1000 }, { category_id: 3, name: 'Travel', color: '#444', total: 200 }, { category_id: 2, name: 'Food', color: '#222', total: 280.2 }] };
  it('lines up each category with what it was the month before', () => {
    const c = compareFromSummaries(cur, prev, '2026-10');
    assert.equal(c.month, '2026-10');
    assert.equal(c.prevMonth, '2026-09');
    const by = Object.fromEntries(c.categories.map((x) => [x.name, [x.current, x.previous]]));
    assert.deepEqual(by, { Rent: [1000, 1000], Food: [300.1, 280.2], Uncategorized: [7, 0], Travel: [0, 200] });
  });
  it('lists the biggest first, including categories that only existed last month', () => {
    assert.deepEqual(compareFromSummaries(cur, prev, '2026-10').categories.map((x) => x.name), ['Rent', 'Food', 'Uncategorized', 'Travel']);
  });
  it('adds the totals exactly, in cents', () => {
    const c = compareFromSummaries(cur, prev, '2026-10');
    assert.deepEqual(c.totals, { expenses: 1307.1, expensesPrevious: 1480.2 });
  });
  it('adds exactly even when the amounts are not exact in floating point', () => {
    const drifting = { byCategory: [{ category_id: 1, name: 'A', color: '#1', total: 1.15 }, { category_id: 2, name: 'B', color: '#2', total: 0.57 }, { category_id: 3, name: 'C', color: '#3', total: 8.2 }] };
    assert.notEqual(1.15 + 0.57 + 8.2, 9.92, 'plain addition drifts for these amounts');
    assert.equal(compareFromSummaries(drifting, drifting, '2026-10').totals.expenses, 9.92);
    assert.equal(compareFromSummaries(drifting, drifting, '2026-10').totals.expensesPrevious, 9.92);
  });
  it('copes with no spending and no previous month', () => {
    assert.deepEqual(compareFromSummaries({ byCategory: [] }, undefined, '2026-10').categories, []);
    assert.deepEqual(compareFromSummaries({ byCategory: [] }, undefined, '2026-10').totals, { expenses: 0, expensesPrevious: 0 });
    assert.equal(compareFromSummaries(cur, undefined, '2026-10').categories.every((x) => x.previous === 0), true);
  });
  it('keeps uncategorized spending apart from a category of the same name', () => {
    const c = compareFromSummaries({ byCategory: [{ category_id: null, name: 'Other', color: '#1', total: 5 }, { category_id: 9, name: 'Other', color: '#2', total: 8 }] }, { byCategory: [{ category_id: 9, name: 'Other', color: '#2', total: 3 }] }, '2026-10');
    assert.deepEqual(c.categories.map((x) => [x.category_id, x.current, x.previous]), [[9, 8, 3], [null, 5, 0]]);
  });
});

describe('outlook', () => {
  const m = (month, kind, endBalance) => ({ month, kind, endBalance });
  const months = [m('2026-08', 'actual', -50), m('2026-09', 'actual', 100), m('2026-10', 'current', 120), m('2026-11', 'forecast', 40), m('2026-12', 'forecast', -30), m('2027-01', 'forecast', -90), m('2027-02', 'forecast', 10)];
  it('says "dip" with the first month below zero and the lowest point', () => {
    const o = outlook(months, 100);
    assert.equal(o.status, 'dip');
    assert.deepEqual(o.firstNegative, { month: '2026-12', balance: -30 });
    assert.deepEqual(o.lowest, { month: '2027-01', balance: -90 });
  });
  it('ignores months that are already behind us, even negative ones', () => {
    const o = outlook(months.filter((x) => x.month !== '2026-12' && x.month !== '2027-01'), 100);
    assert.equal(o.status, 'ok');
    assert.equal(o.firstNegative, null);
    assert.equal(o.lowest.month, '2027-02');
    assert.equal(o.lowest.balance, 10);
  });
  it('is "below" when the balance is under zero today, whatever comes next', () => {
    assert.equal(outlook(months, -0.01).status, 'below');
    assert.equal(outlook([m('2026-10', 'current', 500)], -20).status, 'below');
  });
  it('treats exactly zero as fine', () => {
    assert.equal(outlook([m('2026-10', 'current', 0), m('2026-11', 'forecast', 0)], 0).status, 'ok');
  });
  it('takes the earliest of equal lowest points', () => {
    assert.equal(outlook([m('2026-10', 'current', 5), m('2026-11', 'forecast', 5)], 5).lowest.month, '2026-10');
  });
  it('has nothing to say without a forecast', () => {
    assert.equal(outlook([], 10), null);
    assert.equal(outlook(undefined, 10), null);
    assert.equal(outlook([m('2026-08', 'actual', 1)], 10), null);
  });
});
