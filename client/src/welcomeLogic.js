// The rules behind the welcome questions, kept free of React so they can be tested on their own.
// Every answer is used for something real: the order of the dashboard, the alert settings, the voice of the app, what the checklist suggests.
import { DEFAULT_LAYOUT, normalizeLayout } from './prefsLogic.js';

export const GOALS = ['forecast', 'budget', 'bills', 'debts', 'together', 'import'];
export const VILLAINS = ['dining', 'subscriptions', 'groceries', 'transport', 'none'];
export const NUDGES = ['urgent', 'weekly', 'early'];
export const TONES = ['plain', 'cheeky'];

/** The dashboard widgets each goal cares about, most important first. */
const GOAL_WIDGETS = {
  forecast: ['outlook'],
  budget: ['budget', 'spending'],
  bills: ['upcoming', 'recurring'],
  debts: ['paying'],
  import: ['spending'],
  together: [],
};

/** The dashboard layout for somebody who chose these goals: the greeting and insights stay on top, then what they asked for, then the rest. */
export function layoutForGoals(goals = [], saved = {}) {
  const layout = normalizeLayout(saved);
  const wanted = [];
  for (const g of goals) for (const w of GOAL_WIDGETS[g] ?? []) if (!wanted.includes(w)) wanted.push(w);
  const top = ['hero', 'insights'];
  const order = [...top, ...wanted.filter((w) => !top.includes(w)), ...DEFAULT_LAYOUT.order.filter((w) => !top.includes(w) && !wanted.includes(w))];
  return { ...layout, order };
}

/** How early and how often to nudge, as the notification settings the server already understands. */
export function nudgeSettings(nudge) {
  if (nudge === 'urgent') return { lead_days: 1, weekly_summary: false };
  if (nudge === 'weekly') return { lead_days: 3, weekly_summary: true };
  if (nudge === 'early') return { lead_days: 7, weekly_summary: true };
  return null;
}

/** The default category (by its stored name) a "budget villain" answer points at. */
export function villainCategory(villain) {
  return { dining: 'Dining & leisure', subscriptions: 'Subscriptions', groceries: 'Groceries', transport: 'Transport' }[villain] ?? null;
}
