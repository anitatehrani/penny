import { Link } from 'react-router-dom';
import { useAssistant } from '../assistant/assistant.jsx';
import { Icon } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { usePrefs } from '../prefs.jsx';
import { useQuick } from '../quick.jsx';
import { catName } from '../categoryNames.js';
import { villainCategory } from '../welcomeLogic.js';
import WelcomeQuiz from './WelcomeQuiz.jsx';
import { t } from '../i18n/translate.js';

/** What a brand-new budget sees instead of empty widgets: a short checklist of what makes the dashboard come alive. */
export default function FirstRun({ rulesCount }) {
  const { settings } = useApp();
  const { openAddPayment } = useQuick();
  const { openAssistant } = useAssistant();
  const { prefs, setPrefs } = usePrefs();
  const plain = prefs.tone === 'plain';
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
  // what the welcome questions found out about this person
  const category = villainCategory(prefs.villain);
  if (category) {
    steps.push({
      id: 'villain',
      done: false,
      title: t('Put a limit on {category}', { category: catName(category) }),
      text: t('You called it your arch-enemy. Give it an amount for the month and Penny keeps an eye on it.'),
      action: (
        <Link className="btn sm" to="/budget">
          {t('Set a limit')}
        </Link>
      ),
    });
  }
  if (prefs.goals?.includes('debts')) {
    steps.push({
      id: 'debts',
      done: false,
      title: t('Write down what you owe'),
      text: t('A friend, a shop, the dentist. Give it a plan and a progress bar, and it stops hiding in the back of your mind.'),
      action: (
        <Link className="btn sm" to="/debts">
          {t('Add a debt')}
        </Link>
      ),
    });
  }
  if (prefs.goals?.includes('together')) {
    steps.push({
      id: 'together',
      done: false,
      title: t('Invite the people you share money with'),
      text: t('Connect with them first, then make a shared budget. Nobody sees your personal one.'),
      action: (
        <Link className="btn sm" to="/people">
          {t('Find people')}
        </Link>
      ),
    });
  }
  const done = steps.filter((s) => s.done).length;
  return (
    <>
      {!prefs.welcome_done && <WelcomeQuiz firstTime />}
      <section className="firstrun" aria-label={t('Getting started')}>
      <div className="firstrun-head">
        <div>
          <div className="eyebrow">{t('Getting started')}</div>
          <h2>{t('Welcome. Let’s make this budget yours.')}</h2>
          <p className="muted">{(plain ? t('Four small steps. Your dashboard fills in as you go.') : t('Four small steps, no judgement. Your dashboard fills in as you go.'))}</p>
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
    </>
  );
}
