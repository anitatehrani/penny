import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { billMonthOptions, cardInstallmentSummary, cardPayDate, defaultBillMonth, installmentMonths, paymentDates, spreadAmounts, suggestEach } from '../cardLogic.js';
import { MonthCalendar, MonthPicker } from './ds/MonthPicker.jsx';
import { useApp } from '../context.jsx';
import { addMonthsYM, dateLong, monthLabel, todayYMD } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { AlertPicker, choiceFrom, NO_CHOICE, sameChoice, saveAlertChoice } from './Alerts.jsx';
import Receipts, { uploadQueued, useReceiptList } from './Receipts.jsx';
import DatePicker from './ds/DatePicker.jsx';
import Select from './ds/Select.jsx';
import { Avatar, CategorySelect, Field, Segmented } from './ui.jsx';
import { t, tn } from '../i18n/translate.js';

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
  // A new card purchase can be paid in one bill or in installments (docs/DESIGN.md section 23).
  const [cardMode, setCardMode] = useState('one');
  const [instCount, setInstCount] = useState('3');
  const [eachInput, setEachInput] = useState(''); // '' = not typed yet: the price divided by the count, no interest
  const [splitMode, setSplitMode] = useState('equal'); // 'equal' | 'custom' (a different amount for each installment)
  const [typed, setTyped] = useState([]); // custom mode: what was typed in each box ('' = not typed, shares what is left)
  const [pickedMonths, setPickedMonths] = useState([]); // a bill month chosen for an installment ('' = follows the one before)
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
  const inInstallments = onCard && !editing && cardMode === 'installments';
  const unequal = inInstallments && splitMode === 'custom';
  const nInst = Math.floor(Number(instCount));
  const customAmounts = unequal && nInst >= 2 && nInst <= 36 ? spreadAmounts({ price: amount, count: nInst, typed }) : null;
  const listed = inInstallments && nInst >= 2 && nInst <= 36;
  const months = listed ? installmentMonths({ first: billMonth, count: nInst, picked: pickedMonths }) : [];
  const billDates = months.map((m) => cardPayDate(m, cardDay));
  const rowAmounts = !listed ? [] : unequal ? customAmounts : eachInput !== '' ? Array(nInst).fill(Number(eachInput)) : spreadAmounts({ price: amount, count: nInst, typed: [] });
  const setPick = (i, m) => setPickedMonths((p) => Object.assign(Array.from({ length: Math.max(p.length, i + 1) }, (_, k) => p[k] ?? ''), { [i]: m }));
  const summary = !inInstallments
    ? null
    : unequal
      ? customAmounts
        ? cardInstallmentSummary({ price: amount, amounts: customAmounts })
        : null
      : cardInstallmentSummary({ price: amount, each: eachInput, count: instCount });

  async function submit(e) {
    e.preventDefault();
    if (overShared && !inInstallments) return notify(t('The shares add up to more than the payment.'), 'error');
    if (inInstallments) {
      if (!summary) return notify(t('Choose 2 to 36 installments and an amount for each.'), 'error');
      if (!summary.valid) return notify(t('The installments add up to less than the price. Interest can only add to it.'), 'error');
    }
    setSaving(true);
    try {
      if (inInstallments) {
        const n = summary.n;
        const paid = billDates.filter((d) => d <= todayYMD()).length; // bills already behind us are paid
        const plan = await api.post('/installments', {
          description,
          installment_count: n,
          first_due_date: billDates[0],
          dates: billDates,
          charged_on: date,
          purchase_amount: Number(amount),
          ...(unequal ? { amounts: summary.parts } : eachInput !== '' ? { installment_amount: Number(eachInput) } : { total_amount: Number(amount) }),
          paid_count: paid,
          category_id: categoryId ? Number(categoryId) : null,
          note: note || null,
          ...(isGroup ? { paid_by: paidBy } : {}),
        });
        notify(t('Installments added'));
        onSaved(plan);
        return;
      }
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
        if (failed) problem = tn(failed, '{n} receipt could not be uploaded. Open the payment to try again.', '{n} receipts could not be uploaded. Open the payment to try again.');
      }
      if (!sameChoice(alertChoice, startChoice)) {
        try {
          await saveAlertChoice('transaction', saved.id, alertChoice);
        } catch (err) {
          problem = problem ?? t('The payment was saved, but its alert setting was not: {message}', { message: err.message });
        }
      }
      notify(problem ?? (editing ? t('Payment updated') : t('Payment added')), problem ? 'error' : 'ok');
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
          {initial.source === 'recurring'
            ? t('This is one occurrence of a recurring item. Changes here only affect this payment.')
            : initial.source === 'debt'
              ? initial.type === 'income'
                ? t('This is one repayment of money you lent. Changes here only affect this payment.')
                : t('This is one payment towards a debt. Changes here only affect this payment.')
              : initial.source === 'loan'
                ? t('This is one loan you made. Changes here only affect this payment.')
                : t('This is one installment of a plan. Changes here only affect this payment.')}
        </div>
      )}
      <Segmented
        label={t('Type')}
        value={type}
        onChange={(v) => {
          setType(v);
          setCategoryId('');
          if (v === 'income') setOnCard(false);
        }}
        options={[
          { value: 'expense', label: t('Expense'), tone: 'expense' },
          { value: 'income', label: t('Income'), tone: 'income' },
        ]}
      />
      <Field label={t('Description')}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={200} placeholder={type === 'expense' ? t('e.g. Electricity bill') : t('e.g. Salary')} />
      </Field>
      <div className="form-grid">
        <Field label={t('Amount')}>
          <input type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0.00" />
        </Field>
        <Field label={onCard ? t('Bought on') : t('Date')} hint={onCard ? t('The day you used the card.') : t('Use a past date to record something you already paid.')}>
          <DatePicker label={onCard ? t('Bought on') : t('Date')} value={date} onChange={setDate} />
        </Field>
      </div>
      {type === 'expense' && (
        <div className="split-box card-box">
          <label className="check">
            <input type="checkbox" checked={onCard} onChange={(e) => setOnCard(e.target.checked)} />
            <span>
              {t('Paid with credit card')}
              <span className="muted block small">{t('It counts in the month you pay the card bill, not the day you bought it.')}</span>
            </span>
          </label>
          {onCard && !editing && (
            <Segmented
              label={t('How is it paid?')}
              value={cardMode}
              onChange={setCardMode}
              options={[
                { value: 'one', label: t('In one bill') },
                { value: 'installments', label: t('In installments') },
              ]}
            />
          )}
          {onCard && (
            <div className="field">
              <span className="field-label">
                {inInstallments ? t('The first installment is in') : t('Counts in')} <strong>{monthLabel(billMonth)}</strong>
                {billMonth === defaultBillMonth(date) ? t(' (the next bill)') : ''}
              </span>
              <MonthCalendar
                value={billMonth}
                onChange={setBillChoice}
                allowed={billOptions}
                notAllowedReason={t('A card bill cannot fall before the purchase or more than a year after it')}
                showToday={false}
                label={t('The month the card bill is paid')}
              />
              <span className="field-hint">{t('Leaves your balance on {dateLong}, your card pay day. You can change the day in Settings.', { dateLong: dateLong(dates.date) })}</span>
            </div>
          )}
          {inInstallments && (
            <>
              <Segmented
                label={t('How are the installments split?')}
                value={splitMode}
                onChange={setSplitMode}
                options={[
                  { value: 'equal', label: t('Equal') },
                  { value: 'custom', label: t('Different amounts') },
                ]}
              />
              <div className="form-grid">
                <Field label={t('Number of installments')} hint={t('2 to 36, one on each monthly bill.')}>
                  <input type="number" min="2" max="36" step="1" inputMode="numeric" value={instCount} onChange={(e) => setInstCount(e.target.value)} required />
                </Field>
                {!unequal && (
                <Field label={t('Each installment')} hint={t('What the bank charges each month. Raise it if there is interest.')}>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    value={eachInput !== '' ? eachInput : amount ? String(suggestEach(amount, instCount) || '') : ''}
                    onChange={(e) => setEachInput(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                )}
              </div>
              {listed && rowAmounts && (
                <div className="inst-list" role="group" aria-label={t('Month and amount of each installment')}>
                  {months.map((m, i) => (
                    <div key={i} className={`inst-row${unequal && typed[i] ? ' typed' : ''}`}>
                      <span className="inst-when">
                        {i + 1}.{' '}
                        {i === 0 ? (
                          <span className="muted">{monthLabel(m)}</span>
                        ) : (
                          <MonthPicker
                            value={m}
                            onChange={(v) => setPick(i, v)}
                            min={addMonthsYM(months[i - 1], 1)}
                            max={addMonthsYM(billMonth, 72)}
                            label={t('Bill month of installment {value}', { value: i + 1 })}
                            className="inst-month"
                          />
                        )}
                      </span>
                      {unequal ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          inputMode="decimal"
                          value={typed[i] ? typed[i] : rowAmounts[i] ? String(rowAmounts[i]) : ''}
                          onChange={(e) => setTyped((tt) => Object.assign(Array.from({ length: Math.max(tt.length, i + 1) }, (_, k) => tt[k] ?? ''), { [i]: e.target.value }))}
                          aria-label={t('Installment {value}, {monthLabel}', { value: i + 1, monthLabel: monthLabel(m) })}
                        />
                      ) : (
                        <strong className="num">{money(rowAmounts[i])}</strong>
                      )}
                    </div>
                  ))}
                  <p className="field-hint">
                    {t('The months follow each other; choose another month for any installment after the first.')}
                    {unequal && t(' Boxes you have not typed in share what is left of the price equally.')}{' '}
                    {pickedMonths.some(Boolean) && (
                      <button type="button" className="link-quiet" onClick={() => setPickedMonths([])}>
                        {t('Back to consecutive months')}
                      </button>
                    )}{' '}
                    {unequal && typed.some(Boolean) && (
                      <button type="button" className="link-quiet" onClick={() => setTyped([])}>
                        {t('Share equally again')}
                      </button>
                    )}
                  </p>
                </div>
              )}
              {summary && (
                <div className={`banner ${summary.valid ? 'info' : 'warn'}`} aria-live="polite">
                  {summary.valid ? (
                    <span>
                      {summary.parts ? (
                        summary.n <= 6 ? (
                          summary.parts.map((p, i) => (
                            <span key={i}>
                              {i > 0 && ' + '}
                              <strong>{money(p)}</strong>
                            </span>
                          ))
                        ) : (
                          <span>{t('{n} installments', { n: summary.n })}</span>
                        )
                      ) : (
                        <span>
                          {summary.n} × {summary.approx && <>{t('about')} </>}
                          <strong>{money(summary.each)}</strong>
                        </span>
                      )}
                      {' = '}
                      <strong>{money(summary.total)}</strong>
                      {' · '}
                      {summary.interest > 0 ? <>
                          {t('interest')} <strong>{money(summary.interest)}</strong> {t('({pct}% of the price)', { pct: summary.pct })}
                        </> : t('no interest')}
                    </span>
                  ) : (
                    <span>
                      {t('{n} installments add up to {money}, less than the price of {money2}. Interest can only add to it.', { n: summary.n, money: money(summary.total), money2: money(summary.price) })}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

        </div>
      )}
      <div className="form-grid">
        <Field label={t('Category')}>
          <CategorySelect kind={type} value={categoryId} onChange={setCategoryId} />
        </Field>
        {!inInstallments && (
        <Field label={t('Status')}>
          <Select
            label={t('Status')}
            value={effectiveStatus}
            onChange={setStatus}
            options={[
              { value: 'paid', label: type === 'income' ? t('Received') : t('Paid') },
              { value: 'pending', label: type === 'income' ? t('Expected') : t('Pending (still to pay)') },
            ]}
          />
        </Field>
        )}
      </div>

      {isGroup && (
        <Field label={type === 'income' ? t('Whose income') : t('Paid by')} hint={t('Everything lands in the shared balance; this just records who it came from.')}>
          <Select label={type === 'income' ? t('Whose income') : t('Paid by')} value={paidBy} onChange={setPaidBy} options={members.map((m) => ({ value: m.username, label: m.username === user.username ? t('{name} (you)', { name: m.name }) : m.name, person: m }))} />
        </Field>
      )}

      {!inInstallments && (
      <div className="split-box">
        <label className="check">
          <input type="checkbox" checked={splitOpen} onChange={(e) => setSplitOpen(e.target.checked)} />
          <span>
            {t('Add people to this payment')}
            <span className="muted block small">{t('Share it with your partner, family or friends and note each person’s part.')}</span>
          </span>
        </label>
        {splitOpen &&
          (conns.loading && !conns.data ? (
            <p className="muted small">{t('Loading your people…')}</p>
          ) : candidates.length === 0 ? (
            <p className="field-hint">{t('You have no connections yet. Add people under People first.')}</p>
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
                    label={t('How to split')}
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'equal', label: t('Equal parts') },
                      { value: 'custom', label: t('Custom amounts') },
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
                          aria-label={t('{name}\'s share', { name: p.name })}
                          placeholder="0.00"
                        />
                      )}
                    </div>
                  ))}
                  <div className={`split-row total${overShared ? ' bad' : ''}`}>
                    <span>{t('You')}</span>
                    <strong className="num">{overShared ? t('Shares exceed the amount') : money(myPart / 100)}</strong>
                  </div>
                </div>
              )}
            </>
          ))}
      </div>
      )}

      {inInstallments && <p className="field-hint">{t('Sharing the purchase, a receipt or an alert belong to one payment: open any installment afterwards to add them.')}</p>}

      {effectiveStatus === 'pending' && !inInstallments && (
        <AlertPicker
          value={alertChoice}
          onChange={setAlertChoice}
          label={t('Alert for this payment')}
          idPrefix="form-alert"
          hint={initial?.alert && !initial.alert.own && initial.alert.source !== 'default' ? t('Currently set by its {source}.', { source: initial.alert.source }) : t('Alerts only fire while it is still to pay.')}
        />
      )}

      {!inInstallments && (
        <div className="receipt-section">
          <span className="field-label">{t('Receipts')}</span>
          <Receipts txId={editing ? initial.id : null} items={receiptList ?? []} onChange={refreshReceipts} queue={queue} setQueue={setQueue} />
        </div>
      )}

      <Field label={t('Note (optional)')}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving || overShared}>
          {editing ? t('Save changes') : inInstallments ? t('Add installments') : t('Add payment')}
        </button>
      </div>
    </form>
  );
}
