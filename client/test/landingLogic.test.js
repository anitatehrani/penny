import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chartPoints, monthLabels, projectBalance, smoothPath, summarizeProjection } from '../src/landingLogic.js';

const base = { start: 1000, income: 2000, bills: 1200, spending: 500 };

describe('the home page forecast', () => {
  it('starts with today and adds one value for each month', () => {
    const s = projectBalance({ ...base, months: 3 });
    assert.deepEqual(s, [1000, 1300, 1600, 1900]);
    assert.equal(projectBalance(base).length, 13, 'twelve months by default');
  });

  it('takes a big purchase off in the month it falls in, once', () => {
    const s = projectBalance({ ...base, purchase: 1000, purchaseMonth: 2, months: 4 });
    assert.deepEqual(s, [1000, 1300, 600, 900, 1200]);
    const none = projectBalance({ ...base, purchase: 1000, purchaseMonth: 99, months: 4 });
    assert.deepEqual(none, [1000, 1300, 1600, 1900, 2200], 'a purchase beyond the year changes nothing');
  });

  it('can go down: more goes out than comes in', () => {
    assert.deepEqual(projectBalance({ start: 500, income: 1000, bills: 900, spending: 300, months: 3 }), [500, 300, 100, -100]);
  });

  it('keeps cents, not floating-point dust', () => {
    const s = projectBalance({ start: 0.1, income: 0.2, bills: 0, spending: 0, months: 3 });
    assert.deepEqual(s, [0.1, 0.3, 0.5, 0.7]);
  });

  it('says where the lowest point is and when it first goes below zero', () => {
    const s = projectBalance({ start: 500, income: 1000, bills: 900, spending: 300, months: 5 });
    const r = summarizeProjection(s);
    assert.deepEqual([r.lowest, r.lowestIndex, r.firstNegative, r.dips, r.end], [-500, 5, 3, true, -500]);
    const fine = summarizeProjection([100, 200, 150, 300]);
    assert.deepEqual([fine.lowest, fine.lowestIndex, fine.firstNegative, fine.dips], [100, 0, -1, false]);
  });

  it('labels the months from now, wrapping into the next year', () => {
    assert.deepEqual(monthLabels(new Date(Date.UTC(2026, 10, 15)), 3), ['Now', 'Dec', 'Jan', 'Feb']);
  });

  it('always keeps zero inside the picture, and puts bigger values higher up', () => {
    const { points, zeroY } = chartPoints([100, 300, 200], { width: 300, height: 200 });
    assert.equal(points.length, 3);
    assert.ok(points[1].y < points[0].y && points[1].y < points[2].y, 'the highest value is the highest point');
    assert.ok(zeroY >= points[0].y, 'zero is below all-positive values');
    const neg = chartPoints([-500, 200], { width: 300, height: 200 });
    assert.ok(neg.zeroY > neg.points[1].y && neg.zeroY < neg.points[0].y, 'zero sits between a negative and a positive value');
    assert.ok(neg.points.every((p) => p.y >= 0 && p.y <= 200), 'nothing is drawn outside the box');
    assert.ok(chartPoints([0, 0, 0], { width: 100, height: 100 }).points.every((p) => Number.isFinite(p.y)), 'a flat line at zero does not divide by zero');
  });

  it('keeps a straight climb straight and a flat part flat, and never bulges past the points it joins', () => {
    const nums = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    // a straight climb: every control point lies on the line, so the curve is the line
    const straight = [0, 1, 2, 3].map((i) => ({ x: i * 100, y: 300 - i * 50 }));
    const n = nums(smoothPath(straight));
    for (let k = 2; k < n.length; k += 6) {
      for (const [x, y] of [[n[k], n[k + 1]], [n[k + 2], n[k + 3]]]) assert.ok(Math.abs(y - (300 - x / 2)) < 0.2, `on the line: ${x},${y}`);
    }
    // flat, then a rise: no control point goes below the flat part or above the top
    const bent = [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 20 }];
    const m = nums(smoothPath(bent));
    const ys = [];
    for (let k = 2; k < m.length; k += 6) ys.push(m[k + 1], m[k + 3]);
    assert.ok(ys.every((y) => y <= 100.05 && y >= 19.95), 'stays between 20 and 100: ' + ys.join());
    assert.equal(smoothPath([{ x: 5, y: 7 }]), 'M5 7', 'one point is just a starting point');
  });

  it('draws a path that starts at the first point and ends at the last', () => {
    const { points } = chartPoints([1, 2, 3], { width: 100, height: 100 });
    const d = smoothPath(points);
    assert.match(d, /^M[\d.]+ [\d.]+( C[\d. ]+)+$/);
    assert.equal((d.match(/C/g) ?? []).length, 2);
    assert.equal(smoothPath([]), '');
  });
});
