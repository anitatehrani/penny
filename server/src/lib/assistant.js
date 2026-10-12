import { query } from '../db.js';
import { addDays } from './dates.js';
import { budgetForMonth } from './budget.js';
import { catName } from './categoryNames.js';
import { buildInsights, buildSummary, makeFmt, monthName } from './insights.js';
import { N_, t, tn } from './i18n.js';

/**
 * Answers a typed question about the open budget. It recognises a fixed set of question types, computes the
 * answer from the person's own data and writes it as a sentence plus a few rows. It never guesses: a question
 * it does not understand gets an honest "I can't answer that yet" and a list of things it can do.
 * It reads English and Italian (docs/DESIGN.md section 46): the buttons are sentences of the app, put back into English before they are read, and
 * a question typed in Italian is recognised by its own words.
 */

const SUGGESTIONS = [N_('Give me a summary'), N_('How is my budget?'), N_('Will I go negative?'), N_('What is due soon?'), N_('Where does my money go?'), N_('How can I save money?')];
const suggestions = () => SUGGESTIONS.map((s) => t(s));
const round2 = (n) => Math.round(n * 100) / 100;
const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const row = (label, value, extra = {}) => ({ label, value, ...extra });
const signed = (pct) => `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").trim();
const has = (q, re) => re.test(q);

/** The category a question names: by its name in English or in the reader's language, or by one of the words in it. */
function findCategory(q, facts) {
  const cats = [...facts.categories].sort((a, b) => b.name.length - a.name.length);
  const names = (c) => [c.name.toLowerCase(), catName(c.name).toLowerCase()];
  return (
    cats.find((c) => names(c).some((n) => n.length >= 3 && q.includes(n))) ??
    cats.find((c) =>
      names(c)
        .join(' ')
        .split(/[^a-zàèéìòù]+/)
        .some((w) => w.length >= 4 && new RegExp(`\\b${w}[se]?\\b`).test(q)),
    )
  );
}

function extractTerm(q) {
  const m =
    q.match(/(?:spen[dt]|pa[iy]d?|cost|costs|paying)\w*\s+(?:on|for|at|to)\s+(.+?)[?.!]*$/i) ??
    q.match(/(?:spes[oie]|spendo|spendere|pagat[oi]|pago|costa)\s+(?:per|in|da|al|alla|dal)\s+(.+?)[?.!]*$/i) ??
    q.match(/(?:on|for|at)\s+(.+?)[?.!]*$/i);
  const term = m?.[1]?.replace(/\b(this|last|the|my|month|year|so far|questo|scorso|il|la|lo|mio|mia|mese|anno|finora|ultimo)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return term && term.length >= 3 ? term.slice(0, 40) : null;
}

export async function answerQuestion(rawQuestion, { workspaceId, facts, aiOn = false }) {
  const q = norm(rawQuestion);
  const fmt = makeFmt(facts.currency);
  const tt = facts.totals;
  const reply = (intent, answer, extra = {}) => ({ intent, answer, blocks: [], follow_ups: [], ...extra });

  if (facts.isEmpty && !has(q, /^(hi|hello|hey|help|ciao|salve|aiuto)/)) {
    return reply('empty', t('There is nothing in this budget yet, so there is nothing to analyse. Add a payment or a recurring item and ask me again.'), {
      link: { label: t('Add a payment'), to: '/payments' },
      follow_ups: [t('What can you do?')],
    });
  }

  if (has(q, /^(hi|hello|hey|help|ciao|salve|buongiorno|buonasera|aiuto)\b|what can you|what do you do|how do you work|cosa sai fare|cosa puoi fare|come funzioni|come ti posso usare/)) {
    return reply(
      'help',
      aiOn
        ? t('I read your own ledger on this server. The buttons give exact answers worked out here. Questions you type are sent, with a summary of your budget, to a free AI service (OpenRouter), because you and everyone in this budget turned that on. I only know what is in your budget.')
        : t('I read your own ledger on this server and answer questions about it: spending, balance, upcoming payments, subscriptions, forecasts and savings. Nothing is sent to an outside AI service, so I only know what is in your budget.'),
      { follow_ups: suggestions() },
    );
  }

  if (has(q, /summary|summari[sz]e|overview|how am i doing|how('s| is) (my )?month|riepilog|riassun|panoramica|come sto andando|come va il mese/)) {
    const s = buildSummary(facts);
    return reply('summary', s.text, { blocks: [{ type: 'rows', rows: s.stats.map((x) => row(x.label, x.value, { tone: x.tone })) }], follow_ups: [t('Where does my money go?'), t('What is due soon?')] });
  }

  // the monthly budget (docs/DESIGN.md section 43): all of it, or one category
  if (has(q, /\bbudgets?\b|spending limit|left (for|in|on) |limite di spesa|quanto (mi )?(resta|rimane) (per|di|nel)/)) {
    const view = await budgetForMonth(workspaceId, facts.month, { today: facts.today });
    if (!view.budgetedCount) {
      return reply('budget', t('You have not set a monthly budget yet. Give each category an amount for the month, and I can tell you how much of it is spent, how much is left and which categories are heading over.'), {
        link: { label: t('Set up your budget'), to: '/budget' },
        follow_ups: [t('Where does my money go?')],
      });
    }
    const bt = view.totals;
    const cat = findCategory(q, facts);
    const one = cat && view.lines.find((l) => l.id === cat.id && l.budget !== null);
    if (one) {
      const note = one.status === 'over' ? t('That is {over} over.', { over: fmt(one.spent - one.budget) }) : one.status === 'heading-over' ? t('At this pace it will end around {expected}, over its budget.', { expected: fmt(one.expected) }) : t('{left} is left.', { left: fmt(one.left) });
      const figures = { name: catName(one.name), spent: fmt(one.spent), budget: fmt(one.budget), month: monthName(view.month), planned: fmt(one.planned), note };
      return reply(
        'budget',
        one.planned > 0 ? t('{name}: {spent} spent of its {budget} budget for {month}, with {planned} more planned. {note}', figures) : t('{name}: {spent} spent of its {budget} budget for {month}. {note}', figures),
        { link: { label: t('Open the budget'), to: '/budget' }, follow_ups: [t('How is my budget?'), t('Where does my money go?')] },
      );
    }
    const watch = view.lines.filter((l) => ['over', 'heading-over', 'close'].includes(l.status));
    const shown = (watch.length ? watch : view.lines.filter((l) => l.budget !== null).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))).slice(0, 6);
    const words = { over: t('over budget'), 'heading-over': t('on track to go over'), close: t('almost used up'), ok: t('on track') };
    const figures = { month: monthName(view.month), spent: fmt(bt.spent), budget: fmt(bt.budget), left: fmt(Math.max(0, bt.left)) };
    const head =
      view.phase === 'past'
        ? t('In {month} you spent {spent} of the {budget} you budgeted.', figures)
        : view.phase === 'current'
          ? tn(view.remainingDays, 'So far in {month} you have spent {spent} of the {budget} you budgeted, so {left} is left with {n} day to go.', 'So far in {month} you have spent {spent} of the {budget} you budgeted, so {left} is left with {n} days to go.', figures)
          : t('So far in {month} you have spent {spent} of the {budget} you budgeted, so {left} is left.', figures);
    const first = view.findings.find((f) => f.severity === 'alert' || f.severity === 'watch');
    return reply('budget', `${head} ${first ? first.text : t('Every category is on track.')}`, {
      blocks: [{ type: 'rows', rows: shown.map((l) => row(catName(l.name), t('{spent} of {budget}', { spent: fmt(l.spent), budget: fmt(l.budget) }), { sub: words[l.status], tone: l.status === 'over' ? 'neg' : undefined, color: l.color })) }],
      link: { label: t('Open the budget'), to: '/budget' },
      follow_ups: [t('Where does my money go?'), t('How can I save money?')],
    });
  }

  if (has(q, /negative|below (zero|0)|run out|overdraft|go under|forecast|broke|short of money|end of (the )?month|negativo|sotto zero|in rosso|scoperto|previsione|senza soldi|fine (del )?mese/)) {
    const b = facts.balance;
    const links = { link: { label: t('Open forecast'), to: '/forecast' } };
    if (b.current < 0) {
      return reply('forecast', t('Your balance is already below zero: {amount} today.', { amount: fmt(b.current) }), { ...links, follow_ups: [t('What is due soon?'), t('How can I save money?')] });
    }
    if (b.min > 0 && b.current < b.min) {
      return reply('forecast', t('Your balance is {amount} today, below your safety buffer of {buffer}.', { amount: fmt(b.current), buffer: fmt(b.min) }), { ...links, follow_ups: [t('What is due soon?'), t('How can I save money?')] });
    }
    if (b.firstNegative) {
      const figures = { month: monthName(b.firstNegative.month, { year: true }), reached: fmt(b.firstNegative.balance), today: fmt(b.current), end: fmt(b.endOfMonth), buffer: fmt(b.min) };
      return reply(
        'forecast',
        b.firstNegative.balance < 0
          ? t('Yes. The forecast first drops below zero in {month}, reaching {reached}. Today you have {today}, and this month should end at {end}.', figures)
          : t('Yes. The forecast first drops below your safety buffer of {buffer} in {month}, reaching {reached}. Today you have {today}, and this month should end at {end}.', figures),
        {
          blocks: [{ type: 'rows', rows: [row(t('Balance today'), fmt(b.current)), row(t('Expected end of month'), fmt(b.endOfMonth)), row(t('Lowest ({month})', { month: monthName(b.lowest.month, { year: true }) }), fmt(b.lowest.balance), { tone: b.lowest.balance < 0 ? 'neg' : undefined })] }],
          ...links,
          follow_ups: [t('How can I save money?'), t('What is due soon?')],
        },
      );
    }
    const figures = { today: fmt(b.current), end: fmt(b.endOfMonth), buffer: fmt(b.min), low: b.lowest ? fmt(b.lowest.balance) : '', month: b.lowest ? monthName(b.lowest.month, { year: true }) : '' };
    const answer =
      b.min > 0
        ? b.lowest
          ? t('No. Over the next months the forecast stays above your safety buffer of {buffer}. Today you have {today}, and this month should end at {end}; the lowest point ahead is {low} in {month}.', figures)
          : t('No. Over the next months the forecast stays above your safety buffer of {buffer}. Today you have {today}, and this month should end at {end}.', figures)
        : b.lowest
          ? t('No. Over the next months the forecast stays above zero. Today you have {today}, and this month should end at {end}; the lowest point ahead is {low} in {month}.', figures)
          : t('No. Over the next months the forecast stays above zero. Today you have {today}, and this month should end at {end}.', figures);
    return reply('forecast', answer, { ...links, follow_ups: [t('Give me a summary')] });
  }

  if (has(q, /overdue|late payment|missed|behind on|in ritardo|scadut[oie]|arretrat|non pagat/)) {
    const o = facts.overdue;
    if (!o.count) return reply('overdue', t('Nothing is overdue. Every pending payment is dated today or later.'), { follow_ups: [t('What is due soon?')] });
    return reply('overdue', tn(o.count, '{n} payment is overdue, {total} in total.', '{n} payments are overdue, {total} in total.', { total: fmt(o.total) }), {
      blocks: [{ type: 'rows', rows: o.items.map((i) => row(i.description, fmt(i.amount), { sub: i.date })) }],
      link: { label: t('Review overdue'), to: '/payments?status=overdue' },
      follow_ups: [t('What is due soon?')],
    });
  }

  if (has(q, /subscri|streaming|recurring (cost|expense|payment)|abbonament|ricorrent/)) {
    const s = facts.subscriptions;
    if (!s.items.length) return reply('subscriptions', t('I could not find any active recurring items in a category called Subscriptions. Put your subscriptions in that category and I will track them.'), { link: { label: t('Open recurring'), to: '/recurring' } });
    const diff = round2(s.cur - s.prev);
    const change = s.prev > 0 ? (diff > 0 ? t('That is {diff} more than last month.', { diff: fmt(diff) }) : diff < 0 ? t('That is {diff} less than last month.', { diff: fmt(-diff) }) : t('That is the same as last month.')) : '';
    const main = tn(s.items.length, 'You have {n} active subscription, about {month} a month ({year} a year).', 'You have {n} active subscriptions, about {month} a month ({year} a year).', { month: fmt(s.monthlyTotal), year: fmt(s.monthlyTotal * 12) });
    return reply('subscriptions', change ? `${main} ${change}` : main, {
      blocks: [{ type: 'rows', rows: s.items.map((i) => row(i.description, t('{amount}/mo', { amount: fmt(i.monthly) }))) }],
      link: { label: t('Open recurring'), to: '/recurring' },
      follow_ups: [t('How can I save money?')],
    });
  }

  if (has(q, /due|upcoming|next week|coming up|bills|to pay|pending|what do i (owe|need to pay)|scad(e|ono|enz[ae])|in arrivo|prossim[oie] pagament|prossima settimana|bollett|da pagare|in sospeso/)) {
    const days = has(q, /next week|7 days|this week|prossima settimana|questa settimana|7 giorni/) ? 7 : 14;
    const list = facts.upcoming.filter((u) => u.date <= addDays(facts.today, days));
    if (!list.length) return reply('upcoming', t('Nothing is due in the next {days} days.', { days }), { follow_ups: [t('Give me a summary')] });
    const total = round2(list.reduce((s, p) => s + p.amount, 0));
    return reply('upcoming', tn(list.length, '{n} payment is due in the next {days} days, {total} in total. After they are paid your balance would be about {after}.', '{n} payments are due in the next {days} days, {total} in total. After they are paid your balance would be about {after}.', { days, total: fmt(total), after: fmt(facts.balance.current - total) }), {
      blocks: [{ type: 'rows', rows: list.slice(0, 8).map((p) => row(p.description, fmt(p.amount), { sub: p.date })) }],
      link: { label: t('Open payments'), to: '/payments?status=pending' },
      follow_ups: [t('Will I go negative?')],
    });
  }

  if (has(q, /sav(e|ing)|cut|reduce|trim|cheaper|spend less|risparmi|tagliar|ridurre|spendere meno|spender meno|costare meno/)) {
    const ins = buildInsights(facts).find((i) => i.type === 'savings');
    if (!ins) return reply('savings', t('I do not have enough history in everyday categories (dining, shopping, subscriptions, leisure) to estimate savings yet. A few months of data will help.'), { follow_ups: [t('Where does my money go?')] });
    return reply('savings', `${ins.title}. ${ins.body}`, { blocks: [{ type: 'rows', rows: ins.details.map((d) => row(d.label, d.value)) }], follow_ups: [t('What are my subscriptions?'), t('Where does my money go?')] });
  }

  if (has(q, /more than last month|less than last month|compared|versus|vs\b|higher|lower|spending (is|been|compared)|am i spending|più del mese scorso|meno del mese scorso|rispetto al mese|confront|sto spendendo|spendo di (più|meno)/)) {
    const cur = tt.mtdExpenseCur;
    const prev = tt.mtdExpensePrev;
    const pct = pctChange(cur, prev);
    if (pct === null) return reply('compare', t('You have spent {amount} so far this month. There is not enough spending last month to compare with.', { amount: fmt(cur) }), { follow_ups: [t('Where does my money go?')] });
    const movers = facts.categories.map((c) => ({ name: c.name, diff: round2(c.mtdCur - c.mtdPrev) })).filter((c) => c.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 4);
    const figures = { spent: fmt(cur), prev: fmt(prev), pct: Math.abs(pct) };
    return reply(
      'compare',
      pct === 0
        ? t('So far this month you have spent {spent}, the same as the {prev} at this point last month.', figures)
        : pct > 0
          ? t('So far this month you have spent {spent}, {pct}% more than the {prev} at this point last month.', figures)
          : t('So far this month you have spent {spent}, {pct}% less than the {prev} at this point last month.', figures),
      {
        blocks: [{ type: 'rows', rows: movers.map((m) => row(catName(m.name), `${m.diff > 0 ? '+' : '−'}${fmt(Math.abs(m.diff))}`, { tone: m.diff > 0 ? 'neg' : 'pos' })) }],
        follow_ups: [t('How can I save money?')],
      },
    );
  }

  if (has(q, /income|earn|salary|money (coming|in)|received|entrat[ae]|stipendio|guadagn|incass|ricevut/) && !has(q, /spen[dt]|spes[ao]|speso|spendo|spendere/)) {
    const pct = pctChange(tt.incomeCur, tt.incomePrev);
    const main = t('This month you expect {income} in income, {received} of it already received.', { income: fmt(tt.incomeCur), received: fmt(tt.incomePaidCur) });
    const last = pct === null ? '' : t('Last month it was {prev} ({change}).', { prev: fmt(tt.incomePrev), change: signed(pct) });
    return reply('income', last ? `${main} ${last}` : main, { follow_ups: [t('Give me a summary')] });
  }

  if (has(q, /balance|how much (money )?(do i have|is left)|cash|what do i have|\bsaldo\b|quanti soldi (ho|ci sono|mi restano)|quanto mi resta|contanti/)) {
    return reply('balance', t('Your balance today is {amount}. After everything pending this month is settled it should be {end}.', { amount: fmt(facts.balance.current), end: fmt(facts.balance.endOfMonth) }), { follow_ups: [t('Will I go negative?'), t('What is due soon?')] });
  }

  // "how much did I spend on X": a category first, then a word in the payment descriptions
  if (has(q, /spen[dt]|paid|pay\b|cost|how much|spes[oie]|spendo|spendere|pagat[oi]|\bpago\b|costa|quanto/) && !has(q, /where|biggest|top|most|breakdown|dove|maggior|principal|ripartizione/)) {
    const cat = findCategory(q, facts);
    if (cat) {
      const diff = pctChange(cat.cur, cat.prev);
      const figures = { name: catName(cat.name), cur: fmt(cat.cur), paid: fmt(cat.curPaid), prev: fmt(cat.prev), avg: fmt(cat.avg3), change: diff === null ? '' : signed(diff) };
      return reply(
        'category',
        diff === null
          ? t('{name}: {cur} this month ({paid} paid), {prev} last month, and about {avg} in a typical month.', figures)
          : t('{name}: {cur} this month ({paid} paid), {prev} last month, and about {avg} in a typical month ({change} vs last month).', figures),
        {
          link: cat.id ? { label: t('See {name}', { name: catName(cat.name) }), to: `/payments?category=${cat.id}` } : undefined,
          follow_ups: [t('Where does my money go?')],
        },
      );
    }
    const term = extractTerm(q);
    if (term) {
      const { rows } = await query(
        `SELECT to_char(date, 'YYYY-MM') AS month, sum(amount)::float AS total, count(*)::int AS n FROM transactions
         WHERE workspace_id = $1 AND type = 'expense' AND status = 'paid' AND source NOT IN ('adjustment', 'loan') AND description ILIKE $2 AND date >= date_trunc('month', current_date) - interval '6 months'
         GROUP BY 1 ORDER BY 1 DESC`,
        [workspaceId, `%${term.replace(/[%_\\]/g, '\\$&')}%`],
      );
      if (rows.length) {
        const total = round2(rows.reduce((s, r) => s + r.total, 0));
        return reply('search', tn(rows.reduce((s, r) => s + r.n, 0), 'You paid {total} for “{term}” over the last six months ({n} payment).', 'You paid {total} for “{term}” over the last six months ({n} payments).', { total: fmt(total), term }), {
          blocks: [{ type: 'rows', rows: rows.map((r) => row(monthName(r.month, { year: true }), fmt(r.total))) }],
          link: { label: t('Search payments'), to: `/payments?q=${encodeURIComponent(term)}` },
          follow_ups: [t('Where does my money go?')],
        });
      }
      return reply('search', t('I found no paid expenses matching “{term}” in the last six months.', { term }), { follow_ups: suggestions().slice(0, 3) });
    }
  }

  if (has(q, /where|biggest|top|most|categor|breakdown|go(es)? on|dove (vanno|finiscono|va)|maggior|principal|ripartizione/)) {
    const top = [...facts.categories].filter((c) => c.cur > 0).sort((a, b) => b.cur - a.cur).slice(0, 5);
    if (!top.length) return reply('categories', t('There are no expenses this month yet.'), { follow_ups: [t('Give me a summary')] });
    const total = top.reduce((s, c) => s + c.cur, 0);
    return reply('categories', t('Your biggest expense this month is {name} at {amount}. The top {count} categories add up to {top} of {all}.', { name: catName(top[0].name), amount: fmt(top[0].cur), count: top.length, top: fmt(total), all: fmt(tt.expenseCur) }), {
      blocks: [{ type: 'rows', rows: top.map((c) => row(catName(c.name), fmt(c.cur), { sub: tt.expenseCur ? `${Math.round((c.cur / tt.expenseCur) * 100)}%` : undefined, color: c.color })) }],
      follow_ups: [t('Am I spending more than last month?'), t('How can I save money?')],
    });
  }

  return reply('unknown', t('I can’t answer that yet. I can talk about your balance, forecast, spending by category, upcoming and overdue payments, subscriptions, income and savings ideas.'), { follow_ups: suggestions() });
}
