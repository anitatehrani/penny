import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BalanceChart, Sparkline } from '../components/Charts.jsx';
import TransactionForm from '../components/TransactionForm.jsx';
import TxRow from '../components/TxRow.jsx';
import { Avatar, Empty, ErrorBox, Icon, Modal, Skeleton } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { currentMonth, monthLabel } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

function Stat({ icon, label, value, sub, tone, children, hero, delay = 0 }) {
  return (
    <div className={`card stat${hero ? ' hero' : ''}`} style={{ '--delay': `${delay}ms` }}>
      <div className="stat-top">
        <span className="stat-icon" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <span className="stat-label">{label}</span>
      </div>
      <span className={`stat-value num ${tone ?? ''}`}>{value}</span>
      {children}
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** A thin bar showing how much of a total is already settled. */
function Meter({ done, total, label }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="meter" role="img" aria-label={`${label}: ${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your dashboard" role="status">
      <div className="dash-head">
        <Skeleton w={44} h={44} r="50%" />
        <div className="skel-col">
          <Skeleton w={220} h={22} />
          <Skeleton w={150} h={12} />
        </div>
      </div>
      <div className="stats" style={{ marginTop: 18 }}>
        {[0, 1, 2].map((i) => (
          <div className="card stat" key={i}>
            <Skeleton w="40%" h={12} />
            <Skeleton w="65%" h={28} />
            <Skeleton w="80%" h={10} />
          </div>
        ))}
      </div>
      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="card">
          <Skeleton w="35%" h={14} />
          {[0, 1, 2, 3].map((i) => (
            <div className="skel-row" key={i}>
              <Skeleton w={56} h={30} />
              <Skeleton w="60%" h={14} />
            </div>
          ))}
        </div>
        <div className="card">
          <Skeleton w="45%" h={14} />
          {[0, 1, 2, 3].map((i) => (
            <div className="skel-row" key={i}>
              <Skeleton w="100%" h={10} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const { money } = useApp();
  const { user } = useAuth();
  const { isGroup, current } = useWorkspace();
  const month = currentMonth();
  const summary = useFetch(() => api.get(`/summary?month=${month}`), [month]);
  const forecast = useFetch(() => api.get('/forecast?past=2&months=6'), []);
  const [adding, setAdding] = useState(false);

  const reload = () => {
    summary.reload();
    forecast.reload();
  };

  if (summary.error) return <ErrorBox error={summary.error} />;
  if (!summary.data) return <DashboardSkeleton />;
  const s = summary.data;
  const t = s.totals;
  const negNow = s.balance < 0;
  const firstNeg = forecast.data?.insights.firstNegativeMonth;
  const topCategory = s.byCategory[0]?.total || 1;

  return (
    <>
      <header className="dash-head">
        <Link to="/profile" className="dash-avatar" aria-label="Your profile" title="Your profile">
          <Avatar user={user} size={44} />
        </Link>
        <div className="dash-title">
          <h1>
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="muted">
            {isGroup ? `${current.name} · shared money of the group` : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <button className="btn primary add-btn" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add payment
        </button>
      </header>

      {negNow && (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div>
            <strong>Your balance is negative right now ({money(s.balance)}).</strong> Record any income you have received, or check the
            starting balance in <Link to="/settings">Settings</Link>.
          </div>
        </div>
      )}
      {!negNow && firstNeg && (
        <div className="banner warn" role="alert">
          <Icon name="alert" />
          <div>
            <strong>
              Projected to go negative in {monthLabel(firstNeg.month)} ({money(firstNeg.balance)}).
            </strong>{' '}
            See the <Link to="/forecast">forecast</Link> for details.
          </div>
        </div>
      )}
      {s.overdue.count > 0 && (
        <div className="banner warn">
          <Icon name="alert" />
          <div>
            <strong>
              {s.overdue.count} overdue payment{s.overdue.count > 1 ? 's' : ''}
              {s.overdue.expenseTotal > 0 && ` · ${money(s.overdue.expenseTotal)} to pay`}.
            </strong>{' '}
            Mark them as paid below once settled.
          </div>
        </div>
      )}

      <section className="stats" aria-label="This month at a glance">
        <Stat
          hero
          icon="card"
          label={isGroup ? 'Our balance today' : 'Balance today'}
          value={money(s.balance)}
          tone={negNow ? 'neg' : ''}
          sub={`Projected end of ${monthLabel(month, { month: 'long' })}: ${money(s.projectedMonthEnd)}`}
          delay={0}
        >
          {forecast.data && <Sparkline months={forecast.data.months} />}
        </Stat>
        <Stat
          icon="download"
          label={isGroup ? 'Combined income' : 'Income this month'}
          value={money(t.incomePaid + t.incomePending)}
          sub={`${money(t.incomePaid)} received · ${money(t.incomePending)} expected`}
          delay={60}
        >
          <Meter done={t.incomePaid} total={t.incomePaid + t.incomePending} label="Income received" />
        </Stat>
        <Stat
          icon="upload"
          label={isGroup ? 'Shared expenses' : 'Expenses this month'}
          value={money(t.expensePaid + t.expensePending)}
          sub={`${money(t.expensePaid)} paid · ${money(t.expensePending)} still to pay`}
          delay={120}
        >
          <Meter done={t.expensePaid} total={t.expensePaid + t.expensePending} label="Expenses paid" />
        </Stat>
      </section>

      {isGroup && s.byMember.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Who contributes</h2>
            <span className="muted">{monthLabel(month, { month: 'long' })}</span>
          </div>
          <ul className="members-bars">
            {s.byMember.map((m) => {
              const maxIncome = Math.max(1, ...s.byMember.map((x) => x.income));
              const maxExpense = Math.max(1, ...s.byMember.map((x) => x.expenses));
              const totalIncome = s.byMember.reduce((a, x) => a + x.income, 0);
              const share = totalIncome > 0 ? Math.round((m.income / totalIncome) * 100) : 0;
              return (
                <li key={m.username}>
                  <div className="member-head">
                    <Avatar user={m} size={28} />
                    <strong>{m.username === user.username ? `${m.name} (you)` : m.name}</strong>
                    {totalIncome > 0 && <span className="badge">{share}% of income</span>}
                  </div>
                  <div className="member-bar">
                    <span className="muted small">Brings in</span>
                    <div className="bar-track">
                      <div className="bar-solid income" style={{ width: `${(m.income / maxIncome) * 100}%` }} />
                    </div>
                    <span className="num">{money(m.income)}</span>
                  </div>
                  <div className="member-bar">
                    <span className="muted small">Pays</span>
                    <div className="bar-track">
                      <div className="bar-solid expense" style={{ width: `${(m.expenses / maxExpense) * 100}%` }} />
                    </div>
                    <span className="num">{money(m.expenses)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Due in the next 14 days</h2>
            <Link to="/payments">All payments</Link>
          </div>
          {s.overdue.items.length === 0 && s.upcoming.length === 0 ? (
            <Empty icon="check" title="Nothing due">No pending payments in the next two weeks.</Empty>
          ) : (
            <div className="tx-list">
              {[...s.overdue.items, ...s.upcoming].map((tx) => (
                <TxRow key={tx.id} tx={tx} compact onChange={reload} />
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Spending by category</h2>
            <span className="muted">{monthLabel(month, { month: 'long' })}</span>
          </div>
          {s.byCategory.length === 0 ? (
            <Empty icon="trend" title="No expenses yet">Add a payment to see where the money goes.</Empty>
          ) : (
            <ul className="bars">
              {s.byCategory.map((c) => (
                <li key={c.category_id ?? 'none'}>
                  <div className="bar-head">
                    <span className="cat">
                      <span className="dot" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <span className="num">{money(c.total)}</span>
                  </div>
                  <div className="bar-track" title={`${money(c.paid)} paid of ${money(c.total)}`}>
                    <div className="bar-fill" style={{ width: `${(c.total / topCategory) * 100}%` }}>
                      <div className="bar-rest" style={{ background: c.color }} />
                      <div className="bar-paid" style={{ width: `${(c.paid / c.total) * 100}%`, background: c.color }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Balance outlook</h2>
          <Link to="/forecast">Full forecast</Link>
        </div>
        {forecast.data ? <BalanceChart months={forecast.data.months} height={240} /> : <Skeleton w="100%" h={240} r={8} />}
      </section>

      {adding && (
        <Modal title="Add payment" onClose={() => setAdding(false)}>
          <TransactionForm
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
