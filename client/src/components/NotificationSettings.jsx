import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { dateLabel, timeAgo } from '../format.js';
import { pushSupported, useNotifications } from '../notifications.jsx';
import EmailStatus from './EmailStatus.jsx';
import Select from './ds/Select.jsx';
import { ErrorBox, Field, Icon, Loading, Switch } from './ui.jsx';

// One row per kind of notification: the in-app switch and the email switch that go with it.
const GROUPS = [
  {
    title: 'Payments',
    rows: [
      { app: 'due_soon', email: 'email_due', label: 'Upcoming payment alerts', hint: 'A reminder before a payment is due (see “Payment reminders” below for how early).' },
      { app: 'overdue', email: 'email_overdue', label: 'Overdue payment alerts', hint: 'A payment is past its date and still not paid.' },
      { app: 'balance_warning', email: 'email_balance', label: 'Low balance alerts', hint: 'Your balance is already below zero.' },
      { app: 'forecast_warning', email: 'email_forecast', label: 'Forecast warnings', hint: 'The forecast shows the balance going negative in a coming month.' },
    ],
  },
  {
    title: 'Assistant and summaries',
    rows: [
      { app: 'ai_insights', email: 'email_ai', label: 'AI financial insights', hint: 'Spending changes, growing subscriptions, a busy week ahead. At most two a day, and never the same one twice.' },
      { app: 'weekly_summary', email: 'email_weekly', label: 'Weekly summary', hint: 'What you spent and what is due, once a week.' },
      { app: 'monthly_summary', email: 'email_monthly', label: 'Monthly summary', hint: 'How the month went, in the first days of the next one.' },
    ],
  },
  {
    title: 'People',
    note: 'Emails for these three share one switch.',
    rows: [
      { app: 'friend_requests', email: 'email_social', label: 'Connection requests', hint: 'Someone wants to connect, or accepts your request.' },
      { app: 'group_invites', email: 'email_social', label: 'Shared budget invitations', hint: 'Invitations and changes to budgets you are in.' },
      { app: 'shared_payments', email: 'email_social', label: 'Payments shared with you', hint: 'Someone adds you to one of their payments.' },
    ],
  },
  {
    title: 'Shared budgets',
    rows: [{ app: 'group_activity', email: 'email_group_activity', label: 'Activity in shared budgets', hint: 'Another member adds a payment. Can be busy.' }],
  },
  {
    title: 'Security',
    rows: [{ app: 'security_alerts', email: 'email_security', label: 'Security notifications', hint: 'Your password or sign-in method changed. Worth keeping on.' }],
  },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
};
const zones = () => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
};

function Section({ title, description, children, id }) {
  return (
    <section className="card pref-section" id={id}>
      <div className="pref-head">
        <h2>{title}</h2>
        {description && <p className="muted small">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children, htmlFor }) {
  return (
    <div className="pref-row">
      <label className="pref-text" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </label>
      <div className="pref-control">{children}</div>
    </div>
  );
}

/** All the notification preferences: what to be told about (in the app and by email), timing, pausing and delivery. */
export default function NotificationSettings() {
  const { notify } = useApp();
  const { settings, setSettings } = useNotifications();
  const [error, setError] = useState(null);
  const [leadDraft, setLeadDraft] = useState(null);
  const [pauseDate, setPauseDate] = useState('');
  const [tz, setTz] = useState('');
  const [busy, setBusy] = useState(false);
  const [emails, setEmails] = useState(null);
  const verified = settings?.email_verified;

  useEffect(() => {
    api.get('/notifications/settings').then(setSettings).catch(setError);
  }, [setSettings]);
  useEffect(() => {
    if (settings) setTz(settings.timezone);
  }, [settings?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadEmails = useCallback(() => api.get('/notifications/emails').then(setEmails).catch(() => setEmails([])), []);
  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const update = useCallback(
    async (patch, okMessage) => {
      const before = settings;
      setSettings((s) => ({ ...s, ...patch }));
      try {
        const next = await api.put('/notifications/settings', patch);
        setSettings(next);
        if (okMessage) notify(okMessage);
        return true;
      } catch (e) {
        setSettings(before);
        notify(e.message, 'error');
        return false;
      }
    },
    [settings, setSettings, notify],
  );

  if (error && !settings) return <ErrorBox error={error} />;
  if (!settings) return <Loading />;
  const zoneList = zones();
  const device = deviceZone();
  const emailOn = !!settings.email_enabled;
  const permissionDenied = pushSupported() && Notification.permission === 'denied';

  async function setPush(on) {
    if (on) {
      if (!pushSupported()) return notify('This browser does not support desktop notifications.', 'error');
      const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (result !== 'granted') return notify('The browser blocked notifications. Allow them in the site settings and try again.', 'error');
    }
    update({ browser_push: on });
  }

  async function sendTest() {
    setBusy(true);
    try {
      const r = await api.post('/notifications/test-email');
      notify(r.status === 'preview' ? 'No mail server is set up: the test email was saved as a file instead of being sent.' : 'Test email sent. Check your inbox.');
    } catch (e) {
      notify(e.message, 'error');
    }
    loadEmails();
    setBusy(false);
  }

  const commitLead = () => {
    if (leadDraft === null) return;
    const n = Number(leadDraft);
    setLeadDraft(null);
    if (!Number.isInteger(n) || n < 0 || n > 60) return notify('Choose a number of days between 0 and 60.', 'error');
    if (n !== settings.lead_days) update({ lead_days: n }, 'Saved');
  };

  return (
    <div className="pref-stack">
      <Section title="What to be notified about" description="Choose where each kind of notification reaches you. “In the app” fills the bell; “Email” needs email alerts switched on below.">
        <div className="pref-matrix" role="table" aria-label="Notification types">
          <div className="pref-matrix-head" role="row">
            <span role="columnheader">Type</span>
            <span role="columnheader">In the app</span>
            <span role="columnheader">Email</span>
          </div>
          {GROUPS.map((g) => (
            <div key={g.title} className="pref-group" role="rowgroup">
              <div className="pref-group-title">
                {g.title}
                {g.note && <span className="muted small"> · {g.note}</span>}
              </div>
              {g.rows.map((r) => (
                <div key={r.app} className="pref-matrix-row" role="row">
                  <span className="pref-text" role="cell">
                    <span id={`lbl-${r.app}`}>{r.label}</span>
                    <span className="muted small">{r.hint}</span>
                  </span>
                  <span className="pref-cell" role="cell" data-col="In the app">
                    <Switch checked={!!settings[r.app]} onChange={(v) => update({ [r.app]: v })} label={`${r.label}: in the app`} />
                  </span>
                  <span className="pref-cell" role="cell" data-col="Email">
                    <Switch checked={!!settings[r.email]} onChange={(v) => update({ [r.email]: v })} disabled={!emailOn} label={`${r.label}: by email`} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {!emailOn && (
          <p className="pref-foot muted small">
            <Icon name="mail" size={14} /> Email switches are off until you turn on email alerts below.
          </p>
        )}
      </Section>

      <Section title="Payment reminders and summaries" description="How early you hear about a payment, and when summaries arrive.">
        <Row label="Remind me before a payment is due" hint="Days before the due date. 0 means on the day. A single payment, recurring item, plan or category can use its own number." htmlFor="lead-days">
          <span className="stepper">
            <input
              id="lead-days"
              type="number"
              min="0"
              max="60"
              step="1"
              inputMode="numeric"
              value={leadDraft ?? settings.lead_days}
              onChange={(e) => setLeadDraft(e.target.value)}
              onBlur={commitLead}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitLead())}
            />
            <span className="muted small">days</span>
          </span>
        </Row>
        <Row label="Also remind me about expected income" hint="Off by default: income is something you wait for, not something you have to pay." htmlFor="inc">
          <Switch id="inc" checked={!!settings.include_income} onChange={(v) => update({ include_income: v })} label="Remind me about expected income" />
        </Row>
      <Row label="Weekly summary day" hint="Which day the weekly summary arrives (needs the weekly summary switched on above)." htmlFor="wday">
          <Select
            id="wday"
            label="Weekly summary day"
            value={String(settings.weekly_day)}
            disabled={!settings.weekly_summary}
            onChange={(v) => update({ weekly_day: Number(v) })}
            options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
          />
        </Row>
      </Section>

      <Section title="Pause" description="Quiet time. Payment alerts stop; requests from other people still arrive.">
        {settings.paused ? (
          <div className="banner warn" role="status">
            <Icon name="bellOff" />
            <div>
              Paused until the end of <strong>{dateLabel(settings.paused_until_date, { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.
            </div>
            <button className="btn sm" onClick={() => update({ paused_until: null }, 'Alerts resumed')}>
              Resume now
            </button>
          </div>
        ) : null}
        <div className="pause-row">
          {[
            ['Until tomorrow', 1],
            ['For a week', 7],
            ['For a month', 30],
          ].map(([label, days]) => (
            <button key={label} className="btn sm" onClick={() => update({ paused_until: addDays(days) }, 'Alerts paused')}>
              {label}
            </button>
          ))}
          <span className="pause-custom">
            <input type="date" value={pauseDate} min={addDays(0)} onChange={(e) => setPauseDate(e.target.value)} aria-label="Pause until this date" />
            <button className="btn sm" disabled={!pauseDate} onClick={() => update({ paused_until: pauseDate }, 'Alerts paused').then((ok) => ok && setPauseDate(''))}>
              Pause until
            </button>
          </span>
        </div>
      </Section>

      <Section title="Delivery" description="Where notifications go besides the bell." id="email">
        <Row
          label="Desktop notifications"
          hint={!pushSupported() ? 'This browser does not support them.' : permissionDenied ? 'Blocked by your browser. Allow notifications for this site in its settings.' : 'Shown while the app is open in another tab or window.'}
          htmlFor="push"
        >
          <Switch id="push" checked={!!settings.browser_push && !permissionDenied} onChange={setPush} disabled={!pushSupported()} label="Desktop notifications" />
        </Row>

        {settings.mail_mode === 'preview' && (
          <div className="banner info">
            <Icon name="mail" />
            <div>
              No mail server is connected to this copy of the app, so emails are written to a folder on the server instead of being delivered. Ask whoever runs it to set the <code>SMTP_HOST</code> options.
            </div>
          </div>
        )}
        <Row label="Email alerts" hint={verified ? `Sent to ${settings.email}. Every email has an unsubscribe link.` : 'Confirm your email address first.'} htmlFor="email-on">
          <Switch id="email-on" checked={emailOn} disabled={!verified} onChange={(v) => update({ email_enabled: v }, v ? 'Email alerts are on' : 'Email alerts are off')} label="Email alerts" />
        </Row>
        {!verified && <EmailStatus />}

        {emailOn && (
          <div className="pref-indent">
            <fieldset className="fieldset">
              <legend>How often</legend>
              <label className="check">
                <input type="radio" name="freq" checked={settings.email_frequency === 'daily'} onChange={() => update({ email_frequency: 'daily' })} />
                <span>
                  One daily summary
                  <span className="muted block small">Everything new, in one email.</span>
                </span>
              </label>
              <label className="check">
                <input type="radio" name="freq" checked={settings.email_frequency === 'instant'} onChange={() => update({ email_frequency: 'instant' })} />
                <span>
                  Right away
                  <span className="muted block small">One email shortly after something new comes up.</span>
                </span>
              </label>
            </fieldset>
            <div className="form-grid">
              {settings.email_frequency === 'daily' && (
                <Field label="Send the summary at">
                  <Select
                    label="Send the summary at"
                    value={String(settings.email_hour)}
                    onChange={(v) => update({ email_hour: Number(v) })}
                    options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }))}
                    searchable={false}
                  />
                </Field>
              )}
              <Field label="Your time zone" hint={device && device !== settings.timezone ? `Your device uses ${device}.` : 'Used for “today” and the summary time.'}>
                <input
                  list="zone-list"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  onBlur={() => tz !== settings.timezone && (zoneList.includes(tz) ? update({ timezone: tz }, 'Time zone saved') : (notify('Choose a time zone from the list, such as Europe/Berlin.', 'error'), setTz(settings.timezone)))}
                  aria-label="Time zone"
                />
                <datalist id="zone-list">
                  {zoneList.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
            </div>
            {device && device !== settings.timezone && zoneList.includes(device) && (
              <button type="button" className="btn sm" onClick={() => update({ timezone: device }, 'Time zone saved')}>
                Use my device’s time zone ({device})
              </button>
            )}
          </div>
        )}
        {verified && (
          <div className="form-actions left">
            <button type="button" className="btn" onClick={sendTest} disabled={busy}>
              <Icon name="mail" size={16} /> Send me a test email
            </button>
          </div>
        )}
        {emails && emails.length > 0 && (
          <>
            <h3 className="account-sub">Recent emails</h3>
            <ul className="rule-list">
              {emails.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.subject}
                    <span className="muted small"> · {timeAgo(m.created_at)}</span>
                  </span>
                  <span className={`badge ${m.status === 'failed' ? 'danger' : ''}`}>{m.status === 'preview' ? 'saved (not sent)' : m.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
