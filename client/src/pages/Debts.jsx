import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, CategoryDot, CategorySelect, Empty, ErrorBox, Field, Icon, Loading, Modal, Segmented } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { budgetStatus, describePlan, previewPlan, timelineSteps } from '../debtLogic.js';
import { addMonthsYM, currentMonth, dateLong, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

/** A sensible first payment: next month, on today's day of the month (kept to the 28th so it exists every month). */
const suggestedDate = () => `${addMonthsYM(currentMonth(), 1)}-${String(Math.min(Number(todayYMD().slice(8)), 28)).padStart(2, '0')}`;

function DebtForm({ initial, onSaved, onCancel }) {
  const { money, notify } = useApp();
  const { user } = useAuth();
  const { isGroup, members } = useWorkspace();
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? '');
  const [total, setTotal] = useState(initial?.total_amount != null ? String(initial.total_amount) : '');
  const [plan, setPlan] = useState(initial?.plan ?? 'none');
  const [firstDate, setFirstDate] = useState(initial?.first_due_date ?? suggestedDate());
  const [count, setCount] = useState(String(initial?.installment_count ?? 3));
  const [counted, setCounted] = useState(initial?.count_in_budget ?? true);
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [paidBy, setPaidBy] = useState(initial?.member_username ?? user.username);
  const [saving, setSaving] = useState(false);

  const alreadyPaid = initial?.paid ?? 0;
  const owed = Math.max(0, (Number(total) || 0) - alreadyPaid);
  const preview = previewPlan({ plan, owed, firstDate, count });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        name,
        total_amount: Number(total),
        plan,
        first_due_date: plan === 'none' ? null : firstDate,
        installment_count: plan === 'monthly' ? Number(count) : null,
        count_in_budget: counted,
        category_id: categoryId ? Number(categoryId) : null,
        note: note || null,
        ...(isGroup ? { paid_by: paidBy } : {}),
      };
      if (editing) await api.put(`/debts/${initial.id}`, body);
      else await api.post('/debts', body);
      notify(editing ? 'Debt updated' : 'Debt added');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  // One sentence that says exactly what switching "count it in my budget" does for this choice of plan.
  const effect = !counted
    ? 'Only kept on file. Nothing is added to your balance or forecast, even if you pick a plan.'
    : plan === 'none'
      ? 'Nothing is scheduled yet, so your forecast does not change. It is part of the "balance after debts" figure.'
      : 'Its payments appear in Payments and in your forecast, and it is part of the "balance after debts" figure.';

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        <Field label="Who or what is it owed to?">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="e.g. Faeze, Car loan" />
        </Field>
        <Field label="Amount owed" hint={editing && alreadyPaid > 0 ? `${money(alreadyPaid)} has been paid so far.` : undefined}>
          <input type="number" step="0.01" min="0.01" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} required placeholder="0.00" />
        </Field>
      </div>

      <Segmented
        label="Repayment"
        value={plan}
        onChange={setPlan}
        options={[
          { value: 'none', label: 'Not scheduled yet' },
          { value: 'once', label: 'All in one month' },
          { value: 'monthly', label: 'Split over months' },
        ]}
      />
      {plan === 'once' && (
        <Field label="Pay it on">
          <input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} required />
        </Field>
      )}
      {plan === 'monthly' && (
        <div className="form-grid">
          <Field label="First payment" hint="The later ones fall on the same day each month.">
            <input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} required />
          </Field>
          <Field label="Number of months">
            <input type="number" min="2" max="120" step="1" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required />
          </Field>
        </div>
      )}
      {preview && (
        <div className="banner info" aria-live="polite">
          <span>
            {preview.count === 1 ? (
              <>
                One payment of <strong>{money(preview.each)}</strong> on {dateLong(preview.first)}
              </>
            ) : (
              <>
                {preview.count} payments of <strong>{money(preview.each)}</strong>
                {!preview.even ? ` (the last one ${money(preview.eachLast)})` : ''}
                {`, from ${dateLong(preview.first)} to ${dateLong(preview.last)}`}
              </>
            )}
            {editing && alreadyPaid > 0 ? ` · covers the ${money(owed)} still owed` : ''}
          </span>
        </div>
      )}

      <div className="split-box">
        <label className="check">
          <input type="checkbox" checked={counted} onChange={(e) => setCounted(e.target.checked)} />
          <span>
            Count it in my budget
            <span className="muted block small">{effect}</span>
          </span>
        </label>
      </div>

      <div className="form-grid">
        <Field label="Category" hint="For the repayments.">
          <CategorySelect kind="expense" value={categoryId} onChange={setCategoryId} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </div>
      {isGroup && (
        <Field label="In the name of" hint="Repayments come out of the shared balance; this records who the debt is with.">
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.username} value={m.username}>
                {m.username === user.username ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {editing ? 'Save changes' : 'Add debt'}
        </button>
      </div>
    </form>
  );
}

function PaymentForm({ debt, onSaved, onCancel }) {
  const { money, notify } = useApp();
  const [amount, setAmount] = useState(String(debt.next_amount ?? debt.remaining));
  const [date, setDate] = useState(todayYMD());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post(`/debts/${debt.id}/payments`, { amount: Number(amount), date, note: note || null });
      notify(r.debt.status === 'settled' ? `${debt.name} is fully paid` : `Paid. ${money(r.debt.remaining)} left to pay ${debt.name}`);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <p className="muted">
        You still owe <strong className="num">{money(debt.remaining)}</strong> to {debt.name}. This is money paid out, so it lowers your balance
        {debt.scheduled_count > 0 && ', and the payments still planned will be made smaller to match'}.
      </p>
      <div className="form-grid">
        <Field label="Amount">
          <input type="number" step="0.01" min="0.01" max={debt.remaining} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <Field label="Paid on">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          Record payment
        </button>
      </div>
    </form>
  );
}

const STEP_WORD = { paid: 'Paid', overdue: 'Overdue', next: 'Next', later: 'Planned', open: 'Not scheduled yet' };

/** The road to zero: one step per payment, a mark for its state, and where the plan ends. Opens in place, closed by default. */
function DebtTimeline({ debt }) {
  const { money } = useApp();
  const { steps, debtFree } = timelineSteps(debt, todayYMD());
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.state === 'paid').length;
  return (
    <details className="timeline-wrap">
      <summary>
        Repayment timeline
        <span className="muted small"> · {done} of {steps.length} step{steps.length === 1 ? '' : 's'} done</span>
      </summary>
      <ol className="timeline" aria-label={`Repayment timeline for ${debt.name}`}>
        {steps.map((s) => (
          <li key={s.key} className={`tl-step ${s.state}`}>
            <span className="tl-mark" aria-hidden="true">{s.state === 'paid' && <Icon name="check" size={12} />}</span>
            <div className="tl-body">
              <span className="tl-title">
                {s.date ? dateLong(s.date) : 'Still to plan'}
                <span className="tl-word"> · {STEP_WORD[s.state]}</span>
              </span>
              <strong className="num">{money(s.amount)}</strong>
            </div>
          </li>
        ))}
        {debtFree && (
          <li className="tl-step end">
            <span className="tl-mark" aria-hidden="true" />
            <div className="tl-body">
              <span className="tl-title">Debt-free<span className="tl-word"> · by {dateLong(debtFree)}</span></span>
            </div>
          </li>
        )}
      </ol>
    </details>
  );
}

export default function Debts() {
  const { money, notify } = useApp();
  const { isGroup } = useWorkspace();
  const { data, error, reload } = useFetch(() => api.get('/debts'), []);
  const summary = useFetch(() => api.get('/summary'), []);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(() => (params.get('new') === '1' ? {} : null));
  const [paying, setPaying] = useState(null);
  useEffect(() => {
    if (params.get('new') === '1') setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    reload();
    summary.reload();
  };

  async function run(promise, message) {
    try {
      await promise;
      if (message) notify(message);
      refresh();
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  const remove = (d) => {
    if (!window.confirm(`Delete "${d.name}"? Payments still to come are removed; payments already made stay in your history.`)) return;
    run(api.del(`/debts/${d.id}`), 'Debt deleted');
  };
  const settle = (d) => {
    if (!window.confirm(`Mark "${d.name}" as settled? Payments still to come are removed; payments already made stay.`)) return;
    run(api.post(`/debts/${d.id}/settle`), `${d.name} marked as settled`);
  };

  const debts = data?.debts ?? [];
  const totals = data?.totals;
  const active = debts.filter((d) => d.status === 'active');
  const settled = debts.filter((d) => d.status === 'settled');
  const balance = summary.data?.balance;

  const Card = ({ d }) => {
    const pct = d.total_amount > 0 ? Math.min(100, Math.round((d.paid / d.total_amount) * 100)) : 0;
    const badge = budgetStatus(d);
    return (
      <div className="card plan debt">
        <div className="card-head">
          <div>
            <h3>{d.name}</h3>
            <span className="muted small">
              {describePlan(d, dateLong)}
              {d.category_name && (
                <>
                  {' · '}
                  <CategoryDot color={d.category_color} name={d.category_name} />
                </>
              )}
              {isGroup && d.member_name && (
                <>
                  {' · '}
                  <span className="who">
                    <Avatar user={{ name: d.member_name, avatar_url: d.member_avatar }} size={16} /> {d.member_name.split(' ')[0]}
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="row-actions">
            <span className={`badge ${badge.tone}`}>{badge.label}</span>
            <button className="btn icon ghost" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
              <Icon name="edit" />
            </button>
            <button className="btn icon ghost danger-hover" onClick={() => remove(d)} aria-label={`Delete ${d.name}`}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
        <div className="plan-figures">
          <div>
            <span className="muted">Still owed</span>
            <strong className="num">{money(d.remaining)}</strong>
          </div>
          <div>
            <span className="muted">Of total</span>
            <strong className="num">{money(d.total_amount)}</strong>
          </div>
          <div>
            <span className="muted">{d.status === 'settled' ? 'Status' : 'Next payment'}</span>
            <strong>{d.status === 'settled' ? 'Settled' : d.next_due ? `${dateLong(d.next_due)} · ${money(d.next_amount)}` : d.plan !== 'none' && !d.count_in_budget ? 'Planned, not counted' : 'No plan yet'}</strong>
          </div>
        </div>
        <div className="debt-progress">
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${money(d.paid)} of ${money(d.total_amount)} paid`}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="debt-pct num">{pct}% paid</span>
        </div>
        <DebtTimeline debt={d} />
        <div className="debt-actions">
          <span className="muted small">
            {money(d.paid)} paid{d.scheduled_count > 0 ? ` · ${d.scheduled_count} payment${d.scheduled_count === 1 ? '' : 's'} planned (mark each paid on the Payments page)` : ''}
          </span>
          <span className="row-actions">
            {d.status === 'active' ? (
              <>
                <button className="btn sm primary-soft" onClick={() => setPaying(d)}>
                  <Icon name="check" size={14} /> Record a payment
                </button>
                <button className="btn sm" onClick={() => settle(d)}>
                  Mark settled
                </button>
              </>
            ) : (
              d.settled_at && (
                <button className="btn sm" onClick={() => run(api.post(`/debts/${d.id}/reopen`), `${d.name} is open again`)}>
                  <Icon name="undo" size={14} /> Reopen
                </button>
              )
            )}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Debts</h1>
          <p className="muted">Money you owe. Pay it all in one month, split it over months, or just keep it on file for now.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" /> Add debt
        </button>
      </header>

      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : debts.length === 0 ? (
        <section className="card">
          <Empty title="No debts" icon="debt">
            Add money you owe, for example to a friend. Choose when to pay it, and whether it counts in your balance and forecast.
          </Empty>
        </section>
      ) : (
        <>
          <div className="summary-strip">
            <div>
              <span className="muted">Total owed</span>
              <strong className="num">{money(totals.owed)}</strong>
            </div>
            <div>
              <span className="muted">Counted in your budget</span>
              <strong className="num">{money(totals.counted)}</strong>
            </div>
            <div>
              <span className="muted">Planned in your forecast</span>
              <strong className="num">{money(totals.scheduled)}</strong>
            </div>
            <div>
              <span className="muted">Paid so far</span>
              <strong className="num">{money(totals.paid)}</strong>
            </div>
          </div>
          {balance != null && totals.counted > 0 && (
            <p className="muted debt-after">
              Your balance today is <strong className="num">{money(balance)}</strong>. After paying every counted debt it would be{' '}
              <strong className={`num ${balance - totals.counted < 0 ? 'neg' : ''}`}>{money(balance - totals.counted)}</strong>.
            </p>
          )}
          {active.length > 0 && <h2 className="sr-only">Debts you are paying off</h2>}
          <div className="plans">
            {active.map((d) => (
              <Card key={d.id} d={d} />
            ))}
          </div>
          {settled.length > 0 && (
            <>
              <h2 className="section-title">Settled</h2>
              <div className="plans">
                {settled.map((d) => (
                  <Card key={d.id} d={d} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit debt' : 'Add debt'} onClose={() => setEditing(null)}>
          <DebtForm
            initial={editing.id ? editing : null}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}
      {paying && (
        <Modal title={`Pay ${paying.name}`} onClose={() => setPaying(null)}>
          <PaymentForm
            debt={paying}
            onCancel={() => setPaying(null)}
            onSaved={() => {
              setPaying(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
