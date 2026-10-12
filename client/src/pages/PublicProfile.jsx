import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, ErrorBox, Icon, Loading } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { useFetch } from '../hooks.js';
import { useWorkspace } from '../workspace.jsx';
import { RelationSelect, relationLabel } from './People.jsx';
import { t } from '../i18n/translate.js';

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
          <strong>{t('Profile not found')}</strong>
          <p>{t('This profile does not exist, or its owner has hidden it.')}</p>
          <Link className="btn" to="/people">
            {t('Back to People')}
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
      notify(res.status === 'connected' ? t('You are now connected with {name}', { name: p.name }) : t('Request sent to {name}', { name: p.name }));
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
          <p className="muted">{t('This is how others see your profile.')}</p>
          <Link className="btn" to="/profile">
            <Icon name="edit" size={16} /> {t('Edit profile')}
          </Link>
        </>
      ) : p.connection?.status === 'connected' ? (
        <span className="badge accent">{t('Connected · {relationLabel}', { relationLabel: relationLabel(p.connection.relation) })}</span>
      ) : p.connection?.status === 'request_sent' ? (
        <span className="badge">{t('Request sent — waiting for {value} to accept', { value: p.name.split(' ')[0] })}</span>
      ) : (
        <div className="profile-actions">
          {p.connection?.status === 'request_received' && <span className="badge accent">{t('Wants to connect with you')}</span>}
          <label className="inline-select">
            {p.connection?.status === 'request_received' ? t('They are my') : t('They are my')}
            <RelationSelect value={relation} onChange={setRelation} />
          </label>
          <button className="btn primary" onClick={send}>
            <Icon name="plus" size={16} /> {p.connection?.status === 'request_received' ? t('Accept') : t('Send connection request')}
          </button>
          <p className="field-hint">{t('Make sure this is the person you mean. Phone numbers and emails are not verified.')}</p>
        </div>
      )}
    </section>
  );
}
