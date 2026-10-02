import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import TransactionForm from '../components/TransactionForm.jsx';
import TxRow from '../components/TxRow.jsx';
import { CategorySelect, Empty, ErrorBox, Icon, Loading, Modal, MonthNav } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { currentMonth } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

const STATUSES = [
  ['', 'All'],
  ['pending', 'To pay'],
  ['paid', 'Paid'],
  ['overdue', 'Overdue'],
  ['skipped', 'Skipped'],
];

export default function Transactions() {
  const { money } = useApp();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || currentMonth();
  const status = params.get('status') || '';
  const type = params.get('type') || '';
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
    category_id: category,
    member,
    q: search.trim(),
  });
  const { data, error, reload } = useFetch(() => api.get(`/transactions${query}`), [query]);

  const rows = data ?? [];
  const live = rows.filter((r) => r.status !== 'skipped');
  const sum = (ty, st) => live.filter((r) => r.type === ty && (!st || r.status === st)).reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100;
  const income = sum('income');
  const expenses = sum('expense');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Payments</h1>
          <p className="muted">Everything you paid or still have to pay. Add past payments by choosing an earlier date.</p>
        </div>
        <div className="head-actions">
          <a className="btn" href={`/api/transactions/export.csv${qs({ month: status === 'overdue' ? '' : month, status, type, category_id: category, member, ws: current.id })}`}>
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
      <div className="filters">
        <select value={type} onChange={(e) => set('type', e.target.value)} aria-label="Type">
          <option value="">Income &amp; expenses</option>
          <option value="expense">Expenses only</option>
          <option value="income">Income only</option>
        </select>
        <CategorySelect allowAll value={category} onChange={(v) => set('category', v)} />
        {isGroup && (
          <select value={member} onChange={(e) => set('member', e.target.value)} aria-label="Member">
            <option value="">Everyone</option>
            {members.map((m) => (
              <option key={m.username} value={m.username}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <input type="search" placeholder="Search description or note…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      </div>

      {status !== 'skipped' && data && (
        <div className="summary-strip">
          <div>
            <span className="muted">Income</span>
            <strong className="num pos">{money(income)}</strong>
          </div>
          <div>
            <span className="muted">Expenses</span>
            <strong className="num">{money(expenses)}</strong>
          </div>
          <div>
            <span className="muted">Net</span>
            <strong className={`num ${income - expenses < 0 ? 'neg' : ''}`}>{money(income - expenses, { signed: true })}</strong>
          </div>
        </div>
      )}

      <section className="card flush">
        {error ? (
          <ErrorBox error={error} />
        ) : !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No payments found">
            {status || type || category || search ? 'Try clearing some filters.' : 'Nothing recorded for this month yet — add a payment to get started.'}
          </Empty>
        ) : (
          <div className="tx-list">
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
