import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { useNotifications } from '../notifications.jsx';
import Select from './ds/Select.jsx';
import { Field, Icon, Modal } from './ui.jsx';
import { t, tn } from '../i18n/translate.js';

/** A saved override ({mode, days}) or nothing, as the form's choice. */
export const choiceFrom = (own) => (own ? { mode: own.mode, days: own.days != null ? String(own.days) : '' } : { mode: 'default', days: '' });

export const NO_CHOICE = { mode: 'default', days: '' };

export const sameChoice = (a, b) => a.mode === b.mode && (a.mode !== 'on' || (a.days ?? '') === (b.days ?? ''));

/** Save a choice for a payment / recurring item / installment plan / category. "default" removes the override. */
export async function saveAlertChoice(type, id, choice) {
  if (choice.mode === 'default') return api.del(`/alerts/${type}/${id}`);
  const days = choice.mode === 'on' && choice.days !== '' ? Number(choice.days) : null;
  return api.put(`/alerts/${type}/${id}`, { mode: choice.mode, days });
}

export function describeAlert(alert) {
  if (!alert) return '';
  const where = alert.source === 'default' ? 'default' : alert.source;
  if (alert.mode === 'off') return t('No alerts ({where})', { where });
  const when = alert.days === 0 ? t('On the day') : tn(alert.days, '{n} day before', '{n} days before');
  return `${when} (${where})`;
}

/**
 * Choose whether this item raises alerts: follow the default, always remind (optionally with its own
 * number of days before), or never. Used in the payment, recurring and installment forms and the category list.
 */
export function AlertPicker({ value, onChange, label = t('Alerts'), hint, idPrefix = 'alert' }) {
  const { settings } = useNotifications();
  const lead = settings?.lead_days ?? 3;
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="alert-picker">
      <div className="form-grid">
        <Field label={label} hint={hint}>
          <Select
            label={label}
            id={`${idPrefix}-mode`}
            value={value.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'default', label: t('Follow my default ({value})', { value: lead === 0 ? 'on the day' : `${lead} day${lead === 1 ? '' : 's'} before` }) },
              { value: 'on', label: t('Always remind me') },
              { value: 'off', label: t('Never remind me') },
            ]}
          />
        </Field>
        {value.mode === 'on' ? (
          <Field label={t('Remind me')} hint={t('Days before it is due. 0 = on the day.')}>
            <input
              type="number"
              min="0"
              max="60"
              step="1"
              inputMode="numeric"
              value={value.days}
              placeholder={String(lead)}
              onChange={(e) => set({ days: e.target.value.replace(/[^\d]/g, '').slice(0, 2) })}
              aria-label={t('Days before the due date')}
            />
          </Field>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

/** The bell on a payment row: shows the rule that applies and opens a small dialog to change it. */
export function AlertBell({ tx, onChange }) {
  const [open, setOpen] = useState(false);
  const a = tx.alert;
  if (!a) return null;
  const off = a.mode === 'off';
  return (
    <>
      <button
        className={`btn icon ghost alert-bell${off ? ' off' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={t('Alerts for {description}: {describeAlert}', { description: tx.description, describeAlert: describeAlert(a) })}
        title={describeAlert(a)}
      >
        <Icon name={off ? 'bellOff' : 'bell'} size={16} />
      </button>
      {open && <AlertModal tx={tx} onClose={() => setOpen(false)} onSaved={onChange} />}
    </>
  );
}

function AlertModal({ tx, onClose, onSaved }) {
  const { notify } = useApp();
  const [choice, setChoice] = useState(choiceFrom(tx.alert.own));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await saveAlertChoice('transaction', tx.id, choice);
      notify(t('Alert saved'));
      onSaved?.();
      onClose();
    } catch (e) {
      notify(e.message, 'error');
      setBusy(false);
    }
  }
  const inherited = !tx.alert.own && tx.alert.source !== 'default';

  return (
    <Modal title={t('Alerts for this payment')} onClose={onClose}>
      <div className="modal-body form">
        <p>
          <strong>{tx.description}</strong>
        </p>
        <p className="muted small">
          {inherited ? t('Right now: {describeAlert}. This comes from its {source}; choose something below to override it for this payment only.', { describeAlert: describeAlert(tx.alert), source: tx.alert.source }) : t('Right now: {describeAlert}.', { describeAlert: describeAlert(tx.alert) })}
        </p>
        <AlertPicker value={choice} onChange={setChoice} label={t('For this payment')} idPrefix="tx-alert" />
        <div className="form-actions">
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {t('Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The person's own alert choice for a recurring item / plan / category, loaded when editing.
 * Returns [choice, setChoice, startChoice, save(id)] where save() only writes when something changed.
 */
export function useAlertChoice(type, id) {
  const [start, setStart] = useState(NO_CHOICE);
  const [choice, setChoice] = useState(NO_CHOICE);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    api
      .get('/alerts/overrides')
      .then((rows) => {
        if (!alive) return;
        const own = choiceFrom(rows.find((r) => r.target_type === type && r.target_id === id));
        setStart(own);
        setChoice(own);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [type, id]);
  const save = async (targetId) => {
    if (sameChoice(choice, start)) return;
    await saveAlertChoice(type, targetId, choice);
  };
  return { choice, setChoice, save, loaded };
}
