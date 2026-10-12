import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AiAnswersCard, useAiStatus } from '../assistant/AiAnswers.jsx';
import AccountCard from '../components/AccountCard.jsx';
import YourDataCard from '../components/YourDataCard.jsx';
import AppearanceSettings from '../components/AppearanceSettings.jsx';
import NotificationSettings from '../components/NotificationSettings.jsx';
import Select from '../components/ds/Select.jsx';
import { useFetch } from '../hooks.js';
import { backupLine } from '../backupLogic.js';
import { Field, Icon, Modal, Segmented } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { useNotifications } from '../notifications.jsx';
import { useWorkspace } from '../workspace.jsx';
import { N_, localeOf, t, tn } from '../i18n/translate.js';
import { catName } from '../categoryNames.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'AED', 'SAR', 'EGP', 'INR', 'JPY', 'CNY', 'AUD', 'NZD', 'CAD', 'MXN', 'BRL', 'ZAR'];

function CategoryForm({ initial, onSaved, onCancel }) {
  const { notify } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState(initial?.kind ?? 'expense');
  const [color, setColor] = useState(initial?.color ?? '#2a78d6');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name, kind, color };
      if (initial?.id) await api.put(`/categories/${initial.id}`, body);
      else await api.post('/categories', body);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <Segmented
        label={t('Kind')}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: t('Expense'), tone: 'expense' },
          { value: 'income', label: t('Income'), tone: 'income' },
        ]}
      />
      <div className="form-grid">
        <Field label={t('Name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </Field>
        <Field label={t('Color')}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
        </Field>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {t('Save')}
        </button>
      </div>
    </form>
  );
}

const TABS = [
  ['general', N_('Budget'), 'gear'],
  ['account', N_('Account'), 'user'],
  ['notifications', N_('Notifications'), 'bell'],
  ['appearance', N_('Appearance'), 'palette'],
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'general';
  const { unread } = useNotifications();
  const { settings, categories, reloadSettings, reloadCategories, notify } = useApp();
  const { current, isGroup } = useWorkspace();
  const ai = useAiStatus(current.id);
  const [opening, setOpening] = useState(String(settings.opening_balance));
  const [currency, setCurrency] = useState(settings.currency);
  const [cardDay, setCardDay] = useState(String(settings.card_pay_day ?? 10));
  const [carryOver, setCarryOver] = useState(settings.carry_over ?? true);
  const backups = useFetch(() => api.get('/backups/status'), []);
  const backup = backupLine(backups.data, (iso) => new Date(iso).toLocaleString(localeOf(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  const [buffer, setBuffer] = useState(String(settings.min_balance ?? 0));
  const [editingCat, setEditingCat] = useState(null);
  const [catAlerts, setCatAlerts] = useState({}); // category id -> 'on' | 'off' (my own choices; missing = follow default)

  useEffect(() => {
    api
      .get('/alerts/overrides')
      .then((rows) => setCatAlerts(Object.fromEntries(rows.filter((r) => r.target_type === 'category').map((r) => [r.target_id, r.mode]))))
      .catch(() => {});
  }, [categories]);

  async function setCategoryAlert(c, mode) {
    try {
      await saveAlertChoice('category', c.id, { mode, days: '' });
      setCatAlerts((m) => {
        const next = { ...m };
        if (mode === 'default') delete next[c.id];
        else next[c.id] = mode;
        return next;
      });
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  useEffect(() => {
    setOpening(String(settings.opening_balance));
    setCurrency(settings.currency);
    setCardDay(String(settings.card_pay_day ?? 10));
    setCarryOver(settings.carry_over ?? true);
    setBuffer(String(settings.min_balance ?? 0));
  }, [settings]);

  async function save(e) {
    e.preventDefault();
    try {
      await api.put('/settings', { opening_balance: Number(opening), currency, card_pay_day: Number(cardDay), carry_over: carryOver, min_balance: Number(buffer) || 0 });
      reloadSettings();
      notify(t('Settings saved'));
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function removeCategory(c) {
    const msg = c.usage_count
      ? t('Delete "{name}"? {usage_count} payment(s) will become uncategorized.', { name: catName(c.name), usage_count: c.usage_count })
      : t('Delete "{name}"?', { name: catName(c.name) });
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/categories/${c.id}`);
      reloadCategories();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const groups = [
    ['expense', t('Expense categories')],
    ['income', t('Income categories')],
  ];
  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('Settings')}</h1>
          <p className="muted">
            {isGroup ? t('Starting balance, currency and categories of the shared budget “{name}”. Anyone in the group can change these.', { name: current.name }) : t('Your budget, your account and how you are notified.')}
          </p>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label={t('Settings sections')}>
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" id={`set-${id}`} aria-selected={tab === id} aria-controls="set-panel" className={tab === id ? 'active' : ''} onClick={() => setParams(id === 'general' ? {} : { tab: id }, { replace: true })}>
            <Icon name={icon} size={16} /> {t(label)}
            {id === 'notifications' && unread > 0 && <span className="tab-badge" aria-label={t('{unread} unread', { unread })}>{unread > 99 ? '99+' : unread}</span>}
          </button>
        ))}
      </div>

      <div id="set-panel" role="tabpanel" aria-labelledby={`set-${tab}`} className="tab-panel">
      {tab === 'account' && (
        <>
          <AccountCard />
          <YourDataCard />
        </>
      )}
      {tab === 'notifications' && <NotificationSettings />}
      {tab === 'appearance' && <AppearanceSettings />}
      {tab === 'general' && (
      <>
      <section className="card">
        <div className="card-head">
          <h2>{t('Balance, currency & credit card')}</h2>
        </div>
        <form onSubmit={save} className="form">
          <div className="form-grid">
            <Field label={t('Starting balance')} hint={t('What you had before your first recorded payment. Can be negative (e.g. an overdraft).')}>
              <input type="number" step="0.01" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} required />
            </Field>
            <Field label={t('Currency')}>
              <Select label={t('Currency')} value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label={t('Credit card pay day')} hint={t('The day of the month you pay your credit card bill (1 to 28). A purchase made with the card counts on this day of the month you choose.')}>
              <input type="number" min="1" max="28" step="1" inputMode="numeric" value={cardDay} onChange={(e) => setCardDay(e.target.value)} required />
            </Field>
          </div>
          <Field label={t('Safety buffer')} hint={t('The balance you do not want to go below. Warnings, the balance card and the forecast use it instead of zero. Leave it at 0 to be warned only below zero.')}>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} placeholder="0.00" />
          </Field>
          <div className="split-box">
            <label className="check">
              <input type="checkbox" checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} />
              <span>
                {t('Carry what is left over into the next month')}
                <span className="muted block small">
                  {carryOver ? t('The Payments page starts each month with a line for the money left from earlier months, and counts it in that month’s income and net. It is not a payment, so your balance is unchanged.') : t('Each month on the Payments page starts from nothing. Your balance and forecast still include everything.')}
                </span>
              </span>
            </label>
          </div>
          <div className="form-actions left">
            <button className="btn primary">{t('Save')}</button>
          </div>
        </form>
      </section>

      {backup && (
        <section className="card" aria-labelledby="backups-title">
          <div className="card-head">
            <h2 id="backups-title">{t('Backups')}</h2>
          </div>
          <p className={`backup-line ${backup.tone}`} role={backup.tone === 'warn' ? 'alert' : undefined}>
            {backup.text}
          </p>
          <p className="muted small">
            {t('Penny copies the whole database once a day to a backups folder next to the app. A backup on the same disk does not help if the disk fails, so keep a second copy somewhere else, such as another drive or a synced folder (see the README).')}
          </p>
        </section>
      )}

      {groups.map(([kind, title]) => (
        <section className="card" key={kind}>
          <div className="card-head">
            <h2>{title}</h2>
            {kind === 'expense' && (
              <button className="btn sm" onClick={() => setEditingCat({})}>
                <Icon name="plus" size={14} /> {t('New category')}
              </button>
            )}
          </div>
          <ul className="cat-list">
            {categories
              .filter((c) => c.kind === kind)
              .map((c) => (
                <li key={c.id}>
                  <span className="cat">
                    <span className="dot big" style={{ background: c.color }} />
                    {catName(c.name)}
                  </span>
                  <span className="muted small">{tn(c.usage_count, '{n} payment', '{n} payments')}</span>
                  <span className="cat-alert" title={t('Payment alerts for this category (only for you)')}>
                    <Select
                      variant="inline"
                      label={t('Alerts for {name}', { name: catName(c.name) })}
                      value={catAlerts[c.id] ?? 'default'}
                      onChange={(v) => setCategoryAlert(c, v)}
                      options={[
                        { value: 'default', label: t('Alerts: default') },
                        { value: 'on', label: t('Alerts: always') },
                        { value: 'off', label: t('Alerts: never') },
                      ]}
                    />
                  </span>
                  <span className="row-actions">
                    <button className="btn icon ghost" onClick={() => setEditingCat(c)} aria-label={t('Edit {name}', { name: catName(c.name) })}>
                      <Icon name="edit" />
                    </button>
                    <button className="btn icon ghost danger-hover" onClick={() => removeCategory(c)} aria-label={t('Delete {name}', { name: catName(c.name) })}>
                      <Icon name="trash" />
                    </button>
                  </span>
                </li>
              ))}
          </ul>
          {kind === 'income' && (
            <button className="btn sm" onClick={() => setEditingCat({ kind: 'income' })}>
              <Icon name="plus" size={14} /> {t('New income category')}
            </button>
          )}
        </section>
      ))}

      <section className="card">
        <div className="card-head">
          <h2>{t('Export your payments')}</h2>
        </div>
        <p className="muted">{t('Save all your payments in one file. It opens like a spreadsheet, in Excel, Numbers or Google Sheets, so you can keep it or look at it on a computer.')}</p>
        <a className="btn" href={`/api/transactions/export.csv?status=&ws=${current.id}`}>
          <Icon name="download" /> {t('Export all payments')}
        </a>
      </section>

      {ai.status?.configured && (
        <section className="card" aria-labelledby="ai-title">
          <div className="card-head">
            <h2 id="ai-title">{t('Assistant: AI answers')}</h2>
          </div>
          <AiAnswersCard ai={ai} full bare />
        </section>
      )}

      </>
      )}
      </div>

      {editingCat && (
        <Modal title={editingCat.id ? t('Edit category') : t('New category')} onClose={() => setEditingCat(null)}>
          <CategoryForm
            initial={editingCat}
            onCancel={() => setEditingCat(null)}
            onSaved={() => {
              setEditingCat(null);
              reloadCategories();
            }}
          />
        </Modal>
      )}
    </>
  );
}
