import { t } from './i18n/translate.js';
// The little forecast on the public home page (docs/DESIGN.md section 37): a visitor moves a few sliders and sees what a year could look like.
// It is only an illustration of the idea (the real forecast is built from the person's own payments), so it is deliberately simple and pure.

/**
 * The balance at the end of each of the next `months` months: today's balance first, then one value per month.
 * Each month adds the income and takes off the bills and everyday spending; one big purchase falls in `purchaseMonth` (1 = next month).
 */
export function projectBalance({ start, income, bills, spending, purchase = 0, purchaseMonth = 4, months = 12 }) {
  const cents = (n) => Math.round(n * 100) / 100;
  const series = [cents(start)];
  let balance = start;
  for (let m = 1; m <= months; m += 1) {
    balance += income - bills - spending - (m === purchaseMonth ? purchase : 0);
    series.push(cents(balance));
  }
  return series;
}

/** What to tell the visitor about a projection: the lowest point, the first month below zero, and where it ends up. */
export function summarizeProjection(series) {
  let lowestIndex = 0;
  series.forEach((v, i) => {
    if (v < series[lowestIndex]) lowestIndex = i;
  });
  const firstNegative = series.findIndex((v) => v < 0);
  return { lowest: series[lowestIndex], lowestIndex, firstNegative, end: series[series.length - 1], dips: firstNegative !== -1 };
}

/** Short month names for the chart: "Now", then the next months counted from `now`. */
export function monthLabels(now, count, locale = 'en') {
  const labels = [t('Now')];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    labels.push(d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }));
  }
  return labels;
}

/** The chart's lines in a box: x/y for each value, scaled so zero is always inside the picture. */
export function chartPoints(series, { width, height, padX = 8, padTop = 16, padBottom = 28 }) {
  const lo = Math.min(0, ...series);
  const hi = Math.max(0, ...series);
  const span = hi - lo || 1;
  const x = (i) => padX + (i * (width - padX * 2)) / Math.max(1, series.length - 1);
  const y = (v) => padTop + ((hi - v) * (height - padTop - padBottom)) / span;
  return { points: series.map((v, i) => ({ x: x(i), y: y(v), v })), zeroY: y(0) };
}

/**
 * A smooth path through the points (monotone cubic: a straight run stays straight, a flat part stays flat, and the curve never bulges
 * above or below the points it joins, so a line that only goes up never dips between two months).
 */
export function smoothPath(points) {
  const n = points.length;
  if (!n) return '';
  const f = (v) => Math.round(v * 10) / 10;
  if (n === 1) return `M${f(points[0].x)} ${f(points[0].y)}`;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push((points[i + 1].y - points[i].y) / (dx[i] || 1));
  }
  const tt = new Array(n);
  tt[0] = slope[0];
  tt[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) tt[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tt[i] = 0;
      tt[i + 1] = 0;
    } else {
      const a = tt[i] / slope[i];
      const b = tt[i + 1] / slope[i];
      const sq = a * a + b * b;
      if (sq > 9) {
        const tau = 3 / Math.sqrt(sq);
        tt[i] = tau * a * slope[i];
        tt[i + 1] = tau * b * slope[i];
      }
    }
  }
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    d += ` C${f(p.x + dx[i] / 3)} ${f(p.y + (tt[i] * dx[i]) / 3)} ${f(q.x - dx[i] / 3)} ${f(q.y - (tt[i + 1] * dx[i]) / 3)} ${f(q.x)} ${f(q.y)}`;
  }
  return d;
}
