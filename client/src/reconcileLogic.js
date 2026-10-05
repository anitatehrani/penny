/**
 * "Match my bank balance" (docs/DESIGN.md section 28): what saving would do, from Penny's balance and what the bank shows.
 * `bank` is what was typed ('' = nothing yet). Everything is compared in whole cents so 0.1 + 0.2 style drift cannot make a
 * matching balance look different.
 */
export function reconcilePreview({ penny, bank }) {
  if (bank === '' || bank == null || !Number.isFinite(Number(bank))) return { state: 'empty' };
  const diff = Math.round(Number(bank) * 100) - Math.round(Number(penny) * 100);
  if (diff === 0) return { state: 'match', diff: 0 };
  return { state: diff > 0 ? 'more' : 'less', diff: diff / 100, amount: Math.abs(diff) / 100, type: diff > 0 ? 'income' : 'expense' };
}
