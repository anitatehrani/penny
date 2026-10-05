/**
 * The "left over from last month" line on the Payments page (docs/DESIGN.md section 21): whether it belongs in the current view,
 * what state it is in, and how it changes the strip above the list. The amount itself comes from GET /api/carryover.
 */

/** 'pending' (expected) while the month has not started yet, because it depends on payments still to come; otherwise 'paid'. */
export const carryState = (month, today) => (`${month}-01` > today ? 'pending' : 'paid');

/**
 * Show the line only where an income would show: the status filter is All or matches its state, and there is no filter on type
 * (expenses only hides it), way of paying, category, person or search, which it belongs to none of.
 */
export function carryVisible({ carry, month, today, status = '', type = '', pay = '', category = '', member = '', search = '' }) {
  if (!carry?.enabled || !(carry.amount > 0)) return false;
  if (type === 'expense' || pay || category || member || String(search).trim()) return false;
  if (status === '') return true;
  return status === carryState(month, today);
}

/** The strip's figures with the carried amount added to income and net, in whole cents so the sums stay exact. */
export function withCarry(totals, amount) {
  const add = Math.round((Number(amount) || 0) * 100);
  const income = Math.round(totals.income * 100) + add;
  const net = Math.round(totals.net * 100) + add;
  return { ...totals, income: income / 100, net: net / 100, carried: add / 100 };
}
