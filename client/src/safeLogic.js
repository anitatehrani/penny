/**
 * The "safe to spend" line on the balance card (docs/DESIGN.md section 27): what GET /api/safe-to-spend says, in words.
 * `money` formats an amount and `dateLabel` a 'YYYY-MM-DD' day ('10 Nov'); both are passed in so this stays plain and testable.
 */
export function safeLine(safe, { money, dateLabel }) {
  if (!safe) return null;
  const until = safe.until_kind === 'income' && safe.next_income ? `${safe.next_income.description} on ${dateLabel(safe.next_income.date)}` : 'the end of the month';
  const dayWord = `${safe.days} day${safe.days === 1 ? '' : 's'}`;
  const arithmetic = [
    ['Balance today', money(safe.balance)],
    [`Still to pay until ${dateLabel(safe.until)}${safe.bills_count ? ` (${safe.bills_count} payment${safe.bills_count === 1 ? '' : 's'})` : ''}`, `−${money(safe.bills)}`],
    ...(safe.buffer > 0 ? [['Safety buffer', `−${money(safe.buffer)}`]] : []),
    [safe.available >= 0 ? 'Left to spend' : 'Short', money(Math.abs(safe.available))],
    [`Over ${dayWord}`, safe.per_day > 0 ? `${money(safe.per_day)} a day` : '—'],
  ];
  if (safe.per_day > 0) {
    return { tone: 'ok', text: `Safe to spend ${money(safe.per_day)} a day for ${dayWord}, until ${until}`, arithmetic };
  }
  if (safe.short > 0) {
    return { tone: 'short', text: `${money(safe.short)} short before ${until}`, arithmetic };
  }
  return { tone: 'none', text: `Nothing spare before ${until}`, arithmetic };
}
