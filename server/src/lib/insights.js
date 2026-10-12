import { query } from '../db.js';
import { addDays, addMonthsYM, daysInMonth, monthOf, monthStart, parseYMD, todayYMD } from './dates.js';
import { forecastForWorkspace } from './forecastService.js';
import { catName } from './categoryNames.js';
import { localeOf, t, tn } from './i18n.js';

/**
 * The "assistant": statistics over one budget's ledger, turned into plain sentences.
 * Nothing here calls an outside service. gatherFacts() reads the data, buildInsights()/buildSummary() are pure
 * functions of those facts (so they are easy to test), and the questions in assistant.js reuse the same facts.
 */

const SUBSCRIPTION = /subscri/i;
const DISCRETIONARY = /dining|leisure|restaurant|entertain|shopping|subscri|travel|hobb|gift|coffee|takeaway|bar|other/i;
const round2 = (n) => Math.round(n * 100) / 100;
const countWord = (n) => (n <= 10 ? [t('no'), t('one'), t('two'), t('three'), t('four'), t('five'), t('six'), t('seven'), t('eight'), t('nine'), t('ten')][n] : String(n));
/** "a and b", "a, b and c" */
const listOf = (names) => (names.length <= 1 ? names.join('') : t('{join} and {at}', { join: names.slice(0, -1).join(', '), at: names.at(-1) }));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export const monthName = (ym, { year = false } = {}) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(localeOf(), { month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** "€1,240" and "€90" for whole or big amounts, "€12.40" for small ones with cents. */
export function makeFmt(currency) {
  return (amount) => {
    const abs = Math.abs(amount);
    const digits = abs >= 100 || Math.abs(Math.round(amount) - amount) < 0.005 ? 0 : 2;
    try {
      return new Intl.NumberFormat(localeOf(), { style: 'currency', currency: currency || 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount);
    } catch {
      return `${round2(amount)} ${currency ?? ''}`.trim();
    }
  };
}

const monthlyEquivalent = (r) => {
  const n = Math.max(1, r.interval_count || 1);
  if (r.frequency === 'weekly') return (r.amount * 52) / 12 / n;
  if (r.frequency === 'yearly') return r.amount / 12 / n;
  return r.amount / n;
};

// ------------------------------------------------------------------------------------------------
// facts
// ------------------------------------------------------------------------------------------------
export async function gatherFacts(workspaceId, { today = todayYMD() } = {}) {
  const month = monthOf(today);
  const prevMonth = addMonthsYM(month, -1);
  const from = monthStart(addMonthsYM(month, -3));
  const to = monthStart(addMonthsYM(month, 1));
  const { y, m, d: dayOfMonth } = parseYMD(today);

  const [expenseRows, incomeRows, subRules, upcoming, overdue, forecast, counts, settings] = await Promise.all([
    query(
      `SELECT t.category_id, c.name, c.color, to_char(t.date, 'YYYY-MM') AS month,
              sum(t.amount)::float AS total,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::float AS paid,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid' AND extract(day FROM t.date) <= $4 AND t.date <= $5), 0)::float AS mtd,
              count(*) FILTER (WHERE t.status = 'paid')::int AS paid_count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.status IN ('paid', 'pending') AND t.source NOT IN ('adjustment', 'loan') AND t.date >= $2 AND t.date < $3
       GROUP BY 1, 2, 3, 4`,
      [workspaceId, from, to, dayOfMonth, today],
    ),
    query(
      `SELECT to_char(t.date, 'YYYY-MM') AS month, sum(t.amount)::float AS total,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::float AS paid,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid' AND extract(day FROM t.date) <= $4 AND t.date <= $5), 0)::float AS mtd
       FROM transactions t
       WHERE t.workspace_id = $1 AND t.type = 'income' AND t.status IN ('paid', 'pending') AND t.source NOT IN ('adjustment', 'debt') AND t.date >= $2 AND t.date < $3
       GROUP BY 1`,
      [workspaceId, from, to, dayOfMonth, today],
    ),
    query(
      `SELECT r.description, r.amount::float AS amount, r.frequency, r.interval_count, c.name AS category
       FROM recurring_rules r JOIN categories c ON c.id = r.category_id
       WHERE r.workspace_id = $1 AND r.active AND r.type = 'expense' AND c.name ~* 'subscri'
       ORDER BY r.amount DESC`,
      [workspaceId],
    ),
    query(
      `SELECT id, description, amount::float AS amount, date::text AS date FROM transactions
       WHERE workspace_id = $1 AND type = 'expense' AND status = 'pending' AND date >= $2 AND date <= $3 ORDER BY date, id`,
      [workspaceId, today, addDays(today, 14)],
    ),
    query(
      `SELECT id, description, amount::float AS amount, date::text AS date FROM transactions
       WHERE workspace_id = $1 AND type = 'expense' AND status = 'pending' AND date < $2 ORDER BY date, id LIMIT 50`,
      [workspaceId, today],
    ),
    forecastForWorkspace(workspaceId, { past: 0, months: 7 }),
    query(
      `SELECT count(*)::int AS n FROM transactions WHERE workspace_id = $1 AND status IN ('paid', 'pending')`,
      [workspaceId],
    ),
    query('SELECT currency FROM workspace_settings WHERE workspace_id = $1', [workspaceId]),
  ]);

  const cats = new Map();
  for (const r of expenseRows.rows) {
    const key = r.category_id ?? 0;
    if (!cats.has(key)) cats.set(key, { id: r.category_id, name: r.name ?? t('Uncategorized'), color: r.color ?? '#8a8a85', cur: 0, curPaid: 0, prev: 0, mtdCur: 0, mtdPrev: 0, history: {} });
    const c = cats.get(key);
    c.history[r.month] = r.total;
    if (r.month === month) {
      c.cur = r.total;
      c.curPaid = r.paid;
      c.mtdCur = r.mtd;
    } else if (r.month === prevMonth) {
      c.prev = r.total;
      c.mtdPrev = r.mtd;
    }
  }
  const lastThree = [addMonthsYM(month, -1), addMonthsYM(month, -2), addMonthsYM(month, -3)];
  const categories = [...cats.values()].map((c) => ({ ...c, avg3: round2(lastThree.reduce((s, mm) => s + (c.history[mm] ?? 0), 0) / 3) }));

  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const exp = (mm, f = 'total') => round2(sum(expenseRows.rows.filter((r) => r.month === mm), (r) => r[f]));
  const inc = (mm, f = 'total') => round2(incomeRows.rows.filter((r) => r.month === mm).reduce((s, r) => s + r[f], 0));

  const subCats = categories.filter((c) => SUBSCRIPTION.test(c.name));
  const subs = {
    cur: round2(sum(subCats, (c) => c.cur)),
    prev: round2(sum(subCats, (c) => c.prev)),
    items: subRules.rows.map((r) => ({ description: r.description, amount: r.amount, monthly: round2(monthlyEquivalent(r)) })),
  };
  subs.monthlyTotal = round2(sum(subs.items, (i) => i.monthly));

  const f = forecast;
  return {
    today,
    month,
    prevMonth,
    dayOfMonth,
    daysInMonth: daysInMonth(y, m),
    currency: settings.rows[0]?.currency ?? f.currency ?? 'USD',
    isEmpty: counts.rows[0].n === 0,
    categories,
    totals: {
      expenseCur: exp(month),
      expensePaidCur: exp(month, 'paid'),
      expensePrev: exp(prevMonth),
      mtdExpenseCur: exp(month, 'mtd'),
      mtdExpensePrev: exp(prevMonth, 'mtd'),
      paidCount: sum(expenseRows.rows.filter((r) => r.month === month), (r) => r.paid_count),
      incomeCur: inc(month),
      incomePaidCur: inc(month, 'paid'),
      incomePrev: inc(prevMonth),
    },
    subscriptions: subs,
    upcoming: upcoming.rows,
    overdue: { count: overdue.rows.length, total: round2(sum(overdue.rows, (r) => r.amount)), items: overdue.rows.slice(0, 5) },
    balance: {
      current: f.currentBalance,
      endOfMonth: f.months[0]?.endBalance ?? f.currentBalance,
      firstNegative: f.insights.firstNegativeMonth ?? null, // the first month below the safety buffer (below zero when there is none)
      lowest: f.insights.lowest ?? null,
      min: f.minBalance ?? 0, // the safety buffer
    },
    forecastMonths: f.months.map((m) => ({ month: m.month, endBalance: m.endBalance, income: m.income + m.estimatedIncome, expenses: m.expenses + m.estimatedExpenses })),
  };
}

// ------------------------------------------------------------------------------------------------
// insights (pure)
// ------------------------------------------------------------------------------------------------
const RANK = { alert: 0, watch: 1, good: 2, info: 3 };

export function buildInsights(facts) {
  const fmt = makeFmt(facts.currency);
  const { totals: tt, categories, subscriptions, balance } = facts;
  const out = [];
  const k = (type, extra = '') => `${type}:${facts.month}${extra ? `:${extra}` : ''}`;
  const nextDays = (n) => facts.upcoming.filter((u) => u.date <= addDays(facts.today, n));

  // 1. below zero now / overdue
  if (balance.current < 0) {
    out.push({
      key: k('below-zero'),
      type: 'below-zero',
      severity: 'alert',
      title: t('Your balance is below zero ({fmt})', { fmt: fmt(balance.current) }),
      body: t('Record any income you have received, or check the starting balance in Settings.'),
      details: [{ label: t('Balance today'), value: fmt(balance.current), tone: 'neg' }],
      action: { label: t('Open settings'), to: '/settings' },
      ask: [t('Will I go negative?'), t('What is due soon?')],
    });
  }
  if (balance.current >= 0 && balance.min > 0 && balance.current < balance.min) {
    out.push({
      key: k('below-buffer'),
      type: 'below-buffer',
      severity: 'alert',
      title: t('Your balance ({fmt}) is below your safety buffer of {fmt2}', { fmt: fmt(balance.current), fmt2: fmt(balance.min) }),
      body: t('It is not below zero, but it is under the cushion you chose to keep. Check what is still to pay before spending more.'),
      details: [
        { label: t('Balance today'), value: fmt(balance.current), tone: 'neg' },
        { label: t('Safety buffer'), value: fmt(balance.min) },
      ],
      action: { label: t('Open forecast'), to: '/forecast' },
      ask: [t('Will I go negative?'), t('What is due soon?')],
    });
  }
  if (facts.overdue.count > 0) {
    const n = facts.overdue.count;
    out.push({
      key: k('overdue'),
      type: 'overdue',
      severity: 'alert',
      title: tn(n, '{cap} overdue payment ({fmt})', '{cap} overdue payments ({fmt})', { cap: cap(countWord(n)), fmt: fmt(facts.overdue.total) }),
      body: t('Mark them as paid once settled, or move the date if the plan changed.'),
      details: facts.overdue.items.map((i) => ({ label: i.description, value: fmt(i.amount) })),
      action: { label: t('Review overdue'), to: '/payments?status=overdue' },
      ask: [t('What is overdue?')],
    });
  }

  // 2. forecast
  if (balance.current >= Math.max(0, balance.min ?? 0) && balance.firstNegative) {
    const fn = balance.firstNegative;
    const monthsAway = Math.max(0, parseYMD(`${fn.month}-01`).y * 12 + parseYMD(`${fn.month}-01`).m - (parseYMD(`${facts.month}-01`).y * 12 + parseYMD(`${facts.month}-01`).m));
    const lowest = balance.lowest && balance.lowest.balance < fn.balance ? balance.lowest : fn;
    out.push({
      key: k('forecast-negative', fn.month),
      type: 'forecast-negative',
      severity: monthsAway <= 2 ? 'alert' : 'watch',
      title: fn.balance < 0 ? t('You may run below {fmt} in {monthName}', { fmt: fmt(0), monthName: monthName(fn.month, { year: monthsAway > 6 }) }) : t('You may dip below your safety buffer of {fmt} in {monthName}', { fmt: fmt(balance.min), monthName: monthName(fn.month, { year: monthsAway > 6 }) }),
      body: lowest.month !== fn.month ? t('The forecast reaches {fmt} and bottoms out at {low} in {monthName}. Moving or trimming a large planned payment would help.', { fmt: fmt(fn.balance), low: fmt(lowest.balance), monthName: monthName(lowest.month) }) : t('The forecast reaches {fmt}. Moving or trimming a large planned payment would help.', { fmt: fmt(fn.balance) }),
      details: [
        { label: t('Lowest point ({monthName})', { monthName: monthName(lowest.month) }), value: fmt(lowest.balance), tone: 'neg' },
        { label: t('Balance today'), value: fmt(balance.current) },
        { label: t('Expected end of this month'), value: fmt(balance.endOfMonth) },
      ],
      forecast: true,
      action: { label: t('Open forecast'), to: '/forecast' },
      ask: [t('Will I go negative?'), t('How can I save money?')],
    });
  }

  // 3. spending pace vs last month (same days)
  const cur = tt.mtdExpenseCur;
  const prev = tt.mtdExpensePrev;
  const pct = pctChange(cur, prev);
  if (prev >= 50 && pct !== null && Math.abs(pct) >= 8 && facts.dayOfMonth >= 5) {
    const movers = categories
      .map((c) => ({ ...c, diff: round2(c.mtdCur - c.mtdPrev) }))
      .filter((c) => (pct > 0 ? c.diff > 0 : c.diff < 0))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 3);
    out.push({
      key: k('spend-pace'),
      type: 'spend-pace',
      severity: pct > 0 ? 'watch' : 'good',
      title: pct > 0 ? t('Your spending is {pct}% higher than last month', { pct }) : t('You are spending {abs}% less than last month', { abs: Math.abs(pct) }),
      body: movers.length ? t('So far this month you have spent {fmt}; by this day last month it was {fmt2}. Most of the difference is {names}.', { fmt: fmt(cur), fmt2: fmt(prev), names: listOf(movers.map((m) => catName(m.name)).slice(0, 2)) }) : t('So far this month you have spent {fmt}; by this day last month it was {fmt2}.', { fmt: fmt(cur), fmt2: fmt(prev) }),
      details: movers.map((m) => ({ label: catName(m.name), value: `${m.diff > 0 ? '+' : '−'}${fmt(Math.abs(m.diff))}`, tone: m.diff > 0 ? 'neg' : 'pos' })),
      action: { label: t('See payments'), to: '/payments' },
      ask: [t('Where does my money go?'), t('How can I save money?')],
    });
  }

  // 4. one category far above its usual level
  const spikes = categories
    .filter((c) => c.avg3 >= 30 && c.mtdCur >= c.avg3 * 1.35 && c.mtdCur - c.avg3 >= 40)
    .sort((a, b) => b.mtdCur - b.avg3 - (a.mtdCur - a.avg3));
  if (spikes[0]) {
    const c = spikes[0];
    out.push({
      key: k('category-spike', String(c.id ?? 0)),
      type: 'category-spike',
      severity: 'watch',
      title: t('{name} is {pctChange}% above your usual', { name: catName(c.name), pctChange: pctChange(c.mtdCur, c.avg3) }),
      body: t('{fmt} so far this month, against about {fmt2} in a typical month.', { fmt: fmt(c.mtdCur), fmt2: fmt(c.avg3) }),
      details: [
        { label: t('This month so far'), value: fmt(c.mtdCur), tone: 'neg' },
        { label: t('3-month average'), value: fmt(c.avg3) },
      ],
      action: { label: t('See payments'), to: `/payments${c.id ? `?category=${c.id}` : ''}` },
      ask: [t('How much did I spend on {name}?', { name: catName(c.name) })],
    });
  }

  // 5. subscriptions
  const subDiff = round2(subscriptions.cur - subscriptions.prev);
  if (subscriptions.prev > 0 && subDiff >= 5) {
    out.push({
      key: k('subscriptions'),
      type: 'subscriptions',
      severity: 'watch',
      title: t('Your subscriptions increased by {fmt} this month', { fmt: fmt(subDiff) }),
      body: t('They add up to {fmt} this month, against {fmt2} last month.', { fmt: fmt(subscriptions.cur), fmt2: fmt(subscriptions.prev) }),
      details: subscriptions.items.slice(0, 4).map((i) => ({ label: i.description, value: t('{amount}/mo', { amount: fmt(i.monthly) }) })),
      action: { label: t('View subscriptions'), to: '/recurring' },
      ask: [t('What are my subscriptions?')],
    });
  }

  // 6. a cluster of payments in the next 7 days
  const week = nextDays(7);
  const weekTotal = round2(week.reduce((s, p) => s + p.amount, 0));
  if (week.length >= 3 || (week.length >= 1 && balance.current - weekTotal < 0 && balance.current >= 0)) {
    const after = round2(balance.current - weekTotal);
    out.push({
      key: k('week-ahead', facts.today),
      type: 'week-ahead',
      severity: after < 0 ? 'alert' : weekTotal > Math.max(0, balance.current) * 0.3 ? 'watch' : 'info',
      title: tn(week.length, '{cap} upcoming payment ({fmt}) may affect your balance next week', '{cap} upcoming payments ({fmt}) may affect your balance next week', { cap: cap(countWord(week.length)), fmt: fmt(weekTotal) }),
      body: after < 0 ? t('After they are paid your balance would be {fmt}.', { fmt: fmt(after) }) : t('After they are paid your balance would be about {fmt}.', { fmt: fmt(after) }),
      details: week.slice(0, 5).map((p) => ({ label: p.description, value: fmt(p.amount), when: p.date })),
      action: { label: t('Open payments'), to: '/payments?status=pending' },
      ask: [t('What is due soon?')],
    });
  }

  // 7. possible savings (an estimate, clearly labelled)
  const savable = categories
    .filter((c) => DISCRETIONARY.test(c.name) && c.avg3 >= 25)
    .sort((a, b) => b.avg3 - a.avg3)
    .slice(0, 3);
  const savings = round2(savable.reduce((s, c) => s + c.avg3 * 0.15, 0));
  if (savings >= 20) {
    out.push({
      key: k('savings'),
      type: 'savings',
      severity: 'info',
      title: t('You could save about {fmt} a month', { fmt: fmt(savings) }),
      body: t('That is roughly 15% less on {join}. It is an estimate from your last three months, not a promise.', { join: savable.map((c) => catName(c.name)).join(', ') }),
      details: savable.map((c) => ({ label: catName(c.name), value: t('{fmt} of {fmt2}', { fmt: fmt(c.avg3 * 0.15), fmt2: fmt(c.avg3) }) })),
      action: { label: t('See categories'), to: '/settings' },
      ask: [t('How can I save money?'), t('Where does my money go?')],
    });
  }

  // 8. a good month
  if (tt.incomePrev > 0) {
    const net = tt.incomePrev - tt.expensePrev;
    const rate = Math.round((net / tt.incomePrev) * 100);
    if (rate >= 10) {
      out.push({
        key: k('saved'),
        type: 'saved',
        severity: 'good',
        title: t('You kept {rate}% of your income in {monthName}', { rate, monthName: monthName(facts.prevMonth) }),
        body: t('{fmt} came in and {fmt2} went out, which left {fmt3}.', { fmt: fmt(tt.incomePrev), fmt2: fmt(tt.expensePrev), fmt3: fmt(net) }),
        details: [],
        ask: [t('Give me a summary')],
      });
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** A short written summary of the month so far. */
export function buildSummary(facts) {
  const fmt = makeFmt(facts.currency);
  const { totals: tt, balance } = facts;
  const name = monthName(facts.month);
  if (facts.isEmpty) return { title: t('{name} so far', { name }), text: t('There is nothing in this budget yet. Add a payment or a recurring item and a summary will appear here.'), stats: [] };
  const pct = pctChange(tt.mtdExpenseCur, tt.mtdExpensePrev);
  const pace = tt.mtdExpensePrev >= 50 && pct !== null ? (pct === 0 ? 'same' : pct > 0 ? 'more' : 'less') : null;
  const stillToPay = round2(tt.expenseCur - tt.expensePaidCur);
  const top = [...facts.categories].sort((a, b) => b.cur - a.cur)[0];
  const parts = [
    (() => {
      const figures = { name, fmt: fmt(tt.expensePaidCur), abs: pct === null ? 0 : Math.abs(pct) };
      if (pace === 'same') return tn(tt.paidCount, 'In {name} you have spent {fmt} across {n} payment, the same as at this point last month.', 'In {name} you have spent {fmt} across {n} payments, the same as at this point last month.', figures);
      if (pace === 'more') return tn(tt.paidCount, 'In {name} you have spent {fmt} across {n} payment, {abs}% more than at this point last month.', 'In {name} you have spent {fmt} across {n} payments, {abs}% more than at this point last month.', figures);
      if (pace === 'less') return tn(tt.paidCount, 'In {name} you have spent {fmt} across {n} payment, {abs}% less than at this point last month.', 'In {name} you have spent {fmt} across {n} payments, {abs}% less than at this point last month.', figures);
      return tn(tt.paidCount, 'In {name} you have spent {fmt} across {n} payment.', 'In {name} you have spent {fmt} across {n} payments.', figures);
    })(),
    tt.incomeCur > 0 ? t('{fmt} of {fmt2} expected income has arrived.', { fmt: fmt(tt.incomePaidCur), fmt2: fmt(tt.incomeCur) }) : null,
    stillToPay > 0 ? t('{fmt} is still to pay.', { fmt: fmt(stillToPay) }) : t('Everything planned for this month is paid.'),
    top && top.cur > 0 ? t('{name} is the biggest category at {fmt}.', { name: catName(top.name), fmt: fmt(top.cur) }) : null,
    balance.endOfMonth < 0 ? t('At this pace the balance ends the month at {fmt}, below zero.', { fmt: fmt(balance.endOfMonth) }) : balance.min > 0 && balance.endOfMonth < balance.min ? t('At this pace the balance ends the month at {fmt}, below your safety buffer of {fmt2}.', { fmt: fmt(balance.endOfMonth), fmt2: fmt(balance.min) }) : t('The balance is expected to end the month at {fmt}.', { fmt: fmt(balance.endOfMonth) }),
  ].filter(Boolean);
  return {
    title: t('{name} so far', { name }),
    text: parts.join(' '),
    stats: [
      { label: t('Spent'), value: fmt(tt.expensePaidCur) },
      { label: t('Still to pay'), value: fmt(stillToPay) },
      { label: t('Income received'), value: fmt(tt.incomePaidCur) },
      { label: t('Expected month end'), value: fmt(balance.endOfMonth), tone: balance.endOfMonth < 0 ? 'neg' : undefined },
    ],
  };
}

/** Numbers for the dashboard's "compare with last month" views. */
export function buildCompare(facts) {
  const tt = facts.totals;
  return {
    month: facts.month,
    prevMonth: facts.prevMonth,
    dayOfMonth: facts.dayOfMonth,
    categories: facts.categories
      .filter((c) => c.cur > 0 || c.prev > 0)
      .map((c) => ({ category_id: c.id, name: c.name, color: c.color, current: round2(c.cur), previous: round2(c.prev), average: c.avg3 }))
      .sort((a, b) => b.current - a.current),
    totals: {
      expenses: tt.expenseCur,
      expensesPrevious: tt.expensePrev,
      expensesSoFar: tt.mtdExpenseCur,
      expensesSoFarPrevious: tt.mtdExpensePrev,
      income: tt.incomeCur,
      incomePrevious: tt.incomePrev,
      subscriptions: facts.subscriptions.cur,
      subscriptionsPrevious: facts.subscriptions.prev,
      subscriptionsMonthly: facts.subscriptions.monthlyTotal,
    },
    subscriptions: facts.subscriptions.items,
  };
}

// ------------------------------------------------------------------------------------------------
// weekly / monthly summaries for notifications
// ------------------------------------------------------------------------------------------------
export async function periodFigures(workspaceId, fromDate, toDateExclusive) {
  const { rows } = await query(
    `SELECT type, sum(amount)::float AS total, count(*)::int AS n FROM transactions
     WHERE workspace_id = $1 AND status = 'paid' AND source NOT IN ('adjustment', 'loan') AND NOT (type = 'income' AND source = 'debt') AND date >= $2 AND date < $3 GROUP BY type`,
    [workspaceId, fromDate, toDateExclusive],
  );
  const get = (ty) => rows.find((r) => r.type === ty) ?? { total: 0, n: 0 };
  return { income: round2(get('income').total), expenses: round2(get('expense').total), expenseCount: get('expense').n };
}
