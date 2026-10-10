// Dashboard layout rules, kept free of React so they can be tested on their own.
export const WIDGETS = ['hero', 'insights', 'upcoming', 'spending', 'budget', 'recurring', 'paying', 'outlook'];
export const DEFAULT_LAYOUT = {
  order: ['hero', 'insights', 'upcoming', 'spending', 'budget', 'recurring', 'paying', 'outlook'],
  hidden: [],
  sizes: { hero: 'l', insights: 'l', upcoming: 'm', spending: 'm', budget: 'm', recurring: 'm', paying: 'm', outlook: 'm' },
};
/** Complete a saved layout: unknown widgets dropped, new ones appended, so an old save never hides a new widget. */
export function normalizeLayout(saved = {}) {
  const known = (list) => (Array.isArray(list) ? list.filter((w) => WIDGETS.includes(w)) : []);
  const order = [...new Set([...known(saved.order), ...DEFAULT_LAYOUT.order])];
  return { order, hidden: [...new Set(known(saved.hidden))], sizes: { ...DEFAULT_LAYOUT.sizes, ...(saved.sizes ?? {}) } };
}

