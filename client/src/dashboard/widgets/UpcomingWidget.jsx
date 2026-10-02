import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ds/States.jsx';
import { Modal } from '../../components/ui.jsx';
import TransactionForm from '../../components/TransactionForm.jsx';
import { useApp } from '../../context.jsx';
import { useQuick } from '../../quick.jsx';
import PaymentRow from '../PaymentRow.jsx';

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
      <EmptyState art="calm" title="Nothing due in the next two weeks" action={<button className="btn sm" onClick={() => openAddPayment()}>Add a payment</button>}>
        When you add a payment with a date, it will appear here.
      </EmptyState>
    );
  }
  return (
    <>
      <p className="widget-lead">
        <span className="num">{money(total)}</span> to pay across {rows.length} item{rows.length === 1 ? '' : 's'}
        {summary.overdue.count > 0 && <span className="neg-text"> · {summary.overdue.count} overdue</span>}
      </p>
      <ul className="ledger" aria-label="Payments coming up">
        {shown.map((tx) => (
          <PaymentRow key={tx.id} tx={tx} onEdit={setEditing} />
        ))}
      </ul>
      <div className="widget-foot">
        {rows.length > FIRST && (
          <button className="link-quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? 'Show fewer' : `Show ${rows.length - FIRST} more`}
          </button>
        )}
        <span className="spacer" />
        <Link to="/payments?status=pending" className="link-quiet">
          All payments
        </Link>
      </div>
      {editing && (
        <Modal title="Edit payment" onClose={() => setEditing(null)}>
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
