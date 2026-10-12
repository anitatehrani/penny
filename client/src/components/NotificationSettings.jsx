import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { dateLabel, timeAgo } from '../format.js';
import { pushSupported, useNotifications } from '../notifications.jsx';
import EmailStatus from './EmailStatus.jsx';
import DatePicker from './ds/DatePicker.jsx';
import Select from './ds/Select.jsx';
import { ErrorBox, Field, Icon, Loading, Switch } from './ui.jsx';
import { N_, localeOf, t } from '../i18n/translate.js';
import { tRich } from '../i18n/react.jsx';

// One row per kind of notification: the in-app switch and the email switch that go with it.
const GROUPS = [
  {
    get title() { return t('Payments'); },
    rows: [
      { app: 'due_soon', email: 'email_due', get label() { return t('Upcoming payment alerts'); }, get hint() { return t('A reminder before a payment is due (see “Payment reminders” below for how early).'); } },
      { app: 'overdue', email: 'email_overdue', get label() { return t('Overdue payment alerts'); }, get hint() { return t('A payment is past its date and still not paid.'); } },
      { app: 'balance_warning', email: 'email_balance', get label() { return t('Low balance alerts'); }, get hint() { return t('Your balance is already below zero.'); } },
      { app: 'forecast_warning', email: 'email_forecast', get label() { return t('Forecast warnings'); }, get hint() { return t('The forecast shows the balance going negative in a coming month.'); } },
      { app: 'budget_alerts', get label() { return t('Monthly budget alerts'); }, get hint() { return t('A category has used up 80% of its monthly budget, or has gone over it. In the app only.'); } },
    ],
  },
  {
    get title() { return t('Assistant and summaries'); },
    rows: [
      { app: 'ai_insights', email: 'email_ai', get label() { return t('AI financial insights'); }, get hint() { return t('Spending changes, growing subscriptions, a busy week ahead. At most two a day, and never the same one twice.'); } },
      { app: 'weekly_summary', email: 'email_weekly', get label() { return t('Weekly summary'); }, get hint() { return t('What you spent and what is due, once a week.'); } },
      { app: 'monthly_summary', email: 'email_monthly', get label() { return t('Monthly summary'); }, get hint() { return t('How the month went, in the first days of the next one.'); } },
    ],
  },
  {
    get title() { return t('People'); },
    get note() { return t('Emails for these three share one switch.'); },
    rows: [
      { app: 'friend_requests', email: 'email_social', get label() { return t('Connection requests'); }, get hint() { return t('Someone wants to connect, or accepts your request.'); } },
      { app: 'group_invites', email: 'email_social', get label() { return t('Shared budget invitations'); }, get hint() { return t('Invitations and changes to budgets you are in.'); } },
      { app: 'shared_payments', email: 'email_social', get label() { return t('Payments shared with you'); }, get hint() { return t('Someone adds you to one of their payments.'); } },
    ],
  },
  {
    get title() { return t('Shared budgets'); },
    rows: [{ app: 'group_activity', email: 'email_group_activity', get label() { return t('Activity in shared budgets'); }, get hint() { return t('Another member adds a payment. Can be busy.'); } }],
  },
  {
    get title() { return t('Security'); },
    rows: [{ app: 'security_alerts', email: 'email_security', get label() { return t('Security notifications'); }, get hint() { return t('Your password or sign-in method changed. Worth keeping on.'); } }],
  },
];

const WEEKDAYS = [N_('Sunday'), N_('Monday'), N_('Tuesday'), N_('Wednesday'), N_('Thursday'), N_('Friday'), N_('Saturday')];

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(localeOf(), { hour: 'numeric', minute: '2-digit' });
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
      if (!pushSupported()) return notify(t('This browser does not support desktop notifications.'), 'error');
      const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (result !== 'granted') return notify(t('The browser blocked notifications. Allow them in the site settings and try again.'), 'error');
    }
    update({ browser_push: on });
  }

  async function sendTest() {
    setBusy(true);
    try {
      const r = await api.post('/notifications/test-email');
      notify(r.status === 'preview' ? t('No mail server is set up: the test email was saved as a file instead of being sent.') : t('Test email sent. Check your inbox.'));
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
    if (!Number.isInteger(n) || n < 0 || n > 60) return notify(t('Choose a number of days between 0 and 60.'), 'error');
    if (n !== settings.lead_days) update({ lead_days: n }, t('Saved'));
  };

  return (
    <div className="pref-stack">
      <Section title={t('What to be notified about')} description={t('Choose where each kind of notification reaches you. “In the app” fills the bell; “Email” needs email alerts switched on below.')}>
        <div className="pref-matrix" role="table" aria-label={t('Notification types')}>
          <div className="pref-matrix-head" role="row">
            <span role="columnheader">{t('Type')}</span>
            <span role="columnheader">{t('In the app')}</span>
            <span role="columnheader">{t('Email')}</span>
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
                  <span className="pref-cell" role="cell" data-col={t('In the app')}>
                    <Switch checked={!!settings[r.app]} onChange={(v) => update({ [r.app]: v })} label={t('{label}: in the app', { label: r.label })} />
                  </span>
                  <span className="pref-cell" role="cell" data-col={t('Email')}>
                    {r.email ? <Switch checked={!!settings[r.email]} onChange={(v) => update({ [r.email]: v })} disabled={!emailOn} label={t('{label}: by email', { label: r.label })} /> : <span className="muted small">{t('Not by email')}</span>}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {!emailOn && (
          <p className="pref-foot muted small">
            <Icon name="mail" size={14} /> {t('Email switches are off until you turn on email alerts below.')}
          </p>
        )}
      </Section>

      <Section title={t('Payment reminders and summaries')} description={t('How early you hear about a payment, and when summaries arrive.')}>
        <Row label={t('Remind me before a payment is due')} hint={t('Days before the due date. 0 means on the day. A single payment, recurring item, plan or category can use its own number.')} htmlFor="lead-days">
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
            <span className="muted small">{t('days')}</span>
          </span>
        </Row>
        <Row label={t('Also remind me about expected income')} hint={t('Off by default: income is something you wait for, not something you have to pay.')} htmlFor="inc">
          <Switch id="inc" checked={!!settings.include_income} onChange={(v) => update({ include_income: v })} label={t('Remind me about expected income')} />
        </Row>
      <Row label={t('Weekly summary day')} hint={t('Which day the weekly summary arrives (needs the weekly summary switched on above).')} htmlFor="wday">
          <Select
            id="wday"
            label={t('Weekly summary day')}
            value={String(settings.weekly_day)}
            disabled={!settings.weekly_summary}
            onChange={(v) => update({ weekly_day: Number(v) })}
            options={WEEKDAYS.map((d, i) => ({ value: String(i), label: t(d) }))}
          />
        </Row>
      </Section>

      <Section title={t('Pause')} description={t('Quiet time. Payment alerts stop; requests from other people still arrive.')}>
        {settings.paused ? (
          <div className="banner warn" role="status">
            <Icon name="bellOff" />
            <div>
              {tRich('Paused until the end of {bold}.', { bold: <strong>{dateLabel(settings.paused_until_date, { day: 'numeric', month: 'long', year: 'numeric' })}</strong> })}
            </div>
            <button className="btn sm" onClick={() => update({ paused_until: null }, t('Alerts resumed'))}>
              {t('Resume now')}
            </button>
          </div>
        ) : null}
        <div className="pause-row">
          {[
            [t('Until tomorrow'), 1],
            [t('For a week'), 7],
            [t('For a month'), 30],
          ].map(([label, days]) => (
            <button key={label} className="btn sm" onClick={() => update({ paused_until: addDays(days) }, t('Alerts paused'))}>
              {label}
            </button>
          ))}
          <span className="pause-custom">
            <DatePicker compact label={t('Pause until this date')} placeholder={t('Pick a day')} value={pauseDate} min={addDays(0)} onChange={setPauseDate} />
            <button className="btn sm" disabled={!pauseDate} onClick={() => update({ paused_until: pauseDate }, t('Alerts paused')).then((ok) => ok && setPauseDate(''))}>
              {t('Pause until')}
            </button>
          </span>
        </div>
      </Section>

      <Section title={t('Delivery')} description={t('Where notifications go besides the bell.')} id="email">
        <Row
          label={t('Desktop notifications')}
          hint={!pushSupported() ? t('This browser does not support them.') : permissionDenied ? t('Blocked by your browser. Allow notifications for this site in its settings.') : t('Shown while the app is open in another tab or window.')}
          htmlFor="push"
        >
          <Switch id="push" checked={!!settings.browser_push && !permissionDenied} onChange={setPush} disabled={!pushSupported()} label={t('Desktop notifications')} />
        </Row>

        {settings.mail_mode === 'preview' && (
          <div className="banner info">
            <Icon name="mail" />
            <div>
              {tRich('No mail server is connected to this copy of the app, so emails are written to a folder on the server instead of being delivered. Ask whoever runs it to set the {code} options.', { code: <code>SMTP_HOST</code> })}
            </div>
          </div>
        )}
        <Row label={t('Email alerts')} hint={verified ? t('Sent to {email}. Every email has an unsubscribe link.', { email: settings.email }) : t('Confirm your email address first.')} htmlFor="email-on">
          <Switch id="email-on" checked={emailOn} disabled={!verified} onChange={(v) => update({ email_enabled: v }, v ? t('Email alerts are on') : t('Email alerts are off'))} label={t('Email alerts')} />
        </Row>
        {!verified && <EmailStatus />}

        {emailOn && (
          <div className="pref-indent">
            <fieldset className="fieldset">
              <legend>{t('How often')}</legend>
              <label className="check">
                <input type="radio" name="freq" checked={settings.email_frequency === 'daily'} onChange={() => update({ email_frequency: 'daily' })} />
                <span>
                  {t('One daily summary')}
                  <span className="muted block small">{t('Everything new, in one email.')}</span>
                </span>
              </label>
              <label className="check">
                <input type="radio" name="freq" checked={settings.email_frequency === 'instant'} onChange={() => update({ email_frequency: 'instant' })} />
                <span>
                  {t('Right away')}
                  <span className="muted block small">{t('One email shortly after something new comes up.')}</span>
                </span>
              </label>
            </fieldset>
            <div className="form-grid">
              {settings.email_frequency === 'daily' && (
                <Field label={t('Send the summary at')}>
                  <Select
                    label={t('Send the summary at')}
                    value={String(settings.email_hour)}
                    onChange={(v) => update({ email_hour: Number(v) })}
                    options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }))}
                    searchable={false}
                  />
                </Field>
              )}
              <Field label={t('Your time zone')} hint={device && device !== settings.timezone ? t('Your device uses {device}.', { device }) : t('Used for “today” and the summary time.')}>
                <input
                  list="zone-list"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  onBlur={() => tz !== settings.timezone && (zoneList.includes(tz) ? update({ timezone: tz }, t('Time zone saved')) : (notify(t('Choose a time zone from the list, such as Europe/Berlin.'), 'error'), setTz(settings.timezone)))}
                  aria-label={t('Time zone')}
                />
                <datalist id="zone-list">
                  {zoneList.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
            </div>
            {device && device !== settings.timezone && zoneList.includes(device) && (
              <button type="button" className="btn sm" onClick={() => update({ timezone: device }, t('Time zone saved'))}>
                {t('Use my device’s time zone ({device})', { device })}
              </button>
            )}
          </div>
        )}
        {verified && (
          <div className="form-actions left">
            <button type="button" className="btn" onClick={sendTest} disabled={busy}>
              <Icon name="mail" size={16} /> {t('Send me a test email')}
            </button>
          </div>
        )}
        {emails && emails.length > 0 && (
          <>
            <h3 className="account-sub">{t('Recent emails')}</h3>
            <ul className="rule-list">
              {emails.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.subject}
                    <span className="muted small"> · {timeAgo(m.created_at)}</span>
                  </span>
                  <span className={`badge ${m.status === 'failed' ? 'danger' : ''}`}>{m.status === 'preview' ? t('saved (not sent)') : m.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
