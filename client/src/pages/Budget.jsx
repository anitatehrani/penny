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
      notify(amount === null ? `Budget for ${line.name} removed` : `Budget for ${line.name} saved`);
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
      <Field label={`How much for ${line.name} each month?`} hint={bad ? 'Type an amount, like 120 or 120.50.' : 'Leave it empty to have no budget for this category.'}>
        <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-invalid={bad} placeholder="For example 150" />
      </Field>
      <div className="bud-suggest">
        {line.suggested && (
          <button type="button" className="chip" onClick={() => setText(String(line.suggested))}>
            Use {money(line.suggested)} <span className="muted">(what you usually spend)</span>
          </button>
        )}
        {line.lastMonth > 0 && (
          <button type="button" className="chip" onClick={() => setText(String(Math.ceil(line.lastMonth)))}>
            Use {money(Math.ceil(line.lastMonth))} <span className="muted">(about last month)</span>
          </button>
        )}
      </div>
      <fieldset className="bud-scope">
        <legend className="field-label">When does it apply?</legend>
        <label className="check">
          <input type="radio" name="scope" checked={scope === 'onward'} onChange={() => setScope('onward')} />
          <span>From {monthLabel(month, { month: 'long' })} on. Earlier months keep what they had.</span>
        </label>
        <label className="check">
          <input type="radio" name="scope" checked={scope === 'month'} onChange={() => setScope('month')} />
          <span>Only {monthLabel(month, { month: 'long' })}. The next month goes back to what it was.</span>
        </label>
      </fieldset>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {line.budget !== null && (
          <button type="button" className="btn" onClick={() => save(null)} disabled={busy}>
            Remove budget
          </button>
        )}
        <button className="btn primary" disabled={busy || bad}>
          Save budget
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
    bottom.push(line.left >= 0 ? `${money(line.left)} left` : `${money(-line.left)} over`);
    if (line.planned > 0) bottom.push(`${money(line.planned)} still planned`);
    if (line.perDay !== null && line.left > 0) bottom.push(`about ${money(line.perDay)} a day`);
  } else if (line.planned > 0) bottom.push(`${money(line.planned)} still planned`);
  if (line.lastMonth > 0) bottom.push(`last month ${money(line.lastMonth)}`);
  if (line.typical > 0) bottom.push(`usually ${money(line.typical)}`);
  return (
    <li className={`bud-row s-${line.status}`}>
      <div className="bud-row-top">
        <CategoryDot color={line.color} name={line.name} />
        {has && <span className={`bud-chip ${st.tone}`}>{st.label}</span>}
        <span className="bud-nums num">
          {has ? (
            <>
              <strong>{money(line.spent)}</strong> <span className="muted">of {money(line.budget)}</span>
            </>
          ) : (
            money(line.spent)
          )}
        </span>
      </div>
      {has && <Bar line={line} elapsed={view.elapsed} label={`${line.name}: ${money(line.spent)} spent of ${money(line.budget)}${line.planned > 0 ? `, ${money(line.planned)} planned` : ''}. ${st.label}.`} />}
      {bottom.length > 0 && <p className="bud-row-bottom muted small">{bottom.join(' · ')}</p>}
      <div className="bud-row-actions">
        {line.id !== null ? (
          <button className="btn sm" onClick={() => onEdit(editing === key ? null : key)} aria-expanded={editing === key}>
            {has ? 'Change budget' : 'Set a budget'}
          </button>
        ) : (
          <span className="muted small">Payments with no category cannot have a budget. Give them a category first.</span>
        )}
        {(line.spent > 0 || line.planned > 0) && (
          <Link className="btn sm ghost" to={`/payments?month=${month}${line.id !== null ? `&category=${line.id}` : ''}`}>
            See the payments
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
      notify(r.filled ? `Budgets set for ${r.filled} ${r.filled === 1 ? 'category' : 'categories'}. Change any of them.` : 'Nothing to fill in yet: there is not enough spending in the earlier months.');
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
        <h1>Monthly budget</h1>
        <p className="muted">Decide how much each category may use in a month, and see how much of it is spent, now and at the end of the month.</p>
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

  const t = view.totals;
  const top = headline(view, money);
  const budgeted = view.lines.filter((l) => l.budget !== null);
  const others = view.lines.filter((l) => l.budget === null);
  const canFill = others.some((l) => l.id !== null);

  return (
    <>
      {header}

      {budgeted.length === 0 ? (
        <section className="card">
          <EmptyState art="chart" title={`No budget for ${monthLabel(month, { month: 'long' })} yet`}>
            Give each category an amount for the month. Penny then shows how much is spent, how much is left, and warns you when a category is heading over. The quickest start is to let Penny suggest amounts
            from what you usually spend, then change any of them.
          </EmptyState>
          <div className="bud-start">
            <button className="btn primary" onClick={() => fill('typical')} disabled={busy}>
              Suggest from what I usually spend
            </button>
            <button className="btn" onClick={() => fill('last_month')} disabled={busy}>
              Use last month&rsquo;s spending
            </button>
          </div>
        </section>
      ) : (
        <section className="card bud-summary" aria-label="The month so far">
          <div className="bud-head">
            <div>
              <span className="eyebrow">{top.label}</span>
              <div className={`bud-big num ${top.tone}`}>{top.value}</div>
              <p className="muted">
                {money(t.spent)} spent of {money(t.budget)} budgeted{t.planned > 0 ? `, and ${money(t.planned)} more is planned` : ''}.
              </p>
            </div>
            <dl className="bud-facts">
              {view.phase === 'current' && (
                <div>
                  <dt>Time</dt>
                  <dd>
                    Day {view.day} of {view.days}
                    <span className="muted small"> · {daysLeftText(view)}</span>
                  </dd>
                </div>
              )}
              {t.perDay !== null && (
                <div>
                  <dt>You can spend about</dt>
                  <dd className="num">{money(t.perDay)} a day</dd>
                </div>
              )}
              <div>
                <dt>{view.phase === 'past' ? 'Month total' : 'Expected by month end'}</dt>
                <dd className="num">
                  {money(t.expected)}
                  <span className={`small ${t.expected > t.budget + 0.005 ? 'bud-warn' : 'muted'}`}> {t.expected > t.budget + 0.005 ? `${money(t.expected - t.budget)} over` : 'within budget'}</span>
                </dd>
              </div>
            </dl>
          </div>
          <Bar line={{ budget: t.budget, spent: t.spent, planned: t.planned }} elapsed={view.elapsed} label={`${money(t.spent)} spent of ${money(t.budget)}, ${money(t.planned)} planned.`} />
          {view.phase === 'current' && (
            <p className="bud-legend muted small">
              <span className="lg spent" /> spent <span className="lg planned" /> planned, not paid yet <span className="lg pace" /> where an even pace would be today
            </p>
          )}
          <details className="bud-help">
            <summary>How is &ldquo;expected by month end&rdquo; worked out?</summary>
            <p className="muted small">
              It adds what is already paid, what is planned for the rest of the month (recurring payments, installments and anything you have entered with a later date), and the everyday spending that usually
              follows: the payments you enter by hand, at the pace of the month so far. In the first days of a month Penny uses what you usually spend instead, because a few days say little. It is an estimate,
              not a promise.
            </p>
          </details>
        </section>
      )}

      {view.findings.length > 0 && (
        <section className="card bud-findings" aria-label="What stands out">
          <div className="card-head">
            <h2>What stands out</h2>
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
        <section className="card" aria-label="Categories with a budget">
          <div className="card-head">
            <h2>Your categories</h2>
            {canFill && (
              <div className="head-actions">
                <button className="btn sm" onClick={() => fill('typical')} disabled={busy}>
                  Fill in the rest from what I usually spend
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
        <section className="card" aria-label="Categories without a budget">
          <div className="card-head">
            <h2>{budgeted.length ? 'No budget yet' : 'Your categories'}</h2>
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
