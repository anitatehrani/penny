import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, Empty, ErrorBox, Field, Icon, Loading, Modal } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLabel } from '../format.js';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';

export const RELATIONS = [
  ['partner', 'Partner'],
  ['family', 'Family member'],
  ['friend', 'Friend'],
  ['other', 'Other'],
];
export const relationLabel = (r) => RELATIONS.find(([v]) => v === r)?.[1] ?? r;

export function RelationSelect({ value, onChange, label = 'Relationship' }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="relation-select">
      {RELATIONS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Person({ user, sub, children }) {
  return (
    <div className="person">
      <Avatar user={user} size={40} />
      <div className="person-text">
        <strong>{user.name}</strong>
        <span className="muted small">
          @{user.username}
          {sub ? ` · ${sub}` : ''}
        </span>
      </div>
      <div className="person-actions">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ people */

function FindPerson({ onChanged }) {
  const { notify } = useApp();
  const [q, setQ] = useState('');
  const [state, setState] = useState(null); // {result, hint, searched}
  const [relation, setRelation] = useState('friend');
  const [busy, setBusy] = useState(false);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await api.get(`/people/lookup?q=${encodeURIComponent(q.trim())}`);
      setState({ ...res, searched: q.trim() });
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  }

  async function send() {
    try {
      const res = await api.post('/connections', { username: state.result.username, relation });
      notify(res.status === 'connected' ? `You are now connected with ${state.result.name}` : `Request sent to ${state.result.name}`);
      setState(null);
      setQ('');
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const r = state?.result;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Find someone</h2>
      </div>
      <form onSubmit={search} className="find-form">
        <div className="search-input">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="@username, email address or phone number (+49…)"
            aria-label="Find by username, email or phone"
            maxLength={120}
          />
        </div>
        <button className="btn primary" disabled={busy || !q.trim()}>
          Search
        </button>
      </form>
      <p className="field-hint">Enter the full username, email or phone number. People can choose to hide themselves from search.</p>

      {state && !r && (
        <div className="banner info find-result">
          <Icon name="alert" />
          <div>{state.hint ?? `No one matches “${state.searched}”. Check the spelling — or they may have hidden their profile from search.`}</div>
        </div>
      )}
      {r && (
        <div className="find-result">
          <Person user={r}>
            {r.connection?.status === 'connected' && <span className="badge accent">Connected · {relationLabel(r.connection.relation)}</span>}
            {r.connection?.status === 'request_sent' && <span className="badge">Request sent</span>}
            {r.connection?.status === 'request_received' && (
              <>
                <span className="badge accent">Wants to connect</span>
                <RelationSelect value={relation} onChange={setRelation} />
                <button className="btn primary sm" onClick={send}>
                  Accept
                </button>
              </>
            )}
            {!r.connection && (
              <>
                <RelationSelect value={relation} onChange={setRelation} label="They are my…" />
                <button className="btn primary sm" onClick={send}>
                  <Icon name="plus" size={14} /> Send request
                </button>
              </>
            )}
          </Person>
          <p className="field-hint">Check the name and @username before you send a request: phone numbers and emails are not verified.</p>
        </div>
      )}
    </section>
  );
}

function ConnectionsTab() {
  const { notify } = useApp();
  const { reloadInbox } = useWorkspace();
  const { data, error, reload } = useFetch(() => api.get('/connections'), []);
  const [acceptRel, setAcceptRel] = useState({});

  const changed = () => {
    reload();
    reloadInbox();
  };
  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) notify(okMsg);
      changed();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <FindPerson onChanged={changed} />

      {data.incoming.length > 0 && (
        <section className="card highlight">
          <div className="card-head">
            <h2>Requests for you ({data.incoming.length})</h2>
          </div>
          {data.incoming.map((c) => (
            <Person key={c.id} user={c.user} sub={`says you are their ${relationLabel(c.relation).toLowerCase()}`}>
              <RelationSelect value={acceptRel[c.id] ?? c.relation} onChange={(v) => setAcceptRel((s) => ({ ...s, [c.id]: v }))} label="They are my…" />
              <button className="btn primary sm" onClick={() => run(() => api.post(`/connections/${c.id}/accept`, { relation: acceptRel[c.id] ?? c.relation }), `Connected with ${c.user.name}`)}>
                Accept
              </button>
              <button className="btn sm" onClick={() => run(() => api.post(`/connections/${c.id}/decline`), 'Request declined')}>
                Decline
              </button>
            </Person>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Your people</h2>
        </div>
        {data.accepted.length === 0 ? (
          <Empty title="No one yet">Find your partner, family or friends above. Once they accept you can add them to payments and invite them to a shared budget.</Empty>
        ) : (
          data.accepted.map((c) => (
            <Person key={c.id} user={c.user}>
              <RelationSelect value={c.relation} onChange={(v) => run(() => api.put(`/connections/${c.id}`, { relation: v }))} />
              <button
                className="btn icon ghost danger-hover"
                aria-label={`Remove ${c.user.name}`}
                title="Remove connection"
                onClick={() => window.confirm(`Remove ${c.user.name}? You will stop sharing payments with each other.`) && run(() => api.del(`/connections/${c.id}`), 'Connection removed')}
              >
                <Icon name="trash" />
              </button>
            </Person>
          ))
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Waiting for a reply</h2>
          </div>
          {data.outgoing.map((c) => (
            <Person key={c.id} user={c.user} sub={relationLabel(c.relation)}>
              <button className="btn sm" onClick={() => run(() => api.del(`/connections/${c.id}`), 'Request cancelled')}>
                Cancel request
              </button>
            </Person>
          ))}
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ groups */

function CreateGroup({ connections, onClose, onCreated }) {
  const { notify } = useApp();
  const [name, setName] = useState('');
  const [invite, setInvite] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const ws = await api.post('/workspaces', { name });
      const chosen = Object.keys(invite).filter((u) => invite[u]);
      const failed = [];
      for (const username of chosen) {
        try {
          await api.post(`/workspaces/${ws.id}/invites`, { username });
        } catch {
          failed.push(username);
        }
      }
      notify(chosen.length ? `Group created and ${chosen.length - failed.length} invitation(s) sent` : 'Group created');
      onCreated(ws);
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <p className="muted">
        A shared budget has one combined balance. Everyone in it adds their income and the payments you make together, so you always see what the household has.
      </p>
      <Field label="Name of the group" hint="For example: Home, Our family, Trip to Rome">
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
      </Field>
      <div className="field">
        <span className="field-label">Invite people (they must accept)</span>
        {connections.length === 0 ? (
          <span className="field-hint">You have no connections yet. Add people first, then you can invite them.</span>
        ) : (
          connections.map((c) => (
            <label key={c.id} className="check pick">
              <input type="checkbox" checked={!!invite[c.user.username]} onChange={(e) => setInvite((s) => ({ ...s, [c.user.username]: e.target.checked }))} />
              <Avatar user={c.user} size={24} /> {c.user.name} <span className="muted small">{relationLabel(c.relation)}</span>
            </label>
          ))
        )}
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !name.trim()}>
          Create group
        </button>
      </div>
    </form>
  );
}

function GroupCard({ group, connections, onChanged }) {
  const { notify } = useApp();
  const { user } = useAuth();
  const { switchTo, current } = useWorkspace();
  const isOwner = group.role === 'owner';
  const invites = useFetch(() => (isOwner ? api.get(`/workspaces/${group.id}/invites`) : Promise.resolve([])), [group.id, group.members.length]);
  const [pick, setPick] = useState('');

  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) notify(okMsg);
      invites.reload();
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const memberNames = new Set(group.members.map((m) => m.username));
  const pending = new Set((invites.data ?? []).map((i) => i.user.username));
  const invitable = connections.filter((c) => !memberNames.has(c.user.username) && !pending.has(c.user.username));

  return (
    <section className={`card group-card${current.id === group.id ? ' current' : ''}`}>
      <div className="card-head">
        <div>
          <h2>{group.name}</h2>
          <span className="muted small">{group.members.length} {group.members.length === 1 ? 'person' : 'people'} · {isOwner ? 'you own this group' : 'you are a member'}</span>
        </div>
        {current.id === group.id ? (
          <span className="badge accent">Open now</span>
        ) : (
          <button className="btn sm primary" onClick={() => switchTo(group.id)}>
            Open
          </button>
        )}
      </div>

      <div className="members">
        {group.members.map((m) => (
          <Person key={m.username} user={m} sub={m.role === 'owner' ? 'Owner' : 'Member'}>
            {m.username === user.username && <span className="badge">You</span>}
            {isOwner && m.username !== user.username && (
              <>
                <button className="btn sm" onClick={() => window.confirm(`Make ${m.name} the owner? You will become a regular member.`) && run(() => api.post(`/workspaces/${group.id}/transfer`, { username: m.username }), 'Ownership transferred')}>
                  Make owner
                </button>
                <button className="btn sm" onClick={() => window.confirm(`Remove ${m.name} from ${group.name}?`) && run(() => api.del(`/workspaces/${group.id}/members/${m.username}`), `${m.name} removed`)}>
                  Remove
                </button>
              </>
            )}
          </Person>
        ))}
        {(invites.data ?? []).map((i) => (
          <Person key={i.id} user={i.user} sub="invited — waiting for a reply">
            <button className="btn sm" onClick={() => run(() => api.del(`/workspace-invites/${i.id}`), 'Invitation cancelled')}>
              Cancel
            </button>
          </Person>
        ))}
      </div>

      {isOwner && (
        <form
          className="invite-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) run(() => api.post(`/workspaces/${group.id}/invites`, { username: pick }), 'Invitation sent').then(() => setPick(''));
          }}
        >
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Invite a connection">
            <option value="">{invitable.length ? 'Invite someone you are connected with…' : 'No one left to invite'}</option>
            {invitable.map((c) => (
              <option key={c.id} value={c.user.username}>
                {c.user.name} (@{c.user.username})
              </option>
            ))}
          </select>
          <button className="btn sm primary" disabled={!pick}>
            Send invitation
          </button>
        </form>
      )}

      <div className="group-foot">
        {isOwner && (
          <button
            className="btn sm"
            onClick={() => {
              const name = window.prompt('New name for the group', group.name);
              if (name?.trim()) run(() => api.put(`/workspaces/${group.id}`, { name: name.trim() }), 'Group renamed');
            }}
          >
            <Icon name="edit" size={14} /> Rename
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => window.confirm(`Leave ${group.name}? You will lose access to its budget.`) && run(() => api.post(`/workspaces/${group.id}/leave`), 'You left the group')}
        >
          Leave group
        </button>
        {isOwner && (
          <button
            className="btn sm danger-outline"
            onClick={() => {
              const typed = window.prompt(`This deletes ${group.name} and ALL its payments for everyone. Type the group name to confirm.`);
              if (typed === group.name) run(() => api.del(`/workspaces/${group.id}`), 'Group deleted');
              else if (typed !== null) notify('The name did not match, nothing was deleted.', 'error');
            }}
          >
            <Icon name="trash" size={14} /> Delete group
          </button>
        )}
      </div>
    </section>
  );
}

function GroupsTab() {
  const { notify } = useApp();
  const { spaces, inbox, reloadSpaces, reloadInbox, switchTo } = useWorkspace();
  const conns = useFetch(() => api.get('/connections'), []);
  const [creating, setCreating] = useState(false);
  const groups = spaces.filter((w) => w.kind === 'group');

  const refresh = () => {
    reloadSpaces();
    reloadInbox();
    conns.reload();
  };

  async function respond(invite, accept) {
    try {
      if (accept) {
        const res = await api.post(`/workspace-invites/${invite.id}/accept`);
        notify(`You joined ${invite.workspace.name}`);
        refresh();
        switchTo(res.workspace_id);
      } else {
        await api.post(`/workspace-invites/${invite.id}/decline`);
        notify('Invitation declined');
        refresh();
      }
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <>
      <section className="card intro">
        <div>
          <h2>Shared budgets</h2>
          <p className="muted">Pool your income with a partner or family and pay everything from one combined balance. Each person keeps their own private budget too — switch between them from the top of the sidebar.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> New group
        </button>
      </section>

      {inbox.group_invites.length > 0 && (
        <section className="card highlight">
          <div className="card-head">
            <h2>Group invitations ({inbox.group_invites.length})</h2>
          </div>
          {inbox.group_invites.map((i) => (
            <Person key={i.id} user={i.inviter} sub={`invites you to “${i.workspace.name}” · ${i.workspace.member_count} ${i.workspace.member_count === 1 ? 'person' : 'people'} so far`}>
              <button className="btn primary sm" onClick={() => respond(i, true)}>
                Join
              </button>
              <button className="btn sm" onClick={() => respond(i, false)}>
                Decline
              </button>
            </Person>
          ))}
        </section>
      )}

      {groups.length === 0 ? (
        <section className="card">
          <Empty title="No shared budgets yet">Create a group, invite your partner and start tracking your household money together.</Empty>
        </section>
      ) : (
        groups.map((g) => <GroupCard key={g.id} group={g} connections={conns.data?.accepted ?? []} onChanged={refresh} />)
      )}

      {creating && (
        <Modal title="New shared budget" onClose={() => setCreating(false)}>
          <CreateGroup
            connections={conns.data?.accepted ?? []}
            onClose={() => setCreating(false)}
            onCreated={(ws) => {
              setCreating(false);
              refresh();
              switchTo(ws.id);
            }}
          />
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ shared with me */

function SharedTab() {
  const { money, notify } = useApp();
  const { current, reloadInbox } = useWorkspace();
  const { data, error, reload } = useFetch(() => api.get('/shared'), []);

  async function add(item) {
    try {
      await api.post(`/shared/${item.id}/import`, {});
      notify(`Added ${money(item.my_share)} to ${current.kind === 'group' ? current.name : 'your personal budget'}`);
      reload();
      reloadInbox();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <section className="card flush">
      <div className="card-head pad">
        <div>
          <h2>Shared with me</h2>
          <p className="muted small">Payments your connections added you to. Add your share to the budget you have open.</p>
        </div>
      </div>
      {data.length === 0 ? (
        <Empty title="Nothing shared with you yet">When a connection adds you to one of their payments, it shows up here.</Empty>
      ) : (
        <div className="tx-list">
          {data.map((s) => (
            <div key={s.id} className="tx-row shared">
              <div className="tx-date">
                <strong>{dateLabel(s.date)}</strong>
                <span className="muted">{s.status === 'paid' ? 'paid' : 'pending'}</span>
              </div>
              <div className="tx-main">
                <div className="tx-title">{s.description}</div>
                <span className="muted small">
                  <Avatar user={s.shared_by} size={16} /> {s.shared_by.name} · total {money(s.amount)}
                </span>
              </div>
              <div className="tx-amount num">
                {s.type === 'income' ? '+' : '−'}
                {money(s.my_share)}
                <span className="muted small block">your share</span>
              </div>
              <div className="tx-actions">
                {s.imported ? (
                  <span className="badge accent">Added</span>
                ) : s.my_share > 0 ? (
                  <button className="btn sm primary-soft" onClick={() => add(s)}>
                    <Icon name="plus" size={14} /> Add to {current.kind === 'group' ? current.name : 'my budget'}
                  </button>
                ) : (
                  <span className="badge">No share</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ page */

const TABS = [
  ['connections', 'People', 'user'],
  ['groups', 'Groups', 'users'],
  ['shared', 'Shared with me', 'share'],
];

export default function People() {
  const [params, setParams] = useSearchParams();
  const { inbox, reloadInbox, reloadSpaces } = useWorkspace();
  // Opening this page always shows the latest requests, invitations and group members.
  useEffect(() => {
    reloadInbox();
    reloadSpaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'connections';
  const counts = { connections: inbox.connection_requests.length, groups: inbox.group_invites.length, shared: inbox.shared_waiting };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>People &amp; groups</h1>
          <p className="muted">Connect with your partner, family and friends, share payments and run a shared budget together.</p>
        </div>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label, icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setParams({ tab: key }, { replace: true })}>
            <Icon name={icon} size={16} /> {label}
            {counts[key] > 0 && <span className="tab-badge">{counts[key]}</span>}
          </button>
        ))}
      </div>
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'shared' && <SharedTab />}
    </>
  );
}
