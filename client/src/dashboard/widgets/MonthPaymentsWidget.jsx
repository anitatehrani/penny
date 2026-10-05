import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ds/States.jsx';
import TransactionForm from '../../components/TransactionForm.jsx';
import TxRow from '../../components/TxRow.jsx';
import { Modal, Skeleton } from '../../components/ui.jsx';
import { byListDate, monthTotals } from '../../cardLogic.js';
import { useApp } from '../../context.jsx';
import { monthLabel } from '../../format.js';
import { useQuick } from '../../quick.jsx';

const FIRST = 8;

/**
 * "Coming up" for another month: every payment of that month in date order, with the credit card purchases bought in it (they count
 * in the month the bill is paid, so they are marked and left out of the totals here, as on the Payments page).
 */
export default function MonthPaymentsWidget({ month, rows }) {
  const { money } = useApp();
  const { bump, openAddPayment } = useQuick();
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(false);
  if (!rows) return <Skeleton w="100%" h={190} r={8} />;
  const name = monthLabel(month);
  const sorted = [...rows].sort(byListDate);
  const totals = monthTotals(sorted);
  const shown = expanded ? sorted : sorted.slice(0, FIRST);

  if (sorted.length === 0) {
    return (
      <EmptyState art="calm" title={`Nothing recorded for ${name}`} action={<button className="btn sm" onClick={() => openAddPayment()}>Add a payment</button>}>
        Payments dated in this month will be listed here.
      </EmptyState>
    );
  }
  return (
    <>
      <p className="widget-lead">
        <span className="num">{money(totals.expenses)}</span> out, <span className="num">{money(totals.income)}</span> in · {sorted.length} payment{sorted.length === 1 ? '' : 's'}
        {totals.bought > 0 && (
          <span className="muted">
            {' '}
            · <span className="num">{money(totals.bought)}</span> bought on card
          </span>
        )}
      </p>
      <div className="tx-list" aria-label={`Payments in ${name}`}>
        {shown.map((tx) => (
          <TxRow key={tx.id} tx={tx} compact onChange={bump} onEdit={setEditing} />
        ))}
      </div>
      <div className="widget-foot">
        {sorted.length > FIRST && (
          <button className="link-quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? 'Show fewer' : `Show ${sorted.length - FIRST} more`}
          </button>
        )}
        <span className="spacer" />
        <Link to={`/payments?month=${month}`} className="link-quiet">
          Open in Payments
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
