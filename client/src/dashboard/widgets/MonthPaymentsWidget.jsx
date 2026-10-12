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
import { t, tn } from '../../i18n/translate.js';
import { tRich } from '../../i18n/react.jsx';

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
  const totals = monthTotals(sorted, month);
  const shown = expanded ? sorted : sorted.slice(0, FIRST);

  if (sorted.length === 0) {
    return (
      <EmptyState art="calm" title={t('Nothing recorded for {name}', { name })} action={<button className="btn sm" onClick={() => openAddPayment()}>{t('Add a payment')}</button>}>
        {t('Payments dated in this month will be listed here.')}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="widget-lead">
        {tRich('{out} out, {incoming} in · {count}', { out: <span className="num">{money(totals.expenses)}</span>, incoming: <span className="num">{money(totals.income)}</span>, count: tn(sorted.length, '{n} payment', '{n} payments') })}
        {totals.boughtCredit > 0 && (
          <span className="muted">
            {' '}
            {tRich('· {span} bought with credit card', { span: <span className="num">{money(totals.boughtCredit)}</span> })}
          </span>
        )}
      </p>
      <div className="tx-list" aria-label={t('Payments in {name}', { name })}>
        {shown.map((tx) => (
          <TxRow key={tx.id} tx={tx} compact onChange={bump} onEdit={setEditing} />
        ))}
      </div>
      <div className="widget-foot">
        {sorted.length > FIRST && (
          <button className="link-quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? t('Show fewer') : t('Show {value} more', { value: sorted.length - FIRST })}
          </button>
        )}
        <span className="spacer" />
        <Link to={`/payments?month=${month}`} className="link-quiet">
          {t('Open in Payments')}
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
