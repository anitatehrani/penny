import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { agoText, checkSummary, deleteConfirmed, eventWho, formatBytes, messagePreview, percent, personBadges, rangeText, signInMethods, signupBars, uptimeText, viewAsProblem } from '../adminLogic.js';
import { backupLine } from '../backupLogic.js';
import Select from '../components/ds/Select.jsx';
import { Field, Icon, Loading, Modal, ErrorBox, Empty, Segmented } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLong } from '../format.js';
import { useFetch } from '../hooks.js';
import { N_, localeOf, t, tn } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

const TABS = [
  ['overview', N_('Overview'), 'home'],
  ['people', N_('People'), 'users'],
  ['messages', N_('Messages'), 'mail'],
  ['activity', N_('Activity'), 'list'],
  ['system', N_('System'), 'gear'],
];

const toneClass = (tt) => (tt === 'ok' ? 'ok' : tt === 'warn' ? 'tone-warn' : tt === 'neg' ? 'tone-neg' : '');
const whenText = (iso) => new Date(iso).toLocaleString(localeOf(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <span className="muted">{label}</span>
      <strong className="num">{value}</strong>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

function EventList({ events, compact }) {
  if (!events.length) return <p className="muted small">{t('Nothing yet.')}</p>;
  return (
    <ul className={`admin-events${compact ? ' compact' : ''}`}>
      {events.map((e) => {
        const who = eventWho(e);
        return (
          <li key={e.id}>
            <time dateTime={e.at} title={new Date(e.at).toLocaleString(localeOf())} className="muted small">
              {agoText(e.at)}
            </time>
            <span className={`badge ${toneClass(e.tone)}`}>{e.label}</span>
            {!compact && <span className="admin-who">{who.person}</span>}
            {compact && e.user_name && <span className="admin-who">{e.user_name}</span>}
            {who.actor && <span className="muted small">{t('by {actor}', { actor: who.actor })}</span>}
            {e.detail && <span className="muted small admin-detail">{e.detail}</span>}
            {e.source && !compact && (
              <span className="muted small admin-source" title={t('A short code for where it came from. The address itself is not kept.')}>
                {t('from {source}', { source: e.source })}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// Overview
// ------------------------------------------------------------------------------------------------------------------------
function SignupChart({ rows }) {
  const chart = signupBars(rows);
  const first = rows[0]?.day;
  const last = rows.at(-1)?.day;
  return (
    <div className="card admin-chart">
      <div className="card-head">
        <h2>{t('Sign-ups, last 30 days')}</h2>
        <span className="muted small">
          {t('{total} in all', { total: chart.total })}{chart.busiest ? t(' · most on {dateLong} ({count})', { dateLong: dateLong(chart.busiest.day), count: chart.busiest.count }) : ''}
        </span>
      </div>
      <div className="su-bars" role="img" aria-label={t('Sign-ups per day for the last 30 days: {total} in all', { total: chart.total })}>
        {chart.bars.map((b) => (
          <span key={b.day} className="su-col" title={tn(b.count, '{dateLong}: {n} sign-up', '{dateLong}: {n} sign-ups', { dateLong: dateLong(b.day) })}>
            <span className={`su-bar${b.count ? '' : ' zero'}`} style={{ height: `${b.pct}%` }} />
          </span>
        ))}
      </div>
      {first && (
        <div className="su-axis muted small" aria-hidden="true">
          <span>{dateLong(first)}</span>
          <span>{dateLong(last)}</span>
        </div>
      )}
    </div>
  );
}

function Overview() {
  const { data, error } = useFetch(() => api.get('/admin/overview'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const p = data.people;
  const c = data.content;
  const l = data.last_24h;
  const sum = checkSummary(data.checks);
  return (
    <>
      <h2 className="section-title">{t('People')}</h2>
      <div className="admin-grid">
        <Stat label={t('People')} value={p.total} note={t('{new_24h} today · {new_7d} this week · {new_30d} this month', { new_24h: p.new_24h, new_7d: p.new_7d, new_30d: p.new_30d })} />
        <Stat label={t('Active this week')} value={p.active_7d} note={t('{percent}% of everyone · {active_24h} today · {active_30d} this month', { percent: percent(p.active_7d, p.total), active_24h: p.active_24h, active_30d: p.active_30d })} />
        <Stat label={t('E-mail confirmed')} value={p.email_confirmed} note={t('{percent}% of everyone', { percent: percent(p.email_confirmed, p.total) })} />
        <Stat label={t('Suspended')} value={p.suspended} note={tn(p.admins, '{n} admin · {google} with Google · {password} with a password', '{n} admins · {google} with Google · {password} with a password', { google: p.google, password: p.password })} tone={p.suspended ? 'warn' : ''} />
      </div>

      <h2 className="section-title">{t('Last 24 hours')}</h2>
      <div className="admin-grid">
        <Stat label={t('Sign-ins')} value={l.sign_ins} />
        <Stat label={t('Failed sign-ins')} value={l.failed_sign_ins} tone={l.failed_sign_ins >= 10 ? 'warn' : ''} />
        <Stat label={t('Sign-ups')} value={l.sign_ups} />
        <Stat label={t('Turned away')} value={l.rate_limited} note={t('too many tries')} tone={l.rate_limited ? 'warn' : ''} />
      </div>

      <SignupChart rows={data.signups_by_day} />

      <h2 className="section-title">{t('What people have made')}</h2>
      <div className="admin-grid">
        <Stat label={t('Personal budgets')} value={c.personal_budgets} />
        <Stat label={t('Shared budgets')} value={c.shared_budgets} />
        <Stat label={t('Payments')} value={c.payments.toLocaleString(localeOf())} note={t('a count; what they are stays private')} />
        <Stat label={t('Receipts')} value={c.receipts.toLocaleString(localeOf())} note={formatBytes(c.receipt_bytes)} />
      </div>

      <section className="card admin-checks" aria-labelledby="going-public">
        <div className="card-head">
          <h2 id="going-public">{t('Going public')}</h2>
          <span className={`badge ${sum.allOk ? 'ok' : 'tone-warn'}`}>
            {t('{done} of {total} ready', { done: sum.done, total: sum.total })}
          </span>
        </div>
        <ul>
          {data.checks.map((ch) => (
            <li key={ch.id} className={ch.ok ? 'done' : 'todo'}>
              <Icon name={ch.ok ? 'check' : 'alert'} size={16} />
              <div>
                <strong>{ch.text}</strong>
                {!ch.ok && <p className="muted small">{ch.hint}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="recent-activity">
        <div className="card-head">
          <h2 id="recent-activity">{t('Latest activity')}</h2>
          <Link to="/admin?tab=activity" className="link-quiet">
            {t('See all')}
          </Link>
        </div>
        <EventList events={data.recent} compact />
      </section>
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// People
// ------------------------------------------------------------------------------------------------------------------------
function SuspendDialog({ person, onClose, onDone }) {
  const { notify } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/admin/users/${person.id}/suspend`, { reason: reason.trim() || undefined });
      notify(t('{name} is suspended', { name: person.name }));
      onDone();
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Suspend {name}?', { name: person.name })} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          {t('They are signed out on every device now and cannot sign in until you reinstate them. Nothing is deleted. Only admins see the reason.')}
        </p>
        <Field label={t('Reason (optional)')}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('e.g. spam sign-ups')} autoFocus />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn danger" disabled={busy}>
            {t('Suspend')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "View as": the one place an admin can see a person's money, so it asks why, asks for the admin's password, and says what happens. */
function ViewAsDialog({ person, onClose }) {
  const { notify } = useApp();
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [write, setWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = viewAsProblem({ reason, password }, user.has_password);
  async function submit(e) {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${person.id}/view-as`, { reason: reason.trim(), password: password || undefined, read_only: !write });
      window.location.assign('/'); // start again as that person, so every page loads their account
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  }
  return (
    <Modal title={t('View as {name}', { name: person.name })} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="banner info">
          <Icon name="shield" />
          <div>
            {tRich('You will see Penny exactly as {bold} does, including their payments and amounts. It lasts 30 minutes, it is written in the activity log with your reason, and {bold2}. Only look when you need to.', { bold: <strong>{person.name}</strong>, bold2: <strong>{t('they are told in the app that an admin viewed their account')}</strong> })}
          </div>
        </div>
        <Field label={t('Why do you need to look?')} hint={t('Shown to them and in the log.')}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('e.g. they asked for help with a missing payment')} autoFocus />
        </Field>
        {user.has_password && (
          <Field label={t('Your password')} hint={t('To confirm it is you. This is your own password, not theirs.')}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
          <span>
            {t('Allow changes to their budget')}
            <span className="muted block small">{t('Off (recommended): nothing can be changed. On: payments, plans, debts and settings can be changed, each change is logged as yours; their name, password, friends and sharing can never be changed.')}</span>
          </span>
        </label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !!problem} title={problem ?? undefined}>
            {t('View as {value}', { value: person.name.split(' ')[0] })}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ person, onClose, onDone }) {
  const { notify } = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.del(`/admin/users/${person.id}`, { confirm: typed.replace(/^@/, '') });
      notify(t('{name}\'s account was deleted', { name: person.name }));
      onDone();
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Delete {name}\'s account?', { name: person.name })} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="banner danger">
          <Icon name="alert" />
          <div>{t('This permanently deletes the person and everything in their own budgets: payments, plans, debts, receipts. It cannot be undone. Take a backup first if you are unsure.')}</div>
        </div>
        <Field label={t('Type their username, @{username}, to confirm', { username: person.username })}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn danger" disabled={busy || !deleteConfirmed(typed.replace(/^@/, ''), person.username)}>
            {t('Delete account')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PersonDetail({ id, me, onChanged }) {
  const { notify } = useApp();
  const { data, error, reload } = useFetch(() => api.get(`/admin/users/${id}`), [id]);
  const [dialog, setDialog] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const u = data.user;
  const refresh = () => {
    reload();
    onChanged();
  };
  async function act(path, message) {
    try {
      await api.post(`/admin/users/${u.id}/${path}`, {});
      notify(message);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  const protectedPerson = u.is_admin || u.id === me;
  return (
    <div className="admin-detail-panel">
      <dl className="admin-facts">
        <div><dt>{t('E-mail')}</dt><dd>{u.email} {u.email_verified ? <span className="badge ok">{t('confirmed')}</span> : <span className="badge">{t('not confirmed')}</span>}</dd></div>
        <div><dt>{t('Signs in with')}</dt><dd>{signInMethods(u)}</dd></div>
        <div><dt>{t('Joined')}</dt><dd>{dateLong(u.created_at.slice(0, 10))}</dd></div>
        <div><dt>{t('Last sign-in')}</dt><dd>{agoText(u.last_login_at)}</dd></div>
        <div><dt>{t('Devices signed in')}</dt><dd>{data.devices}</dd></div>
        <div><dt>{t('Payments')}</dt><dd>{u.payments} <span className="muted small">{t('(a count only)')}</span></dd></div>
        <div><dt>{t('Shared budgets')}</dt><dd>{u.shared_budgets}{data.shared_with_others ? t(' ({shared_with_others} with other people)', { shared_with_others: data.shared_with_others }) : ''}</dd></div>
        {u.suspended && <div><dt>{t('Suspended')}</dt><dd>{agoText(u.suspended_at)}{u.suspended_reason ? `: ${u.suspended_reason}` : ''}</dd></div>}
      </dl>

      {protectedPerson ? (
        <p className="muted small">{u.id === me ? t('This is you.') : t('This person is an admin. Take the role away first with .\\penny remove-admin to manage their account.')}</p>
      ) : (
        <div className="admin-actions">
          {u.suspended ? (
            <button className="btn sm" onClick={() => act('unsuspend', t('{name} is reinstated', { name: u.name }))}>
              <Icon name="undo" size={14} /> {t('Reinstate')}
            </button>
          ) : (
            <button className="btn sm" onClick={() => setDialog('suspend')}>
              <Icon name="alert" size={14} /> {t('Suspend')}
            </button>
          )}
          <button className="btn sm primary-soft" onClick={() => setDialog('viewas')}>
            <Icon name="user" size={14} /> {t('View as {value}', { value: u.name.split(' ')[0] })}
          </button>
          <button className="btn sm" disabled={data.devices === 0} onClick={() => act('sign-out', t('{name} was signed out everywhere', { name: u.name }))}>
            <Icon name="logout" size={14} /> {t('Sign out everywhere')}
          </button>
          <button className="btn sm danger" disabled={!data.can_delete} onClick={() => setDialog('delete')} title={data.can_delete ? undefined : t('They share a budget with other people, so deleting them would harm those people.')}>
            <Icon name="trash" size={14} /> {t('Delete account')}
          </button>
          {!data.can_delete && data.shared_with_others > 0 && (
            <p className="muted small">{tn(data.shared_with_others, 'Cannot be deleted: in {n} shared budget with other people. Suspend instead.', 'Cannot be deleted: in {n} shared budgets with other people. Suspend instead.')}</p>
          )}
        </div>
      )}

      <h3 className="admin-sub">{t('Recent events')}</h3>
      <EventList events={data.events} compact />

      {dialog === 'suspend' && (
        <SuspendDialog
          person={u}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog === 'viewas' && <ViewAsDialog person={u} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <DeleteDialog
          person={u}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onChanged(true);
          }}
        />
      )}
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: 'all', get label() { return t('Everyone'); } },
  { value: 'active', get label() { return t('Active'); } },
  { value: 'suspended', get label() { return t('Suspended'); } },
  { value: 'unconfirmed', get label() { return t('E-mail not confirmed'); } },
  { value: 'admins', get label() { return t('Admins'); } },
];
const SORT_OPTIONS = [
  { value: 'newest', get label() { return t('Newest first'); } },
  { value: 'seen', get label() { return t('Last seen'); } },
  { value: 'name', get label() { return t('Name'); } },
];

function Pager({ page, pages, total, size, onPage }) {
  return (
    <div className="admin-pager">
      <span className="muted small" aria-live="polite">
        {rangeText(page, size, total)}
      </span>
      <span className="row-actions">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <Icon name="left" size={14} /> {t('Newer')}
        </button>
        <span className="muted small">
          {t('Page {page} of {pages}', { page, pages })}
        </span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('Older')} <Icon name="right" size={14} />
        </button>
      </span>
    </div>
  );
}

function People() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const tt = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(tt);
  }, [text]);
  const { data, error, reload } = useFetch(() => api.get(`/admin/users?q=${encodeURIComponent(q)}&status=${status}&sort=${sort}&page=${page}`), [q, status, sort, page]);

  return (
    <>
      <div className="admin-filters">
        <label className="admin-search">
          <Icon name="search" size={16} />
          <span className="sr-only">{t('Search people')}</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Search by name, username or e-mail')} autoComplete="off" />
        </label>
        <Select label={t('Show')} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} variant="filter" />
        <Select label={t('Sort')} value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={SORT_OPTIONS} variant="filter" />
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.users.length === 0 ? (
        <section className="card">
          <Empty title={t('Nobody found')} icon="users">
            {q || status !== 'all' ? t('Try another search or filter.') : t('Nobody has signed up yet.')}
          </Empty>
        </section>
      ) : (
        <>
          <ul className="admin-people">
            {data.users.map((u) => {
              const expanded = open === u.id;
              return (
                <li key={u.id} className={expanded ? 'open' : ''}>
                  <button className="admin-person" aria-expanded={expanded} aria-controls={`person-${u.id}`} onClick={() => setOpen(expanded ? null : u.id)}>
                    <span className="admin-name">
                      <strong>{u.name}</strong>
                      <span className="muted small">
                        @{u.username} · {u.email}
                      </span>
                    </span>
                    <span className="admin-meta muted small">
                      <span>{t('Joined {agoText}', { agoText: agoText(u.created_at) })}</span>
                      <span>{t('Seen {agoText}', { agoText: agoText(u.last_seen_at) })}</span>
                      <span>{tn(u.payments, '{n} payment', '{n} payments')}</span>
                    </span>
                    <span className="admin-badges">
                      {personBadges(u).map((b) => (
                        <span key={b.label} className={`badge ${b.tone}`}>
                          {b.label}
                        </span>
                      ))}
                    </span>
                    <Icon name={expanded ? 'chevronUp' : 'chevron'} size={16} />
                  </button>
                  {expanded && (
                    <div id={`person-${u.id}`}>
                      <PersonDetail
                        id={u.id}
                        me={user.id}
                        onChanged={(gone) => {
                          if (gone) setOpen(null);
                          reload();
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager page={data.page} pages={data.pages} total={data.total} size={data.page_size} onPage={setPage} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// Activity
// ------------------------------------------------------------------------------------------------------------------------
function Activity() {
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const { data, error } = useFetch(() => api.get(`/admin/events?kind=${kind}&page=${page}`), [kind, page]);
  const options = [{ value: 'all', label: t('Everything') }, ...(data?.kinds ?? []).map((k) => ({ value: k.kind, label: k.label }))];
  return (
    <>
      <div className="admin-filters">
        <Select label={t('Show')} value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={options} variant="filter" />
        <p className="muted small admin-note">{t('Kept for 90 days. A source is a short code for where something came from, not the address. Passwords and what was typed are never recorded.')}</p>
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.events.length === 0 ? (
        <section className="card">
          <Empty title={t('No events')} icon="list">
            {t('Nothing like that has happened (yet).')}
          </Empty>
        </section>
      ) : (
        <>
          <section className="card">
            <EventList events={data.events} />
          </section>
          <Pager page={data.page} pages={data.pages} total={data.total} size={50} onPage={setPage} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// Messages from the contact form (docs/DESIGN.md section 38)
// ------------------------------------------------------------------------------------------------------------------------
const MESSAGE_FILTERS = [
  ['unread', N_('Unread')],
  ['all', N_('All')],
  ['archived', N_('Archived')],
];

/** Answer a message by e-mail, from here. The writer gets it from Penny's address, and their reply goes to the admin's own address. */
function ReplyDialog({ m, inbox, onClose, onDone }) {
  const { notify } = useApp();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const latest = [...m.thread].reverse().find((tt) => tt.direction === 'in')?.body ?? m.message; // what they said last
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/admin/messages/${m.id}/reply`, { reply: text });
      if (r.mail === 'preview') notify(t('Saved, but not e-mailed: this server has no mail server set up (see System).'), 'error');
      else notify(t('Answer sent to {name}', { name: m.name }));
      onDone(r.message, r.unread);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Answer {name}', { name: m.name })} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        {error && <ErrorBox error={{ message: error }} />}
        <p className="muted small">
          {tRich('To {email}. It is sent from Penny.', { email: <strong>{m.email}</strong> })}{' '}
          {inbox
            ? t('When {first} answers, the reply comes back here, under this message.', { first: m.name.split(' ')[0] })
            : t('Your address ({email}) is the reply address, so when {first} answers, it reaches you directly.', { email: user.email, first: m.name.split(' ')[0] })}{' '}
          {t('What they wrote is quoted underneath.')}
        </p>
        <p className="msg-text msg-quote">{latest}</p>
        <Field label={t('Your answer')}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000} required autoFocus />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || text.trim().length < 2}>
            <Icon name="send" size={14} /> {busy ? t('Sending…') : t('Send answer')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MessageItem({ m: base, inbox, open, onToggle, onChange, onCount }) {
  const { notify } = useApp();
  const { user } = useAuth();
  // reading a message in the Unread list must not make it vanish from under the reader, so what was just read is remembered here
  const [local, setLocal] = useState(null);
  const [replying, setReplying] = useState(false);
  const [patch, setPatch] = useState(null); // what changed here (an answer was sent), shown without making the message leave the list it is in
  const m = patch ? { ...base, ...patch } : base;
  const read = local ?? m.read;
  async function act(path, value, message) {
    try {
      const r = await api.post(`/admin/messages/${m.id}/${path}`, { value });
      if (message) notify(message);
      if (path === 'read') setLocal(value);
      onChange(r.unread);
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  async function remove() {
    if (!window.confirm(t('Delete the message from {name} for good?', { name: m.name }))) return;
    try {
      const r = await api.del(`/admin/messages/${m.id}`);
      notify(t('Message deleted'));
      onChange(r.unread);
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  function toggle() {
    if (!open && !read) {
      // opening it is reading it
      setLocal(true);
      api.post(`/admin/messages/${m.id}/read`, { value: true }).then((r) => onCount(r.unread)).catch((err) => notify(err.message, 'error'));
    }
    onToggle();
  }
  return (
    <li className={`msg${read ? '' : ' unread'}${open ? ' open' : ''}`}>
      <button className="msg-head" onClick={toggle} aria-expanded={open}>
        <span className="msg-dot" aria-hidden="true">{!read && <i className="unread-dot" />}</span>
        <span className="msg-from">
          <strong>{m.name}</strong>
          <span className="muted small">{m.email}</span>
        </span>
        <span className="badge">{m.topic_label}</span>
        <time className="muted small" dateTime={m.created_at} title={whenText(m.created_at)}>{agoText(m.created_at)}</time>
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {!open && <p className="msg-preview muted">{messagePreview(m.message)}</p>}
      {open && (
        <div className="msg-body">
          <p className="msg-text">{m.message}</p>
          {m.thread.map((tt) =>
            tt.direction === 'out' ? (
              <div key={tt.id} className="msg-answer">
                <span className="muted small">
                  {tt.admin_name && tt.admin_name !== user.name ? t('{admin_name} answered', { admin_name: tt.admin_name }) : t('You answered')} {agoText(tt.created_at)}:
                </span>
                <p>{tt.body}</p>
              </div>
            ) : (
              <div key={tt.id} className="msg-reply">
                <span className="muted small">
                  {t('{value} replied {agoText}', { value: m.name.split(' ')[0], agoText: agoText(tt.created_at) })}
                  {tt.other_sender && <span className="badge" title={tt.from_email}> {t('from another address')}</span>}:
                </span>
                <p>{tt.body}</p>
              </div>
            ),
          )}
          <p className="muted small">
            {m.signed_in ? t('Sent {when}, while signed in to an account.', { when: whenText(m.created_at) }) : t('Sent {when}, without signing in.', { when: whenText(m.created_at) })}
          </p>
          <div className="admin-actions">
            <button className="btn sm primary-soft" onClick={() => setReplying(true)}>
              <Icon name="send" size={14} /> {m.replied ? t('Answer again') : t('Answer by e-mail')}
            </button>
            <button className="btn sm" onClick={() => act('read', !read)}>
              <Icon name={read ? 'undo' : 'check'} size={14} /> {read ? t('Mark unread') : t('Mark read')}
            </button>
            <button className="btn sm" onClick={() => act('archive', !m.archived, m.archived ? t('Restored') : t('Archived'))}>
              <Icon name={m.archived ? 'undo' : 'download'} size={14} /> {m.archived ? t('Restore') : t('Archive')}
            </button>
            <button className="btn sm danger" onClick={remove}>
              <Icon name="trash" size={14} /> {t('Delete')}
            </button>
          </div>
        </div>
      )}
      {replying && (
        <ReplyDialog
          m={m}
          inbox={inbox}
          onClose={() => setReplying(false)}
          onDone={(message, unread) => {
            setReplying(false);
            setPatch(message);
            setLocal(true);
            onCount(unread);
          }}
        />
      )}
    </li>
  );
}

function Messages({ onUnread }) {
  const [filter, setFilter] = useState('unread');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [counts, setCounts] = useState(null); // the last numbers seen, so the buttons do not blink while a list loads
  useEffect(() => {
    const tt = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(tt);
  }, [text]);
  const { data, error, reload } = useFetch(() => api.get(`/admin/messages?filter=${filter}&q=${encodeURIComponent(q)}&page=${page}`), [filter, q, page]);
  useEffect(() => {
    if (data) {
      onUnread(data.unread);
      setCounts(data.counts);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = (unread) => {
    if (typeof unread === 'number') onUnread(unread);
    reload();
  };
  const choose = (v) => {
    setFilter(v);
    setPage(1);
    setOpenId(null);
  };
  const options = MESSAGE_FILTERS.map(([value, label]) => ({
    value,
    label: (
      <>
        {t(label)}
        {counts && (
          <span className={`seg-count${value === 'unread' && counts.unread > 0 ? ' hot' : ''}`} aria-label={`${counts[value]} ${label.toLowerCase()}`}>
            {counts[value]}
          </span>
        )}
      </>
    ),
  }));
  const empty =
    q !== ''
      ? { title: t('Nothing found'), text: filter === 'unread' ? t('No unread message matches “{q}”.', { q }) : filter === 'archived' ? t('No archived message matches “{q}”.', { q }) : t('No message matches “{q}”.', { q }) }
      : filter === 'unread'
        ? { title: t('Nothing waiting'), text: t('Every message has been read.') }
        : filter === 'archived'
          ? { title: t('Nothing archived'), text: t('Archived messages are kept here until they are a year old.') }
          : { title: t('No messages'), text: t('Nobody has written through the contact form yet.') };
  return (
    <>
      <div className="admin-filters msg-filters">
        <Segmented value={filter} onChange={choose} options={options} label={t('Show messages')} />
        <label className="admin-search">
          <Icon name="search" size={16} />
          <span className="sr-only">{t('Search messages')}</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Search name, e-mail or words')} autoComplete="off" />
        </label>
      </div>
      <p className="muted small msg-note">{t('What people wrote through the contact form. Kept for a year, then deleted. Open a message to answer it by e-mail; the writer is not told anything automatically.')}</p>
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.messages.length === 0 ? (
        <section className="card">
          <Empty title={empty.title} icon={q ? 'search' : 'mail'}>
            {empty.text}
            {filter !== 'all' && data.counts.all > 0 && (
              <>
                {' '}
                <button className="btn sm" onClick={() => choose('all')}>
                  {t('Show all {all}', { all: data.counts.all })}
                </button>
              </>
            )}
          </Empty>
        </section>
      ) : (
        <>
          <section className="card">
            <ul className="msg-list">
              {data.messages.map((m) => (
                <MessageItem key={m.id} m={m} inbox={data.replies_by_email} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} onChange={changed} onCount={onUnread} />
              ))}
            </ul>
          </section>
          <Pager page={data.page} pages={data.pages} total={data.total} size={data.page_size} onPage={setPage} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// System
// ------------------------------------------------------------------------------------------------------------------------
function System() {
  const { data, error } = useFetch(() => api.get('/admin/system'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const backup = backupLine(data.backups, whenText);
  const m = data.mail;
  return (
    <div className="admin-system">
      <section className="card">
        <div className="card-head">
          <h2>{t('Database')}</h2>
          <span className="badge ok">{t('Working')}</span>
        </div>
        <p>
          <strong className="num">{formatBytes(data.database.bytes)}</strong> <span className="muted">{tn(data.database.connections, '· {n} connection', '· {n} connections')}</span>
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('Biggest tables')}</th>
              <th className="r">{t('Rows')}</th>
              <th className="r">{t('Size')}</th>
            </tr>
          </thead>
          <tbody>
            {data.database.tables.map((tt) => (
              <tr key={tt.name}>
                <td>{tt.name}</td>
                <td className="r num">{Math.max(0, Math.round(tt.rows)).toLocaleString(localeOf())}</td>
                <td className="r num">{formatBytes(tt.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Penny')}</h2>
        </div>
        <dl className="admin-facts">
          <div><dt>{t('Version')}</dt><dd>{data.app.version ?? t('unknown')}</dd></div>
          <div><dt>{t('Running for')}</dt><dd>{uptimeText(data.app.uptime_seconds)}</dd></div>
          <div><dt>{t('Sign-ups')}</dt><dd>{data.app.signups_open ? <span className="badge ok">{t('open')}</span> : <span className="badge tone-warn">{t('closed')}</span>}</dd></div>
          <div><dt>{t('Memory')}</dt><dd>{formatBytes(data.app.memory_bytes)}</dd></div>
          <div><dt>{t('Node')}</dt><dd>{data.app.node}</dd></div>
        </dl>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Backups')}</h2>
          <span className={`badge ${backup.tone === 'ok' ? 'ok' : backup.tone === 'warn' ? 'tone-warn' : ''}`}>{backup.tone === 'ok' ? t('On') : backup.tone === 'warn' ? t('Check') : t('Off')}</span>
        </div>
        <p className={`backup-line ${backup.tone}`} role={backup.tone === 'warn' ? 'alert' : undefined}>
          {backup.text}
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('E-mail')}</h2>
          <span className={`badge ${m.mode === 'smtp' ? 'ok' : 'tone-warn'}`}>{m.mode === 'smtp' ? t('Real mail server') : t('Preview only')}</span>
        </div>
        {m.mode !== 'smtp' && <p className="muted small">{t('No mail server is set, so e-mails are only saved in a folder and nobody receives them.')}</p>}
        <p className="small">
          {t('Replies by e-mail:')}{' '}
          {m.replies_by_email ? (
            <>
              <span className="badge ok">{t('on')}</span> <span className="muted">{t('written to {replies_by_email} come back into Messages', { replies_by_email: m.replies_by_email })}</span>
            </>
          ) : (
            <>
              <span className="badge">{t('off')}</span> <span className="muted">{t('answers to messages ask for the reply to go to the admin\'s own mailbox')}</span>
            </>
          )}
        </p>
        <p>
          <strong className="num">{m.sent_24h}</strong> <span className="muted">{t('sent in 24 hours')}</span> · <strong className="num">{m.failed_24h}</strong> <span className="muted">{t('failed')}</span>
        </p>
        {m.recent_failures.length > 0 && (
          <ul className="admin-failures">
            {m.recent_failures.map((f, i) => (
              <li key={i}>
                <span className="muted small">{agoText(f.created_at)} · {f.kind} · {f.to_email}</span>
                <span className="small">{f.error}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
export default function Admin() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview';
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (user?.is_admin) api.get('/admin/messages/unread').then((r) => setUnread(r.unread)).catch(() => {});
  }, [user?.is_admin]);
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('Admin')}</h1>
          <p className="muted">{t('How Penny is doing and who is using it.')}</p>
        </div>
      </header>
      <div className="banner info admin-privacy">
        <Icon name="shield" />
        <div>
          {tRich('This dashboard shows accounts and how the service is running, never payments, amounts, debts or notes. The only way to see someone\'s money is {bold} on a person: it needs a reason and your password, lasts 30 minutes, is read-only unless you allow changes, is logged, and tells the person.', { bold: <strong>{t('View as')}</strong> })}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={t('Admin sections')}>
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" id={`adm-${id}`} aria-selected={tab === id} aria-controls="adm-panel" className={tab === id ? 'active' : ''} onClick={() => setParams(id === 'overview' ? {} : { tab: id }, { replace: true })}>
            <Icon name={icon} size={16} /> {t(label)}
            {id === 'messages' && unread > 0 && <span className="tab-count" aria-label={t('{unread} unread', { unread })}>{unread}</span>}
          </button>
        ))}
      </div>
      <div id="adm-panel" role="tabpanel" aria-labelledby={`adm-${tab}`} className="tab-panel">
        {tab === 'overview' && <Overview />}
        {tab === 'people' && <People />}
        {tab === 'messages' && <Messages onUnread={setUnread} />}
        {tab === 'activity' && <Activity />}
        {tab === 'system' && <System />}
      </div>
    </>
  );
}
