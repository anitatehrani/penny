import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { MonthNav } from '../components/ds/MonthPicker.jsx';
import { EmptyState, ErrorState } from '../components/ds/States.jsx';
import { CategoryDot, Field, Icon, Skeleton } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { barParts, daysLeftText, headline, parseBudget, statusOf } from '../budgetLogic.js';
import { currentMonth, monthLabel } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { t, tn } from '../i18n/translate.js';
import { catName } from '../categoryNames.js';

/** One bar: what is spent, what is planned after it, where the budget is once it is passed, and where an even pace would be today. */
export function Bar({ line, elapsed, label }) {
  const b = barParts(line, elapsed);
  return (
    <div className={`bud-bar${b.over ? ' over' : ''}`} role="img" aria-label={label}>
      <span className="bud-spent" style={{ width: `${b.spent}%` }} />
      <span className="bud-planned" style={{ left: `${b.spent}%`, width: `${b.planned}%` }} />
      {b.budgetMark !== null && <i className="bud-mark" style={{ left: `${b.budgetMark}%` }} />}
      {b.paceMark !== null && <i className="bud-pace" style={{ left: `${b.paceMark}%` }} />}
    </div>
  );
}

const SEVERITY_ICON = { alert: 'alert', watch: 'clock', info: 'tag', good: 'check' };

function BudgetEditor({ line, month, onDone, onCancel }) {
  const { money, notify } = useApp();
  const [text, setText] = useState(line.budget !== null ? String(line.budget) : '');
  const [scope, setScope] = useState('onward');
  const [busy, setBusy] = useState(false);
  const value = parseBudget(text);
  const bad = Number.isNaN(value);

  async function save(amount) {
    setBusy(true);
    try {
      await api.put(`/budgets/${line.id}`, { month, amount, scope });
      notify(amount === null ? t('Budget for {name} removed', { name: catName(line.name) }) : t('Budget for {name} saved', { name: catName(line.name) }));
      onDone();
    } catch (e) {
      notify(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <form
      className="bud-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bad) save(value);
      }}
    >
      <Field label={t('How much for {name} each month?', { name: catName(line.name) })} hint={bad ? t('Type an amount, like 120 or 120.50.') : t('Leave it empty to have no budget for this category.')}>
        <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-invalid={bad} placeholder={t('For example 150')} />
      </Field>
      <div className="bud-suggest">
        {line.suggested && (
          <button type="button" className="chip" onClick={() => setText(String(line.suggested))}>
            {t('Use {money}', { money: money(line.suggested) })} <span className="muted">{t('(what you usually spend)')}</span>
          </button>
        )}
        {line.lastMonth > 0 && (
          <button type="button" className="chip" onClick={() => setText(String(Math.ceil(line.lastMonth)))}>
            {t('Use {money}', { money: money(Math.ceil(line.lastMonth)) })} <span className="muted">{t('(about last month)')}</span>
          </button>
        )}
      </div>
      <fieldset className="bud-scope">
        <legend className="field-label">{t('When does it apply?')}</legend>
        <label className="check">
          <input type="radio" name="scope" checked={scope === 'onward'} onChange={() => setScope('onward')} />
          <span>{t('From {monthLabel} on. Earlier months keep what they had.', { monthLabel: monthLabel(month, { month: 'long' }) })}</span>
        </label>
        <label className="check">
          <input type="radio" name="scope" checked={scope === 'month'} onChange={() => setScope('month')} />
          <span>{t('Only {monthLabel}. The next month goes back to what it was.', { monthLabel: monthLabel(month, { month: 'long' }) })}</span>
        </label>
      </fieldset>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('Cancel')}
        </button>
        {line.budget !== null && (
          <button type="button" className="btn" onClick={() => save(null)} disabled={busy}>
            {t('Remove budget')}
          </button>
        )}
        <button className="btn primary" disabled={busy || bad}>
          {t('Save budget')}
        </button>
      </div>
    </form>
  );
}

function Row({ line, view, month, editing, onEdit, onDone }) {
  const { money } = useApp();
  const st = statusOf(line.status, view.phase);
  const has = line.budget !== null;
  const key = line.id ?? 'none';
  const bottom = [];
  if (has) {
    bottom.push(line.left >= 0 ? t('{money} left', { money: money(line.left) }) : t('{money} over', { money: money(-line.left) }));
    if (line.planned > 0) bottom.push(t('{money} still planned', { money: money(line.planned) }));
    if (line.perDay !== null && line.left > 0) bottom.push(t('about {money} a day', { money: money(line.perDay) }));
  } else if (line.planned > 0) bottom.push(t('{money} still planned', { money: money(line.planned) }));
  if (line.lastMonth > 0) bottom.push(t('last month {money}', { money: money(line.lastMonth) }));
  if (line.typical > 0) bottom.push(t('usually {money}', { money: money(line.typical) }));
  return (
    <li className={`bud-row s-${line.status}`}>
      <div className="bud-row-top">
        <CategoryDot color={line.color} name={line.name} />
        {has && <span className={`bud-chip ${st.tone}`}>{st.label}</span>}
        <span className="bud-nums num">
          {has ? (
            <>
              <strong>{money(line.spent)}</strong> <span className="muted">{t('of {money}', { money: money(line.budget) })}</span>
            </>
          ) : (
            money(line.spent)
          )}
        </span>
      </div>
      {has && <Bar line={line} elapsed={view.elapsed} label={line.planned > 0 ? t('{name}: {spent} spent of {budget}, {planned} planned. {label}.', { name: catName(line.name), spent: money(line.spent), budget: money(line.budget), planned: money(line.planned), label: st.label }) : t('{name}: {spent} spent of {budget}. {label}.', { name: catName(line.name), spent: money(line.spent), budget: money(line.budget), label: st.label })} />}
      {bottom.length > 0 && <p className="bud-row-bottom muted small">{bottom.join(' · ')}</p>}
      <div className="bud-row-actions">
        {line.id !== null ? (
          <button className="btn sm" onClick={() => onEdit(editing === key ? null : key)} aria-expanded={editing === key}>
            {has ? t('Change budget') : t('Set a budget')}
          </button>
        ) : (
          <span className="muted small">{t('Payments with no category cannot have a budget. Give them a category first.')}</span>
        )}
        {(line.spent > 0 || line.planned > 0) && (
          <Link className="btn sm ghost" to={`/payments?month=${month}${line.id !== null ? `&category=${line.id}` : ''}`}>
            {t('See the payments')}
          </Link>
        )}
      </div>
      {editing === key && line.id !== null && <BudgetEditor line={line} month={month} onDone={onDone} onCancel={() => onEdit(null)} />}
    </li>
  );
}

export default function Budget() {
  const [params, setParams] = useSearchParams();
  const now = currentMonth();
  const asked = params.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : now;
  const { money, notify } = useApp();
  const { current } = useWorkspace();
  const data = useFetch(() => api.get(`/budgets?month=${month}`), [month, current?.id]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const view = data.data;

  const go = (m) => {
    setEditing(null);
    setParams(m === now ? {} : { month: m }, { replace: true });
  };
  const done = () => {
    setEditing(null);
    data.reload();
  };
  async function fill(source) {
    setBusy(true);
    try {
      const r = await api.post('/budgets/fill', { month, source });
      notify(r.filled ? tn(r.filled, 'Budgets set for {n} category. Change any of them.', 'Budgets set for {n} categories. Change any of them.') : t('Nothing to fill in yet: there is not enough spending in the earlier months.'));
      data.reload();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="page-head">
      <div>
        <h1>{t('Monthly budget')}</h1>
        <p className="muted">{t('Decide how much each category may use in a month, and see how much of it is spent, now and at the end of the month.')}</p>
      </div>
      <MonthNav month={month} onChange={go} />
    </header>
  );

  if (data.error && !view) {
    return (
      <>
        {header}
        <ErrorState error={data.error} onRetry={data.reload} />
      </>
    );
  }
  if (!view) {
    return (
      <>
        {header}
        <div aria-busy="true">
          <Skeleton w="100%" h={150} r={8} />
        </div>
      </>
    );
  }

  const tt = view.totals;
  const top = headline(view, money);
  const budgeted = view.lines.filter((l) => l.budget !== null);
  const others = view.lines.filter((l) => l.budget === null);
  const canFill = others.some((l) => l.id !== null);

  return (
    <>
      {header}

      {budgeted.length === 0 ? (
        <section className="card">
          <EmptyState art="chart" title={t('No budget for {monthLabel} yet', { monthLabel: monthLabel(month, { month: 'long' }) })}>
            {t('Give each category an amount for the month. Penny then shows how much is spent, how much is left, and warns you when a category is heading over. The quickest start is to let Penny suggest amounts from what you usually spend, then change any of them.')}
          </EmptyState>
          <div className="bud-start">
            <button className="btn primary" onClick={() => fill('typical')} disabled={busy}>
              {t('Suggest from what I usually spend')}
            </button>
            <button className="btn" onClick={() => fill('last_month')} disabled={busy}>
              {t('Use last month’s spending')}
            </button>
          </div>
        </section>
      ) : (
        <section className="card bud-summary" aria-label={t('The month so far')}>
          <div className="bud-head">
            <div>
              <span className="eyebrow">{top.label}</span>
              <div className={`bud-big num ${top.tone}`}>{top.value}</div>
              <p className="muted">
                {tt.planned > 0 ? t('{spent} spent of {budget} budgeted, and {planned} more is planned.', { spent: money(tt.spent), budget: money(tt.budget), planned: money(tt.planned) }) : t('{spent} spent of {budget} budgeted.', { spent: money(tt.spent), budget: money(tt.budget) })}
              </p>
            </div>
            <dl className="bud-facts">
              {view.phase === 'current' && (
                <div>
                  <dt>{t('Time')}</dt>
                  <dd>
                    {t('Day {day} of {days}', { day: view.day, days: view.days })}
                    <span className="muted small"> · {daysLeftText(view)}</span>
                  </dd>
                </div>
              )}
              {tt.perDay !== null && (
                <div>
                  <dt>{t('You can spend about')}</dt>
                  <dd className="num">{t('{money} a day', { money: money(tt.perDay) })}</dd>
                </div>
              )}
              <div>
                <dt>{view.phase === 'past' ? t('Month total') : t('Expected by month end')}</dt>
                <dd className="num">
                  {money(tt.expected)}
                  <span className={`small ${tt.expected > tt.budget + 0.005 ? 'bud-warn' : 'muted'}`}> {tt.expected > tt.budget + 0.005 ? t('{money} over', { money: money(tt.expected - tt.budget) }) : t('within budget')}</span>
                </dd>
              </div>
            </dl>
          </div>
          <Bar line={{ budget: tt.budget, spent: tt.spent, planned: tt.planned }} elapsed={view.elapsed} label={t('{money} spent of {money2}, {money3} planned.', { money: money(tt.spent), money2: money(tt.budget), money3: money(tt.planned) })} />
          {view.phase === 'current' && (
            <p className="bud-legend muted small">
              <span className="lg spent" /> {t('spent')} <span className="lg planned" /> {t('planned, not paid yet')} <span className="lg pace" /> {t('where an even pace would be today')}
            </p>
          )}
          <details className="bud-help">
            <summary>{t('How is “expected by month end” worked out?')}</summary>
            <p className="muted small">
              {t('It adds what is already paid, what is planned for the rest of the month (recurring payments, installments and anything you have entered with a later date), and the everyday spending that usually follows: the payments you enter by hand, at the pace of the month so far. In the first days of a month Penny uses what you usually spend instead, because a few days say little. It is an estimate, not a promise.')}
            </p>
          </details>
        </section>
      )}

      {view.findings.length > 0 && (
        <section className="card bud-findings" aria-label={t('What stands out')}>
          <div className="card-head">
            <h2>{t('What stands out')}</h2>
          </div>
          <ul>
            {view.findings.map((f) => (
              <li key={f.key} className={`sev-${f.severity}`}>
                <Icon name={SEVERITY_ICON[f.severity]} size={16} />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {budgeted.length > 0 && (
        <section className="card" aria-label={t('Categories with a budget')}>
          <div className="card-head">
            <h2>{t('Your categories')}</h2>
            {canFill && (
              <div className="head-actions">
                <button className="btn sm" onClick={() => fill('typical')} disabled={busy}>
                  {t('Fill in the rest from what I usually spend')}
                </button>
              </div>
            )}
          </div>
          <ul className="bud-list">
            {budgeted.map((l) => (
              <Row key={l.id ?? 'none'} line={l} view={view} month={month} editing={editing} onEdit={setEditing} onDone={done} />
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="card" aria-label={t('Categories without a budget')}>
          <div className="card-head">
            <h2>{budgeted.length ? t('No budget yet') : t('Your categories')}</h2>
          </div>
          <ul className="bud-list">
            {others.map((l) => (
              <Row key={l.id ?? 'none'} line={l} view={view} month={month} editing={editing} onEdit={setEditing} onDone={done} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
