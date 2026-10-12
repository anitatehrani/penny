// Finding the lines of a statement that are already in the budget (docs/DESIGN.md section 41). Pure functions.
//
//   imported    the same bank reference was imported before: certainly the same line
//   same        the same amount and kind within three days, with a similar description, on a payment that is already paid: very likely typed by hand
//   scheduled   the same, but the payment is still waiting (a recurring bill): offer to mark that one as paid instead of adding a second
//   similar     the same amount and kind within three days, with a different description: kept, with a warning
//
// Each payment of the budget can match one line only, so two identical withdrawals on one day stay two lines.

import { merchantWords } from './importCategorize.js';

const DAY = 86400000;
const toDays = (ymd) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY);
const cents = (n) => Math.round(Number(n) * 100);

const tokens = (text) => new Set(merchantWords(text));

/** How alike two descriptions are, 0 to 1: shared words, or one containing the other. */
export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const tt of x) if (y.has(tt)) shared++;
  if (shared) return Math.max(shared / (x.size + y.size - shared), shared / Math.min(x.size, y.size) >= 1 ? 0.9 : 0);
  // one word inside the other ("netflix" and "netflixcom")
  const joinedA = [...x].join('');
  const joinedB = [...y].join('');
  if (joinedA.length >= 4 && joinedB.length >= 4 && (joinedA.includes(joinedB) || joinedB.includes(joinedA))) return 0.8;
  return 0;
}

/**
 * `lines`: [{ i, date, amount, type, description, ref }]; `existing`: [{ id, date, amount, type, description, status, source, import_ref }].
 * Returns Map(i -> { kind: 'imported' | 'same' | 'scheduled' | 'similar', tx: existing, similarity, days }).
 */
export function findDuplicates(lines, existing) {
  const found = new Map();
  const used = new Set();
  const byRef = new Map(existing.filter((e) => e.import_ref).map((e) => [e.import_ref, e]));
  for (const l of lines) {
    const hit = l.ref && byRef.get(l.ref);
    if (hit && !used.has(hit.id)) {
      found.set(l.i, { kind: 'imported', tx: hit, similarity: 1, days: 0 });
      used.add(hit.id);
    }
  }
  // candidate pairs among the rest
  const pairs = [];
  const byKey = new Map();
  for (const e of existing) {
    if (used.has(e.id)) continue;
    const k = `${e.type}:${cents(e.amount)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const waiting = existing.filter((e) => !used.has(e.id) && e.status === 'pending');
  for (const l of lines) {
    if (found.has(l.i)) continue;
    const day = toDays(l.date);
    const exact = byKey.get(`${l.type}:${cents(l.amount)}`) ?? [];
    for (const e of exact) {
      const days = Math.abs(toDays(e.date) - day);
      if (days > 3) continue;
      const sim = similarity(l.description, e.description);
      pairs.push({ l, e, days, sim, rank: sim >= 0.45 ? (days <= 1 ? 0 : 1) : 2 });
    }
    // a waiting bill can be a little different from what was really charged
    for (const e of waiting) {
      if (e.type !== l.type || cents(e.amount) === cents(l.amount)) continue;
      const days = Math.abs(toDays(e.date) - day);
      const sim = similarity(l.description, e.description);
      if (days <= 5 && sim >= 0.6 && Math.abs(e.amount - l.amount) / Math.max(e.amount, 0.01) <= 0.25) pairs.push({ l, e, days, sim, rank: 1, differs: true });
    }
  }
  pairs.sort((a, b) => a.rank - b.rank || a.days - b.days || b.sim - a.sim);
  for (const p of pairs) {
    if (found.has(p.l.i) || used.has(p.e.id)) continue;
    const pending = p.e.status === 'pending';
    const kind = p.rank === 2 ? 'similar' : pending ? 'scheduled' : 'same';
    found.set(p.l.i, { kind, tx: p.e, similarity: Math.round(p.sim * 100) / 100, days: p.days, ...(p.differs ? { amount_differs: true } : {}) });
    used.add(p.e.id);
  }
  return found;
}
