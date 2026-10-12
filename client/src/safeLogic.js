import { t, tn } from './i18n/translate.js';
/**
 * The "safe to spend" line on the balance card (docs/DESIGN.md section 27): what GET /api/safe-to-spend says, in words.
 * `money` formats an amount and `dateLabel` a 'YYYY-MM-DD' day ('10 Nov'); both are passed in so this stays plain and testable.
 */
export function safeLine(safe, { money, dateLabel }) {
  if (!safe) return null;
  const until = safe.until_kind === 'income' && safe.next_income ? t('{description} on {dateLabel}', { description: safe.next_income.description, dateLabel: dateLabel(safe.next_income.date) }) : t('the end of the month');
  const dayWord = tn(safe.days, '{n} day', '{n} days');
  const arithmetic = [
    [t('Balance today'), money(safe.balance)],
    [t('Still to pay until {dateLabel}{value}', { dateLabel: dateLabel(safe.until), value: safe.bills_count ? tn(safe.bills_count, ' ({n} payment)', ' ({n} payments)') : '' }), `−${money(safe.bills)}`],
    ...(safe.buffer > 0 ? [[t('Safety buffer'), `−${money(safe.buffer)}`]] : []),
    [safe.available >= 0 ? t('Left to spend') : t('Short'), money(Math.abs(safe.available))],
    [t('Over {dayWord}', { dayWord }), safe.per_day > 0 ? t('{money} a day', { money: money(safe.per_day) }) : '—'],
  ];
  if (safe.per_day > 0) {
    return { tone: 'ok', text: t('Safe to spend {money} a day for {dayWord}, until {until}', { money: money(safe.per_day), dayWord, until }), arithmetic };
  }
  if (safe.short > 0) {
    return { tone: 'short', text: t('{money} short before {until}', { money: money(safe.short), until }), arithmetic };
  }
  return { tone: 'none', text: t('Nothing spare before {until}', { until }), arithmetic };
}
