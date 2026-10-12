import { Link } from 'react-router-dom';
import { useAssistant } from '../assistant/assistant.jsx';
import { Icon } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { usePrefs } from '../prefs.jsx';
import { useQuick } from '../quick.jsx';
import { t } from '../i18n/translate.js';

/** What a brand-new budget sees instead of empty widgets: a short checklist of what makes the dashboard come alive. */
export default function FirstRun({ rulesCount }) {
  const { settings } = useApp();
  const { openAddPayment } = useQuick();
  const { openAssistant } = useAssistant();
  const { prefs, setPrefs } = usePrefs();
  const steps = [
    {
      id: 'balance',
      done: Number(settings?.opening_balance) !== 0,
      title: t('Set your starting balance'),
      text: t('What you have right now, so every balance after this is right. It can be negative.'),
      action: (
        <Link className="btn sm" to="/settings">
          {t('Open settings')}
        </Link>
      ),
    },
    {
      id: 'payment',
      done: false,
      title: t('Add your first payment'),
      text: t('Something you paid, or something you still owe. Past dates count as already paid.'),
      action: (
        <button className="btn sm primary" onClick={() => openAddPayment()}>
          <Icon name="plus" size={14} /> {t('Add payment')}
        </button>
      ),
    },
    {
      id: 'recurring',
      done: rulesCount > 0,
      title: t('Add what repeats'),
      text: t('Rent, salary, subscriptions. Enter them once and they appear every month in the forecast.'),
      action: (
        <Link className="btn sm" to="/recurring?new=1">
          {t('Add recurring')}
        </Link>
      ),
    },
    {
      id: 'assistant',
      done: prefs.assistant_intro_seen,
      title: t('Meet the assistant'),
      text: t('It reads your ledger and points out what changed, what is coming and what you could save. It starts once you have a few payments.'),
      action: (
        <button
          className="btn sm"
          onClick={() => {
            setPrefs({ assistant_intro_seen: true });
            openAssistant();
          }}
        >
          {t('Take a look')}
        </button>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="firstrun" aria-label={t('Getting started')}>
      <div className="firstrun-head">
        <div>
          <div className="eyebrow">{t('Getting started')}</div>
          <h2>{t('Welcome. Let’s make this budget yours.')}</h2>
          <p className="muted">{t('Four small steps, no judgement. Your dashboard fills in as you go.')}</p>
        </div>
        <div className="firstrun-progress" role="img" aria-label={t('{done} of {length} steps done', { done, length: steps.length })}>
          <span className="num">
            {done}/{steps.length}
          </span>
        </div>
      </div>
      <ol className="firstrun-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? 'done' : ''}>
            <span className="step-no" aria-hidden="true">
              {s.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <div className="step-text">
              <strong>
                {s.title}
                {s.done && <span className="sr-only"> {t('(done)')}</span>}
              </strong>
              <p className="muted small">{s.text}</p>
            </div>
            <div className="step-action">{!s.done && s.action}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
