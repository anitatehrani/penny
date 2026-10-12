import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ds/States.jsx';
import { Modal } from '../../components/ui.jsx';
import TransactionForm from '../../components/TransactionForm.jsx';
import { useApp } from '../../context.jsx';
import { useQuick } from '../../quick.jsx';
import PaymentRow from '../PaymentRow.jsx';
import { t, tn } from '../../i18n/translate.js';

const FIRST = 5;

/** What has to be paid soon: overdue first, then the next two weeks. Expands when there is more. */
export default function UpcomingWidget({ summary }) {
  const { money } = useApp();
  const { bump, openAddPayment } = useQuick();
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const rows = [...summary.overdue.items, ...summary.upcoming];
  const shown = expanded ? rows : rows.slice(0, FIRST);
  const total = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

  if (rows.length === 0) {
    return (
      <EmptyState art="calm" title={t('Nothing due in the next two weeks')} action={<button className="btn sm" onClick={() => openAddPayment()}>{t('Add a payment')}</button>}>
        {t('When you add a payment with a date, it will appear here.')}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="widget-lead">
        <span className="num">{money(total)}</span> {tn(rows.length, 'to pay across {n} item', 'to pay across {n} items')}
        {summary.overdue.count > 0 && <span className="neg-text"> {t('· {count} overdue', { count: summary.overdue.count })}</span>}
      </p>
      <ul className="ledger" aria-label={t('Payments coming up')}>
        {shown.map((tx) => (
          <PaymentRow key={tx.id} tx={tx} onEdit={setEditing} />
        ))}
      </ul>
      <div className="widget-foot">
        {rows.length > FIRST && (
          <button className="link-quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? t('Show fewer') : t('Show {value} more', { value: rows.length - FIRST })}
          </button>
        )}
        <span className="spacer" />
        <Link to="/payments?status=pending" className="link-quiet">
          {t('All payments')}
        </Link>
      </div>
      {editing && (
        <Modal title={t('Edit payment')} onClose={() => setEditing(null)}>
          <TransactionForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              bump();
            }}
          />
        </Modal>
      )}
    </>
  );
}
