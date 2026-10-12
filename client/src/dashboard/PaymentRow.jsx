import { useState } from 'react';
import { api } from '../api.js';
import { Tooltip } from '../components/ds/Tooltip.jsx';
import { CategoryDot, Icon } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { dateLabel, relativeDay, todayYMD, weekday } from '../format.js';
import { useQuick } from '../quick.jsx';
import { t } from '../i18n/translate.js';

/**
 * One payment in the "coming up" ledger. The date, name and amount are always visible; the quick actions
 * (mark paid, edit) appear when the row is hovered or focused, and are always shown on touch screens.
 */
export default function PaymentRow({ tx, onEdit }) {
  const { money, notify } = useApp();
  const { bump } = useQuick();
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const overdue = tx.date < todayYMD();
  const income = tx.type === 'income';

  async function markPaid() {
    setBusy(true);
    try {
      await api.patch(`/transactions/${tx.id}/status`, { status: 'paid' });
      setLeaving(true);
      notify(`${income ? t('Received') : t('Paid')}: ${tx.description}`, 'ok', {
        label: t('Undo'),
        run: async () => {
          await api.patch(`/transactions/${tx.id}/status`, { status: 'pending' }).catch(() => {});
          bump();
        },
      });
      setTimeout(bump, 200); // let the row fold away before the lists reload
    } catch (e) {
      notify(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <li className={`prow${overdue ? ' overdue' : ''}${leaving ? ' leaving' : ''}`}>
      <div className="prow-date">
        <strong className="num">{dateLabel(tx.date)}</strong>
        <span className={overdue ? 'neg-text' : 'muted'}>{overdue ? relativeDay(tx.date) : weekday(tx.date)}</span>
      </div>
      <div className="prow-main">
        <div className="prow-title">
          <span>{tx.description}</span>
          {tx.source === 'recurring' && (
            <Tooltip label={t('Repeats automatically')}>
              <span className="prow-ico" role="img" aria-label={t('Recurring')}>
                <Icon name="repeat" size={12} />
              </span>
            </Tooltip>
          )}
          {tx.pay_method === 'credit_card' && (
            <Tooltip label={t('Credit card, bought {dateLabel}', { dateLabel: dateLabel(tx.charged_on) })}>
              <span className="prow-ico" role="img" aria-label={t('Credit card, bought {dateLabel}', { dateLabel: dateLabel(tx.charged_on) })}>
                <Icon name="card" size={12} />
              </span>
            </Tooltip>
          )}
          {tx.source === 'debt' && (
            <Tooltip label={tx.type === 'income' ? t('Money paid back to you') : t('Paying off a debt')}>
              <span className="prow-ico" role="img" aria-label={tx.type === 'income' ? t('Paid back') : t('Debt')}>
                <Icon name="debt" size={12} />
              </span>
            </Tooltip>
          )}
          {tx.source === 'loan' && (
            <Tooltip label={t('Money you lent')}>
              <span className="prow-ico" role="img" aria-label={t('Loan')}>
                <Icon name="debt" size={12} />
              </span>
            </Tooltip>
          )}
          {tx.source === 'installment' && (
            <Tooltip label={t('Installment plan')}>
              <span className="prow-ico" role="img" aria-label={t('Installment')}>
                <Icon name="card" size={12} />
              </span>
            </Tooltip>
          )}
        </div>
        <CategoryDot color={tx.category_color} name={tx.category_name} />
      </div>
      <div className={`prow-amount num ${income ? 'pos' : ''}`}>
        {income ? '+' : '−'}
        {money(tx.amount)}
      </div>
      <div className="prow-actions">
        <button className="btn sm primary-soft" onClick={markPaid} disabled={busy} aria-label={`${income ? t('Mark received') : t('Mark paid')}: ${tx.description}`}>
          <Icon name="check" size={14} /> {income ? t('Received') : t('Paid')}
        </button>
        {onEdit && (
          <Tooltip label={t('Edit')}>
            <button className="btn icon sm ghost" onClick={() => onEdit(tx)} aria-label={t('Edit {description}', { description: tx.description })}>
              <Icon name="edit" size={15} />
            </button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}
