import { t } from './i18n/translate.js';
// What the budget page needs to draw, kept free of React so it can be tested on its own (docs/DESIGN.md section 43).

/** The words and the look of each state of a category. A state is never shown by colour alone: it always has these words too. */
export const STATUS = {
  over: { get label() { return t('Over budget'); }, tone: 'bad' },
  'heading-over': { get label() { return t('On track to go over'); }, tone: 'warn' },
  close: { get label() { return t('Almost used up'); }, tone: 'warn' },
  ok: { get label() { return t('On track'); }, tone: 'good' },
  none: { get label() { return t('No budget'); }, tone: 'quiet' },
  idle: { get label() { return t('No budget'); }, tone: 'quiet' },
};
/** "On track" is the wrong thing to say about a month that is over: then it is "Within budget". */
export function statusOf(status, phase) {
  const s = STATUS[status] ?? STATUS.idle;
  if (phase === 'past' && status === 'ok') return { label: t('Within budget'), tone: 'good' };
  if (phase === 'future' && status === 'ok') return { label: t('Planned'), tone: 'quiet' };
  return s;
}

/**
 * The widths of the bar for one category, as percentages of its width: what is spent, what is planned on top, a mark where the budget is
 * (it matters once the bar has grown past it) and a mark where an even pace would be today.
 */
export function barParts(line, elapsed = 0) {
  const budget = line.budget;
  const used = line.spent + line.planned;
  const scale = Math.max(budget ?? 0, used, 0.01);
  const pct = (n) => Math.max(0, Math.min(100, (n / scale) * 100));
  const spent = pct(line.spent);
  return {
    spent,
    planned: Math.min(pct(used) - spent, 100 - spent),
    budgetMark: budget !== null && used > budget ? pct(budget) : null,
    paceMark: budget !== null && elapsed > 0 && elapsed < 1 ? pct(budget * elapsed) : null,
    over: budget !== null && line.spent > budget + 0.005,
  };
}

/** A budget typed by a person: "120", "120.50" and "120,50" are all fine. '' means "no budget". Returns a number, null (none) or NaN (not a number). */
export function parseBudget(text) {
  const tt = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (tt === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(tt)) return NaN;
  const n = Number(tt);
  return n <= 9_999_999_999 ? n : NaN;
}

/** "5 days left" / "last day" / "1 day left" for the summary of a month under way. */
export function daysLeftText(view) {
  if (view.phase !== 'current') return '';
  if (view.remainingDays <= 1) return t('last day of the month');
  return t('{remainingDays} days left', { remainingDays: view.remainingDays });
}

/** The one sentence under the big figure. */
export function headline(view, money) {
  const tt = view.totals;
  if (tt.left < 0) return { label: t('Over budget by'), value: money(-tt.left), tone: 'bad' };
  if (view.phase === 'past') return { label: t('Left over'), value: money(tt.left), tone: 'good' };
  return { label: view.phase === 'future' ? t('Budgeted') : t('Left to spend'), value: money(view.phase === 'future' ? tt.budget : tt.left), tone: tt.leftAfterPlanned < 0 ? 'warn' : 'good' };
}
