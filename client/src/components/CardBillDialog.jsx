import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { dateLabel, monthLabel } from '../format.js';
import { laterBillMonths, summarizeRollover } from '../rolloverLogic.js';
import Select from './ds/Select.jsx';
import { Field, Modal } from './ui.jsx';

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
      notify(`${money(r.rolled)}${r.interest > 0 ? ` and ${money(r.interest)} interest` : ''} moved to the ${dateLabel(r.to_date)} bill`);
      onDone();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  const problem =
    s && !s.valid
      ? {
          whole: 'Enter less than the whole bill: what you pay now. The rest is what moves.',
          negative: 'Amounts cannot be negative.',
          toomuch: `Only ${money(s?.movable)} of this bill can move to a later one (fixed installments, debt payments and shared payments stay). Pay at least ${money(s?.minPay)} now.`,
        }[s.reason]
      : null;

  return (
    <Modal title="Pay only part of the card bill" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          The card bill on <strong>{dateLabel(bill.bill_date)}</strong> is <strong className="num">{money(bill.total)}</strong> to pay.
          {bill.fixed > 0 && ` ${money(bill.fixed)} of it is fixed (installments, debts, shared payments) and stays on this bill.`}
        </p>
        <div className="form-grid">
          <Field label="I will pay now" hint="The rest moves to a later bill.">
            <input type="number" step="0.01" min="0" inputMode="decimal" value={payNow} onChange={(e) => setPayNow(e.target.value)} placeholder={String(bill.total)} required autoFocus />
          </Field>
          <Field label="The rest moves to the bill of">
            <Select label="The rest moves to the bill of" value={toMonth} onChange={setToMonth} options={months} />
          </Field>
        </div>
        <Field label="Interest on the rest (optional)" hint="Added as one card payment on that later bill.">
          <input type="number" step="0.01" min="0" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0.00" />
        </Field>
        <div className={`banner ${s?.valid ? 'info' : 'warn'}`} aria-live="polite">
          {s?.valid ? (
            <div>
              <div>
                This bill becomes <strong>{money(s.thisBill)}</strong>. The {monthLabel(toMonth)} bill gets <strong>{money(s.rest)}</strong>
                {s.interest > 0 && (
                  <>
                    {' + '}
                    <strong>{money(s.interest)}</strong> interest
                  </>
                )}
                .
              </div>
              <ul className="rollover-list">
                {s.moves.map((m) => (
                  <li key={m.id}>
                    {m.description}: {m.action === 'move' ? `${money(m.part)} moves` : `${money(m.part)} of ${money(m.of)} moves, ${money(m.of - m.part)} stays`}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <span>{problem ?? 'Enter how much you pay now.'}</span>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving || !s?.valid || payNow === ''}>
            Move the rest
          </button>
        </div>
      </form>
    </Modal>
  );
}
