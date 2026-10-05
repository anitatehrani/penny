import { planFacts } from './installmentLogic.js';

const cents = (v) => Math.round((Number(v) || 0) * 100);

/**
 * The rows of the dashboard's "Paying off" widget: the active debts and installment plans, overdue first, then by next payment,
 * then the ones with nothing scheduled. `total` is what is still to pay in the person's budget: counted debts plus installment plans
 * (debts with "count it in my budget" off are listed but left out, as the Debts page does). `today` is 'YYYY-MM-DD'.
 */
export function payingOff(debts, plans, today, limit = 5) {
  const rows = [];
  let totalCents = 0;
  for (const d of debts ?? []) {
    if (d.status !== 'active') continue;
    const counted = d.count_in_budget !== false;
    if (counted) totalCents += cents(d.remaining);
    rows.push({
      kind: 'debt',
      id: d.id,
      name: d.name,
      remaining: d.remaining,
      pct: d.total_amount > 0 ? Math.min(100, Math.round((d.paid / d.total_amount) * 100)) : 0,
      segments: null,
      paidText: null,
      nextDate: d.next_due ?? null,
      nextAmount: d.next_amount ?? null,
      counted,
      overdue: !!d.next_due && d.next_due < today,
    });
  }
  for (const p of plans ?? []) {
    if (!(p.remaining_count > 0)) continue;
    const f = planFacts(p);
    totalCents += cents(Math.max(0, p.remaining_total));
    rows.push({
      kind: 'plan',
      id: p.id,
      name: p.description,
      remaining: Math.max(0, p.remaining_total),
      pct: f.pct,
      segments: f.segments,
      paidText: `${f.paid} of ${f.count} paid`,
      nextDate: p.next_due ?? null,
      nextAmount: f.each,
      counted: true,
      overdue: !!p.next_due && p.next_due < today,
    });
  }
  const rank = (r) => (r.nextDate ? 0 : 1); // overdue ones come first on their own: their date is the earliest
  rows.sort((a, b) => rank(a) - rank(b) || (a.nextDate ?? '').localeCompare(b.nextDate ?? '') || a.name.localeCompare(b.name));
  return { total: totalCents / 100, count: rows.length, items: rows.slice(0, limit), more: Math.max(0, rows.length - limit), overdue: rows.filter((r) => r.overdue).length };
}
