import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { catName } from '../categoryNames.js';
import { Icon } from '../components/ui.jsx';
import { usePrefs } from '../prefs.jsx';
import { layoutForGoals, nudgeSettings, villainCategory } from '../welcomeLogic.js';
import { t } from '../i18n/translate.js';

/** The four questions. They are functions so the words follow the language in use. */
const questions = () => [
  {
    id: 'goals',
    multi: true,
    title: t('What brought you here?'),
    hint: t('Pick as many as you like. We won’t tell your bank.'),
    options: [
      ['forecast', t('I’d like to see my balance before it surprises me')],
      ['budget', t('My spending keeps playing hide and seek')],
      ['bills', t('Bills keep sneaking up on me')],
      ['debts', t('I owe people money (it happens, no judgement)')],
      ['together', t('I’m sharing money with someone I live with')],
      ['import', t('I have a pile of bank statements and a dream')],
    ],
  },
  {
    id: 'tone',
    title: t('How should Penny talk to you?'),
    hint: t('You can change this any time in Settings.'),
    options: [
      ['plain', t('Straight-faced, please. Just the facts.')],
      ['cheeky', t('A little cheeky is fine. Keep it light.')],
    ],
  },
  {
    id: 'nudge',
    title: t('When a payment is coming up, how should Penny tap your shoulder?'),
    hint: t('You can fine-tune the alerts later.'),
    options: [
      ['urgent', t('Only when it’s close. I like living on the edge.')],
      ['weekly', t('A calm weekly summary and a heads-up a few days ahead.')],
      ['early', t('Early and often. Future me panics easily.')],
    ],
  },
  {
    id: 'villain',
    title: t('Which category is your budget’s arch-enemy?'),
    hint: t('Penny will help you keep an eye on it.'),
    options: [
      ['dining', t('Eating out. The pizza was worth it, though.')],
      ['subscriptions', t('Subscriptions I forgot I had')],
      ['groceries', t('The supermarket. I only went in for milk.')],
      ['transport', t('Getting around')],
      ['none', t('None. I’m a saint (probably).')],
    ],
  },
];

/**
 * A few light questions for somebody new, and a way to answer them again later. Each answer is used (docs/DESIGN.md section 47):
 * the order of the dashboard, the alert settings, how playful the wording is, and an extra step in the checklist.
 * `firstTime` is true on a brand-new budget, where the dashboard is also rearranged; on a budget with data it is left as the person made it.
 */
export default function WelcomeQuiz({ firstTime = false, onDone }) {
  const { prefs, setPrefs } = usePrefs();
  const { notify } = useApp();
  const qs = questions();
  const [step, setStep] = useState(firstTime ? -1 : 0); // -1 is the welcome, 0..3 the questions, 4 the wrap-up
  const [answers, setAnswers] = useState({ goals: prefs.goals ?? [], tone: prefs.welcome_done ? prefs.tone : undefined, nudge: prefs.nudge, villain: prefs.villain });
  const q = qs[step];

  const pick = (id, value, multi) =>
    setAnswers((a) => {
      if (!multi) return { ...a, [id]: value };
      const list = a[id] ?? [];
      return { ...a, [id]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  async function finish() {
    const patch = { welcome_done: true };
    if (answers.goals?.length) patch.goals = answers.goals;
    if (answers.tone) patch.tone = answers.tone;
    if (answers.nudge) patch.nudge = answers.nudge;
    if (answers.villain) patch.villain = answers.villain;
    if (firstTime && answers.goals?.length) patch.layout = layoutForGoals(answers.goals, prefs.layout);
    setPrefs(patch);
    const alerts = nudgeSettings(answers.nudge);
    if (alerts) {
      try {
        await api.put('/notifications/settings', alerts);
      } catch (e) {
        notify(e.message, 'error');
      }
    }
    onDone?.();
  }

  const summary = [
    answers.goals?.length && firstTime ? t('Your dashboard puts what you asked for first.') : null,
    answers.tone === 'plain' ? t('Penny keeps it straight-faced.') : answers.tone === 'cheeky' ? t('Penny keeps it light, with the odd joke.') : null,
    answers.nudge === 'urgent' ? t('Reminders arrive the day before a payment is due.') : null,
    answers.nudge === 'weekly' ? t('Reminders arrive 3 days ahead, plus a weekly summary.') : null,
    answers.nudge === 'early' ? t('Reminders arrive a week ahead, plus a weekly summary.') : null,
    villainCategory(answers.villain) ? t('{category} gets its own step in your checklist.', { category: catName(villainCategory(answers.villain)) }) : null,
  ].filter(Boolean);

  return (
    <section className="welcome" aria-label={t('A few questions')}>
      {step === -1 && (
        <div className="welcome-body">
          <div className="eyebrow">{t('Meet Penny')}</div>
          <h2>{t('Four quick questions, zero tax forms.')}</h2>
          <p className="muted">{t('Penny uses your answers to set itself up. Skip anything you like; it all lives in Settings later.')}</p>
          <div className="welcome-actions">
            <button className="btn primary" onClick={() => setStep(0)}>
              {t('Let’s go')}
            </button>
            <button className="btn ghost" onClick={finish}>
              {t('Skip for now')}
            </button>
          </div>
        </div>
      )}

      {q && (
        <div className="welcome-body">
          <div className="eyebrow">{t('Question {n} of {total}', { n: step + 1, total: qs.length })}</div>
          <h2 id={`wq-${q.id}`}>{q.title}</h2>
          <p className="muted small">{q.hint}</p>
          <div className="welcome-options" role={q.multi ? 'group' : 'radiogroup'} aria-labelledby={`wq-${q.id}`}>
            {q.options.map(([value, label]) => {
              const on = q.multi ? (answers[q.id] ?? []).includes(value) : answers[q.id] === value;
              return (
                <button key={value} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} className={`welcome-opt${on ? ' on' : ''}`} onClick={() => pick(q.id, value, q.multi)}>
                  <span className="welcome-mark" aria-hidden="true">
                    {on && <Icon name="check" size={12} />}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
          <div className="welcome-actions">
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              {step === qs.length - 1 ? t('Finish') : t('Next')}
            </button>
            <button className="btn ghost" onClick={() => setStep(step + 1)}>
              {t('Skip this one')}
            </button>
            {step > 0 && (
              <button className="btn ghost" onClick={() => setStep(step - 1)}>
                {t('Back')}
              </button>
            )}
          </div>
        </div>
      )}

      {step === qs.length && (
        <div className="welcome-body">
          <div className="eyebrow">{t('All set')}</div>
          <h2>{summary.length ? t('Here is what Penny will do.') : t('No problem. Penny starts plain and simple.')}</h2>
          {summary.length > 0 && (
            <ul className="welcome-summary">
              {summary.map((s) => (
                <li key={s}>
                  <Icon name="check" size={14} /> {s}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{t('You can change any of this later, in Settings and in your notification settings.')}</p>
          <div className="welcome-actions">
            <button className="btn primary" onClick={finish}>
              {firstTime ? t('Show me my dashboard') : t('Done')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
