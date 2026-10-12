import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Select from '../components/ds/Select.jsx';
import { Avatar, Empty, ErrorBox, Field, Icon, Loading, Modal } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { dateLabel } from '../format.js';
import { SHARED_AI_NOTICE, useAiStatus } from '../assistant/AiAnswers.jsx';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { N_, t, tn } from '../i18n/translate.js';

export const RELATIONS = [
  ['partner', N_('Partner')],
  ['family', N_('Family member')],
  ['friend', N_('Friend')],
  ['other', N_('Other')],
];
export const relationLabel = (r) => t(RELATIONS.find(([v]) => v === r)?.[1] ?? r);
const theirRole = (r) => ({ partner: t('says you are their partner'), family: t('says you are their family member'), friend: t('says you are their friend') })[r] ?? t('says you are connected with them');

export function RelationSelect({ value, onChange, label = t('Relationship') }) {
  return (
    <span className="relation-select">
      <Select variant="inline" label={label} value={value} onChange={onChange} options={RELATIONS.map(([v, l]) => ({ value: v, label: t(l) }))} />
    </span>
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
      notify(res.status === 'connected' ? t('You are now connected with {name}', { name: state.result.name }) : t('Request sent to {name}', { name: state.result.name }));
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
        <h2>{t('Find someone')}</h2>
      </div>
      <form onSubmit={search} className="find-form">
        <div className="search-input">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('@username, email address or phone number (+49…)')}
            aria-label={t('Find by username, email or phone')}
            maxLength={120}
          />
        </div>
        <button className="btn primary" disabled={busy || !q.trim()}>
          {t('Search')}
        </button>
      </form>
      <p className="field-hint">{t('Enter the full username, email or phone number. People can choose to hide themselves from search.')}</p>

      {state && !r && (
        <div className="banner info find-result">
          <Icon name="alert" />
          <div>{state.hint ?? t('No one matches “{searched}”. Check the spelling — or they may have hidden their profile from search.', { searched: state.searched })}</div>
        </div>
      )}
      {r && (
        <div className="find-result">
          <Person user={r}>
            {r.connection?.status === 'connected' && <span className="badge accent">{t('Connected · {relationLabel}', { relationLabel: relationLabel(r.connection.relation) })}</span>}
            {r.connection?.status === 'request_sent' && <span className="badge">{t('Request sent')}</span>}
            {r.connection?.status === 'request_received' && (
              <>
                <span className="badge accent">{t('Wants to connect')}</span>
                <RelationSelect value={relation} onChange={setRelation} />
                <button className="btn primary sm" onClick={send}>
                  {t('Accept')}
                </button>
              </>
            )}
            {!r.connection && (
              <>
                <RelationSelect value={relation} onChange={setRelation} label={t('They are my…')} />
                <button className="btn primary sm" onClick={send}>
                  <Icon name="plus" size={14} /> {t('Send request')}
                </button>
              </>
            )}
          </Person>
          <p className="field-hint">{t('Check the name and @username before you send a request: phone numbers and emails are not verified.')}</p>
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
            <h2>{t('Requests for you ({length})', { length: data.incoming.length })}</h2>
          </div>
          {data.incoming.map((c) => (
            <Person key={c.id} user={c.user} sub={theirRole(c.relation)}>
              <RelationSelect value={acceptRel[c.id] ?? c.relation} onChange={(v) => setAcceptRel((s) => ({ ...s, [c.id]: v }))} label={t('They are my…')} />
              <button className="btn primary sm" onClick={() => run(() => api.post(`/connections/${c.id}/accept`, { relation: acceptRel[c.id] ?? c.relation }), t('Connected with {name}', { name: c.user.name }))}>
                {t('Accept')}
              </button>
              <button className="btn sm" onClick={() => run(() => api.post(`/connections/${c.id}/decline`), t('Request declined'))}>
                {t('Decline')}
              </button>
            </Person>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{t('Your people')}</h2>
        </div>
        {data.accepted.length === 0 ? (
          <Empty title={t('No one yet')}>{t('Find your partner, family or friends above. Once they accept you can add them to payments and invite them to a shared budget.')}</Empty>
        ) : (
          data.accepted.map((c) => (
            <Person key={c.id} user={c.user}>
              <RelationSelect value={c.relation} onChange={(v) => run(() => api.put(`/connections/${c.id}`, { relation: v }))} />
              <button
                className="btn icon ghost danger-hover"
                aria-label={t('Remove {name}', { name: c.user.name })}
                title={t('Remove connection')}
                onClick={() => window.confirm(t('Remove {name}? You will stop sharing payments with each other.', { name: c.user.name })) && run(() => api.del(`/connections/${c.id}`), t('Connection removed'))}
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
            <h2>{t('Waiting for a reply')}</h2>
          </div>
          {data.outgoing.map((c) => (
            <Person key={c.id} user={c.user} sub={relationLabel(c.relation)}>
              <button className="btn sm" onClick={() => run(() => api.del(`/connections/${c.id}`), t('Request cancelled'))}>
                {t('Cancel request')}
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
  const aiSite = useAiStatus(null).status?.configured === true; // the AI service exists on this site: say so, and record the agreement
  const [name, setName] = useState('');
  const [invite, setInvite] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const ws = await api.post('/workspaces', { name, ...(aiSite ? { ai: true } : {}) });
      const chosen = Object.keys(invite).filter((u) => invite[u]);
      const failed = [];
      for (const username of chosen) {
        try {
          await api.post(`/workspaces/${ws.id}/invites`, { username });
        } catch {
          failed.push(username);
        }
      }
      notify(chosen.length ? t('Group created and {value} invitation(s) sent', { value: chosen.length - failed.length }) : t('Group created'));
      onCreated(ws);
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <p className="muted">
        {t('A shared budget has one combined balance. Everyone in it adds their income and the payments you make together, so you always see what the household has.')}
      </p>
      <Field label={t('Name of the group')} hint={t('For example: Home, Our family, Trip to Rome')}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
      </Field>
      <div className="field">
        <span className="field-label">{t('Invite people (they must accept)')}</span>
        {connections.length === 0 ? (
          <span className="field-hint">{t('You have no connections yet. Add people first, then you can invite them.')}</span>
        ) : (
          connections.map((c) => (
            <label key={c.id} className="check pick">
              <input type="checkbox" checked={!!invite[c.user.username]} onChange={(e) => setInvite((s) => ({ ...s, [c.user.username]: e.target.checked }))} />
              <Avatar user={c.user} size={24} /> {c.user.name} <span className="muted small">{relationLabel(c.relation)}</span>
            </label>
          ))
        )}
      </div>
      {aiSite && <p className="muted small">{t(SHARED_AI_NOTICE)}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="btn primary" disabled={busy || !name.trim()}>
          {t('Create group')}
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
          <span className="muted small">{group.members.length} {group.members.length === 1 ? t('person') : t('people')} · {isOwner ? t('you own this group') : t('you are a member')}</span>
        </div>
        {current.id === group.id ? (
          <span className="badge accent">{t('Open now')}</span>
        ) : (
          <button className="btn sm primary" onClick={() => switchTo(group.id)}>
            {t('Open')}
          </button>
        )}
      </div>

      <div className="members">
        {group.members.map((m) => (
          <Person key={m.username} user={m} sub={m.role === 'owner' ? t('Owner') : t('Member')}>
            {m.username === user.username && <span className="badge">{t('You')}</span>}
            {isOwner && m.username !== user.username && (
              <>
                <button className="btn sm" onClick={() => window.confirm(t('Make {name} the owner? You will become a regular member.', { name: m.name })) && run(() => api.post(`/workspaces/${group.id}/transfer`, { username: m.username }), t('Ownership transferred'))}>
                  {t('Make owner')}
                </button>
                <button className="btn sm" onClick={() => window.confirm(t('Remove {name} from {name2}?', { name: m.name, name2: group.name })) && run(() => api.del(`/workspaces/${group.id}/members/${m.username}`), t('{name} removed', { name: m.name }))}>
                  {t('Remove')}
                </button>
              </>
            )}
          </Person>
        ))}
        {(invites.data ?? []).map((i) => (
          <Person key={i.id} user={i.user} sub={t('invited — waiting for a reply')}>
            <button className="btn sm" onClick={() => run(() => api.del(`/workspace-invites/${i.id}`), t('Invitation cancelled'))}>
              {t('Cancel')}
            </button>
          </Person>
        ))}
      </div>

      {isOwner && (
        <form
          className="invite-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) run(() => api.post(`/workspaces/${group.id}/invites`, { username: pick }), t('Invitation sent')).then(() => setPick(''));
          }}
        >
          <Select
            label={t('Invite a connection')}
            value={pick}
            onChange={setPick}
            options={[
              { value: '', label: invitable.length ? t('Invite someone you are connected with…') : t('No one left to invite') },
              ...invitable.map((c) => ({ value: c.user.username, label: `${c.user.name} (@${c.user.username})`, person: c.user })),
            ]}
          />
          <button className="btn sm primary" disabled={!pick}>
            {t('Send invitation')}
          </button>
        </form>
      )}

      <div className="group-foot">
        {isOwner && (
          <button
            className="btn sm"
            onClick={() => {
              const name = window.prompt(t('New name for the group'), group.name);
              if (name?.trim()) run(() => api.put(`/workspaces/${group.id}`, { name: name.trim() }), t('Group renamed'));
            }}
          >
            <Icon name="edit" size={14} /> {t('Rename')}
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => window.confirm(t('Leave {name}? You will lose access to its budget.', { name: group.name })) && run(() => api.post(`/workspaces/${group.id}/leave`), t('You left the group'))}
        >
          {t('Leave group')}
        </button>
        {isOwner && (
          <button
            className="btn sm danger-outline"
            onClick={() => {
              const typed = window.prompt(t('This deletes {name} and ALL its payments for everyone. Type the group name to confirm.', { name: group.name }));
              if (typed === group.name) run(() => api.del(`/workspaces/${group.id}`), t('Group deleted'));
              else if (typed !== null) notify(t('The name did not match, nothing was deleted.'), 'error');
            }}
          >
            <Icon name="trash" size={14} /> {t('Delete group')}
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
  const aiSite = useAiStatus(null).status?.configured === true;

  const refresh = () => {
    reloadSpaces();
    reloadInbox();
    conns.reload();
  };

  async function respond(invite, accept) {
    try {
      if (accept) {
        const res = await api.post(`/workspace-invites/${invite.id}/accept`, aiSite ? { ai: true } : {});
        notify(t('You joined {name}', { name: invite.workspace.name }));
        refresh();
        switchTo(res.workspace_id);
      } else {
        await api.post(`/workspace-invites/${invite.id}/decline`);
        notify(t('Invitation declined'));
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
          <h2>{t('Shared budgets')}</h2>
          <p className="muted">{t('Pool your income with a partner or family and pay everything from one combined balance. Each person keeps their own private budget too — switch between them from the top of the sidebar.')}</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> {t('New group')}
        </button>
      </section>

      {inbox.group_invites.length > 0 && (
        <section className="card highlight">
          <div className="card-head">
            <h2>{t('Group invitations ({length})', { length: inbox.group_invites.length })}</h2>
          </div>
          {aiSite && <p className="muted small">{t(SHARED_AI_NOTICE)}</p>}
          {inbox.group_invites.map((i) => (
            <Person key={i.id} user={i.inviter} sub={tn(i.workspace.member_count, 'invites you to “{name}” · {n} person so far', 'invites you to “{name}” · {n} people so far', { name: i.workspace.name })}>
              <button className="btn primary sm" onClick={() => respond(i, true)}>
                {t('Join')}
              </button>
              <button className="btn sm" onClick={() => respond(i, false)}>
                {t('Decline')}
              </button>
            </Person>
          ))}
        </section>
      )}

      {groups.length === 0 ? (
        <section className="card">
          <Empty title={t('No shared budgets yet')}>{t('Create a group, invite your partner and start tracking your household money together.')}</Empty>
        </section>
      ) : (
        groups.map((g) => <GroupCard key={g.id} group={g} connections={conns.data?.accepted ?? []} onChanged={refresh} />)
      )}

      {creating && (
        <Modal title={t('New shared budget')} onClose={() => setCreating(false)}>
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
      notify(current.kind === 'group' ? t('Added {money} to {name}', { money: money(item.my_share), name: current.name }) : t('Added {money} to your personal budget', { money: money(item.my_share) }));
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
          <h2>{t('Shared with me')}</h2>
          <p className="muted small">{t('Payments your connections added you to. Add your share to the budget you have open.')}</p>
        </div>
      </div>
      {data.length === 0 ? (
        <Empty title={t('Nothing shared with you yet')}>{t('When a connection adds you to one of their payments, it shows up here.')}</Empty>
      ) : (
        <div className="tx-list">
          {data.map((s) => (
            <div key={s.id} className="tx-row shared">
              <div className="tx-date">
                <strong>{dateLabel(s.date)}</strong>
                <span className="muted">{s.status === 'paid' ? t('paid') : t('pending')}</span>
              </div>
              <div className="tx-main">
                <div className="tx-title">{s.description}</div>
                <span className="muted small">
                  <Avatar user={s.shared_by} size={16} /> {t('{name} · total {money}', { name: s.shared_by.name, money: money(s.amount) })}
                </span>
              </div>
              <div className="tx-amount num">
                {s.type === 'income' ? '+' : '−'}
                {money(s.my_share)}
                <span className="muted small block">{t('your share')}</span>
              </div>
              <div className="tx-actions">
                {s.imported ? (
                  <span className="badge accent">{t('Added')}</span>
                ) : s.my_share > 0 ? (
                  <button className="btn sm primary-soft" onClick={() => add(s)}>
                    <Icon name="plus" size={14} /> {t('Add to')} {current.kind === 'group' ? current.name : t('my budget')}
                  </button>
                ) : (
                  <span className="badge">{t('No share')}</span>
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
  ['connections', N_('People'), 'user'],
  ['groups', N_('Groups'), 'users'],
  ['shared', N_('Shared with me'), 'share'],
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
          <h1>{t('People & groups')}</h1>
          <p className="muted">{t('Connect with your partner, family and friends, share payments and run a shared budget together.')}</p>
        </div>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label, icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setParams({ tab: key }, { replace: true })}>
            <Icon name={icon} size={16} /> {t(label)}
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
