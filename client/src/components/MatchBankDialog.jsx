import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { reconcilePreview } from '../reconcileLogic.js';
import { Field, Icon, Modal } from './ui.jsx';

/**
 * "Match my bank balance": type what the bank shows, see the difference and exactly what saving will do. One paid payment dated today
 * (income or expense) closes the gap; delete it to undo (docs/DESIGN.md section 28).
 */
export default function MatchBankDialog({ balance, overdue, onClose, onDone }) {
  const { money, notify } = useApp();
  const [bank, setBank] = useState('');
  const [saving, setSaving] = useState(false);
  const p = reconcilePreview({ penny: balance, bank });
  const overdueCount = (overdue?.count ?? 0) > 0 ? overdue.count : 0;
  const overdueTotal = Math.abs((overdue?.expenseTotal ?? 0) - (overdue?.incomeTotal ?? 0));

  async function submit(e) {
    e.preventDefault();
    if (p.state === 'empty') return;
    setSaving(true);
    try {
      const r = await api.post('/reconcile', { balance: Number(bank) });
      notify(r.adjusted ? `Balance matched: ${r.difference > 0 ? 'added' : 'subtracted'} ${money(Math.abs(r.difference))}` : 'Already matching, nothing to change');
      onDone();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <Modal title="Match my bank balance" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          Penny says you have <strong className="num">{money(balance)}</strong>. Type what your bank shows right now.
        </p>
        {overdueCount > 0 && (
          <div className="banner info">
            <Icon name="alert" />
            <span>
              {overdueCount} payment{overdueCount === 1 ? ' is' : 's are'} overdue ({money(overdueTotal)}). If you already paid {overdueCount === 1 ? 'it' : 'them'}, mark{' '}
              {overdueCount === 1 ? 'it' : 'them'} paid first: that may close the gap by itself.{' '}
              <Link to="/payments?status=overdue" onClick={onClose}>
                Review overdue
              </Link>
            </span>
          </div>
        )}
        <Field label="Balance in my bank">
          <input type="number" step="0.01" inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="0.00" required autoFocus />
        </Field>
        <div className={`banner ${p.state === 'match' ? 'ok' : p.state === 'empty' ? 'info' : 'warn'}`} aria-live="polite">
          {p.state === 'empty' && <span>Enter the balance to see the difference.</span>}
          {p.state === 'match' && <span>They already match. Nothing needs to change.</span>}
          {(p.state === 'more' || p.state === 'less') && (
            <span>
              Your bank has <strong>{money(p.amount)} {p.state === 'more' ? 'more' : 'less'}</strong> than Penny. Saving adds {p.type === 'income' ? 'an income' : 'an expense'} of{' '}
              <strong>{money(p.amount)}</strong> dated today, called “Balance adjustment”, so your balance becomes <strong>{money(Number(bank))}</strong>. Delete that payment to undo it.
            </span>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving || p.state === 'empty' || p.state === 'match'}>
            {p.state === 'match' ? 'Already matching' : 'Match the balance'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
