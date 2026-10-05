import { query } from '../db.js';
import { addDays } from './dates.js';
import { buildInsights, buildSummary, makeFmt, monthName } from './insights.js';

/**
 * Answers a typed question about the open budget. It recognises a fixed set of question types, computes the
 * answer from the person's own data and writes it as a sentence plus a few rows. It never guesses: a question
 * it does not understand gets an honest "I can't answer that yet" and a list of things it can do.
 */

const SUGGESTIONS = ['Give me a summary', 'Will I go negative?', 'What is due soon?', 'Where does my money go?', 'What are my subscriptions?', 'How can I save money?'];
const round2 = (n) => Math.round(n * 100) / 100;
const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const row = (label, value, extra = {}) => ({ label, value, ...extra });

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").trim();
const has = (q, re) => re.test(q);

function findCategory(q, facts) {
  const cats = [...facts.categories].sort((a, b) => b.name.length - a.name.length);
  return cats.find((c) => c.name.toLowerCase().length >= 3 && q.includes(c.name.toLowerCase())) ?? cats.find((c) => c.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && new RegExp(`\\b${w}s?\\b`).test(q)));
}

function extractTerm(q) {
  const m = q.match(/(?:spen[dt]|pa[iy]d?|cost|costs|paying)\w*\s+(?:on|for|at|to)\s+(.+?)[?.!]*$/i) ?? q.match(/(?:on|for|at)\s+(.+?)[?.!]*$/i);
  const term = m?.[1]?.replace(/\b(this|last|the|my|month|year|so far)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return term && term.length >= 3 ? term.slice(0, 40) : null;
}

export async function answerQuestion(rawQuestion, { workspaceId, facts }) {
  const q = norm(rawQuestion);
  const fmt = makeFmt(facts.currency);
  const t = facts.totals;
  const reply = (intent, answer, extra = {}) => ({ intent, answer, blocks: [], follow_ups: [], ...extra });

  if (facts.isEmpty && !has(q, /^(hi|hello|hey|help)/)) {
    return reply('empty', 'There is nothing in this budget yet, so there is nothing to analyse. Add a payment or a recurring item and ask me again.', {
      link: { label: 'Add a payment', to: '/payments' },
      follow_ups: ['What can you do?'],
    });
  }

  if (has(q, /^(hi|hello|hey|help)\b|what can you|what do you do|how do you work/)) {
    return reply('help', 'I read your own ledger on this server and answer questions about it: spending, balance, upcoming payments, subscriptions, forecasts and savings. Nothing is sent to an outside AI service, so I only know what is in your budget.', {
      follow_ups: SUGGESTIONS,
    });
  }

  if (has(q, /summary|summari[sz]e|overview|how am i doing|how('s| is) (my )?month/)) {
    const s = buildSummary(facts);
    return reply('summary', s.text, { blocks: [{ type: 'rows', rows: s.stats.map((x) => row(x.label, x.value, { tone: x.tone })) }], follow_ups: ['Where does my money go?', 'What is due soon?'] });
  }

  if (has(q, /negative|below (zero|0)|run out|overdraft|go under|forecast|broke|short of money|end of (the )?month/)) {
    const b = facts.balance;
    if (b.current < 0) {
      return reply('forecast', `Your balance is already below zero: ${fmt(b.current)} today.`, { link: { label: 'Open forecast', to: '/forecast' }, follow_ups: ['What is due soon?', 'How can I save money?'] });
    }
    if (b.min > 0 && b.current < b.min) {
      return reply('forecast', `Your balance is ${fmt(b.current)} today, below your safety buffer of ${fmt(b.min)}.`, { link: { label: 'Open forecast', to: '/forecast' }, follow_ups: ['What is due soon?', 'How can I save money?'] });
    }
    if (b.firstNegative) {
      return reply('forecast', `Yes. The forecast first drops below ${b.firstNegative.balance < 0 ? 'zero' : `your safety buffer of ${fmt(b.min)}`} in ${monthName(b.firstNegative.month, { year: true })}, reaching ${fmt(b.firstNegative.balance)}. Today you have ${fmt(b.current)}, and this month should end at ${fmt(b.endOfMonth)}.`, {
        blocks: [{ type: 'rows', rows: [row('Balance today', fmt(b.current)), row('Expected end of month', fmt(b.endOfMonth)), row(`Lowest (${monthName(b.lowest.month, { year: true })})`, fmt(b.lowest.balance), { tone: b.lowest.balance < 0 ? 'neg' : undefined })] }],
        link: { label: 'Open forecast', to: '/forecast' },
        follow_ups: ['How can I save money?', 'What is due soon?'],
      });
    }
    return reply('forecast', `No. Over the next months the forecast stays above ${b.min > 0 ? `your safety buffer of ${fmt(b.min)}` : 'zero'}. Today you have ${fmt(b.current)}, and this month should end at ${fmt(b.endOfMonth)}${b.lowest ? `; the lowest point ahead is ${fmt(b.lowest.balance)} in ${monthName(b.lowest.month, { year: true })}` : ''}.`, {
      link: { label: 'Open forecast', to: '/forecast' },
      follow_ups: ['Give me a summary'],
    });
  }

  if (has(q, /overdue|late payment|missed|behind on/)) {
    const o = facts.overdue;
    if (!o.count) return reply('overdue', 'Nothing is overdue. Every pending payment is dated today or later.', { follow_ups: ['What is due soon?'] });
    return reply('overdue', `${o.count} payment${o.count > 1 ? 's are' : ' is'} overdue, ${fmt(o.total)} in total.`, {
      blocks: [{ type: 'rows', rows: o.items.map((i) => row(i.description, fmt(i.amount), { sub: i.date })) }],
      link: { label: 'Review overdue', to: '/payments?status=overdue' },
      follow_ups: ['What is due soon?'],
    });
  }

  if (has(q, /subscri|streaming|recurring (cost|expense|payment)/)) {
    const s = facts.subscriptions;
    if (!s.items.length) return reply('subscriptions', 'I could not find any active recurring items in a category called Subscriptions. Put your subscriptions in that category and I will track them.', { link: { label: 'Open recurring', to: '/recurring' } });
    const diff = round2(s.cur - s.prev);
    const change = s.prev > 0 ? (diff > 0 ? ` That is ${fmt(diff)} more than last month.` : diff < 0 ? ` That is ${fmt(-diff)} less than last month.` : ' That is the same as last month.') : '';
    return reply('subscriptions', `You have ${s.items.length} active subscription${s.items.length > 1 ? 's' : ''}, about ${fmt(s.monthlyTotal)} a month (${fmt(s.monthlyTotal * 12)} a year).${change}`, {
      blocks: [{ type: 'rows', rows: s.items.map((i) => row(i.description, `${fmt(i.monthly)}/mo`)) }],
      link: { label: 'Open recurring', to: '/recurring' },
      follow_ups: ['How can I save money?'],
    });
  }

  if (has(q, /due|upcoming|next week|coming up|bills|to pay|pending|what do i (owe|need to pay)/)) {
    const days = has(q, /next week|7 days|this week/) ? 7 : 14;
    const list = facts.upcoming.filter((u) => u.date <= addDays(facts.today, days));
    if (!list.length) return reply('upcoming', `Nothing is due in the next ${days} days.`, { follow_ups: ['Give me a summary'] });
    const total = round2(list.reduce((s, p) => s + p.amount, 0));
    return reply('upcoming', `${list.length} payment${list.length > 1 ? 's are' : ' is'} due in the next ${days} days, ${fmt(total)} in total. After they are paid your balance would be about ${fmt(facts.balance.current - total)}.`, {
      blocks: [{ type: 'rows', rows: list.slice(0, 8).map((p) => row(p.description, fmt(p.amount), { sub: p.date })) }],
      link: { label: 'Open payments', to: '/payments?status=pending' },
      follow_ups: ['Will I go negative?'],
    });
  }

  if (has(q, /sav(e|ing)|cut|reduce|trim|cheaper|spend less/)) {
    const ins = buildInsights(facts).find((i) => i.type === 'savings');
    if (!ins) return reply('savings', 'I do not have enough history in everyday categories (dining, shopping, subscriptions, leisure) to estimate savings yet. A few months of data will help.', { follow_ups: ['Where does my money go?'] });
    return reply('savings', `${ins.title}. ${ins.body}`, { blocks: [{ type: 'rows', rows: ins.details.map((d) => row(d.label, d.value)) }], follow_ups: ['What are my subscriptions?', 'Where does my money go?'] });
  }

  if (has(q, /more than last month|less than last month|compared|versus|vs\b|higher|lower|spending (is|been|compared)|am i spending/)) {
    const cur = t.mtdExpenseCur;
    const prev = t.mtdExpensePrev;
    const pct = pctChange(cur, prev);
    if (pct === null) return reply('compare', `You have spent ${fmt(cur)} so far this month. There is not enough spending last month to compare with.`, { follow_ups: ['Where does my money go?'] });
    const movers = facts.categories.map((c) => ({ name: c.name, diff: round2(c.mtdCur - c.mtdPrev) })).filter((c) => c.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 4);
    return reply('compare', `So far this month you have spent ${fmt(cur)}, ${pct === 0 ? 'the same as' : `${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than`} the ${fmt(prev)} at this point last month.`, {
      blocks: [{ type: 'rows', rows: movers.map((m) => row(m.name, `${m.diff > 0 ? '+' : '−'}${fmt(Math.abs(m.diff))}`, { tone: m.diff > 0 ? 'neg' : 'pos' })) }],
      follow_ups: ['How can I save money?'],
    });
  }

  if (has(q, /income|earn|salary|money (coming|in)|received/) && !has(q, /spen[dt]/)) {
    const pct = pctChange(t.incomeCur, t.incomePrev);
    return reply('income', `This month you expect ${fmt(t.incomeCur)} in income, ${fmt(t.incomePaidCur)} of it already received.${pct === null ? '' : ` Last month it was ${fmt(t.incomePrev)} (${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%).`}`, { follow_ups: ['Give me a summary'] });
  }

  if (has(q, /balance|how much (money )?(do i have|is left)|cash|what do i have/)) {
    return reply('balance', `Your balance today is ${fmt(facts.balance.current)}. After everything pending this month is settled it should be ${fmt(facts.balance.endOfMonth)}.`, { follow_ups: ['Will I go negative?', 'What is due soon?'] });
  }

  // "how much did I spend on X": a category first, then a word in the payment descriptions
  if (has(q, /spen[dt]|paid|pay\b|cost|how much/) && !has(q, /where|biggest|top|most|breakdown/)) {
    const cat = findCategory(q, facts);
    if (cat) {
      const diff = pctChange(cat.cur, cat.prev);
      return reply('category', `${cat.name}: ${fmt(cat.cur)} this month (${fmt(cat.curPaid)} paid), ${fmt(cat.prev)} last month, and about ${fmt(cat.avg3)} in a typical month${diff === null ? '' : ` (${diff >= 0 ? '+' : '−'}${Math.abs(diff)}% vs last month)`}.`, {
        link: cat.id ? { label: `See ${cat.name}`, to: `/payments?category=${cat.id}` } : undefined,
        follow_ups: ['Where does my money go?'],
      });
    }
    const term = extractTerm(q);
    if (term) {
      const { rows } = await query(
        `SELECT to_char(date, 'YYYY-MM') AS month, sum(amount)::float AS total, count(*)::int AS n FROM transactions
         WHERE workspace_id = $1 AND type = 'expense' AND status = 'paid' AND source <> 'adjustment' AND description ILIKE $2 AND date >= date_trunc('month', current_date) - interval '6 months'
         GROUP BY 1 ORDER BY 1 DESC`,
        [workspaceId, `%${term.replace(/[%_\\]/g, '\\$&')}%`],
      );
      if (rows.length) {
        const total = round2(rows.reduce((s, r) => s + r.total, 0));
        return reply('search', `You paid ${fmt(total)} for “${term}” over the last six months (${rows.reduce((s, r) => s + r.n, 0)} payment${rows.reduce((s, r) => s + r.n, 0) === 1 ? '' : 's'}).`, {
          blocks: [{ type: 'rows', rows: rows.map((r) => row(monthName(r.month, { year: true }), fmt(r.total))) }],
          link: { label: 'Search payments', to: `/payments?q=${encodeURIComponent(term)}` },
          follow_ups: ['Where does my money go?'],
        });
      }
      return reply('search', `I found no paid expenses matching “${term}” in the last six months.`, { follow_ups: SUGGESTIONS.slice(0, 3) });
    }
  }

  if (has(q, /where|biggest|top|most|categor|breakdown|go(es)? on/)) {
    const top = [...facts.categories].filter((c) => c.cur > 0).sort((a, b) => b.cur - a.cur).slice(0, 5);
    if (!top.length) return reply('categories', 'There are no expenses this month yet.', { follow_ups: ['Give me a summary'] });
    const total = top.reduce((s, c) => s + c.cur, 0);
    return reply('categories', `Your biggest expense this month is ${top[0].name} at ${fmt(top[0].cur)}. The top ${top.length} categories add up to ${fmt(total)} of ${fmt(t.expenseCur)}.`, {
      blocks: [{ type: 'rows', rows: top.map((c) => row(c.name, fmt(c.cur), { sub: t.expenseCur ? `${Math.round((c.cur / t.expenseCur) * 100)}%` : undefined, color: c.color })) }],
      follow_ups: ['Am I spending more than last month?', 'How can I save money?'],
    });
  }

  return reply('unknown', 'I can’t answer that yet. I can talk about your balance, forecast, spending by category, upcoming and overdue payments, subscriptions, income and savings ideas.', { follow_ups: SUGGESTIONS });
}
