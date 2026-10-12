import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, CategoryDot, CategorySelect, Empty, ErrorBox, Field, Icon, Loading, Modal, Segmented } from '../components/ui.jsx';
import DatePicker from '../components/ds/DatePicker.jsx';
import Select from '../components/ds/Select.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { balanceAfter, budgetStatus, describePlan, directionOf, ofDirection, previewPlan, timelineSteps, WORDS } from '../debtLogic.js';
import { addMonthsYM, currentMonth, dateLong, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { t, tn } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

/** A sensible first payment: next month, on today's day of the month (kept to the 28th so it exists every month). */
const suggestedDate = () => `${addMonthsYM(currentMonth(), 1)}-${String(Math.min(Number(todayYMD().slice(8)), 28)).padStart(2, '0')}`;

function DebtForm({ initial, direction, onSaved, onCancel }) {
  const { money, notify } = useApp();
  const { user } = useAuth();
  const { isGroup, members } = useWorkspace();
  const editing = !!initial?.id;
  const W = WORDS[direction];
  const lent = direction === 'lent';
  const [name, setName] = useState(initial?.name ?? '');
  const [total, setTotal] = useState(initial?.total_amount != null ? String(initial.total_amount) : '');
  const [plan, setPlan] = useState(initial?.plan ?? 'none');
  const [firstDate, setFirstDate] = useState(initial?.first_due_date ?? suggestedDate());
  const [count, setCount] = useState(String(initial?.installment_count ?? 3));
  const [counted, setCounted] = useState(initial?.count_in_budget ?? true);
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [paidBy, setPaidBy] = useState(initial?.member_username ?? user.username);
  const [recordLoan, setRecordLoan] = useState(false);
  const [lentOn, setLentOn] = useState(todayYMD());
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
        direction,
        ...(lent && !editing && recordLoan ? { record_loan: true, lent_on: lentOn } : {}),
        ...(isGroup ? { paid_by: paidBy } : {}),
      };
      if (editing) await api.put(`/debts/${initial.id}`, body);
      else await api.post('/debts', body);
      notify(editing ? (lent ? t('Updated') : t('Debt updated')) : lent ? t('Added to what is owed to you') : t('Debt added'));
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  // One sentence that says exactly what switching "count it in my budget" does for this choice of plan.
  const effect = !counted
    ? t('Only kept on file. Nothing is added to your balance or forecast, even if you pick a plan.')
    : lent
      ? plan === 'none'
        ? t('Nothing is scheduled yet, so your forecast does not change. It is part of the "if everyone paid you back" figure.')
        : t('Its repayments appear in Payments as money coming in, and in your forecast. It is part of the "if everyone paid you back" figure.')
      : plan === 'none'
        ? t('Nothing is scheduled yet, so your forecast does not change. It is part of the "balance after debts" figure.')
        : t('Its payments appear in Payments and in your forecast, and it is part of the "balance after debts" figure.');

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        <Field label={W.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder={W.namePlaceholder} />
        </Field>
        <Field label={W.amount} hint={editing && alreadyPaid > 0 ? t('{money} has been {paid} so far.', { money: money(alreadyPaid), paid: W.paid }) : undefined}>
          <input type="number" step="0.01" min="0.01" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} required placeholder="0.00" />
        </Field>
      </div>

      <Segmented
        label={t('Repayment')}
        value={plan}
        onChange={setPlan}
        options={[
          { value: 'none', label: t('Not scheduled yet') },
          { value: 'once', label: t('All in one month') },
          { value: 'monthly', label: t('Split over months') },
        ]}
      />
      {plan === 'once' && (
        <Field label={lent ? t('Expected on') : t('Pay it on')}>
          <DatePicker label={lent ? t('Expected on') : t('Pay it on')} value={firstDate} onChange={setFirstDate} />
        </Field>
      )}
      {plan === 'monthly' && (
        <div className="form-grid">
          <Field label={lent ? t('First repayment') : t('First payment')} hint={t('The later ones fall on the same day each month.')}>
            <DatePicker label={lent ? t('First repayment') : t('First payment')} value={firstDate} onChange={setFirstDate} />
          </Field>
          <Field label={t('Number of months')}>
            <input type="number" min="2" max="120" step="1" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required />
          </Field>
        </div>
      )}
      {preview && (
        <div className="banner info" aria-live="polite">
          <span>
            {preview.count === 1 ? (
              tRich(lent ? 'One repayment of {amount} on {date}' : 'One payment of {amount} on {date}', { amount: <strong>{money(preview.each)}</strong>, date: dateLong(preview.first) })
            ) : (
              <>
                {tRich(lent ? '{count} repayments of {amount}' : '{count} payments of {amount}', { count: preview.count, amount: <strong>{money(preview.each)}</strong> })}
                {!preview.even ? ` (${t('the last one {amount}', { amount: money(preview.eachLast) })})` : ''}
                {`, ${t('from {from} to {to}', { from: dateLong(preview.first), to: dateLong(preview.last) })}`}
              </>
            )}
            {editing && alreadyPaid > 0 ? ` · ${lent ? t('covers the {money} still owed to you', { money: money(owed) }) : t('covers the {money} still owed', { money: money(owed) })}` : ''}
          </span>
        </div>
      )}

      {lent && !editing && (
        <div className="split-box">
          <label className="check">
            <input type="checkbox" checked={recordLoan} onChange={(e) => setRecordLoan(e.target.checked)} />
            <span>
              {t('Also record the money I handed over')}
              <span className="muted block small">
                {t('Lowers your balance by {amount} on the day you lent it. Leave it off if it is already in your balance. It is not counted as spending.', { amount: total ? money(Number(total) || 0) : t('the amount') })}
              </span>
            </span>
          </label>
          {recordLoan && (
            <Field label={t('Lent on')}>
              <DatePicker label={t('Lent on')} value={lentOn} onChange={setLentOn} />
            </Field>
          )}
        </div>
      )}
      <div className="split-box">
        <label className="check">
          <input type="checkbox" checked={counted} onChange={(e) => setCounted(e.target.checked)} />
          <span>
            {t('Count it in my budget')}
            <span className="muted block small">{effect}</span>
          </span>
        </label>
      </div>

      <div className="form-grid">
        <Field label={t('Category')} hint={lent ? t('For the money you get back.') : t('For the repayments.')}>
          <CategorySelect kind={W.categoryKind} value={categoryId} onChange={setCategoryId} />
        </Field>
        <Field label={t('Note (optional)')}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </div>
      {isGroup && (
        <Field label={t('In the name of')} hint={lent ? t('Repayments go into the shared balance; this records who lent it.') : t('Repayments come out of the shared balance; this records who the debt is with.')}>
          <Select label={t('In the name of')} value={paidBy} onChange={setPaidBy} options={members.map((m) => ({ value: m.username, label: m.username === user.username ? t('{name} (you)', { name: m.name }) : m.name, person: m }))} />
        </Field>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {editing ? t('Save changes') : lent ? t('Add') : t('Add debt')}
        </button>
      </div>
    </form>
  );
}

function PaymentForm({ debt, onSaved, onCancel }) {
  const { money, notify } = useApp();
  const lent = directionOf(debt) === 'lent';
  const [amount, setAmount] = useState(String(debt.next_amount ?? debt.remaining));
  const [date, setDate] = useState(todayYMD());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post(`/debts/${debt.id}/payments`, { amount: Number(amount), date, note: note || null });
      notify(
        r.debt.status === 'settled'
          ? lent
            ? t('{name} has paid you back in full', { name: debt.name })
            : t('{name} is fully paid', { name: debt.name })
          : lent
            ? t('Received. {name} still owes you {money}', { name: debt.name, money: money(r.debt.remaining) })
            : t('Paid. {money} left to pay {name}', { money: money(r.debt.remaining), name: debt.name }),
      );
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <p className="muted">
        {lent ? (
          <>
            {tRich(debt.scheduled_count > 0 ? '{name} still owes you {amount}. This is money received, so it raises your balance, and the repayments still expected will be made smaller to match.' : '{name} still owes you {amount}. This is money received, so it raises your balance.', { name: debt.name, amount: <strong className="num">{money(debt.remaining)}</strong> })}
          </>
        ) : (
          <>
            {tRich(debt.scheduled_count > 0 ? 'You still owe {amount} to {name}. This is money paid out, so it lowers your balance, and the payments still planned will be made smaller to match.' : 'You still owe {amount} to {name}. This is money paid out, so it lowers your balance.', { name: debt.name, amount: <strong className="num">{money(debt.remaining)}</strong> })}
          </>
        )}
      </p>
      <div className="form-grid">
        <Field label={t('Amount')}>
          <input type="number" step="0.01" min="0.01" max={debt.remaining} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <Field label={lent ? t('Received on') : t('Paid on')}>
          <DatePicker label={lent ? t('Received on') : t('Paid on')} value={date} onChange={setDate} />
        </Field>
      </div>
      <Field label={t('Note (optional)')}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {lent ? t('Record money received') : t('Record payment')}
        </button>
      </div>
    </form>
  );
}

/** The road to zero: one step per payment, a mark for its state, and where the plan ends. Opens in place, closed by default. */
function DebtTimeline({ debt }) {
  const { money } = useApp();
  const W = WORDS[directionOf(debt)];
  const { steps, debtFree } = timelineSteps(debt, todayYMD());
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.state === 'paid').length;
  return (
    <details className="timeline-wrap">
      <summary>
        {t('Repayment timeline')}
        <span className="muted small"> {tn(steps.length, '· {done} of {n} step done', '· {done} of {n} steps done', { done })}</span>
      </summary>
      <ol className="timeline" aria-label={t('Repayment timeline for {name}', { name: debt.name })}>
        {steps.map((s) => (
          <li key={s.key} className={`tl-step ${s.state}`}>
            <span className="tl-mark" aria-hidden="true">{s.state === 'paid' && <Icon name="check" size={12} />}</span>
            <div className="tl-body">
              <span className="tl-title">
                {s.date ? dateLong(s.date) : t('Still to plan')}
                <span className="tl-word"> · {W.stepWord[s.state]}</span>
              </span>
              <strong className="num">{money(s.amount)}</strong>
            </div>
          </li>
        ))}
        {debtFree && (
          <li className="tl-step end">
            <span className="tl-mark" aria-hidden="true" />
            <div className="tl-body">
              <span className="tl-title">{W.end}<span className="tl-word"> {t('· by {dateLong}', { dateLong: dateLong(debtFree) })}</span></span>
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
  // Two sides of the page: money you owe, and money owed to you. Linkable as /debts?show=lent.
  const side = params.get('show') === 'lent' ? 'lent' : 'owe';
  const setSide = (v) => setParams(v === 'lent' ? { show: 'lent' } : {}, { replace: true });
  const [editing, setEditing] = useState(() => (params.get('new') === '1' ? { direction: side } : null));
  const [paying, setPaying] = useState(null);
  useEffect(() => {
    if (params.get('new') === '1') setParams(side === 'lent' ? { show: 'lent' } : {}, { replace: true });
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
    if (!window.confirm(directionOf(d) === 'lent' ? t('Delete "{name}"? Repayments still expected are removed; money already received stays in your history.', { name: d.name }) : t('Delete "{name}"? Payments still to come are removed; payments already made stay in your history.', { name: d.name }))) return;
    run(api.del(`/debts/${d.id}`), directionOf(d) === 'lent' ? t('Deleted') : t('Debt deleted'));
  };
  const settle = (d) => {
    const lent = directionOf(d) === 'lent';
    if (!window.confirm(lent ? t('Mark "{name}" as paid back? Repayments still expected are removed; money already received stays.', { name: d.name }) : t('Mark "{name}" as settled? Payments still to come are removed; payments already made stay.', { name: d.name }))) return;
    run(api.post(`/debts/${d.id}/settle`), lent ? t('{name} marked as paid back', { name: d.name }) : t('{name} marked as settled', { name: d.name }));
  };

  const W = WORDS[side];
  const debts = data?.debts ?? [];
  const mine = ofDirection(debts, side);
  const totals = data && (side === 'lent' ? { owed: data.lent_totals.owed_to_me, counted: data.lent_totals.counted, scheduled: data.lent_totals.expected, paid: data.lent_totals.received } : data.totals);
  const active = mine.filter((d) => d.status === 'active');
  const settled = mine.filter((d) => d.status === 'settled');
  const after = totals && balanceAfter(side, summary.data?.balance, totals.counted);
  const activeCount = (dir) => ofDirection(debts, dir).filter((d) => d.status === 'active').length;
  // The name, and how many are still open as a small count pill (only when there are some).
  const tabLabel = (dir) => (
    <>
      {WORDS[dir].tab}
      {data && activeCount(dir) > 0 && (
        <span className="seg-count" aria-label={t('{activeCount} open', { activeCount: activeCount(dir) })}>
          {activeCount(dir)}
        </span>
      )}
    </>
  );

  const Card = ({ d }) => {
    const dw = WORDS[directionOf(d)];
    const pct = d.total_amount > 0 ? Math.min(100, Math.round((d.paid / d.total_amount) * 100)) : 0;
    const badge = budgetStatus(d);
    return (
      <div className="card plan debt" data-direction={directionOf(d)}>
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
            <button className="btn icon ghost" onClick={() => setEditing(d)} aria-label={t('Edit {name}', { name: d.name })}>
              <Icon name="edit" />
            </button>
            <button className="btn icon ghost danger-hover" onClick={() => remove(d)} aria-label={t('Delete {name}', { name: d.name })}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
        <div className="plan-figures">
          <div>
            <span className="muted">{dw.still}</span>
            <strong className="num">{money(d.remaining)}</strong>
          </div>
          <div>
            <span className="muted">{t('Of total')}</span>
            <strong className="num">{money(d.total_amount)}</strong>
          </div>
          <div>
            <span className="muted">{d.status === 'settled' ? t('Status') : dw.nextWord}</span>
            <strong>{d.status === 'settled' ? directionOf(d) === 'lent' ? t('Paid back') : t('Settled') : d.next_due ? `${dateLong(d.next_due)} · ${money(d.next_amount)}` : d.plan !== 'none' && !d.count_in_budget ? t('Planned, not counted') : t('No plan yet')}</strong>
          </div>
        </div>
        <div className="debt-progress">
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('{money} of {money2} {paid}', { money: money(d.paid), money2: money(d.total_amount), paid: dw.paid })}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="debt-pct num">{pct}% {dw.paid}</span>
        </div>
        <DebtTimeline debt={d} />
        <div className="debt-actions">
          <span className="muted small">
            {money(d.paid)} {dw.paid}
            {d.scheduled_count > 0 && (
              <>
                {' · '}
                {directionOf(d) === 'lent' ? tn(d.scheduled_count, '{n} repayment expected (mark each received on the Payments page)', '{n} repayments expected (mark each received on the Payments page)') : tn(d.scheduled_count, '{n} payment planned (mark each paid on the Payments page)', '{n} payments planned (mark each paid on the Payments page)')}
              </>
            )}
          </span>
          <span className="row-actions">
            {d.status === 'active' ? (
              <>
                <button className="btn sm primary-soft" onClick={() => setPaying(d)}>
                  <Icon name="check" size={14} /> {dw.action}
                </button>
                <button className="btn sm" onClick={() => settle(d)}>
                  {dw.settle}
                </button>
              </>
            ) : (
              d.settled_at && (
                <button className="btn sm" onClick={() => run(api.post(`/debts/${d.id}/reopen`), t('{name} is open again', { name: d.name }))}>
                  <Icon name="undo" size={14} /> {t('Reopen')}
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
          <h1>{W.title}</h1>
          <p className="muted">{W.lead}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ direction: side })}>
          <Icon name="plus" /> {W.add}
        </button>
      </header>

      <div className="debt-sides">
        <Segmented
          label={t('Which debts')}
          value={side}
          onChange={setSide}
          options={[
            { value: 'owe', label: tabLabel('owe') },
            { value: 'lent', label: tabLabel('lent') },
          ]}
        />
      </div>

      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : mine.length === 0 ? (
        <section className="card">
          <Empty title={W.emptyTitle} icon="debt">
            {W.empty}
          </Empty>
        </section>
      ) : (
        <>
          <div className="summary-strip">
            <div>
              <span className="muted">{side === 'lent' ? t('Owed to you') : t('Total owed')}</span>
              <strong className="num">{money(totals.owed)}</strong>
            </div>
            <div>
              <span className="muted">{side === 'lent' ? t('Counted in your forecast') : t('Counted in your budget')}</span>
              <strong className="num">{money(totals.counted)}</strong>
            </div>
            <div>
              <span className="muted">{side === 'lent' ? t('Expected in your forecast') : t('Planned in your forecast')}</span>
              <strong className="num">{money(totals.scheduled)}</strong>
            </div>
            <div>
              <span className="muted">{W.paidSoFar}</span>
              <strong className="num">{money(totals.paid)}</strong>
            </div>
          </div>
          {after && (
            <p className="muted debt-after">
              {tRich('Your balance today is {balance}.', { balance: <strong className="num">{money(after.balance)}</strong> })}{' '}
              {tRich(side === 'lent' ? 'If everyone paid you back it would be {amount}.' : 'After paying every counted debt it would be {amount}.', { amount: <strong className={`num ${after.after < 0 ? 'neg' : ''}`}>{money(after.after)}</strong> })}
            </p>
          )}
          {active.length > 0 && <h2 className="sr-only">{side === 'lent' ? t('People who owe you') : t('Debts you are paying off')}</h2>}
          <div className="plans">
            {active.map((d) => (
              <Card key={d.id} d={d} />
            ))}
          </div>
          {settled.length > 0 && (
            <>
              <h2 className="section-title">{side === 'lent' ? t('Paid back') : t('Settled')}</h2>
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
        <Modal title={editing.id ? WORDS[directionOf(editing)].editTitle : WORDS[editing.direction ?? side].addTitle} onClose={() => setEditing(null)}>
          <DebtForm
            initial={editing.id ? editing : null}
            direction={editing.id ? directionOf(editing) : editing.direction ?? side}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}
      {paying && (
        <Modal title={directionOf(paying) === 'lent' ? t('{name} pays you', { name: paying.name }) : t('Pay {name}', { name: paying.name })} onClose={() => setPaying(null)}>
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
