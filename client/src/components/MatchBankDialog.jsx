import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { reconcilePreview } from '../reconcileLogic.js';
import { Field, Icon, Modal } from './ui.jsx';
import { t, tn } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

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
      notify(r.adjusted ? r.difference > 0 ? t('Balance matched: {money} added', { money: money(Math.abs(r.difference)) }) : t('Balance matched: {money} subtracted', { money: money(Math.abs(r.difference)) }) : t('Already matching, nothing to change'));
      onDone();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <Modal title={t('Match my bank balance')} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          {tRich('Penny says you have {bold}. Type what your bank shows right now.', { bold: <strong className="num">{money(balance)}</strong> })}
        </p>
        {overdueCount > 0 && (
          <div className="banner info">
            <Icon name="alert" />
            <span>
              {tn(overdueCount, 'One payment is overdue ({money}). If you already paid it, mark it paid first: that may close the gap by itself.', '{n} payments are overdue ({money}). If you already paid them, mark them paid first: that may close the gap by itself.', { money: money(overdueTotal) })}{' '}
              <Link to="/payments?status=overdue" onClick={onClose}>
                {t('Review overdue')}
              </Link>
            </span>
          </div>
        )}
        <Field label={t('Balance in my bank')}>
          <input type="number" step="0.01" inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="0.00" required autoFocus />
        </Field>
        <div className={`banner ${p.state === 'match' ? 'ok' : p.state === 'empty' ? 'info' : 'warn'}`} aria-live="polite">
          {p.state === 'empty' && <span>{t('Enter the balance to see the difference.')}</span>}
          {p.state === 'match' && <span>{t('They already match. Nothing needs to change.')}</span>}
          {(p.state === 'more' || p.state === 'less') && (
            <span>
              {tRich(p.state === 'more' ? 'Your bank has {amount} more than Penny.' : 'Your bank has {amount} less than Penny.', { amount: <strong>{money(p.amount)}</strong> })}{' '}
              {tRich(p.type === 'income' ? 'Saving adds an income of {amount} dated today, called “Balance adjustment”, so your balance becomes {balance}. Delete that payment to undo it.' : 'Saving adds an expense of {amount} dated today, called “Balance adjustment”, so your balance becomes {balance}. Delete that payment to undo it.', { amount: <strong>{money(p.amount)}</strong>, balance: <strong>{money(Number(bank))}</strong> })}
            </span>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={saving || p.state === 'empty' || p.state === 'match'}>
            {p.state === 'match' ? t('Already matching') : t('Match the balance')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
