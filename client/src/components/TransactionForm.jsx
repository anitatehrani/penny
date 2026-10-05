import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { billMonthOptions, defaultBillMonth, paymentDates } from '../cardLogic.js';
import { MonthCalendar } from './ds/MonthPicker.jsx';
import { useApp } from '../context.jsx';
import { dateLong, monthLabel, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { AlertPicker, choiceFrom, NO_CHOICE, sameChoice, saveAlertChoice } from './Alerts.jsx';
import Receipts, { uploadQueued, useReceiptList } from './Receipts.jsx';
import { Avatar, CategorySelect, Field, Segmented } from './ui.jsx';

const cents = (v) => Math.round((Number(v) || 0) * 100);

export default function TransactionForm({ initial, defaultDate, onSaved, onCancel }) {
  const { notify, money, settings } = useApp();
  const { user } = useAuth();
  const { isGroup, members } = useWorkspace();
  const editing = !!initial?.id;
  const conns = useFetch(() => api.get('/connections'), []);

  const [type, setType] = useState(initial?.type ?? 'expense');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  // A credit card payment has two dates: the day it was bought (the form's date) and the day the card bill is paid, which is
  // when it leaves the balance. The bill month is chosen below; the day is the budget's card pay day.
  const cardDay = settings?.card_pay_day ?? 10;
  const wasCard = initial?.pay_method === 'credit_card';
  const [onCard, setOnCard] = useState(wasCard);
  const [date, setDate] = useState(wasCard ? initial.charged_on : (initial?.date ?? defaultDate ?? todayYMD()));
  const [billChoice, setBillChoice] = useState(wasCard ? initial.date.slice(0, 7) : null);
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [status, setStatus] = useState(initial?.status === 'paid' ? 'paid' : initial?.status ? 'pending' : null);
  const [paidBy, setPaidBy] = useState(initial?.member_username ?? user.username);
  const [saving, setSaving] = useState(false);

  // Receipts: attached straight away when editing; queued until the payment exists when adding.
  const [queue, setQueue] = useState([]);
  const [receiptList, setReceiptList] = useReceiptList(editing ? initial.id : null);
  const refreshReceipts = async () => setReceiptList(await api.get(`/transactions/${initial.id}/receipts`));

  // Alerts for this payment only (rules from its recurring item, plan or category still apply underneath).
  const startChoice = choiceFrom(initial?.alert?.own);
  const [alertChoice, setAlertChoice] = useState(startChoice);

  // "Who's involved": people added to this payment, each with their share of the amount.
  const existing = initial?.participants ?? [];
  const [splitOpen, setSplitOpen] = useState(existing.length > 0);
  const [picked, setPicked] = useState(() => Object.fromEntries(existing.map((p) => [p.username, true])));
  const [mode, setMode] = useState(existing.length > 0 ? 'custom' : 'equal');
  const [custom, setCustom] = useState(() => Object.fromEntries(existing.map((p) => [p.username, String(p.share)])));

  // Candidates: my connections, the other members of this budget, and anyone already on the payment.
  const candidates = useMemo(() => {
    const map = new Map();
    for (const c of conns.data?.accepted ?? []) map.set(c.user.username, { ...c.user, relation: c.relation });
    for (const m of members) if (m.username !== user.username) map.set(m.username, { ...map.get(m.username), ...m });
    for (const p of existing) if (!map.has(p.username)) map.set(p.username, p);
    return [...map.values()].filter((p) => p.username !== user.username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conns.data, members, user.username]);

  const chosen = splitOpen ? candidates.filter((p) => picked[p.username]) : [];
  const total = cents(amount);
  const equalEach = chosen.length ? Math.floor(total / (chosen.length + 1)) : 0;
  const shares = chosen.map((p) => ({ username: p.username, share: (mode === 'equal' ? equalEach : cents(custom[p.username])) / 100 }));
  const sharesTotal = shares.reduce((s, p) => s + Math.round(p.share * 100), 0);
  const overShared = sharesTotal > total;
  const myPart = Math.max(0, total - sharesTotal);

  const billOptions = billMonthOptions(date, cardDay, wasCard ? initial.date.slice(0, 7) : null);
  const billMonth = billOptions.includes(billChoice) ? billChoice : defaultBillMonth(date);
  const dates = paymentDates({ onCard, date, billMonth, day: cardDay, keepPayDate: wasCard ? initial.date : null });

  // New items: past/today dates default to "paid", future dates to "pending" until the user picks.
  // (A card payment is judged by the day its bill is paid, not the day it was bought.)
  const effectiveStatus = status ?? (dates.date <= todayYMD() ? 'paid' : 'pending');

  async function submit(e) {
    e.preventDefault();
    if (overShared) return notify('The shares add up to more than the payment.', 'error');
    setSaving(true);
    try {
      const body = {
        type,
        description,
        amount: Number(amount),
        ...dates,
        category_id: categoryId ? Number(categoryId) : null,
        note: note || null,
        status: effectiveStatus,
        ...(isGroup ? { paid_by: paidBy } : {}),
        ...(editing || chosen.length ? { participants: shares } : {}),
      };
      const saved = editing ? await api.put(`/transactions/${initial.id}`, body) : await api.post('/transactions', body);
      let problem = null;
      if (!editing && queue.length) {
        const failed = await uploadQueued(saved.id, queue);
        if (failed) problem = `${failed} receipt${failed === 1 ? '' : 's'} could not be uploaded. Open the payment to try again.`;
      }
      if (!sameChoice(alertChoice, startChoice)) {
        try {
          await saveAlertChoice('transaction', saved.id, alertChoice);
        } catch (err) {
          problem = problem ?? `The payment was saved, but its alert setting was not: ${err.message}`;
        }
      }
      notify(problem ?? (editing ? 'Payment updated' : 'Payment added'), problem ? 'error' : 'ok');
      onSaved(saved);
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      {initial?.source && initial.source !== 'manual' && (
        <div className="banner info">
          This is one {initial.source === 'recurring' ? 'occurrence of a recurring item' : initial.source === 'debt' ? 'payment towards a debt' : 'installment of a plan'}. Changes here
          only affect this payment.
        </div>
      )}
      <Segmented
        label="Type"
        value={type}
        onChange={(v) => {
          setType(v);
          setCategoryId('');
          if (v === 'income') setOnCard(false);
        }}
        options={[
          { value: 'expense', label: 'Expense', tone: 'expense' },
          { value: 'income', label: 'Income', tone: 'income' },
        ]}
      />
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={200} placeholder={type === 'expense' ? 'e.g. Electricity bill' : 'e.g. Salary'} />
      </Field>
      <div className="form-grid">
        <Field label="Amount">
          <input type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0.00" />
        </Field>
        <Field label={onCard ? 'Bought on' : 'Date'} hint={onCard ? 'The day you used the card.' : 'Use a past date to record something you already paid.'}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      {type === 'expense' && (
        <div className="split-box card-box">
          <label className="check">
            <input type="checkbox" checked={onCard} onChange={(e) => setOnCard(e.target.checked)} />
            <span>
              Paid with credit card
              <span className="muted block small">It counts in the month you pay the card bill, not the day you bought it.</span>
            </span>
          </label>
          {onCard && (
            <div className="field">
              <span className="field-label">
                Counts in <strong>{monthLabel(billMonth)}</strong>
                {billMonth === defaultBillMonth(date) ? ' (the next bill)' : ''}
              </span>
              <MonthCalendar
                value={billMonth}
                onChange={setBillChoice}
                allowed={billOptions}
                notAllowedReason="A card bill cannot fall before the purchase or more than a year after it"
                showToday={false}
                label="The month the card bill is paid"
              />
              <span className="field-hint">{`Leaves your balance on ${dateLong(dates.date)}, your card pay day. You can change the day in Settings.`}</span>
            </div>
          )}
        </div>
      )}
      <div className="form-grid">
        <Field label="Category">
          <CategorySelect kind={type} value={categoryId} onChange={setCategoryId} />
        </Field>
        <Field label="Status">
          <select value={effectiveStatus} onChange={(e) => setStatus(e.target.value)}>
            <option value="paid">{type === 'income' ? 'Received' : 'Paid'}</option>
            <option value="pending">{type === 'income' ? 'Expected' : 'Pending (still to pay)'}</option>
          </select>
        </Field>
      </div>

      {isGroup && (
        <Field label={type === 'income' ? 'Whose income' : 'Paid by'} hint="Everything lands in the shared balance; this just records who it came from.">
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.username} value={m.username}>
                {m.username === user.username ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="split-box">
        <label className="check">
          <input type="checkbox" checked={splitOpen} onChange={(e) => setSplitOpen(e.target.checked)} />
          <span>
            Add people to this payment
            <span className="muted block small">Share it with your partner, family or friends and note each person’s part.</span>
          </span>
        </label>
        {splitOpen &&
          (conns.loading && !conns.data ? (
            <p className="muted small">Loading your people…</p>
          ) : candidates.length === 0 ? (
            <p className="field-hint">You have no connections yet. Add people under People first.</p>
          ) : (
            <>
              <div className="pick-list">
                {candidates.map((p) => (
                  <label key={p.username} className={`check pick${picked[p.username] ? ' on' : ''}`}>
                    <input type="checkbox" checked={!!picked[p.username]} onChange={(e) => setPicked((s) => ({ ...s, [p.username]: e.target.checked }))} />
                    <Avatar user={p} size={24} />
                    <span>{p.name}</span>
                    <span className="muted small">@{p.username}</span>
                  </label>
                ))}
              </div>
              {chosen.length > 0 && (
                <div className="split-detail">
                  <Segmented
                    label="How to split"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'equal', label: 'Equal parts' },
                      { value: 'custom', label: 'Custom amounts' },
                    ]}
                  />
                  {chosen.map((p) => (
                    <div key={p.username} className="split-row">
                      <span>{p.name}</span>
                      {mode === 'equal' ? (
                        <strong className="num">{money(equalEach / 100)}</strong>
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={custom[p.username] ?? ''}
                          onChange={(e) => setCustom((s) => ({ ...s, [p.username]: e.target.value }))}
                          aria-label={`${p.name}'s share`}
                          placeholder="0.00"
                        />
                      )}
                    </div>
                  ))}
                  <div className={`split-row total${overShared ? ' bad' : ''}`}>
                    <span>You</span>
                    <strong className="num">{overShared ? 'Shares exceed the amount' : money(myPart / 100)}</strong>
                  </div>
                </div>
              )}
            </>
          ))}
      </div>

      {effectiveStatus === 'pending' && (
        <AlertPicker
          value={alertChoice}
          onChange={setAlertChoice}
          label="Alert for this payment"
          idPrefix="form-alert"
          hint={initial?.alert && !initial.alert.own && initial.alert.source !== 'default' ? `Currently set by its ${initial.alert.source}.` : 'Alerts only fire while it is still to pay.'}
        />
      )}

      <div className="receipt-section">
        <span className="field-label">Receipts</span>
        <Receipts txId={editing ? initial.id : null} items={receiptList ?? []} onChange={refreshReceipts} queue={queue} setQueue={setQueue} />
      </div>

      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving || overShared}>
          {editing ? 'Save changes' : 'Add payment'}
        </button>
      </div>
    </form>
  );
}
