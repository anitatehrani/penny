import { query } from '../db.js';
import { addDays, addMonthsYM, daysInMonth, monthOf, monthStart, parseYMD, todayYMD } from './dates.js';
import { forecastForWorkspace } from './forecastService.js';

/**
 * The "assistant": statistics over one budget's ledger, turned into plain sentences.
 * Nothing here calls an outside service. gatherFacts() reads the data, buildInsights()/buildSummary() are pure
 * functions of those facts (so they are easy to test), and the questions in assistant.js reuse the same facts.
 */

const SUBSCRIPTION = /subscri/i;
const DISCRETIONARY = /dining|leisure|restaurant|entertain|shopping|subscri|travel|hobb|gift|coffee|takeaway|bar|other/i;
const round2 = (n) => Math.round(n * 100) / 100;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n) => (n <= 10 ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export const monthName = (ym, { year = false } = {}) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en', { month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** "€1,240" and "€90" for whole or big amounts, "€12.40" for small ones with cents. */
export function makeFmt(currency) {
  return (amount) => {
    const abs = Math.abs(amount);
    const digits = abs >= 100 || Math.abs(Math.round(amount) - amount) < 0.005 ? 0 : 2;
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount);
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
       WHERE t.workspace_id = $1 AND t.type = 'expense' AND t.status IN ('paid', 'pending') AND t.source <> 'adjustment' AND t.date >= $2 AND t.date < $3
       GROUP BY 1, 2, 3, 4`,
      [workspaceId, from, to, dayOfMonth, today],
    ),
    query(
      `SELECT to_char(t.date, 'YYYY-MM') AS month, sum(t.amount)::float AS total,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::float AS paid,
              COALESCE(sum(t.amount) FILTER (WHERE t.status = 'paid' AND extract(day FROM t.date) <= $4 AND t.date <= $5), 0)::float AS mtd
       FROM transactions t
       WHERE t.workspace_id = $1 AND t.type = 'income' AND t.status IN ('paid', 'pending') AND t.source <> 'adjustment' AND t.date >= $2 AND t.date < $3
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
    if (!cats.has(key)) cats.set(key, { id: r.category_id, name: r.name ?? 'Uncategorized', color: r.color ?? '#8a8a85', cur: 0, curPaid: 0, prev: 0, mtdCur: 0, mtdPrev: 0, history: {} });
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
  };
}

// ------------------------------------------------------------------------------------------------
// insights (pure)
// ------------------------------------------------------------------------------------------------
const RANK = { alert: 0, watch: 1, good: 2, info: 3 };

export function buildInsights(facts) {
  const fmt = makeFmt(facts.currency);
  const { totals: t, categories, subscriptions, balance } = facts;
  const out = [];
  const k = (type, extra = '') => `${type}:${facts.month}${extra ? `:${extra}` : ''}`;
  const nextDays = (n) => facts.upcoming.filter((u) => u.date <= addDays(facts.today, n));

  // 1. below zero now / overdue
  if (balance.current < 0) {
    out.push({
      key: k('below-zero'),
      type: 'below-zero',
      severity: 'alert',
      title: `Your balance is below zero (${fmt(balance.current)})`,
      body: 'Record any income you have received, or check the starting balance in Settings.',
      details: [{ label: 'Balance today', value: fmt(balance.current), tone: 'neg' }],
      action: { label: 'Open settings', to: '/settings' },
      ask: ['Will I go negative?', 'What is due soon?'],
    });
  }
  if (balance.current >= 0 && balance.min > 0 && balance.current < balance.min) {
    out.push({
      key: k('below-buffer'),
      type: 'below-buffer',
      severity: 'alert',
      title: `Your balance (${fmt(balance.current)}) is below your safety buffer of ${fmt(balance.min)}`,
      body: 'It is not below zero, but it is under the cushion you chose to keep. Check what is still to pay before spending more.',
      details: [
        { label: 'Balance today', value: fmt(balance.current), tone: 'neg' },
        { label: 'Safety buffer', value: fmt(balance.min) },
      ],
      action: { label: 'Open forecast', to: '/forecast' },
      ask: ['Will I go negative?', 'What is due soon?'],
    });
  }
  if (facts.overdue.count > 0) {
    const n = facts.overdue.count;
    out.push({
      key: k('overdue'),
      type: 'overdue',
      severity: 'alert',
      title: `${cap(countWord(n))} overdue payment${n > 1 ? 's' : ''} (${fmt(facts.overdue.total)})`,
      body: 'Mark them as paid once settled, or move the date if the plan changed.',
      details: facts.overdue.items.map((i) => ({ label: i.description, value: fmt(i.amount) })),
      action: { label: 'Review overdue', to: '/payments?status=overdue' },
      ask: ['What is overdue?'],
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
      title: fn.balance < 0 ? `You may run below ${fmt(0)} in ${monthName(fn.month, { year: monthsAway > 6 })}` : `You may dip below your safety buffer of ${fmt(balance.min)} in ${monthName(fn.month, { year: monthsAway > 6 })}`,
      body: `The forecast reaches ${fmt(fn.balance)}${lowest.month !== fn.month ? ` and bottoms out at ${fmt(lowest.balance)} in ${monthName(lowest.month)}` : ''}. Moving or trimming a large planned payment would help.`,
      details: [
        { label: `Lowest point (${monthName(lowest.month)})`, value: fmt(lowest.balance), tone: 'neg' },
        { label: 'Balance today', value: fmt(balance.current) },
        { label: 'Expected end of this month', value: fmt(balance.endOfMonth) },
      ],
      forecast: true,
      action: { label: 'Open forecast', to: '/forecast' },
      ask: ['Will I go negative?', 'How can I save money?'],
    });
  }

  // 3. spending pace vs last month (same days)
  const cur = t.mtdExpenseCur;
  const prev = t.mtdExpensePrev;
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
      title: pct > 0 ? `Your spending is ${pct}% higher than last month` : `You are spending ${Math.abs(pct)}% less than last month`,
      body: `So far this month you have spent ${fmt(cur)}; by this day last month it was ${fmt(prev)}.${movers.length ? ` Most of the difference is ${movers.map((m) => m.name).slice(0, 2).join(' and ')}.` : ''}`,
      details: movers.map((m) => ({ label: m.name, value: `${m.diff > 0 ? '+' : '−'}${fmt(Math.abs(m.diff))}`, tone: m.diff > 0 ? 'neg' : 'pos' })),
      action: { label: 'See payments', to: '/payments' },
      ask: ['Where does my money go?', 'How can I save money?'],
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
      title: `${c.name} is ${pctChange(c.mtdCur, c.avg3)}% above your usual`,
      body: `${fmt(c.mtdCur)} so far this month, against about ${fmt(c.avg3)} in a typical month.`,
      details: [
        { label: 'This month so far', value: fmt(c.mtdCur), tone: 'neg' },
        { label: '3-month average', value: fmt(c.avg3) },
      ],
      action: { label: 'See payments', to: `/payments${c.id ? `?category=${c.id}` : ''}` },
      ask: [`How much did I spend on ${c.name}?`],
    });
  }

  // 5. subscriptions
  const subDiff = round2(subscriptions.cur - subscriptions.prev);
  if (subscriptions.prev > 0 && subDiff >= 5) {
    out.push({
      key: k('subscriptions'),
      type: 'subscriptions',
      severity: 'watch',
      title: `Your subscriptions increased by ${fmt(subDiff)} this month`,
      body: `They add up to ${fmt(subscriptions.cur)} this month, against ${fmt(subscriptions.prev)} last month.`,
      details: subscriptions.items.slice(0, 4).map((i) => ({ label: i.description, value: `${fmt(i.monthly)}/mo` })),
      action: { label: 'View subscriptions', to: '/recurring' },
      ask: ['What are my subscriptions?'],
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
      title: `${cap(countWord(week.length))} upcoming payment${week.length > 1 ? 's' : ''} (${fmt(weekTotal)}) may affect your balance next week`,
      body: after < 0 ? `After they are paid your balance would be ${fmt(after)}.` : `After they are paid your balance would be about ${fmt(after)}.`,
      details: week.slice(0, 5).map((p) => ({ label: p.description, value: fmt(p.amount), when: p.date })),
      action: { label: 'Open payments', to: '/payments?status=pending' },
      ask: ['What is due soon?'],
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
      title: `You could save about ${fmt(savings)} a month`,
      body: `That is roughly 15% less on ${savable.map((c) => c.name).join(', ')}. It is an estimate from your last three months, not a promise.`,
      details: savable.map((c) => ({ label: c.name, value: `${fmt(c.avg3 * 0.15)} of ${fmt(c.avg3)}` })),
      action: { label: 'See categories', to: '/settings' },
      ask: ['How can I save money?', 'Where does my money go?'],
    });
  }

  // 8. a good month
  if (t.incomePrev > 0) {
    const net = t.incomePrev - t.expensePrev;
    const rate = Math.round((net / t.incomePrev) * 100);
    if (rate >= 10) {
      out.push({
        key: k('saved'),
        type: 'saved',
        severity: 'good',
        title: `You kept ${rate}% of your income in ${monthName(facts.prevMonth)}`,
        body: `${fmt(t.incomePrev)} came in and ${fmt(t.expensePrev)} went out, which left ${fmt(net)}.`,
        details: [],
        ask: ['Give me a summary'],
      });
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** A short written summary of the month so far. */
export function buildSummary(facts) {
  const fmt = makeFmt(facts.currency);
  const { totals: t, balance } = facts;
  const name = monthName(facts.month);
  if (facts.isEmpty) return { title: `${name} so far`, text: 'There is nothing in this budget yet. Add a payment or a recurring item and a summary will appear here.', stats: [] };
  const pct = pctChange(t.mtdExpenseCur, t.mtdExpensePrev);
  const pace = t.mtdExpensePrev >= 50 && pct !== null ? (pct === 0 ? ', the same as at this point last month' : `, ${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than at this point last month`) : '';
  const stillToPay = round2(t.expenseCur - t.expensePaidCur);
  const top = [...facts.categories].sort((a, b) => b.cur - a.cur)[0];
  const parts = [
    `In ${name} you have spent ${fmt(t.expensePaidCur)} across ${t.paidCount} payment${t.paidCount === 1 ? '' : 's'}${pace}.`,
    t.incomeCur > 0 ? `${fmt(t.incomePaidCur)} of ${fmt(t.incomeCur)} expected income has arrived.` : null,
    stillToPay > 0 ? `${fmt(stillToPay)} is still to pay.` : 'Everything planned for this month is paid.',
    top && top.cur > 0 ? `${top.name} is the biggest category at ${fmt(top.cur)}.` : null,
    balance.endOfMonth < 0 ? `At this pace the balance ends the month at ${fmt(balance.endOfMonth)}, below zero.` : balance.min > 0 && balance.endOfMonth < balance.min ? `At this pace the balance ends the month at ${fmt(balance.endOfMonth)}, below your safety buffer of ${fmt(balance.min)}.` : `The balance is expected to end the month at ${fmt(balance.endOfMonth)}.`,
  ].filter(Boolean);
  return {
    title: `${name} so far`,
    text: parts.join(' '),
    stats: [
      { label: 'Spent', value: fmt(t.expensePaidCur) },
      { label: 'Still to pay', value: fmt(stillToPay) },
      { label: 'Income received', value: fmt(t.incomePaidCur) },
      { label: 'Expected month end', value: fmt(balance.endOfMonth), tone: balance.endOfMonth < 0 ? 'neg' : undefined },
    ],
  };
}

/** Numbers for the dashboard's "compare with last month" views. */
export function buildCompare(facts) {
  const t = facts.totals;
  return {
    month: facts.month,
    prevMonth: facts.prevMonth,
    dayOfMonth: facts.dayOfMonth,
    categories: facts.categories
      .filter((c) => c.cur > 0 || c.prev > 0)
      .map((c) => ({ category_id: c.id, name: c.name, color: c.color, current: round2(c.cur), previous: round2(c.prev), average: c.avg3 }))
      .sort((a, b) => b.current - a.current),
    totals: {
      expenses: t.expenseCur,
      expensesPrevious: t.expensePrev,
      expensesSoFar: t.mtdExpenseCur,
      expensesSoFarPrevious: t.mtdExpensePrev,
      income: t.incomeCur,
      incomePrevious: t.incomePrev,
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
     WHERE workspace_id = $1 AND status = 'paid' AND source <> 'adjustment' AND date >= $2 AND date < $3 GROUP BY type`,
    [workspaceId, fromDate, toDateExclusive],
  );
  const get = (ty) => rows.find((r) => r.type === ty) ?? { total: 0, n: 0 };
  return { income: round2(get('income').total), expenses: round2(get('expense').total), expenseCount: get('expense').n };
}
