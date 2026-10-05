import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AlertPicker, useAlertChoice } from '../components/Alerts.jsx';
import { CategoryDot, CategorySelect, Empty, ErrorBox, Field, Icon, Loading, Modal, Segmented } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLong, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

function addMonthsYMD(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const dim = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}

function PlanForm({ initial, onSaved, onCancel }) {
  const { money, notify } = useApp();
  const { user } = useAuth();
  const { isGroup, members } = useWorkspace();
  const [paidBy, setPaidBy] = useState(user.username);
  const editing = !!initial?.id;
  const [description, setDescription] = useState(initial?.description ?? '');
  const [mode, setMode] = useState('installment'); // 'installment' = amount per installment, 'total'
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState(initial?.installment_count ?? 6);
  const [first, setFirst] = useState(todayYMD());
  const [paid, setPaid] = useState(0);
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [saving, setSaving] = useState(false);
  const alerts = useAlertChoice('installment', initial?.id);

  const n = Number(count) || 0;
  const amt = Number(amount) || 0;
  const total = mode === 'total' ? amt : amt * n;
  const each = n ? (mode === 'total' ? amt / n : amt) : 0;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let saved = initial;
      if (editing) {
        await api.put(`/installments/${initial.id}`, { description, category_id: categoryId ? Number(categoryId) : null, note: note || null });
      } else {
        saved = await api.post('/installments', {
          description,
          [mode === 'total' ? 'total_amount' : 'installment_amount']: amt,
          installment_count: n,
          first_due_date: first,
          paid_count: Number(paid) || 0,
          category_id: categoryId ? Number(categoryId) : null,
          note: note || null,
          ...(isGroup ? { paid_by: paidBy } : {}),
        });
      }
      let problem = null;
      try {
        await alerts.save(saved.id);
      } catch (err) {
        problem = `Saved, but the alert setting was not: ${err.message}`;
      }
      notify(problem ?? (editing ? 'Installment plan updated' : 'Installment plan added'), problem ? 'error' : 'ok');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <Field label="What is it for?">
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={150} placeholder="e.g. Laptop, Car loan, Dentist" />
      </Field>
      {!editing && (
        <>
          <Segmented
            label="Amount type"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'installment', label: 'Amount per installment' },
              { value: 'total', label: 'Total amount' },
            ]}
          />
          <div className="form-grid three">
            <Field label={mode === 'total' ? 'Total amount' : 'Each installment'}>
              <input type="number" step="0.01" min="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Number of installments">
              <input type="number" min="1" max="360" value={count} onChange={(e) => setCount(e.target.value)} required />
            </Field>
            <Field label="First due date" hint="Later ones fall on the same day each month">
              <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} required />
            </Field>
          </div>
          <Field label="Already paid" hint="How many installments you have already paid (the earliest ones).">
            <input type="number" min="0" max={n} value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
          {n > 0 && amt > 0 && (
            <div className="banner info">
              {n} payments of about <strong>{money(each)}</strong> · total <strong>{money(total)}</strong> · from {dateLong(first)} to {dateLong(addMonthsYMD(first, n - 1))}
            </div>
          )}
        </>
      )}
      <div className="form-grid">
        <Field label="Category">
          <CategorySelect kind="expense" value={categoryId} onChange={setCategoryId} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </div>
      {isGroup && !editing && (
        <Field label="Paid by" hint="The installments come out of the shared balance; this records who the plan is in the name of.">
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.username} value={m.username}>
                {m.username === user.username ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <AlertPicker value={alerts.choice} onChange={alerts.setChoice} label="Alerts for each installment" idPrefix="plan-alert" />
      {editing && <p className="field-hint">Amounts and dates can't be edited. To change them, delete the plan and add it again.</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {editing ? 'Save changes' : 'Add installment plan'}
        </button>
      </div>
    </form>
  );
}

export default function Installments() {
  const { money, notify } = useApp();
  const { data, error, reload } = useFetch(() => api.get('/installments'), []);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(() => (params.get('new') === '1' ? {} : null));
  useEffect(() => {
    if (params.get('new') === '1') setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(p) {
    if (!window.confirm(`Delete "${p.description}"? Unpaid installments will be removed; installments already paid stay in your history.`)) return;
    try {
      await api.del(`/installments/${p.id}`);
      notify('Installment plan deleted');
      reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  const active = (data ?? []).filter((p) => p.remaining_count > 0);
  const done = (data ?? []).filter((p) => p.remaining_count <= 0);
  const owed = active.reduce((s, p) => s + p.remaining_total, 0);

  const Card = ({ p }) => {
    const pct = Math.round((p.paid_count / p.installment_count) * 100);
    return (
      <div className="card plan">
        <div className="card-head">
          <div>
            <h3>{p.description}</h3>
            <CategoryDot color={p.category_color} name={p.category_name} />
          </div>
          <div className="row-actions">
            <button className="btn icon ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.description}`}>
              <Icon name="edit" />
            </button>
            <button className="btn icon ghost danger-hover" onClick={() => remove(p)} aria-label={`Delete ${p.description}`}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
        <div className="plan-figures">
          <div>
            <span className="muted">Remaining</span>
            <strong className="num">{money(Math.max(0, p.remaining_total))}</strong>
          </div>
          <div>
            <span className="muted">Of total</span>
            <strong className="num">{money(p.total_amount)}</strong>
          </div>
          <div>
            <span className="muted">{p.next_due ? 'Next due' : 'Status'}</span>
            <strong>{p.next_due ? dateLong(p.next_due) : 'Fully paid'}</strong>
          </div>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.paid_count} of ${p.installment_count} installments paid`}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <span className="muted small">
          {p.paid_count} of {p.installment_count} paid · mark each one paid from the Payments page
        </span>
      </div>
    );
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Installments</h1>
          <p className="muted">Split purchases and loans. Each installment becomes a payment on its due date.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" /> Add installment plan
        </button>
      </header>

      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <section className="card">
          <Empty title="No installment plans">Add a purchase you are paying off in parts and each payment will appear in the right month.</Empty>
        </section>
      ) : (
        <>
          <div className="summary-strip">
            <div>
              <span className="muted">Active plans</span>
              <strong className="num">{active.length}</strong>
            </div>
            <div>
              <span className="muted">Still to pay in total</span>
              <strong className="num">{money(owed)}</strong>
            </div>
          </div>
          {active.length > 0 && <h2 className="sr-only">Plans you are paying off</h2>}
          <div className="plans">
            {active.map((p) => (
              <Card key={p.id} p={p} />
            ))}
          </div>
          {done.length > 0 && (
            <>
              <h2 className="section-title">Completed</h2>
              <div className="plans">
                {done.map((p) => (
                  <Card key={p.id} p={p} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit installment plan' : 'Add installment plan'} onClose={() => setEditing(null)}>
          <PlanForm
            initial={editing.id ? editing : null}
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
