// Monthly budgets per category (docs/DESIGN.md section 43): what each category may use, what has been used, what is still to come, where the
// month is heading, and what is worth saying about it. The numbers come from the ledger; buildBudgetView() and analyse() are pure functions of
// them, so they are easy to test. Nothing here calls an outside service.

import { query } from '../db.js';
import { addMonthsYM, daysInMonth, monthEnd, monthOf, monthStart, parseYMD, todayYMD } from './dates.js';
import { makeFmt, monthName } from './insights.js';
import { workspaceSettings } from './forecastService.js';

const round2 = (n) => Math.round(n * 100) / 100;
const EPS = 0.005;
/** Expenses that are real spending: not balance adjustments and not money handed over as a loan. */
const COUNTED = `t.type = 'expense' AND t.source NOT IN ('adjustment', 'loan')`;

// ------------------------------------------------------------------------------------------------
// reading
// ------------------------------------------------------------------------------------------------

/** The budget of each category in force in a month: Map(categoryId -> amount). A category without one is not in the map. */
export async function effectiveBudgets(workspaceId, month, db = { query }) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (category_id) category_id, amount::float AS amount
     FROM category_budgets WHERE workspace_id = $1 AND month <= $2 ORDER BY category_id, month DESC`,
    [workspaceId, month],
  );
  return new Map(rows.filter((r) => r.amount !== null).map((r) => [r.category_id, r.amount]));
}

/** Spending per category in one month, and the three months before it. Key 0 is "no category". */
export async function gatherSpending(workspaceId, month) {
  const from = monthStart(addMonthsYM(month, -3));
  const [cur, before] = await Promise.all([
    query(
      `SELECT COALESCE(t.category_id, 0) AS cat,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::float AS spent,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'pending'), 0)::float AS planned,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid' AND t.source = 'manual'), 0)::float AS variable_paid
       FROM transactions t
       WHERE t.workspace_id = $1 AND ${COUNTED} AND t.status IN ('paid', 'pending') AND t.date BETWEEN $2 AND $3
       GROUP BY 1`,
      [workspaceId, monthStart(month), monthEnd(month)],
    ),
    query(
      `SELECT COALESCE(t.category_id, 0) AS cat, to_char(t.date, 'YYYY-MM') AS month,
              sum(t.amount)::float AS spent,
              COALESCE(sum(t.amount) FILTER (WHERE t.source = 'manual'), 0)::float AS variable_paid
       FROM transactions t
       WHERE t.workspace_id = $1 AND ${COUNTED} AND t.status = 'paid' AND t.date >= $2 AND t.date < $3
       GROUP BY 1, 2`,
      [workspaceId, from, monthStart(month)],
    ),
  ]);
  const current = new Map(cur.rows.map((r) => [r.cat, { spent: r.spent, planned: r.planned, variablePaid: r.variable_paid }]));
  const history = new Map();
  const prev = addMonthsYM(month, -1);
  for (const r of before.rows) {
    const h = history.get(r.cat) ?? { prev: 0, total3: 0, variable3: 0 };
    if (r.month === prev) h.prev = r.spent;
    h.total3 += r.spent;
    h.variable3 += r.variable_paid;
    history.set(r.cat, h);
  }
  for (const h of history.values()) {
    h.avg3 = round2(h.total3 / 3);
    h.avgVariable3 = round2(h.variable3 / 3);
  }
  return { current, history };
}

async function gatherIncome(workspaceId, month) {
  const { rows } = await query(
    `SELECT COALESCE(sum(t.amount), 0)::float AS expected, COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::float AS received
     FROM transactions t WHERE t.workspace_id = $1 AND t.type = 'income' AND t.status IN ('paid', 'pending') AND t.source NOT IN ('adjustment', 'debt') AND t.date BETWEEN $2 AND $3`,
    [workspaceId, monthStart(month), monthEnd(month)],
  );
  return rows[0];
}

/** A budget worth suggesting from what is typically spent: rounded up to a figure a person would choose. */
export function niceBudget(typical) {
  if (!(typical > 0)) return null;
  const step = typical < 50 ? 5 : typical < 500 ? 10 : typical < 2000 ? 50 : 100;
  return Math.ceil(typical / step - 1e-9) * step;
}

// ------------------------------------------------------------------------------------------------
// the view (pure)
// ------------------------------------------------------------------------------------------------

/**
 * Where a month stands. `categories`: [{ id, name, color }] (expense categories); `budgets`: Map(id -> amount);
 * `current`/`history`: from gatherSpending(); `income`: { expected, received }. Returns the lines per category, the totals and the pace.
 */
export function buildBudgetView({ month, today, categories, budgets, current, history, income }) {
  const thisMonth = monthOf(today);
  const phase = month < thisMonth ? 'past' : month > thisMonth ? 'future' : 'current';
  const days = daysInMonth(parseYMD(`${month}-01`).y, parseYMD(`${month}-01`).m);
  const day = phase === 'current' ? parseYMD(today).d : phase === 'past' ? days : 0;
  const remainingDays = phase === 'current' ? days - day + 1 : phase === 'future' ? days : 0; // today still counts

  const line = (cat) => {
    const c = current.get(cat.id ?? 0) ?? { spent: 0, planned: 0, variablePaid: 0 };
    const h = history.get(cat.id ?? 0) ?? { prev: 0, avg3: 0, avgVariable3: 0 };
    const budget = cat.id != null && budgets.has(cat.id) ? budgets.get(cat.id) : null;
    const spent = round2(c.spent);
    const planned = round2(c.planned);
    // Where the month is heading: what is paid, what is already planned, and, for a month under way, the everyday spending that usually
    // follows (one-off payments entered by hand, at the pace so far; the usual amount of the last months while it is too early to tell).
    let rest = 0;
    if (phase === 'current') {
      const base = day >= 5 ? (c.variablePaid / day) * days : Math.max(h.avgVariable3, c.variablePaid);
      rest = Math.max(0, base - c.variablePaid);
    }
    const expected = round2(spent + planned + rest);
    let status = 'ok';
    if (budget === null) status = spent > 0 || planned > 0 ? 'none' : 'idle';
    else if (spent > budget + EPS) status = 'over';
    else if (phase !== 'past' && expected > budget + EPS) status = 'heading-over';
    else if (phase === 'current' && budget > 0 && spent >= 0.8 * budget) status = 'close';
    return {
      id: cat.id ?? null,
      name: cat.name,
      color: cat.color,
      budget,
      spent,
      planned,
      left: budget === null ? null : round2(budget - spent),
      leftAfterPlanned: budget === null ? null : round2(budget - spent - planned),
      percent: budget && budget > 0 ? Math.round((spent / budget) * 100) : null,
      expected,
      status,
      perDay: phase === 'current' && budget !== null && remainingDays > 0 ? round2(Math.max(0, budget - spent - planned) / remainingDays) : null,
      lastMonth: round2(h.prev),
      typical: h.avg3,
      suggested: niceBudget(h.avg3),
    };
  };

  const lines = categories.map(line);
  const none = current.has(0) ? [line({ id: null, name: 'Uncategorized', color: '#8a8a85' })] : [];
  const budgeted = lines.filter((l) => l.budget !== null);
  const sum = (arr, f) => round2(arr.reduce((s, l) => s + f(l), 0));
  const unbudgeted = [...lines.filter((l) => l.budget === null && (l.spent > 0 || l.planned > 0)), ...none.filter((l) => l.spent > 0 || l.planned > 0)];
  const totals = {
    budget: sum(budgeted, (l) => l.budget),
    spent: sum(budgeted, (l) => l.spent),
    planned: sum(budgeted, (l) => l.planned),
    expected: sum(budgeted, (l) => l.expected),
    unbudgetedSpent: sum(unbudgeted, (l) => l.spent),
    unbudgetedPlanned: sum(unbudgeted, (l) => l.planned),
    income: round2(income.expected),
    incomeReceived: round2(income.received),
  };
  totals.left = round2(totals.budget - totals.spent);
  totals.leftAfterPlanned = round2(totals.budget - totals.spent - totals.planned);
  totals.percent = totals.budget > 0 ? Math.round((totals.spent / totals.budget) * 100) : null;
  totals.perDay = phase === 'current' && remainingDays > 0 ? round2(Math.max(0, totals.leftAfterPlanned) / remainingDays) : null;
  totals.unallocated = round2(totals.income - totals.budget);
  return {
    month,
    phase,
    day,
    days,
    remainingDays,
    elapsed: days ? Math.round((day / days) * 1000) / 1000 : 0,
    budgetedCount: budgeted.length,
    lines: [...budgeted, ...lines.filter((l) => l.budget === null), ...none].sort(
      (a, b) => (a.budget === null) - (b.budget === null) || b.spent - a.spent || a.name.localeCompare(b.name),
    ),
    unbudgetedCount: unbudgeted.length,
    totals,
  };
}

// ------------------------------------------------------------------------------------------------
// what is worth saying (pure)
// ------------------------------------------------------------------------------------------------
const SEVERITY = { alert: 0, watch: 1, info: 2, good: 3 };
const list = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Plain sentences about a month's budget, most important first: [{ key, severity, text, categoryId }]. */
export function analyse(view, currency) {
  const fmt = makeFmt(currency);
  const out = [];
  const t = view.totals;
  const add = (key, severity, text, categoryId = null) => out.push({ key, severity, text, categoryId });
  const budgeted = view.lines.filter((l) => l.budget !== null);
  if (!budgeted.length) return out;
  const label = monthName(view.month);

  const over = budgeted.filter((l) => l.status === 'over');
  const heading = budgeted.filter((l) => l.status === 'heading-over');
  const close = budgeted.filter((l) => l.status === 'close');

  for (const l of over.sort((a, b) => b.spent - b.budget - (a.spent - a.budget))) {
    add(`over:${l.id}`, 'alert', `${l.name} is over its budget by ${fmt(l.spent - l.budget)}: ${fmt(l.spent)} spent of ${fmt(l.budget)}${l.budget > 0 ? ` (${l.percent}%)` : ''}.`, l.id);
  }
  if (view.phase === 'current') {
    for (const l of heading) {
      const plannedAlone = l.spent + l.planned > l.budget + EPS;
      add(
        `heading:${l.id}`,
        'watch',
        plannedAlone
          ? `${l.name}: what is spent and already planned comes to ${fmt(l.spent + l.planned)}, which is ${fmt(l.spent + l.planned - l.budget)} over its budget of ${fmt(l.budget)}.`
          : `At this pace ${l.name} will end the month around ${fmt(l.expected)}, about ${fmt(l.expected - l.budget)} over its budget of ${fmt(l.budget)}.`,
        l.id,
      );
    }
    for (const l of close) {
      add(`close:${l.id}`, 'watch', `${l.name} has used ${l.percent}% of its budget, with ${fmt(l.left)} left for ${view.remainingDays} more day${view.remainingDays === 1 ? '' : 's'}.`, l.id);
    }
  } else if (view.phase === 'future') {
    for (const l of heading) add(`heading:${l.id}`, 'watch', `${l.name}: the payments already planned for ${label} come to ${fmt(l.planned)}, more than its budget of ${fmt(l.budget)}.`, l.id);
  }

  if (t.unbudgetedSpent + t.unbudgetedPlanned > EPS) {
    const names = view.lines.filter((l) => l.budget === null && (l.spent > 0 || l.planned > 0)).map((l) => l.name);
    add('unbudgeted', 'info', `${fmt(t.unbudgetedSpent + (view.phase === 'past' ? 0 : t.unbudgetedPlanned))} ${view.phase === 'past' ? 'went' : 'is going'} on ${names.length === 1 ? 'a category' : 'categories'} with no budget: ${names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : list(names)}.`);
  }
  if (t.income > 0) {
    if (t.unallocated < -EPS) add('over-allocated', 'watch', `Your budgets add up to ${fmt(t.budget)}, which is ${fmt(-t.unallocated)} more than the income you expect in ${label} (${fmt(t.income)}).`);
    else if (t.unallocated > EPS) add('unallocated', 'info', `${fmt(t.unallocated)} of the income you expect in ${label} is not in any budget yet.`);
  }

  if (view.phase === 'past') {
    const within = budgeted.length - over.length;
    add('review', over.length ? 'info' : 'good', `You stayed within budget in ${within} of ${budgeted.length} categories in ${label}. In all you spent ${fmt(t.spent)} of ${fmt(t.budget)}${t.left >= 0 ? `, ${fmt(t.left)} less than planned` : `, ${fmt(-t.left)} more than planned`}.`);
    const best = budgeted.filter((l) => l.status !== 'over' && l.budget - l.spent > EPS).sort((a, b) => b.budget - b.spent - (a.budget - a.spent))[0];
    if (best && !over.length) add('best', 'good', `The most left over was in ${best.name}: ${fmt(best.budget - best.spent)}.`, best.id);
  } else if (!over.length && !heading.length && !close.length) {
    add('on-track', 'good', `${budgeted.length === 1 ? 'Your budgeted category is' : `All ${budgeted.length} budgeted categories are`} on track${view.phase === 'current' ? `, with ${fmt(Math.max(0, t.left))} left of ${fmt(t.budget)} and ${view.remainingDays} day${view.remainingDays === 1 ? '' : 's'} to go` : ''}.`);
  }
  return out.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
}

// ------------------------------------------------------------------------------------------------
// the whole thing for one budget and month
// ------------------------------------------------------------------------------------------------
export async function budgetForMonth(workspaceId, month, { today = todayYMD() } = {}) {
  const [settings, cats, budgets, spending, income] = await Promise.all([
    workspaceSettings(workspaceId),
    query(`SELECT id, name, color FROM categories WHERE workspace_id = $1 AND kind = 'expense' ORDER BY lower(name)`, [workspaceId]),
    effectiveBudgets(workspaceId, month),
    gatherSpending(workspaceId, month),
    gatherIncome(workspaceId, month),
  ]);
  const view = buildBudgetView({ month, today, categories: cats.rows, budgets, current: spending.current, history: spending.history, income });
  return { ...view, currency: settings.currency, findings: analyse(view, settings.currency) };
}
