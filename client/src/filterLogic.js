// The logic behind the searchable filter dropdowns, as plain functions.
// An option is { value, label, group?, dot?, person? }; `value` '' means "no filter" (the "All ..." entry).

/** Lower case with accents removed, so "cafe" finds "Café". */
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * The options that match what was typed: every word typed has to appear in the label or in the group name.
 * Nothing typed keeps everything.
 */
export function filterOptions(options, term) {
  const words = fold(term).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const text = fold(`${o.label} ${o.group ?? ''}`);
    return words.every((w) => text.includes(w));
  });
}

/** Options in runs by group, in the order they come: [{ group: 'Expenses' | '', options: [...] }]. Options without a group share one run. */
export function groupOptions(options) {
  const runs = [];
  for (const o of options) {
    const group = o.group ?? '';
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.options.push(o);
    else runs.push({ group, options: [o] });
  }
  return runs;
}

/** Where the highlight goes when moving by `step` from `index` in a list of `length` (wraps round; -1 means nothing is highlighted yet). */
export function moveHighlight(index, step, length) {
  if (length <= 0) return -1;
  if (index < 0) return step > 0 ? 0 : length - 1;
  return (index + step + length) % length;
}

/** The label to show on the button for the chosen value. */
export function labelOf(options, value) {
  return (options.find((o) => o.value === String(value ?? '')) ?? options[0])?.label ?? '';
}

/** Options for the category filter: "All", "Uncategorized", then expense and income categories under their own headings. */
export function categoryOptions(categories, { allLabel = 'All categories' } = {}) {
  const make = (kind, group) =>
    categories
      .filter((c) => c.kind === kind)
      .map((c) => ({ value: String(c.id), label: c.name, group, dot: c.color || null }));
  return [{ value: '', label: allLabel }, { value: 'none', label: 'Uncategorized', dot: null }, ...make('expense', 'Expenses'), ...make('income', 'Income')];
}

/** How many of the page's filters are switched on (the month and status are not counted: they are always visible). */
export const activeFilterCount = ({ type, pay, category, member, search }) => [type, pay, category, member, (search ?? '').trim()].filter(Boolean).length;
