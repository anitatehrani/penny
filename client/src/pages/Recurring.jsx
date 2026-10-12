import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AlertPicker, useAlertChoice } from '../components/Alerts.jsx';
import { Avatar, CategoryDot, CategorySelect, Empty, ErrorBox, Field, Icon, Loading, Modal, Segmented } from '../components/ui.jsx';
import DatePicker from '../components/ds/DatePicker.jsx';
import Select from '../components/ds/Select.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLong, describeRule, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { lastOccurrence, monthlyEquivalent, monthlyShares, nthOccurrence } from '../recurrenceLogic.js';
import { useWorkspace } from '../workspace.jsx';
import { t, tn } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

const TEMPLATES = [
  { get label() { return t('Rent'); }, type: 'expense', get description() { return t('Rent'); }, frequency: 'monthly', interval_count: 1, category: 'Rent / Mortgage' },
  { get label() { return t('Subscription'); }, type: 'expense', get description() { return t('Subscription'); }, frequency: 'monthly', interval_count: 1, category: 'Subscriptions' },
  { get label() { return t('Salary'); }, type: 'income', get description() { return t('Salary'); }, frequency: 'monthly', interval_count: 1, category: 'Salary' },
  { get label() { return t('Birthday'); }, type: 'expense', get description() { return t('Birthday gift – '); }, frequency: 'yearly', interval_count: 1, category: 'Birthdays & gifts' },
  { get label() { return t('Insurance (quarterly)'); }, type: 'expense', get description() { return t('Insurance'); }, frequency: 'monthly', interval_count: 3, category: 'Other' },
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
  // How it ends: never, on a date, or after a number of payments.
  const [endMode, setEndMode] = useState(initial?.end_date ? 'date' : 'never');
  const [endCount, setEndCount] = useState('12');
  const [saving, setSaving] = useState(false);
  const alerts = useAlertChoice('recurring', initial?.id);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));

  function applyTemplate(tt) {
    const cat = categories.find((c) => c.name === tt.category && c.kind === tt.type);
    set({ type: tt.type, description: tt.description, frequency: tt.frequency, interval_count: tt.interval_count, category_id: cat ? String(cat.id) : '' });
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
        end_date: endMode === 'date' ? f.end_date || null : null,
        ends_after: endMode === 'count' ? Number(endCount) : null,
        note: f.note || null,
      };
      const saved = editing ? await api.put(`/recurring/${initial.id}`, body) : await api.post('/recurring', body);
      let problem = null;
      try {
        await alerts.save(saved.id);
      } catch (err) {
        problem = t('Saved, but the alert setting was not: {message}', { message: err.message });
      }
      notify(problem ?? (editing ? t('Recurring item updated') : t('Recurring item added')), problem ? 'error' : 'ok');
      onSaved(saved);
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  const everyLabel = { weekly: t('Every … week(s)'), monthly: t('Every … month(s)'), yearly: t('Every … year(s)') }[f.frequency];

  // A plain sentence about when it stops, so the choice never has to be guessed.
  const rule = { frequency: f.frequency, interval_count: f.interval_count, start_date: f.start_date };
  const last = endMode === 'date' ? lastOccurrence(rule, f.end_date) : endMode === 'count' && Number(endCount) >= 1 && f.start_date ? { date: nthOccurrence(rule, Number(endCount)), count: Number(endCount) } : null;
  const endSummary =
    endMode === 'never'
      ? t('It keeps going until you pause or delete it.')
      : last
        ? tn(last.count, 'The last payment is on {dateLong} ({n} payment in total). After that, nothing more is added.', 'The last payment is on {dateLong} ({n} payments in total). After that, nothing more is added.', { dateLong: dateLong(last.date) })
        : endMode === 'date' && f.end_date
          ? t('That date is before the first payment, so nothing would be added.')
          : '';

  return (
    <form onSubmit={submit} className="form">
      {!editing && (
        <div className="chips" aria-label={t('Templates')}>
          {TEMPLATES.map((tt) => (
            <button type="button" key={tt.label} className="chip" onClick={() => applyTemplate(tt)}>
              {tt.label}
            </button>
          ))}
        </div>
      )}
      <Segmented
        label={t('Type')}
        value={f.type}
        onChange={(type) => set({ type, category_id: '' })}
        options={[
          { value: 'expense', label: t('Expense'), tone: 'expense' },
          { value: 'income', label: t('Income'), tone: 'income' },
        ]}
      />
      <Field label={t('Description')}>
        <input value={f.description} onChange={(e) => set({ description: e.target.value })} required maxLength={200} />
      </Field>
      <div className="form-grid">
        <Field label={t('Amount')}>
          <input type="number" step="0.01" min="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} required />
        </Field>
        <Field label={t('Category')}>
          <CategorySelect kind={f.type} value={f.category_id} onChange={(category_id) => set({ category_id })} />
        </Field>
      </div>
      {isGroup && (
        <Field label={f.type === 'income' ? t('Whose income') : t('Paid by')} hint={t('Both go into the shared balance; this records who it belongs to.')}>
          <Select label={f.type === 'income' ? t('Whose income') : t('Paid by')} value={f.paid_by} onChange={(paid_by) => set({ paid_by })} options={members.map((m) => ({ value: m.username, label: m.username === user.username ? t('{name} (you)', { name: m.name }) : m.name, person: m }))} />
        </Field>
      )}
      <div className="form-grid three">
        <Field label={t('Repeats')}>
          <Select
            label={t('Repeats')}
            value={f.frequency}
            onChange={(frequency) => set({ frequency })}
            options={[
              { value: 'weekly', label: t('Weekly') },
              { value: 'monthly', label: t('Monthly') },
              { value: 'yearly', label: t('Yearly') },
            ]}
          />
        </Field>
        <Field label={everyLabel}>
          <input type="number" min="1" max="60" value={f.interval_count} onChange={(e) => set({ interval_count: e.target.value })} required />
        </Field>
        <Field label={t('Next / first date')} hint={t('Changing it moves every payment still to come; paid ones stay')}>
          <DatePicker label={t('Next / first date')} value={f.start_date} onChange={(start_date) => set({ start_date })} />
        </Field>
      </div>
      <div className="end-box">
        <Segmented
          label={t('Ends')}
          value={endMode}
          onChange={setEndMode}
          options={[
            { value: 'never', label: t('Never') },
            { value: 'date', label: t('On a date') },
            { value: 'count', label: t('After a number of payments') },
          ]}
        />
        {endMode === 'date' && (
          <Field label={t('Last day')}>
            <DatePicker label={t('Last day')} value={f.end_date} min={f.start_date} onChange={(end_date) => set({ end_date })} />
          </Field>
        )}
        {endMode === 'count' && (
          <Field label={t('Number of payments')} hint={t('Counting the first one.')}>
            <input type="number" min="1" max="600" step="1" inputMode="numeric" value={endCount} onChange={(e) => setEndCount(e.target.value)} required />
          </Field>
        )}
        {endSummary && <p className="field-hint end-summary">{endSummary}</p>}
      </div>
      <Field label={t('Note (optional)')}>
        <input value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} />
      </Field>
      <AlertPicker value={alerts.choice} onChange={alerts.setChoice} label={t('Alerts for every occurrence')} idPrefix="rule-alert" hint={t('You can still change a single payment later.')} />
      {editing && (
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> {t('Active (uncheck to pause without deleting)')}
        </label>
      )}
      <p className="field-hint">
        {t('Upcoming payments are created for the next 24 months. Editing the item updates its unpaid payments; paid ones stay as they are.')}
      </p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {editing ? t('Save changes') : t('Add recurring item')}
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
    if (!window.confirm(t('Delete "{description}"? Its unpaid upcoming payments will be removed; paid history is kept.', { description: r.description }))) return;
    try {
      await api.del(`/recurring/${r.id}`);
      notify(t('Recurring item deleted'));
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

  const rules = data ?? [];
  const monthly = rules.reduce(
    (acc, r) => {
      acc[r.type] += monthlyEquivalent(r);
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const shares = monthlyShares(rules);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('Recurring')}</h1>
          <p className="muted">{t('Rent, subscriptions, salary, birthdays — anything that repeats. They feed your payments list and forecast.')}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" /> {t('Add recurring item')}
        </button>
      </header>

      {data?.length > 0 && (
        <div className="summary-strip">
          <div>
            <span className="muted">{t('Average monthly income')}</span>
            <strong className="num pos">{money(monthly.income)}</strong>
          </div>
          <div>
            <span className="muted">{t('Average monthly commitments')}</span>
            <strong className="num">{money(monthly.expense)}</strong>
          </div>
          <div>
            <span className="muted">{t('Left over')}</span>
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
          <Empty title={t('Nothing recurring yet')}>{t('Add your rent, subscriptions, salary or a yearly birthday to see them in your forecast.')}</Empty>
        ) : (
          <div className="tx-list">
            {data.map((r) => (
              <div key={r.id} className={`tx-row rule${r.active ? '' : ' skipped'}`}>
                <div className="tx-date">
                  <strong>{r.next_date ? dateLong(r.next_date) : '—'}</strong>
                  <span className="muted">{t('next')}</span>
                </div>
                <div className="tx-main">
                  <div className="tx-title">
                    {r.description}
                    {!r.active && <span className="badge">{t('Paused')}</span>}
                    {r.end_date && <span className="badge">{t('Ends {dateLong}', { dateLong: dateLong(r.end_date) })}</span>}
                  </div>
                  <span className="muted">
                    {describeRule(r)} · <CategoryDot color={r.category_color} name={r.category_name} />
                    {isGroup && r.member_name && (
                      <span className="who">
                        {' '}
                        · <Avatar user={{ name: r.member_name, avatar_url: r.member_avatar }} size={16} /> {r.type === 'income' ? t('from') : t('paid by')} {r.member_name.split(' ')[0]}
                      </span>
                    )}
                  </span>
                  {r.active && (
                    <span className="rule-share">
                      <span className="rule-bar" aria-hidden="true">
                        <span className={r.type === 'income' ? 'pos' : ''} style={{ width: `${Math.max(2, Math.round(shares.get(r.id) * 100))}%` }} />
                      </span>
                      <span className="muted small">
                        {tRich(r.type === 'income' ? 'about {span} a month · {round}% of income' : 'about {span} a month · {round}% of commitments', { round: Math.round(shares.get(r.id) * 100), span: <span className="num">{money(monthlyEquivalent(r))}</span> })}
                      </span>
                    </span>
                  )}
                </div>
                <div className={`tx-amount num ${r.type === 'income' ? 'pos' : ''}`}>
                  {r.type === 'income' ? '+' : '−'}
                  {money(r.amount)}
                </div>
                <div className="tx-actions">
                  <button className="btn sm" onClick={() => toggle(r)}>
                    {r.active ? t('Pause') : t('Resume')}
                  </button>
                  <button className="btn icon ghost" onClick={() => setEditing(r)} aria-label={t('Edit {description}', { description: r.description })}>
                    <Icon name="edit" />
                  </button>
                  <button className="btn icon ghost danger-hover" onClick={() => remove(r)} aria-label={t('Delete {description}', { description: r.description })}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing.id ? t('Edit recurring item') : t('Add recurring item')} onClose={() => setEditing(null)}>
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
