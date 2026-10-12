import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AlertPicker, useAlertChoice } from '../components/Alerts.jsx';
import { CategoryDot, CategorySelect, Empty, ErrorBox, Field, Icon, Loading, Modal, Segmented } from '../components/ui.jsx';
import DatePicker from '../components/ds/DatePicker.jsx';
import Select from '../components/ds/Select.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLong, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { planFacts } from '../installmentLogic.js';
import { useWorkspace } from '../workspace.jsx';
import { t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

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
        problem = t('Saved, but the alert setting was not: {message}', { message: err.message });
      }
      notify(problem ?? (editing ? t('Installment plan updated') : t('Installment plan added')), problem ? 'error' : 'ok');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('What is it for?')}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={150} placeholder={t('e.g. Laptop, Car loan, Dentist')} />
      </Field>
      {!editing && (
        <>
          <Segmented
            label={t('Amount type')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'installment', label: t('Amount per installment') },
              { value: 'total', label: t('Total amount') },
            ]}
          />
          <div className="form-grid three">
            <Field label={mode === 'total' ? t('Total amount') : t('Each installment')}>
              <input type="number" step="0.01" min="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label={t('Number of installments')}>
              <input type="number" min="1" max="360" value={count} onChange={(e) => setCount(e.target.value)} required />
            </Field>
            <Field label={t('First due date')} hint={t('Later ones fall on the same day each month')}>
              <DatePicker label={t('First due date')} value={first} onChange={setFirst} />
            </Field>
          </div>
          <Field label={t('Already paid')} hint={t('How many installments you have already paid (the earliest ones).')}>
            <input type="number" min="0" max={n} value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
          {n > 0 && amt > 0 && (
            <div className="banner info">
              {tRich('{n} payments of about {bold} · total {bold2} · from {dateLong} to {dateLong2}', { n, dateLong: dateLong(first), dateLong2: dateLong(addMonthsYMD(first, n - 1)), bold: <strong>{money(each)}</strong>, bold2: <strong>{money(total)}</strong> })}
            </div>
          )}
        </>
      )}
      <div className="form-grid">
        <Field label={t('Category')}>
          <CategorySelect kind="expense" value={categoryId} onChange={setCategoryId} />
        </Field>
        <Field label={t('Note (optional)')}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </div>
      {isGroup && !editing && (
        <Field label={t('Paid by')} hint={t('The installments come out of the shared balance; this records who the plan is in the name of.')}>
          <Select label={t('Paid by')} value={paidBy} onChange={setPaidBy} options={members.map((m) => ({ value: m.username, label: m.username === user.username ? t('{name} (you)', { name: m.name }) : m.name, person: m }))} />
        </Field>
      )}
      <AlertPicker value={alerts.choice} onChange={alerts.setChoice} label={t('Alerts for each installment')} idPrefix="plan-alert" />
      {editing && <p className="field-hint">{t('Amounts and dates can\'t be edited. To change them, delete the plan and add it again.')}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {editing ? t('Save changes') : t('Add installment plan')}
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
    if (!window.confirm(t('Delete "{description}"? Unpaid installments will be removed; installments already paid stay in your history.', { description: p.description }))) return;
    try {
      await api.del(`/installments/${p.id}`);
      notify(t('Installment plan deleted'));
      reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  const active = (data ?? []).filter((p) => p.remaining_count > 0);
  const done = (data ?? []).filter((p) => p.remaining_count <= 0);
  const owed = active.reduce((s, p) => s + p.remaining_total, 0);

  const Card = ({ p }) => {
    const facts = planFacts(p);
    const pct = facts.pct;
    return (
      <div className="card plan">
        <div className="card-head">
          <div>
            <h3>{p.description}</h3>
            <CategoryDot color={p.category_color} name={p.category_name} />
          </div>
          <div className="row-actions">
            <button className="btn icon ghost" onClick={() => setEditing(p)} aria-label={t('Edit {description}', { description: p.description })}>
              <Icon name="edit" />
            </button>
            <button className="btn icon ghost danger-hover" onClick={() => remove(p)} aria-label={t('Delete {description}', { description: p.description })}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
        <div className="plan-figures">
          <div>
            <span className="muted">{t('Remaining')}</span>
            <strong className="num">{money(Math.max(0, p.remaining_total))}</strong>
          </div>
          <div>
            <span className="muted">{t('Of total')}</span>
            <strong className="num">{money(p.total_amount)}</strong>
          </div>
          <div>
            <span className="muted">{p.next_due ? t('Next due') : t('Status')}</span>
            <strong>{p.next_due ? dateLong(p.next_due) : t('Fully paid')}</strong>
          </div>
        </div>
        <div className={`progress${facts.segments ? ' steps' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('{paid_count} of {installment_count} installments paid', { paid_count: p.paid_count, installment_count: p.installment_count })}>
          {facts.segments ? facts.segments.map((state, i) => <span key={i} className={`step ${state}`} aria-hidden="true" />) : <div style={{ width: `${pct}%` }} />}
        </div>
        {p.purchase_amount != null && (
          <span className="muted small">
            {t('Bought with the credit card on {dateLong} for {money}', { dateLong: dateLong(p.charged_on), money: money(p.purchase_amount) })}
            {' · '}
            {p.total_amount > p.purchase_amount ? t('interest {money} ({pct}%)', { money: money(p.total_amount - p.purchase_amount), pct: Math.round(((p.total_amount - p.purchase_amount) * 1000) / p.purchase_amount) / 10 }) : t('no interest')}
          </span>
        )}
        <span className="muted small">
          {t('{paid_count} of {installment_count} paid', { paid_count: p.paid_count, installment_count: p.installment_count })}
          {!facts.finished && (
            <>
              {' · '}
              {t('about {money} each', { money: money(facts.each) })}
            </>
          )}
          {facts.lastDue && (
            <>
              {' · '}
              {facts.finished ? t('finished on {dateLong}', { dateLong: dateLong(facts.lastDue) }) : t('the last one is on {dateLong}', { dateLong: dateLong(facts.lastDue) })}
            </>
          )}
          {!facts.finished && (
            <>
              {' · '}
              {t('mark each one paid from the Payments page')}
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('Installments')}</h1>
          <p className="muted">{t('Split purchases and loans. Each installment becomes a payment on its due date.')}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" /> {t('Add installment plan')}
        </button>
      </header>

      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <section className="card">
          <Empty title={t('No installment plans')}>{t('Add a purchase you are paying off in parts and each payment will appear in the right month.')}</Empty>
        </section>
      ) : (
        <>
          <div className="summary-strip">
            <div>
              <span className="muted">{t('Active plans')}</span>
              <strong className="num">{active.length}</strong>
            </div>
            <div>
              <span className="muted">{t('Still to pay in total')}</span>
              <strong className="num">{money(owed)}</strong>
            </div>
          </div>
          {active.length > 0 && <h2 className="sr-only">{t('Plans you are paying off')}</h2>}
          <div className="plans">
            {active.map((p) => (
              <Card key={p.id} p={p} />
            ))}
          </div>
          {done.length > 0 && (
            <>
              <h2 className="section-title">{t('Completed')}</h2>
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
        <Modal title={editing.id ? t('Edit installment plan') : t('Add installment plan')} onClose={() => setEditing(null)}>
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
