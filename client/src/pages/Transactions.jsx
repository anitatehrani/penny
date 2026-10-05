import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import TransactionForm from '../components/TransactionForm.jsx';
import TxRow from '../components/TxRow.jsx';
import FilterSelect from '../components/ds/FilterSelect.jsx';
import { MonthNav } from '../components/ds/MonthPicker.jsx';
import { Empty, ErrorBox, Icon, Loading, Modal } from '../components/ui.jsx';
import { byListDate, monthTotals } from '../cardLogic.js';
import { carryState, carryVisible, withCarry } from '../carryLogic.js';
import { useApp } from '../context.jsx';
import { activeFilterCount, categoryOptions } from '../filterLogic.js';
import { currentMonth, monthLabel, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

const TYPES = [
  { value: '', label: 'Income & expenses' },
  { value: 'expense', label: 'Expenses only' },
  { value: 'income', label: 'Income only' },
];
const PAYS = [
  { value: '', label: 'Any way of paying' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'cash', label: 'Cash and bank' },
];

/** The line at the top of a month: what was left over from the month before. Nothing to edit; it is not a payment. */
function CarryRow({ carry, state, month }) {
  const { money } = useApp();
  const from = monthLabel(carry.from_month, { month: 'long' });
  return (
    <div className="tx-row carry">
      <div className="tx-date">
        <strong>{monthLabel(month, { month: 'short' })} 1</strong>
        <span className="muted">{state === 'pending' ? 'expected' : 'carried over'}</span>
      </div>
      <div className="tx-main">
        <div className="tx-title">
          Left over from {from}
          <span className="badge" title="Worked out from your payments. It is not a payment, so it is not in your balance twice.">
            <Icon name="undo" size={12} /> Carried over
          </span>
        </div>
        <div className="tx-meta">
          <span className="muted">What remained after everything in {from}, added to this month. You can turn this off in Settings.</span>
        </div>
      </div>
      <div className="tx-amount num pos">+{money(carry.amount)}</div>
      <div className="tx-actions" />
    </div>
  );
}

const STATUSES = [
  ['', 'All'],
  ['pending', 'To pay'],
  ['paid', 'Paid'],
  ['overdue', 'Overdue'],
  ['skipped', 'Skipped'],
];

export default function Transactions() {
  const { money, categories } = useApp();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || currentMonth();
  const status = params.get('status') || '';
  const type = params.get('type') || '';
  const pay = params.get('pay') || '';
  const category = params.get('category') || '';
  const member = params.get('member') || '';
  const { current, isGroup, members } = useWorkspace();
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const [editing, setEditing] = useState(null); // null | {} (new) | tx

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Overdue items can be from any month, so that filter ignores the month selector.
  const query = qs({
    month: status === 'overdue' ? '' : month,
    status,
    type,
    pay,
    category_id: category,
    member,
    q: search.trim(),
    // In the "All" view, also list the credit card purchases bought this month that are paid (and counted) in another one.
    bought: status === '' ? '1' : '',
  });
  const { data, error, reload } = useFetch(() => api.get(`/transactions${query}`), [query]);

  // What was left over from earlier months (docs/DESIGN.md section 21). It is worked out on the server and is not a stored payment.
  const carryData = useFetch(() => (status === 'overdue' ? Promise.resolve(null) : api.get(`/carryover?month=${month}`)), [month, status, data]);
  const today = todayYMD();
  const showCarry = carryVisible({ carry: carryData.data, month, today, status, type, pay, category, member, search });

  const categoryChoices = useMemo(() => categoryOptions(categories), [categories]);
  const memberChoices = useMemo(() => [{ value: '', label: 'Everyone' }, ...members.map((m) => ({ value: m.username, label: m.name, person: m }))], [members]);
  const filterCount = activeFilterCount({ type, pay, category, member, search });
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const k of ['type', 'pay', 'category', 'member', 'q']) next.delete(k);
    setParams(next, { replace: true });
    setSearch('');
  };

  const rows = [...(data ?? [])].sort(byListDate); // a purchase sits on the day it was bought, not on the day its bill is paid
  const totals = monthTotals(rows);
  const { income, expenses, net, onCard, bought, carried = 0 } = showCarry ? withCarry(totals, carryData.data.amount) : totals;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Payments</h1>
          <p className="muted">Everything you paid or still have to pay. Add past payments by choosing an earlier date.</p>
        </div>
        <div className="head-actions">
          <a className="btn" href={`/api/transactions/export.csv${qs({ month: status === 'overdue' ? '' : month, status, type, pay, category_id: category, member, ws: current.id })}`}>
            <Icon name="download" /> CSV
          </a>
          <button className="btn primary" onClick={() => setEditing({})}>
            <Icon name="plus" /> Add payment
          </button>
        </div>
      </header>

      <div className="toolbar">
        {status !== 'overdue' && <MonthNav month={month} onChange={(m) => set('month', m === currentMonth() ? '' : m)} />}
        <div className="chips" role="group" aria-label="Status filter">
          {STATUSES.map(([value, label]) => (
            <button key={value} className={`chip${status === value ? ' active' : ''}`} onClick={() => set('status', value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="filters" role="search" aria-label="Filter payments">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search description or note…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payments" />
          {search && (
            <button type="button" className="btn icon ghost sm search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <FilterSelect label="Type" icon="trend" value={type} onChange={(v) => set('type', v)} options={TYPES} />
        <FilterSelect label="Paid with" icon="card" value={pay} onChange={(v) => set('pay', v)} options={PAYS} />
        <FilterSelect label="Category" icon="tag" value={category} onChange={(v) => set('category', v)} options={categoryChoices} />
        {isGroup && <FilterSelect label="Member" icon="users" value={member} onChange={(v) => set('member', v)} options={memberChoices} />}
        {filterCount > 0 && (
          <button type="button" className="btn sm ghost filters-clear" onClick={clearFilters}>
            <Icon name="x" size={14} /> Clear filters ({filterCount})
          </button>
        )}
      </div>

      {status !== 'skipped' && data && (
        <div className="summary-strip">
          <div>
            <span className="muted">Income</span>
            <strong className="num pos">{money(income)}</strong>
            {carried > 0 && <span className="muted small">includes {money(carried)} left over from {monthLabel(carryData.data.from_month, { month: 'long' })}</span>}
          </div>
          <div>
            <span className="muted">Expenses</span>
            <strong className="num">{money(expenses)}</strong>
          </div>
          <div>
            <span className="muted">Net</span>
            <strong className={`num ${net < 0 ? 'neg' : ''}`}>{money(net, { signed: true })}</strong>
          </div>
          {onCard > 0 && (
            <div>
              <span className="muted">Paid with the card bill</span>
              <strong className="num">{money(onCard)}</strong>
            </div>
          )}
          {bought > 0 && (
            <div title="Bought with the credit card this month. It counts in the month the bill is paid, so it is not in the figures on the left.">
              <span className="muted">Bought on card</span>
              <strong className="num">{money(bought)}</strong>
            </div>
          )}
        </div>
      )}

      <section className="card flush">
        {error ? (
          <ErrorBox error={error} />
        ) : !data ? (
          <Loading />
        ) : rows.length === 0 && !showCarry ? (
          <Empty title="No payments found">
            {status || type || pay || category || search ? 'Try clearing some filters.' : 'Nothing recorded for this month yet — add a payment to get started.'}
          </Empty>
        ) : (
          <div className="tx-list">
            {showCarry && <CarryRow carry={carryData.data} state={carryState(month, today)} month={month} />}
            {rows.map((tx) => (
              <TxRow key={tx.id} tx={tx} onChange={reload} onEdit={setEditing} />
            ))}
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing.id ? 'Edit payment' : 'Add payment'} onClose={() => setEditing(null)}>
          <TransactionForm
            initial={editing.id ? editing : null}
            defaultDate={month === currentMonth() ? undefined : `${month}-01`}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
