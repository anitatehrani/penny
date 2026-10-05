import { addMonthsYM, monthLabel } from './format.js';

/**
 * Part-paying a card bill and rolling the rest over (docs/DESIGN.md section 25). The server decides what really happens; this
 * is the same choice of purchases, written again so the dialog can preview it. A test checks the two always agree.
 */

const toCents = (v) => Math.round((Number(v) || 0) * 100);

/**
 * `items` are the payments that can move, newest purchase first: { id, cents }. `restCents` is how much leaves this bill.
 * A payment that fits in what is left moves whole; the one that straddles the line is split (`cents` is the part that moves).
 */
export function planRollover(items, restCents) {
  let left = Math.max(0, Math.floor(restCents));
  const steps = [];
  for (const it of items) {
    if (left <= 0) break;
    if (it.cents <= left) {
      steps.push({ id: it.id, action: 'move', cents: it.cents });
      left -= it.cents;
    } else {
      steps.push({ id: it.id, action: 'split', cents: left });
      left = 0;
    }
  }
  return { steps, short: left };
}

/** The later bills the rest can move to: the month after this one, up to a year ahead. */
export const laterBillMonths = (billMonth, count = 12) =>
  Array.from({ length: count }, (_, i) => {
    const value = addMonthsYM(billMonth, i + 1);
    return { value, label: monthLabel(value) };
  });

/**
 * What the dialog shows for a bill (the answer of GET /api/card-bills), what is paid now (`payNow`, '' = all of it) and the interest.
 * Returns null when the bill is empty; otherwise `{ valid: false, reason }` ('negative' | 'whole' | 'toomuch' with `minPay`) or the
 * preview: what this bill and the later one become, and which purchases move or split.
 */
export function summarizeRollover({ bill, payNow, interest }) {
  const total = toCents(bill?.total);
  if (!bill || total <= 0) return null;
  const movable = toCents(bill.movable);
  const pay = payNow === '' || payNow == null ? total : toCents(payNow);
  const extra = toCents(interest);
  if (Number(payNow) < 0 || Number(interest) < 0) return { valid: false, reason: 'negative' };
  if (pay >= total) return { valid: false, reason: 'whole' };
  const rest = total - pay;
  if (rest > movable) return { valid: false, reason: 'toomuch', movable: movable / 100, minPay: (total - movable) / 100 };
  const byId = new Map(bill.items.map((i) => [i.id, i]));
  const { steps } = planRollover(bill.items.filter((i) => i.movable).map((i) => ({ id: i.id, cents: toCents(i.amount) })), rest);
  return {
    valid: true,
    thisBill: pay / 100,
    rest: rest / 100,
    interest: extra / 100,
    nextBill: (rest + extra) / 100,
    moves: steps.map((s) => ({ id: s.id, description: byId.get(s.id).description, action: s.action, part: s.cents / 100, of: toCents(byId.get(s.id).amount) / 100 })),
  };
}
