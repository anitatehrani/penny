import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Select from '../components/ds/Select.jsx';
import { Field, Icon } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { LegalShell } from './Legal.jsx';

/**
 * The contact form (docs/DESIGN.md section 38). Public: it works signed in or out. A signed-in person gets their name and address filled in,
 * and the message is tied to their account on the server. The extra field called "website" is hidden from people and only ever filled in by
 * programs (the server throws such messages away). Nothing is mailed back to the writer automatically.
 */
export const TOPICS = [
  { value: 'question', label: 'A question' },
  { value: 'problem', label: 'Something is wrong' },
  { value: 'idea', label: 'An idea' },
  { value: 'account', label: 'My data or my account' },
  { value: 'other', label: 'Something else' },
];
const MAX = 4000;
const MIN = 10;

export default function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '', topic: 'question', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const left = MAX - form.message.length;
  const ready = form.name.trim() && form.email.trim() && form.message.trim().length >= MIN && !busy;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/contact', form);
      setSent(true);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <LegalShell which="contact" title="Thank you">
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>
            Your message is sent. If it needs an answer, it will come by e-mail to <strong>{form.email.trim().toLowerCase()}</strong>. That can take a few days, and the reply may land in spam.
          </div>
        </div>
        <p>
          <Link to="/">{user ? 'Back to Penny' : 'Back to the home page'}</Link>
        </p>
      </LegalShell>
    );
  }

  return (
    <LegalShell which="contact" title="Contact us">
      <p className="legal-lead">A question, something that is not working, an idea, or a request about your data or account. Write here and the person who runs Penny will read it.</p>
      <form onSubmit={submit} className="form contact-form" noValidate>
        {error && (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div>{error.message}</div>
          </div>
        )}
        <div className="contact-row">
          <Field label="Your name">
            <input value={form.name} onChange={set('name')} autoComplete="name" maxLength={80} required />
          </Field>
          <Field label="Your e-mail" hint="So there is somewhere to send the answer.">
            <input type="email" value={form.email} onChange={set('email')} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254} required />
          </Field>
        </div>
        <Select label="What is it about?" value={form.topic} onChange={(v) => setForm((f) => ({ ...f, topic: v }))} options={TOPICS} />
        <Field label="Your message" hint={left < 200 ? `${left} characters left` : `At least ${MIN} characters.`}>
          <textarea value={form.message} onChange={set('message')} rows={7} maxLength={MAX} required />
        </Field>
        {/* the trap: people never see or reach this field, programs fill every field they find */}
        <div className="contact-trap" aria-hidden="true">
          <label>
            Leave this empty
            <input name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <button className="btn primary" disabled={!ready}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
        <p className="muted small">
          Please do not send passwords or card numbers. What you write is kept for a year; see the <Link to="/privacy">privacy policy</Link>.
        </p>
      </form>
    </LegalShell>
  );
}
