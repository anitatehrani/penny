import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, ErrorBox, Icon, Loading } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { RelationSelect, relationLabel } from './People.jsx';

/** Where a shared profile link (/u/username) lands. */
export default function PublicProfile() {
  const { username } = useParams();
  const { notify } = useApp();
  const { reloadInbox } = useWorkspace();
  const { data, error, reload } = useFetch(() => api.get(`/people/${encodeURIComponent(username)}`), [username]);
  const [relation, setRelation] = useState('friend');

  if (error) {
    return (
      <section className="card">
        <div className="empty">
          <strong>Profile not found</strong>
          <p>This profile does not exist, or its owner has hidden it.</p>
          <Link className="btn" to="/people">
            Back to People
          </Link>
        </div>
      </section>
    );
  }
  if (!data) return <Loading />;
  const p = data.profile;

  async function send() {
    try {
      const res = await api.post('/connections', { username: p.username, relation });
      notify(res.status === 'connected' ? `You are now connected with ${p.name}` : `Request sent to ${p.name}`);
      reload();
      reloadInbox();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <section className="card profile-card">
      <Avatar user={p} size={88} />
      <h1>{p.name}</h1>
      <div className="muted">@{p.username}</div>
      {p.self ? (
        <>
          <p className="muted">This is how others see your profile.</p>
          <Link className="btn" to="/profile">
            <Icon name="edit" size={16} /> Edit profile
          </Link>
        </>
      ) : p.connection?.status === 'connected' ? (
        <span className="badge accent">Connected · {relationLabel(p.connection.relation)}</span>
      ) : p.connection?.status === 'request_sent' ? (
        <span className="badge">Request sent — waiting for {p.name.split(' ')[0]} to accept</span>
      ) : (
        <div className="profile-actions">
          {p.connection?.status === 'request_received' && <span className="badge accent">Wants to connect with you</span>}
          <label className="inline-select">
            {p.connection?.status === 'request_received' ? 'They are my' : 'They are my'}
            <RelationSelect value={relation} onChange={setRelation} />
          </label>
          <button className="btn primary" onClick={send}>
            <Icon name="plus" size={16} /> {p.connection?.status === 'request_received' ? 'Accept' : 'Send connection request'}
          </button>
          <p className="field-hint">Make sure this is the person you mean. Phone numbers and emails are not verified.</p>
        </div>
      )}
    </section>
  );
}
