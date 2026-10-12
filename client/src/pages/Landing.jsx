import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LanguageLinks } from '../components/LanguageSwitch.jsx';
import { Wordmark } from '../components/Logo.jsx';
import { Icon, ThemeToggle } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { chartPoints, monthLabels, projectBalance, smoothPath, summarizeProjection } from '../landingLogic.js';
import { N_, localeOf, t } from '../i18n/translate.js';
import { tRich, useLocalPath } from '../i18n/react.jsx';

/**
 * The page a visitor sees first (docs/DESIGN.md section 37): what Penny is, what it does, something to play with, and a way in. Public, shown
 * at "/" to anybody who is not signed in (signed-in people go straight to their dashboard). The screenshots are real pages of the demo account
 * in light and dark; the small cards are drawings of what Penny shows, in the same colours. Every claim is something Penny really does.
 */
const TITLE = N_('Penny: a personal budget with a forecast months ahead');

const euro = (n) => new Intl.NumberFormat(localeOf(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

/** A product screenshot in a window frame; the dark and light versions swap with the theme (see landing.css). */
function Shot({ name, alt, priority = false }) {
  const common = { width: 1920, height: 1200, alt, decoding: 'async', loading: priority ? 'eager' : 'lazy', ...(priority ? { fetchPriority: 'high' } : {}) };
  return (
    <figure className="lp-window">
      <div className="lp-window-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <img className="lp-shot lp-shot-light" src={`/landing/${name}-light.webp`} {...common} />
      {/* the picture for the other theme is fetched only when it is shown, so the first view downloads one picture, not two */}
      <img className="lp-shot lp-shot-dark" src={`/landing/${name}-dark.webp`} {...common} loading="lazy" fetchPriority="auto" />
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Something to play with: a small forecast the visitor can bend
// ---------------------------------------------------------------------------------------------------------------------------------
const SLIDERS = [
  { key: 'start', get label() { return t('In the bank today'); }, min: 0, max: 10000, step: 100 },
  { key: 'income', get label() { return t('Coming in each month'); }, min: 500, max: 6000, step: 100 },
  { key: 'bills', get label() { return t('Bills each month'); }, get hint() { return t('rent, subscriptions, installments'); }, min: 300, max: 4500, step: 100 },
  { key: 'spending', get label() { return t('Everyday spending'); }, get hint() { return t('food, transport, fun'); }, min: 0, max: 2500, step: 50 },
  { key: 'purchase', get label() { return t('One big purchase'); }, min: 0, max: 6000, step: 100 },
];

function ForecastDemo({ signupsOpen }) {
  const id = useId().replace(/:/g, '');
  const [v, setV] = useState({ start: 1800, income: 2600, bills: 1750, spending: 600, purchase: 1500, purchaseMonth: 4 });
  const set = (key) => (e) => setV((s) => ({ ...s, [key]: Number(e.target.value) }));
  const series = useMemo(() => projectBalance(v), [v]);
  const sum = useMemo(() => summarizeProjection(series), [series]);
  const labels = useMemo(() => monthLabels(new Date(), 12), []);
  const W = 640;
  const H = 280;
  const { points, zeroY } = useMemo(() => chartPoints(series, { width: W, height: H }), [series]);
  const line = smoothPath(points);
  const area = `${line} L${points.at(-1).x} ${zeroY} L${points[0].x} ${zeroY} Z`;
  const low = points[sum.lowestIndex];

  return (
    <section id="try" className="lp-section">
      <div className="lp-wrap">
        <p className="lp-eyebrow lp-center lp-reveal">{t('Try it')}</p>
        <h2 className="lp-reveal">{t('Bend a year, see where it lands')}</h2>
        <p className="lp-sub lp-reveal">{t('Go on, buy the big thing. Move the sliders and see what it does to your year. This is the idea behind Penny\'s forecast, with your own payments in place of these numbers.')}</p>
        <div className="lp-demo lp-reveal">
          <div className="lp-demo-controls">
            {SLIDERS.map((s) => (
              <label key={s.key} className="lp-slider">
                <span className="lp-slider-top">
                  <span>
                    {s.label}
                    {s.hint && <small> · {s.hint}</small>}
                  </span>
                  <output>{euro(v[s.key])}</output>
                </span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={v[s.key]} onChange={set(s.key)} style={{ '--fill': `${((v[s.key] - s.min) / (s.max - s.min)) * 100}%` }} />
              </label>
            ))}
            <label className="lp-slider">
              <span className="lp-slider-top">
                <span>{t('…in month')}</span>
                <output>{labels[v.purchaseMonth]}</output>
              </span>
              <input type="range" min={1} max={12} step={1} value={v.purchaseMonth} onChange={set('purchaseMonth')} style={{ '--fill': `${((v.purchaseMonth - 1) / 11) * 100}%` }} />
            </label>
          </div>

          <div className="lp-demo-chart">
            <div className={`lp-verdict ${sum.dips ? 'bad' : 'good'}`} role="status" aria-live="polite">
              <Icon name={sum.dips ? 'alert' : 'check'} size={18} />
              <span>
                {sum.dips ? (
                  <>
                    {tRich('You would go below zero in {bold} (lowest {euro}). Penny warns you well before.', { euro: euro(sum.lowest), bold: <strong>{labels[sum.firstNegative]}</strong> })}
                  </>
                ) : (
                  <>
                    {t('No dip ahead. Lowest point')} <strong>{euro(sum.lowest)}</strong>{sum.lowestIndex ? <> {t('in {value}', { value: labels[sum.lowestIndex] })}</> : t(' is today')}.
                  </>
                )}
              </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="lp-chart" role="img" aria-label={t('A twelve month forecast. It ends at {euro}, and its lowest point is {euro2}.', { euro: euro(sum.end), euro2: euro(sum.lowest) })}>
              <defs>
                <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
                <clipPath id={`${id}-above`}>
                  <rect x="0" y="0" width={W} height={zeroY} />
                </clipPath>
                <clipPath id={`${id}-below`}>
                  <rect x="0" y={zeroY} width={W} height={H - zeroY} />
                </clipPath>
              </defs>
              <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="lp-zero" />
              <text x={W - 4} y={zeroY - 6} textAnchor="end" className="lp-zero-label">
                €0
              </text>
              <path d={area} fill={`url(#${id}-fill)`} clipPath={`url(#${id}-above)`} />
              <path d={area} className="lp-area-neg" clipPath={`url(#${id}-below)`} />
              <path d={line} className="lp-line" clipPath={`url(#${id}-above)`} />
              <path d={line} className="lp-line neg" clipPath={`url(#${id}-below)`} />
              <circle cx={points[0].x} cy={points[0].y} r="5" className="lp-dot-start" />
              {sum.lowestIndex > 0 && (
                <g>
                  <circle cx={low.x} cy={low.y} r="14" className={`lp-pulse ${sum.dips ? 'neg' : ''}`} />
                  <circle cx={low.x} cy={low.y} r="5.5" className={`lp-dot-low ${sum.dips ? 'neg' : ''}`} />
                </g>
              )}
              {labels.map((l, i) => (
                <text key={l + i} x={points[i].x} y={H - 6} textAnchor="middle" className={`lp-xl${i % 2 ? ' odd' : ''}`}>
                  {l}
                </text>
              ))}
            </svg>
            <div className="lp-demo-foot">
              <span>
                {t('In 12 months:')} <strong>{euro(sum.end)}</strong>
              </span>
              {signupsOpen ? (
                <Link className="btn primary" to="/signup">
                  {t('Do it with your own numbers')}
                </Link>
              ) : (
                <Link className="btn primary" to="/login">
                  {t('Log in')}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A bento grid: each card is a small drawing of something Penny shows
// ---------------------------------------------------------------------------------------------------------------------------------
function Bento() {
  const spark = 'M4 70 C 30 66, 44 40, 70 44 S 112 66, 138 50 S 176 14, 198 22 S 236 44, 262 36';
  return (
    <section id="features" className="lp-section lp-tint">
      <div className="lp-wrap">
        <p className="lp-eyebrow lp-center lp-reveal">{t('What is inside')}</p>
        <h2 className="lp-reveal">{t('Everything money asks of you, in one calm place')}</h2>
        <div className="lp-bento">
          <article className="lp-card lp-a lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="trend" size={18} />
              </span>
              <h3>{t('A forecast you can trust')}</h3>
            </header>
            <p>{t('Built from what is pending, what repeats and what is in installments. Up to two years ahead, with a warning before the balance dips below zero.')}</p>
            <div className="lp-mini-forecast" aria-hidden="true">
              <div className="lp-bignum">
                €4,222<small>.57</small>
              </div>
              <span className="lp-ok">
                <Icon name="check" size={14} /> {t('No dip ahead, lowest €4,262 in February')}
              </span>
              <svg viewBox="0 0 266 90" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="lp-spark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${spark} L262 90 L4 90 Z`} fill="url(#lp-spark)" />
                <path d={spark} className="lp-spark" pathLength="1" />
              </svg>
            </div>
          </article>

          <article className="lp-card lp-b lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="bell" size={18} />
              </span>
              <h3>{t('Alerts that arrive in time')}</h3>
            </header>
            <p>{t('In the app, and by e-mail if you want. Before a bill is due, when something is overdue, when the balance is heading down.')}</p>
            <ul className="lp-notes" aria-hidden="true">
              <li>
                <i className="warn" /> {t('Rent is due in 3 days')} <small>€780</small>
              </li>
              <li>
                <i className="bad" /> {t('One overdue payment')} <small>€124</small>
              </li>
              <li>
                <i className="ok" /> {t('11% less spent than last month')}
              </li>
            </ul>
          </article>

          <article className="lp-card lp-c lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="users" size={18} />
              </span>
              <h3>{t('Budget together')}</h3>
            </header>
            <p>{t('A shared budget with your partner, family or flatmates. Nobody sees your personal one.')}</p>
            <div className="lp-people" aria-hidden="true">
              <span style={{ '--h': 215 }}>A</span>
              <span style={{ '--h': 150 }}>S</span>
              <span style={{ '--h': 320 }}>M</span>
              <em>{t('Home · 3 people')}</em>
            </div>
          </article>

          <article className="lp-card lp-d lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="debt" size={18} />
              </span>
              <h3>{t('Debts, both ways')}</h3>
            </header>
            <p>{t('What you owe, with a plan. What you lent, kept apart.')}</p>
            <div className="lp-bars" aria-hidden="true">
              <div>
                <span>{t('Laptop')}</span>
                <b style={{ '--w': '17%' }} />
              </div>
              <div>
                <span>{t('Dentist')}</span>
                <b style={{ '--w': '62%' }} />
              </div>
              <div>
                <span>{t('Lent to Jordan')}</span>
                <b className="lent" style={{ '--w': '40%' }} />
              </div>
            </div>
          </article>

          <article className="lp-card lp-e lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="sparkle" size={18} />
              </span>
              <h3>{t('Ask Penny')}</h3>
            </header>
            <div className="lp-chat" aria-hidden="true">
              <p className="me">{t('What changed this month?')}</p>
              <p className="penny">{t('You are spending 11% less than last month. Utilities and Groceries made the difference.')}</p>
              <p className="typing">
                <i />
                <i />
                <i />
              </p>
            </div>
          </article>

          <article className="lp-card lp-f lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="card" size={18} />
              </span>
              <h3>{t('Installments and cards')}</h3>
            </header>
            <p>{t('Split a purchase, with interest if there is some. Each installment lands on the right card bill, and you can pay part of a bill.')}</p>
            <div className="lp-track" aria-hidden="true">
              {[t('Nov'), t('Dec'), t('Jan'), t('Feb'), t('Mar'), t('Apr')].map((m, i) => (
                <span key={m} className={i < 3 ? 'done' : ''}>
                  <i />
                  {m}
                </span>
              ))}
            </div>
          </article>

          <article className="lp-card lp-h lp-reveal">
            <div className="lp-h-text">
              <header>
                <span className="lp-chipicon">
                  <Icon name="upload" size={18} />
                </span>
                <h3>{t('Bring in a bank statement')}</h3>
              </header>
              <p>
                {t('Drop in a statement from your bank, as a PDF or a spreadsheet file. Penny finds the columns by itself, suggests a category for every line, spots what is already there and shows you everything before it saves a thing. The file is read on your device and never uploaded.')}
              </p>
            </div>
            <div className="lp-import" aria-hidden="true">
              <div className="lp-file">
                <Icon name="file" size={18} />
                <span>{t('statement.pdf')}</span>
                <small>{t('38 lines')}</small>
              </div>
              <ul className="lp-lines">
                <li>
                  <span>{t('Esselunga')}</span>
                  <i style={{ '--c': 'var(--lp-teal)' }}>{t('Groceries')}</i>
                  <b>−€45.30</b>
                </li>
                <li>
                  <span>{t('Zara')}</span>
                  <i style={{ '--c': 'var(--lp-pink)' }}>{t('Clothing')}</i>
                  <b>−€59.90</b>
                </li>
                <li>
                  <span>{t('Netflix')}</span>
                  <i style={{ '--c': 'var(--lp-violet)' }}>{t('Subscriptions')}</i>
                  <b>−€15.49</b>
                </li>
                <li>
                  <span>{t('Uber')}</span>
                  <i style={{ '--c': 'var(--lp-sky)' }}>{t('Transport')}</i>
                  <b>−€18.20</b>
                </li>
                <li className="check">
                  <span>{t('Corner bakery')}</span>
                  <i className="q">{t('Check')}</i>
                  <b>−€5.80</b>
                </li>
              </ul>
            </div>
          </article>

          <article className="lp-card lp-g lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="command" size={18} />
              </span>
              <h3>{t('Fast, and yours')}</h3>
            </header>
            <p>{t('Search or act from anywhere. Light or dark, your accent colour, your dashboard. Any currency per budget. On your phone too.')}</p>
            <div className="lp-keys" aria-hidden="true">
              <kbd>Ctrl</kbd>
              <kbd>K</kbd>
              <span className="lp-swatches">
                <i style={{ background: '#1f5fc4' }} />
                <i style={{ background: '#2a7a3b' }} />
                <i style={{ background: '#6a4fc9' }} />
                <i style={{ background: '#a35f00' }} />
              </span>
            </div>
          </article>

          <article className="lp-card lp-i lp-reveal">
            <div className="lp-i-text">
              <header>
                <span className="lp-chipicon">
                  <Icon name="target" size={18} />
                </span>
                <h3>{t('Plan each month, category by category')}</h3>
              </header>
              <p>
                {t('Give every category an amount for the month, or let Penny suggest it from what you usually spend. You see how much is spent and how much is left, now and at the end of the month, in plain words, and Penny warns you before a category runs over.')}
              </p>
            </div>
            <div className="lp-budget" aria-hidden="true">
              <div className="lp-bud-top">
                <span>{t('Left to spend')}</span>
                <b>€412</b>
                <small>{t('€688 of €1,100 · 12 days left')}</small>
              </div>
              <ul className="lp-bud-list">
                {[
                  [t('Groceries'), t('On track'), 'var(--lp-teal)', 62, t('€248 of €400')],
                  [t('Dining out'), t('Almost used up'), 'var(--lp-amber)', 92, t('€110 of €120')],
                  [t('Transport'), t('Over budget'), 'var(--lp-coral)', 100, t('€96 of €80')],
                ].map(([name, state, color, width, amounts]) => (
                  <li key={name} style={{ '--c': color }}>
                    <span>{name}</span>
                    <em>{state}</em>
                    <div className="lp-bud-bar">
                      <i style={{ width: `${width}%` }} />
                    </div>
                    <small>{amounts}</small>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A tabbed tour of the real pages
// ---------------------------------------------------------------------------------------------------------------------------------
const TOUR = [
  {
    id: 'forecast',
    icon: 'trend',
    get label() { return t('Forecast'); },
    shot: 'forecast',
    get alt() { return t('The Forecast page: balance today, balance in twelve months, and a chart that shows where the balance dips below zero'); },
    get title() { return t('Know your balance before you get there'); },
    get text() { return t('A forecast from what is pending, what repeats and what is in installments, plus an estimate of everyday spending that you can switch off.'); },
    get points() { return [t('3 months, 6 months, a year or two years ahead'), t('A warning when the balance will go below zero or below your own safety buffer'), t('"Safe to spend" per day until your next payday'), t('Leftover money carries into next month; match your bank balance in one click')]; },
  },
  {
    id: 'payments',
    icon: 'list',
    get label() { return t('Payments'); },
    shot: 'payments',
    get alt() { return t('The Payments page: this month\'s payments with their state, category and amount'); },
    get title() { return t('Everything you pay, in one calm list'); },
    get text() { return t('Pending, paid and overdue are clear at a glance. Rent, salary and subscriptions repeat by themselves, weekly, monthly or yearly, with an end date if they have one.'); },
    get points() { return [t('Change one month, or every month still to come'), t('Categories, search and filters'), t('Attach a receipt to a payment'), t('Past dates count as already paid')]; },
  },
  {
    id: 'budget',
    icon: 'target',
    get label() { return t('Budget'); },
    shot: 'budget',
    get alt() { return t('The Monthly budget page: how much is left to spend this month, a bar of what is spent and planned, and sentences about which categories are over or heading over'); },
    get title() { return t('Know how each category is doing, before the month ends'); },
    get text() { return t('Give every category an amount for the month. Penny shows how much of it is spent and how much is left, now and at the end of the month, and says in plain words what needs a look.'); },
    get points() { return [
      t('Let Penny suggest the amounts from what you usually spend, then change any of them'),
      t('A bar for each category, a pace to compare with, and an estimate of where the month will end'),
      t('A warning in the app when a category is nearly used up, and again when it goes over'),
      t('Change a budget from now on, or for one month only; past months keep theirs'),
    ]; },
  },
  {
    id: 'import',
    icon: 'upload',
    get label() { return t('Import'); },
    shot: 'import',
    get alt() { return t('The import window: the lines of a bank statement, each with a suggested category, and a mark on the ones Penny wants you to check'); },
    get title() { return t('Bring in a whole statement instead of typing it'); },
    get text() { return t('Choose a statement from your bank, as a PDF or a spreadsheet file. Penny reads it on your device, suggests a category for every line, and shows you the lot before anything is saved.'); },
    get points() { return [
      t('No list of supported banks: Penny works out the layout of the file itself, and asks you once if it cannot'),
      t('Esselunga is Groceries, Zara is Clothing, Netflix is Subscriptions; what Penny is unsure about is marked'),
      t('Lines already in your payments are spotted, and a scheduled bill can be marked paid instead of added twice'),
      t('Penny remembers the categories you correct; one click undoes a whole import'),
    ]; },
  },
  {
    id: 'installments',
    icon: 'card',
    get label() { return t('Installments'); },
    shot: 'installments',
    get alt() { return t('The Installments page: purchases split over months with their progress'); },
    get title() { return t('Split a purchase, see it on the right bill'); },
    get text() { return t('Buy now, pay over months, with or without interest. For a credit card each installment lands on its own bill month, and you can pay part of a bill and roll the rest over.'); },
    get points() { return [t('Equal installments or amounts you choose'), t('Interest worked out and shown'), t('Pay only part of a card bill; the rest moves on with its interest')]; },
  },
  {
    id: 'debts',
    icon: 'debt',
    get label() { return t('Debts'); },
    shot: 'debts',
    get alt() { return t('The Debts page: two repayment plans with progress bars and the next payment'); },
    get title() { return t('Money you owe, and money owed to you'); },
    get text() { return t('Keep track of what you owe a friend, a shop or the dentist with a plan, a progress bar and a timeline. Money you lent is kept apart, so it never looks like income.'); },
    get points() { return [t('Pay it at once, split over months, or just keep it on file'), t('Choose whether a debt counts in your balance and forecast'), t('See what the balance looks like once everything is paid')]; },
  },
  {
    id: 'shared',
    icon: 'users',
    get label() { return t('Shared'); },
    shot: 'shared',
    get alt() { return t('A shared budget called Home: the dashboard shows the household\'s balance and who it is shared with'); },
    get title() { return t('Budget together, without sharing everything'); },
    get text() { return t('Make a budget with your partner, family or flatmates. Everyone sees what is in it; nobody sees your personal budget or your other details.'); },
    get points() { return [t('Invite people you are connected with'), t('Split a payment and give everyone their share'), t('Leave a shared budget whenever you like')]; },
  },
];

function Tour() {
  const [active, setActive] = useState(TOUR[0].id);
  const cur = TOUR.find((tt) => tt.id === active);
  const onKey = (e) => {
    const i = TOUR.findIndex((tt) => tt.id === active);
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const tt = TOUR[(next + TOUR.length) % TOUR.length];
    setActive(tt.id);
    document.getElementById(`tour-tab-${tt.id}`)?.focus();
  };
  return (
    <section id="tour" className="lp-section">
      <div className="lp-wrap">
        <p className="lp-eyebrow lp-center lp-reveal">{t('Take a look')}</p>
        <h2 className="lp-reveal">{t('The real thing, page by page')}</h2>
        <p className="lp-sub lp-reveal">{t('Every picture is a real page of Penny, with made-up numbers.')}</p>
        <div className="lp-tour lp-reveal">
          <div className="lp-tabs" role="tablist" aria-label={t('Pages of Penny')} aria-orientation="horizontal" onKeyDown={onKey}>
            {TOUR.map((tt) => (
              <button key={tt.id} id={`tour-tab-${tt.id}`} role="tab" type="button" aria-selected={active === tt.id} aria-controls="tour-panel" tabIndex={active === tt.id ? 0 : -1} className={active === tt.id ? 'on' : ''} onClick={() => setActive(tt.id)}>
                <span className="lp-chipicon">
                  <Icon name={tt.icon} size={18} />
                </span>
                <span>
                  <strong>{tt.label}</strong>
                </span>
              </button>
            ))}
          </div>
          <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${cur.id}`} className="lp-tour-panel" key={cur.id}>
            <div className="lp-tour-text">
              <h3>{cur.title}</h3>
              <p>{cur.text}</p>
              <ul>
                {cur.points.map((p) => (
                  <li key={p}>
                    <Icon name="check" size={16} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Shot name={cur.shot} alt={cur.alt} />
          </div>
        </div>
      </div>
    </section>
  );
}

const MARQUEE = [N_('Forecast'), N_('Recurring bills'), N_('Installments'), N_('Credit cards'), N_('Debts'), N_('Shared budgets'), N_('Bank statement import'), N_('Monthly budget'), N_('Receipts'), N_('Alerts'), N_('Insights'), N_('Ask Penny'), N_('Any currency'), N_('Light and dark')];

const STEPS = [
  { icon: 'plus', get title() { return t('Add what you pay and earn'); }, get text() { return t('One-off payments, rent and salary that repeat, installments, money you owe and money owed to you. Enter it once, or import a bank statement.'); } },
  { icon: 'trend', get title() { return t('See what is ahead'); }, get text() { return t('Your balance month by month, a warning well before it dips below zero, and a figure for what is safe to spend today.'); } },
  { icon: 'bell', get title() { return t('Stay in control'); }, get text() { return t('Alerts before a bill is due, plain answers when you ask a question, and nothing hidden in the numbers.'); } },
];

const PRIVACY = [
  { icon: 'shield', get title() { return t('Private by design'); }, get text() { return t('No ads, no tracking, no selling your data. No bank login to hand over, and a statement you import is read on your device, never uploaded.'); } },
  { icon: 'download', get title() { return t('Yours to take'); }, get text() { return t('Download everything you have entered as a file, whenever you like.'); } },
  { icon: 'trash', get title() { return t('Yours to delete'); }, get text() { return t('One button removes your account and everything in it, immediately.'); } },
  { icon: 'eye', get title() { return t('No surprises'); }, get text() { return t('If the person running the site ever has to look inside your account to help you, they need a written reason, and you are told.'); } },
];

const FAQ = [
  { get q() { return t('Is Penny free?'); }, get a() { return t('Yes. You can sign up and use it without paying. A budget app that doesn\'t cost money, imagine that.'); } },
  { get q() { return t('Does it connect to my bank?'); }, get a() { return t('No, on purpose, so Penny never sees your bank login. You enter payments yourself, set them to repeat, or import a statement file from your bank. When your real balance and Penny\'s drift apart, "Match my bank balance" fixes it in one step.'); } },
  { get q() { return t('Can I import a bank statement?'); }, get a() { return t('Yes: a PDF or a spreadsheet file (CSV or Excel), from any bank. Penny works out the layout by itself (it reads English, Italian, German, French, Spanish, Portuguese and Dutch headings), suggests a category for each line and lets you check everything before it saves. The file is read in your browser and never uploaded, and one click undoes an import.'); } },
  { get q() { return t('Can I set a budget for each category?'); }, get a() { return t('Yes. Give each category an amount for the month, or let Penny suggest amounts from what you usually spend. Penny shows how much is spent and left, tells you which categories are heading over, and warns you in the app at 80% and when a category goes over. You can also look back at a finished month.'); } },
  { get q() { return t('Who can see my data?'); }, get a() { return t('You, and the people you share a budget with, in that budget only. The person who runs the site sees account basics, not what your payments are or their amounts. They can look inside your account only to help you, with a written reason, and you are told when it happens.'); } },
  { get q() { return t('Can I share a budget with my partner or family?'); }, get a() { return t('Yes. Make a shared budget and invite people you are connected with. You can also split single payments between people.'); } },
  { get q() { return t('What if I want to leave?'); }, get a() { return t('No hard feelings. Download everything as a file, then delete your account, both in Settings. Deleting is immediate and complete.'); } },
  { get q() { return t('Does it work on my phone?'); }, get a() { return t('Yes. It runs in your phone\'s browser and can be added to your home screen, so your balance is one thumb away.'); } },
];

export default function Landing() {
  const { signupsOpen } = useAuth();
  const to = useLocalPath();

  useEffect(() => {
    const before = document.title;
    document.title = t(TITLE);
    return () => {
      document.title = before;
    };
  }, []);

  // things fade up as they scroll into view (everything is simply shown when motion is reduced or the browser cannot tell)
  useEffect(() => {
    const items = [...document.querySelectorAll('.lp-reveal')];
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      items.forEach((el) => el.classList.add('in'));
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const signup = signupsOpen ? (
    <Link className="btn primary lp-big lp-glow" to="/signup">
      {t('Create your account')}
      <Icon name="right" size={18} />
    </Link>
  ) : null;

  return (
    <div className="landing">
      <a className="skip-link" href="#lp-main">
        {t('Skip to content')}
      </a>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link to={to('/')} className="lp-brand" aria-label={t('Penny, home')}>
            <Wordmark height={26} />
          </Link>
          <nav className="lp-links" aria-label={t('Page sections')}>
            <a href="#try">{t('Try it')}</a>
            <a href="#features">{t('Features')}</a>
            <a href="#tour">{t('Tour')}</a>
            <a href="#privacy">{t('Privacy')}</a>
            <a href="#faq">{t('Questions')}</a>
            <a href={to('/guides')}>{t('Guides')}</a>
          </nav>
          <div className="lp-nav-actions">
            <LanguageLinks />
            <span className="lp-theme-nav">
              <ThemeToggle compact />
            </span>
            <Link className="btn" to="/login">
              {t('Log in')}
            </Link>
            {signupsOpen && (
              <Link className="btn primary" to="/signup">
                {t('Sign up')}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero">
          <div className="lp-aurora" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="lp-wrap">
            <p className="lp-pill">
              <span className="lp-pulse-dot" /> {t('A calm budget for real life')}
            </p>
            <h1>
              {tRich('See your money {span}, not just where it went.', { span: <span className="lp-grad">{t('months ahead')}</span> })}
            </h1>
            <p className="lp-lead">
              {t('Penny turns your payments, recurring bills, installments and debts into one clear forecast. Bring in a bank statement instead of typing, plan each month category by category, and share a budget with the people you live with. No bank login, no ads, no selling your data.')}
            </p>
            <div className="lp-cta">
              {signup}
              <Link className={`btn lp-big${signupsOpen ? '' : ' primary'}`} to="/login">
                {t('Log in')}
              </Link>
            </div>
            <p className="lp-note">{signupsOpen ? t('Free to use · Takes a minute · Works on your phone') : t('Sign-ups are closed for now. If you already have an account, log in.')}</p>

            <div className="lp-stage">
              <div className="lp-hero-shot">
                <Shot name="dashboard" alt={t('The Penny dashboard: balance today, a chart of the balance and forecast, and what needs attention')} priority />
              </div>
              <div className="lp-float f1" aria-hidden="true">
                <span className="ico ok">
                  <Icon name="check" size={16} />
                </span>
                <span>
                  <strong>{t('No dip ahead')}</strong>
                  <small>{t('lowest €4,262 in February')}</small>
                </span>
              </div>
              <div className="lp-float f2" aria-hidden="true">
                <span className="ico">
                  <Icon name="trend" size={16} />
                </span>
                <span>
                  <strong>{t('Safe to spend')}</strong>
                  <small>{t('€176 a day until payday')}</small>
                </span>
              </div>
              <div className="lp-float f3" aria-hidden="true">
                <span className="ico warn">
                  <Icon name="bell" size={16} />
                </span>
                <span>
                  <strong>{t('Rent is due in 3 days')}</strong>
                  <small>{t('€780 · on your calendar')}</small>
                </span>
              </div>
              <div className="lp-float f4" aria-hidden="true">
                <span className="ico">
                  <Icon name="users" size={16} />
                </span>
                <span>
                  <strong>{t('Sam added a payment')}</strong>
                  <small>{t('to Home, your shared budget')}</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-marquee" aria-label={t('What Penny covers')}>
          <div className="lp-marquee-track">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={m + i} aria-hidden={i >= MARQUEE.length ? 'true' : undefined}>
                <i /> {t(m)}
              </span>
            ))}
          </div>
        </div>

        <ForecastDemo signupsOpen={signupsOpen} />

        <Bento />

        <Tour />

        <section id="how" className="lp-section lp-tint">
          <div className="lp-wrap">
            <p className="lp-eyebrow lp-center lp-reveal">{t('How it works')}</p>
            <h2 className="lp-reveal">{t('Three steps, then it looks after itself')}</h2>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="lp-reveal" style={{ '--d': `${i * 90}ms` }}>
                  <span className="lp-step-no" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="lp-chipicon lp-big-icon" aria-hidden="true">
                    <Icon name={s.icon} size={22} />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="lp-dark">
          <div className="lp-wrap">
            <p className="lp-eyebrow lp-center lp-reveal">{t('Privacy')}</p>
            <h2 className="lp-reveal">{t('Your money, your data')}</h2>
            <p className="lp-sub lp-reveal">{t('A budget is personal. Penny is built so that it stays that way.')}</p>
            <ul className="lp-privacy-grid">
              {PRIVACY.map((p, i) => (
                <li key={p.title} className="lp-reveal" style={{ '--d': `${i * 80}ms` }}>
                  <span className="lp-chipicon" aria-hidden="true">
                    <Icon name={p.icon} size={20} />
                  </span>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </li>
              ))}
            </ul>
            <p className="lp-more lp-reveal">
              {tRich('Read the {link} and the {link2}.', { link: <Link to={to('/privacy')}>{t('privacy policy')}</Link>, link2: <Link to={to('/terms')}>{t('terms of use')}</Link> })}
            </p>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-narrow">
            <p className="lp-eyebrow lp-center lp-reveal">{t('Questions')}</p>
            <h2 className="lp-reveal">{t('Good to know')}</h2>
            <div className="lp-faq lp-reveal">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap lp-reveal">
            <h2>{t('Ready to see what is ahead?')}</h2>
            <p>{signupsOpen ? t('Make an account in a minute, and add your first payment. Your coffee will still be hot.') : t('Sign-ups are closed for now. If you already have an account, log in.')}</p>
            <div className="lp-cta lp-cta-center">
              {signupsOpen && (
                <Link className="btn lp-big lp-white" to="/signup">
                  {t('Create your account')}
                  <Icon name="right" size={18} />
                </Link>
              )}
              <Link className={`btn lp-big ${signupsOpen ? 'lp-ghost' : 'lp-white'}`} to="/login">
                {t('Log in')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <Wordmark height={22} />
          <nav aria-label={t('Footer')}>
            <a href={to('/guides')}>{t('Guides')}</a>
            <Link to={to('/terms')}>{t('Terms of use')}</Link>
            <Link to={to('/privacy')}>{t('Privacy policy')}</Link>
            <Link to="/login">{t('Log in')}</Link>
            {signupsOpen && <Link to="/signup">{t('Sign up')}</Link>}
            <Link to={to('/contact')}>{t('Contact')}</Link>
          </nav>
          <LanguageLinks className="lp-lang-foot" />
          <span className="lp-theme-foot">
            <ThemeToggle compact />
          </span>
          <span className="lp-copy">{t('© {getFullYear} Penny', { getFullYear: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </div>
  );
}
