import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AlertPicker, useAlertChoice } from '../components/Alerts.jsx';
import { Avatar, CategoryDot, CategorySelect, Empty, ErrorBox, Field, Icon, Loading, Modal, Segmented } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLong, describeRule, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

const TEMPLATES = [
  { label: 'Rent', type: 'expense', description: 'Rent', frequency: 'monthly', interval_count: 1, category: 'Rent / Mortgage' },
  { label: 'Subscription', type: 'expense', description: 'Subscription', frequency: 'monthly', interval_count: 1, category: 'Subscriptions' },
  { label: 'Salary', type: 'income', description: 'Salary', frequency: 'monthly', interval_count: 1, category: 'Salary' },
  { label: 'Birthday', type: 'expense', description: "Birthday gift – ", frequency: 'yearly', interval_count: 1, category: 'Birthdays & gifts' },
  { label: 'Insurance (quarterly)', type: 'expense', description: 'Insurance', frequency: 'monthly', interval_count: 3, category: 'Other' },
];

function RuleForm({ initial, onSaved, onCancel }) {
  const { categories, notify } = useApp();
  const { user } = useAuth();
  const { isGroup, members } = useWorkspace();
  const editing = !!initial?.id;
  const [f, setF] = useState({
    paid_by: initial?.member_username ?? user.username,
    type: initial?.type ?? 'expense',
    description: initial?.description ?? '',
    amount: initial?.amount != null ? String(initial.amount) : '',
    frequency: initial?.frequency ?? 'monthly',
    interval_count: initial?.interval_count ?? 1,
    start_date: initial?.start_date ?? todayYMD(),
    end_date: initial?.end_date ?? '',
    category_id: initial?.category_id ? String(initial.category_id) : '',
    note: initial?.note ?? '',
    active: initial?.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const alerts = useAlertChoice('recurring', initial?.id);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));

  function applyTemplate(t) {
    const cat = categories.find((c) => c.name === t.category && c.kind === t.type);
    set({ type: t.type, description: t.description, frequency: t.frequency, interval_count: t.interval_count, category_id: cat ? String(cat.id) : '' });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...f,
        amount: Number(f.amount),
        interval_count: Number(f.interval_count),
        category_id: f.category_id ? Number(f.category_id) : null,
        end_date: f.end_date || null,
        note: f.note || null,
      };
      const saved = editing ? await api.put(`/recurring/${initial.id}`, body) : await api.post('/recurring', body);
      let problem = null;
      try {
        await alerts.save(saved.id);
      } catch (err) {
        problem = `Saved, but the alert setting was not: ${err.message}`;
      }
      notify(problem ?? (editing ? 'Recurring item updated' : 'Recurring item added'), problem ? 'error' : 'ok');
      onSaved(saved);
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  const unit = { weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[f.frequency];

  return (
    <form onSubmit={submit} className="form">
      {!editing && (
        <div className="chips" aria-label="Templates">
          {TEMPLATES.map((t) => (
            <button type="button" key={t.label} className="chip" onClick={() => applyTemplate(t)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <Segmented
        label="Type"
        value={f.type}
        onChange={(type) => set({ type, category_id: '' })}
        options={[
          { value: 'expense', label: 'Expense', tone: 'expense' },
          { value: 'income', label: 'Income', tone: 'income' },
        ]}
      />
      <Field label="Description">
        <input value={f.description} onChange={(e) => set({ description: e.target.value })} required maxLength={200} />
      </Field>
      <div className="form-grid">
        <Field label="Amount">
          <input type="number" step="0.01" min="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} required />
        </Field>
        <Field label="Category">
          <CategorySelect kind={f.type} value={f.category_id} onChange={(category_id) => set({ category_id })} />
        </Field>
      </div>
      {isGroup && (
        <Field label={f.type === 'income' ? 'Whose income' : 'Paid by'} hint="Both go into the shared balance; this records who it belongs to.">
          <select value={f.paid_by} onChange={(e) => set({ paid_by: e.target.value })}>
            {members.map((m) => (
              <option key={m.username} value={m.username}>
                {m.username === user.username ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-grid three">
        <Field label="Repeats">
          <select value={f.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label={`Every … ${unit}`}>
          <input type="number" min="1" max="60" value={f.interval_count} onChange={(e) => set({ interval_count: e.target.value })} required />
        </Field>
        <Field label="Next / first date" hint="Sets the day of the month">
          <input type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} required />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Ends on (optional)">
          <input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set({ end_date: e.target.value })} />
        </Field>
        <Field label="Note (optional)">
          <input value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} />
        </Field>
      </div>
      <AlertPicker value={alerts.choice} onChange={alerts.setChoice} label="Alerts for every occurrence" idPrefix="rule-alert" hint="You can still change a single payment later." />
      {editing && (
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Active (uncheck to pause without deleting)
        </label>
      )}
      <p className="field-hint">
        Upcoming payments are created for the next 24 months. Editing the item updates its unpaid payments; paid ones stay as they are.
      </p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {editing ? 'Save changes' : 'Add recurring item'}
        </button>
      </div>
    </form>
  );
}

export default function Recurring() {
  const { money, notify } = useApp();
  const { isGroup } = useWorkspace();
  const { data, error, reload } = useFetch(() => api.get('/recurring'), []);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(() => (params.get('new') === '1' ? {} : null));
  useEffect(() => {
    if (params.get('new') === '1') setParams({}, { replace: true }); // the link has done its job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(r) {
    if (!window.confirm(`Delete "${r.description}"? Its unpaid upcoming payments will be removed; paid history is kept.`)) return;
    try {
      await api.del(`/recurring/${r.id}`);
      notify('Recurring item deleted');
      reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  async function toggle(r) {
    try {
      await api.put(`/recurring/${r.id}`, { ...r, category_id: r.category_id, active: !r.active });
      reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  const monthly = (data ?? [])
    .filter((r) => r.active)
    .reduce(
      (acc, r) => {
        const perMonth = { weekly: (52 / 12) / r.interval_count, monthly: 1 / r.interval_count, yearly: 1 / (12 * r.interval_count) }[r.frequency];
        acc[r.type] += r.amount * perMonth;
        return acc;
      },
      { income: 0, expense: 0 },
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Recurring</h1>
          <p className="muted">Rent, subscriptions, salary, birthdays — anything that repeats. They feed your payments list and forecast.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" /> Add recurring item
        </button>
      </header>

      {data?.length > 0 && (
        <div className="summary-strip">
          <div>
            <span className="muted">Average monthly income</span>
            <strong className="num pos">{money(monthly.income)}</strong>
          </div>
          <div>
            <span className="muted">Average monthly commitments</span>
            <strong className="num">{money(monthly.expense)}</strong>
          </div>
          <div>
            <span className="muted">Left over</span>
            <strong className={`num ${monthly.income - monthly.expense < 0 ? 'neg' : ''}`}>{money(monthly.income - monthly.expense, { signed: true })}</strong>
          </div>
        </div>
      )}

      <section className="card flush">
        {error ? (
          <ErrorBox error={error} />
        ) : !data ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty title="Nothing recurring yet">Add your rent, subscriptions, salary or a yearly birthday to see them in your forecast.</Empty>
        ) : (
          <div className="tx-list">
            {data.map((r) => (
              <div key={r.id} className={`tx-row rule${r.active ? '' : ' skipped'}`}>
                <div className="tx-date">
                  <strong>{r.next_date ? dateLong(r.next_date) : '—'}</strong>
                  <span className="muted">next</span>
                </div>
                <div className="tx-main">
                  <div className="tx-title">
                    {r.description}
                    {!r.active && <span className="badge">Paused</span>}
                    {r.end_date && <span className="badge">Ends {dateLong(r.end_date)}</span>}
                  </div>
                  <span className="muted">
                    {describeRule(r)} · <CategoryDot color={r.category_color} name={r.category_name} />
                    {isGroup && r.member_name && (
                      <span className="who">
                        {' '}
                        · <Avatar user={{ name: r.member_name, avatar_url: r.member_avatar }} size={16} /> {r.type === 'income' ? 'from' : 'paid by'} {r.member_name.split(' ')[0]}
                      </span>
                    )}
                  </span>
                </div>
                <div className={`tx-amount num ${r.type === 'income' ? 'pos' : ''}`}>
                  {r.type === 'income' ? '+' : '−'}
                  {money(r.amount)}
                </div>
                <div className="tx-actions">
                  <button className="btn sm" onClick={() => toggle(r)}>
                    {r.active ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn icon ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.description}`}>
                    <Icon name="edit" />
                  </button>
                  <button className="btn icon ghost danger-hover" onClick={() => remove(r)} aria-label={`Delete ${r.description}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing.id ? 'Edit recurring item' : 'Add recurring item'} onClose={() => setEditing(null)}>
          <RuleForm
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
