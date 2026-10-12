import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { dateLabel, monthLabel } from '../format.js';
import { laterBillMonths, summarizeRollover } from '../rolloverLogic.js';
import Select from './ds/Select.jsx';
import { Field, Modal } from './ui.jsx';
import { t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

/**
 * "Pay only part of the card bill": say how much you pay now, which later bill gets the rest, and the interest. The preview says what
 * will happen before anything changes. The server makes the change in one step (docs/DESIGN.md section 25).
 */
export default function CardBillDialog({ bill, month, onClose, onDone }) {
  const { money, notify } = useApp();
  const [payNow, setPayNow] = useState('');
  const [toMonth, setToMonth] = useState(laterBillMonths(month)[0].value);
  const [interest, setInterest] = useState('');
  const [saving, setSaving] = useState(false);
  const months = useMemo(() => laterBillMonths(month), [month]);
  const s = summarizeRollover({ bill, payNow, interest });

  async function submit(e) {
    e.preventDefault();
    if (!s?.valid) return;
    setSaving(true);
    try {
      const r = await api.post('/card-bills/rollover', { bill_month: month, to_month: toMonth, pay_now: Number(payNow), interest: Number(interest) || 0 });
      notify(r.interest > 0 ? t('{money} and {interest} interest moved to the {dateLabel} bill', { money: money(r.rolled), interest: money(r.interest), dateLabel: dateLabel(r.to_date) }) : t('{money} moved to the {dateLabel} bill', { money: money(r.rolled), dateLabel: dateLabel(r.to_date) }));
      onDone();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  const problem =
    s && !s.valid
      ? {
          whole: t('Enter less than the whole bill: what you pay now. The rest is what moves.'),
          negative: t('Amounts cannot be negative.'),
          toomuch: t('Only {money} of this bill can move to a later one (fixed installments, debt payments and shared payments stay). Pay at least {money2} now.', { money: money(s?.movable), money2: money(s?.minPay) }),
        }[s.reason]
      : null;

  return (
    <Modal title={t('Pay only part of the card bill')} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          {bill.fixed > 0
            ? tRich('The card bill on {bold} is {bold2} to pay. {money} of it is fixed (installments, debts, shared payments) and stays on this bill.', { bold: <strong>{dateLabel(bill.bill_date)}</strong>, bold2: <strong className="num">{money(bill.total)}</strong>, money: money(bill.fixed) })
            : tRich('The card bill on {bold} is {bold2} to pay.', { bold: <strong>{dateLabel(bill.bill_date)}</strong>, bold2: <strong className="num">{money(bill.total)}</strong> })}
        </p>
        <div className="form-grid">
          <Field label={t('I will pay now')} hint={t('The rest moves to a later bill.')}>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={payNow} onChange={(e) => setPayNow(e.target.value)} placeholder={String(bill.total)} required autoFocus />
          </Field>
          <Field label={t('The rest moves to the bill of')}>
            <Select label={t('The rest moves to the bill of')} value={toMonth} onChange={setToMonth} options={months} />
          </Field>
        </div>
        <Field label={t('Interest on the rest (optional)')} hint={t('Added as one card payment on that later bill.')}>
          <input type="number" step="0.01" min="0" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0.00" />
        </Field>
        <div className={`banner ${s?.valid ? 'info' : 'warn'}`} aria-live="polite">
          {s?.valid ? (
            <div>
              <div>
                {s.interest > 0
                  ? tRich('This bill becomes {bold}. The {monthLabel} bill gets {rest} + {interest} interest.', { monthLabel: monthLabel(toMonth), bold: <strong>{money(s.thisBill)}</strong>, rest: <strong>{money(s.rest)}</strong>, interest: <strong>{money(s.interest)}</strong> })
                  : tRich('This bill becomes {bold}. The {monthLabel} bill gets {rest}.', { monthLabel: monthLabel(toMonth), bold: <strong>{money(s.thisBill)}</strong>, rest: <strong>{money(s.rest)}</strong> })}
              </div>
              <ul className="rollover-list">
                {s.moves.map((m) => (
                  <li key={m.id}>
                    {m.description}: {m.action === 'move' ? t('{money} moves', { money: money(m.part) }) : t('{money} of {money2} moves, {money3} stays', { money: money(m.part), money2: money(m.of), money3: money(m.of - m.part) })}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <span>{problem ?? t('Enter how much you pay now.')}</span>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={saving || !s?.valid || payNow === ''}>
            {t('Move the rest')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
