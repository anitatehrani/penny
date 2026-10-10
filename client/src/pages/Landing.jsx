import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '../components/Logo.jsx';
import { Icon, ThemeToggle } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { chartPoints, monthLabels, projectBalance, smoothPath, summarizeProjection } from '../landingLogic.js';

/**
 * The page a visitor sees first (docs/DESIGN.md section 37): what Penny is, what it does, something to play with, and a way in. Public, shown
 * at "/" to anybody who is not signed in (signed-in people go straight to their dashboard). The screenshots are real pages of the demo account
 * in light and dark; the small cards are drawings of what Penny shows, in the same colours. Every claim is something Penny really does.
 */
const TITLE = 'Penny: see your money months ahead';

const euro = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

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
      <img className="lp-shot lp-shot-dark" src={`/landing/${name}-dark.webp`} {...common} />
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Something to play with: a small forecast the visitor can bend
// ---------------------------------------------------------------------------------------------------------------------------------
const SLIDERS = [
  { key: 'start', label: 'In the bank today', min: 0, max: 10000, step: 100 },
  { key: 'income', label: 'Coming in each month', min: 500, max: 6000, step: 100 },
  { key: 'bills', label: 'Bills each month', hint: 'rent, subscriptions, installments', min: 300, max: 4500, step: 100 },
  { key: 'spending', label: 'Everyday spending', hint: 'food, transport, fun', min: 0, max: 2500, step: 50 },
  { key: 'purchase', label: 'One big purchase', min: 0, max: 6000, step: 100 },
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
        <p className="lp-eyebrow lp-center lp-reveal">Try it</p>
        <h2 className="lp-reveal">Bend a year, see where it lands</h2>
        <p className="lp-sub lp-reveal">Move the sliders. This is the idea behind Penny&apos;s forecast, with your own payments in place of these numbers.</p>
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
                <span>…in month</span>
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
                    You would go below zero in <strong>{labels[sum.firstNegative]}</strong> (lowest {euro(sum.lowest)}). Penny warns you well before.
                  </>
                ) : (
                  <>
                    No dip ahead. Lowest point <strong>{euro(sum.lowest)}</strong>{sum.lowestIndex ? <> in {labels[sum.lowestIndex]}</> : ' is today'}.
                  </>
                )}
              </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="lp-chart" role="img" aria-label={`A twelve month forecast. It ends at ${euro(sum.end)}, and its lowest point is ${euro(sum.lowest)}.`}>
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
                In 12 months: <strong>{euro(sum.end)}</strong>
              </span>
              {signupsOpen ? (
                <Link className="btn primary" to="/signup">
                  Do it with your own numbers
                </Link>
              ) : (
                <Link className="btn primary" to="/login">
                  Log in
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
        <p className="lp-eyebrow lp-center lp-reveal">What is inside</p>
        <h2 className="lp-reveal">Everything money asks of you, in one calm place</h2>
        <div className="lp-bento">
          <article className="lp-card lp-a lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="trend" size={18} />
              </span>
              <h3>A forecast you can trust</h3>
            </header>
            <p>Built from what is pending, what repeats and what is in installments. Up to two years ahead, with a warning before the balance dips below zero.</p>
            <div className="lp-mini-forecast" aria-hidden="true">
              <div className="lp-bignum">
                €4,222<small>.57</small>
              </div>
              <span className="lp-ok">
                <Icon name="check" size={14} /> No dip ahead, lowest €4,262 in February
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
              <h3>Alerts that arrive in time</h3>
            </header>
            <p>In the app, and by e-mail if you want. Before a bill is due, when something is overdue, when the balance is heading down.</p>
            <ul className="lp-notes" aria-hidden="true">
              <li>
                <i className="warn" /> Rent is due in 3 days <small>€780</small>
              </li>
              <li>
                <i className="bad" /> One overdue payment <small>€124</small>
              </li>
              <li>
                <i className="ok" /> 11% less spent than last month
              </li>
            </ul>
          </article>

          <article className="lp-card lp-c lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="users" size={18} />
              </span>
              <h3>Budget together</h3>
            </header>
            <p>A shared budget with your partner, family or flatmates. Nobody sees your personal one.</p>
            <div className="lp-people" aria-hidden="true">
              <span style={{ '--h': 215 }}>A</span>
              <span style={{ '--h': 150 }}>S</span>
              <span style={{ '--h': 320 }}>M</span>
              <em>Home · 3 people</em>
            </div>
          </article>

          <article className="lp-card lp-d lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="debt" size={18} />
              </span>
              <h3>Debts, both ways</h3>
            </header>
            <p>What you owe, with a plan. What you lent, kept apart.</p>
            <div className="lp-bars" aria-hidden="true">
              <div>
                <span>Laptop</span>
                <b style={{ '--w': '17%' }} />
              </div>
              <div>
                <span>Dentist</span>
                <b style={{ '--w': '62%' }} />
              </div>
              <div>
                <span>Lent to Jordan</span>
                <b className="lent" style={{ '--w': '40%' }} />
              </div>
            </div>
          </article>

          <article className="lp-card lp-e lp-reveal">
            <header>
              <span className="lp-chipicon">
                <Icon name="sparkle" size={18} />
              </span>
              <h3>Ask Penny</h3>
            </header>
            <div className="lp-chat" aria-hidden="true">
              <p className="me">What changed this month?</p>
              <p className="penny">You are spending 11% less than last month. Utilities and Groceries made the difference.</p>
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
              <h3>Installments and cards</h3>
            </header>
            <p>Split a purchase, with interest if there is some. Each installment lands on the right card bill, and you can pay part of a bill.</p>
            <div className="lp-track" aria-hidden="true">
              {['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'].map((m, i) => (
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
                <h3>Bring in a bank statement</h3>
              </header>
              <p>
                Drop in a statement from your bank, as a PDF or a spreadsheet file. Penny finds the columns by itself, suggests a category for every line, spots what is already there and shows you everything before it saves a thing. The file is read on your
                device and never uploaded.
              </p>
            </div>
            <div className="lp-import" aria-hidden="true">
              <div className="lp-file">
                <Icon name="file" size={18} />
                <span>statement.pdf</span>
                <small>38 lines</small>
              </div>
              <ul className="lp-lines">
                <li>
                  <span>Esselunga</span>
                  <i style={{ '--c': 'var(--lp-teal)' }}>Groceries</i>
                  <b>−€45.30</b>
                </li>
                <li>
                  <span>Zara</span>
                  <i style={{ '--c': 'var(--lp-pink)' }}>Clothing</i>
                  <b>−€59.90</b>
                </li>
                <li>
                  <span>Netflix</span>
                  <i style={{ '--c': 'var(--lp-violet)' }}>Subscriptions</i>
                  <b>−€15.49</b>
                </li>
                <li>
                  <span>Uber</span>
                  <i style={{ '--c': 'var(--lp-sky)' }}>Transport</i>
                  <b>−€18.20</b>
                </li>
                <li className="check">
                  <span>Corner bakery</span>
                  <i className="q">Check</i>
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
              <h3>Fast, and yours</h3>
            </header>
            <p>Search or act from anywhere. Light or dark, your accent colour, your dashboard. Any currency per budget. On your phone too.</p>
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
    label: 'Forecast',
    shot: 'forecast',
    alt: 'The Forecast page: balance today, balance in twelve months, and a chart that shows where the balance dips below zero',
    title: 'Know your balance before you get there',
    text: 'A forecast from what is pending, what repeats and what is in installments, plus an estimate of everyday spending that you can switch off.',
    points: ['3 months, 6 months, a year or two years ahead', 'A warning when the balance will go below zero or below your own safety buffer', '"Safe to spend" per day until your next payday', 'Leftover money carries into next month; match your bank balance in one click'],
  },
  {
    id: 'payments',
    icon: 'list',
    label: 'Payments',
    shot: 'payments',
    alt: 'The Payments page: this month\'s payments with their state, category and amount',
    title: 'Everything you pay, in one calm list',
    text: 'Pending, paid and overdue are clear at a glance. Rent, salary and subscriptions repeat by themselves, weekly, monthly or yearly, with an end date if they have one.',
    points: ['Change one month, or every month still to come', 'Categories, search and filters', 'Attach a receipt to a payment', 'Past dates count as already paid'],
  },
  {
    id: 'import',
    icon: 'upload',
    label: 'Import',
    shot: 'import',
    alt: 'The import window: the lines of a bank statement, each with a suggested category, and a mark on the ones Penny wants you to check',
    title: 'Bring in a whole statement instead of typing it',
    text: 'Choose a statement from your bank, as a PDF or a spreadsheet file. Penny reads it on your device, suggests a category for every line, and shows you the lot before anything is saved.',
    points: [
      'No list of supported banks: Penny works out the layout of the file itself, and asks you once if it cannot',
      'Esselunga is Groceries, Zara is Clothing, Netflix is Subscriptions; what Penny is unsure about is marked',
      'Lines already in your payments are spotted, and a scheduled bill can be marked paid instead of added twice',
      'Penny remembers the categories you correct; one click undoes a whole import',
    ],
  },
  {
    id: 'installments',
    icon: 'card',
    label: 'Installments',
    shot: 'installments',
    alt: 'The Installments page: purchases split over months with their progress',
    title: 'Split a purchase, see it on the right bill',
    text: 'Buy now, pay over months, with or without interest. For a credit card each installment lands on its own bill month, and you can pay part of a bill and roll the rest over.',
    points: ['Equal installments or amounts you choose', 'Interest worked out and shown', 'Pay only part of a card bill; the rest moves on with its interest'],
  },
  {
    id: 'debts',
    icon: 'debt',
    label: 'Debts',
    shot: 'debts',
    alt: 'The Debts page: two repayment plans with progress bars and the next payment',
    title: 'Money you owe, and money owed to you',
    text: 'Keep track of what you owe a friend, a shop or the dentist with a plan, a progress bar and a timeline. Money you lent is kept apart, so it never looks like income.',
    points: ['Pay it at once, split over months, or just keep it on file', 'Choose whether a debt counts in your balance and forecast', 'See what the balance looks like once everything is paid'],
  },
  {
    id: 'shared',
    icon: 'users',
    label: 'Shared',
    shot: 'shared',
    alt: 'A shared budget called Home: the dashboard shows the household\'s balance and who it is shared with',
    title: 'Budget together, without sharing everything',
    text: 'Make a budget with your partner, family or flatmates. Everyone sees what is in it; nobody sees your personal budget or your other details.',
    points: ['Invite people you are connected with', 'Split a payment and give everyone their share', 'Leave a shared budget whenever you like'],
  },
];

function Tour() {
  const [active, setActive] = useState(TOUR[0].id);
  const cur = TOUR.find((t) => t.id === active);
  const onKey = (e) => {
    const i = TOUR.findIndex((t) => t.id === active);
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TOUR[(next + TOUR.length) % TOUR.length];
    setActive(t.id);
    document.getElementById(`tour-tab-${t.id}`)?.focus();
  };
  return (
    <section id="tour" className="lp-section">
      <div className="lp-wrap">
        <p className="lp-eyebrow lp-center lp-reveal">Take a look</p>
        <h2 className="lp-reveal">The real thing, page by page</h2>
        <p className="lp-sub lp-reveal">Every picture is a real page of Penny, with made-up numbers.</p>
        <div className="lp-tour lp-reveal">
          <div className="lp-tabs" role="tablist" aria-label="Pages of Penny" aria-orientation="horizontal" onKeyDown={onKey}>
            {TOUR.map((t) => (
              <button key={t.id} id={`tour-tab-${t.id}`} role="tab" type="button" aria-selected={active === t.id} aria-controls="tour-panel" tabIndex={active === t.id ? 0 : -1} className={active === t.id ? 'on' : ''} onClick={() => setActive(t.id)}>
                <span className="lp-chipicon">
                  <Icon name={t.icon} size={18} />
                </span>
                <span>
                  <strong>{t.label}</strong>
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

const MARQUEE = ['Forecast', 'Recurring bills', 'Installments', 'Credit cards', 'Debts', 'Shared budgets', 'Bank statement import', 'Receipts', 'Alerts', 'Insights', 'Ask Penny', 'Any currency', 'Light and dark'];

const STEPS = [
  { icon: 'plus', title: 'Add what you pay and earn', text: 'One-off payments, rent and salary that repeat, installments, money you owe and money owed to you. Enter it once, or import a bank statement.' },
  { icon: 'trend', title: 'See what is ahead', text: 'Your balance month by month, a warning well before it dips below zero, and a figure for what is safe to spend today.' },
  { icon: 'bell', title: 'Stay in control', text: 'Alerts before a bill is due, plain answers when you ask a question, and nothing hidden in the numbers.' },
];

const PRIVACY = [
  { icon: 'shield', title: 'Private by design', text: 'No ads, no tracking, no selling your data. No bank login to hand over, and a statement you import is read on your device, never uploaded.' },
  { icon: 'download', title: 'Yours to take', text: 'Download everything you have entered as a file, whenever you like.' },
  { icon: 'trash', title: 'Yours to delete', text: 'One button removes your account and everything in it, immediately.' },
  { icon: 'eye', title: 'No surprises', text: 'If the person running the site ever has to look inside your account to help you, they need a written reason, and you are told.' },
];

const FAQ = [
  { q: 'Is Penny free?', a: 'Yes. You can sign up and use it without paying.' },
  { q: 'Does it connect to my bank?', a: 'No, on purpose, so Penny never sees your bank login. You enter payments yourself, set them to repeat, or import a statement file from your bank. When your real balance and Penny\'s drift apart, "Match my bank balance" fixes it in one step.' },
  { q: 'Can I import a bank statement?', a: 'Yes: a PDF or a spreadsheet file (CSV or Excel), from any bank. Penny works out the layout by itself (it reads English, Italian, German, French, Spanish, Portuguese and Dutch headings), suggests a category for each line and lets you check everything before it saves. The file is read in your browser and never uploaded, and one click undoes an import.' },
  { q: 'Who can see my data?', a: 'You, and the people you share a budget with, in that budget only. The person who runs the site sees account basics, not what your payments are or their amounts. They can look inside your account only to help you, with a written reason, and you are told when it happens.' },
  { q: 'Can I share a budget with my partner or family?', a: 'Yes. Make a shared budget and invite people you are connected with. You can also split single payments between people.' },
  { q: 'What if I want to leave?', a: 'Download everything as a file, then delete your account, both in Settings. Deleting is immediate and complete.' },
  { q: 'Does it work on my phone?', a: 'Yes. It runs in your phone\'s browser and can be added to your home screen.' },
];

export default function Landing() {
  const { signupsOpen } = useAuth();

  useEffect(() => {
    const before = document.title;
    document.title = TITLE;
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
      Create your account
      <Icon name="right" size={18} />
    </Link>
  ) : null;

  return (
    <div className="landing">
      <a className="skip-link" href="#lp-main">
        Skip to content
      </a>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link to="/" className="lp-brand" aria-label="Penny, home">
            <Wordmark height={26} />
          </Link>
          <nav className="lp-links" aria-label="Page sections">
            <a href="#try">Try it</a>
            <a href="#features">Features</a>
            <a href="#tour">Tour</a>
            <a href="#privacy">Privacy</a>
            <a href="#faq">Questions</a>
          </nav>
          <div className="lp-nav-actions">
            <span className="lp-theme-nav">
              <ThemeToggle compact />
            </span>
            <Link className="btn" to="/login">
              Log in
            </Link>
            {signupsOpen && (
              <Link className="btn primary" to="/signup">
                Sign up
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
              <span className="lp-pulse-dot" /> A calm budget for real life
            </p>
            <h1>
              See your money <span className="lp-grad">months ahead</span>, not just where it went.
            </h1>
            <p className="lp-lead">
              Penny turns your payments, recurring bills, installments and debts into one clear forecast. Bring in a bank statement instead of typing, and share a budget with the people you live with. No bank login, no ads, no selling your data.
            </p>
            <div className="lp-cta">
              {signup}
              <Link className={`btn lp-big${signupsOpen ? '' : ' primary'}`} to="/login">
                Log in
              </Link>
            </div>
            <p className="lp-note">{signupsOpen ? 'Free to use · Takes a minute · Works on your phone' : 'Sign-ups are closed for now. If you already have an account, log in.'}</p>

            <div className="lp-stage">
              <div className="lp-hero-shot">
                <Shot name="dashboard" alt="The Penny dashboard: balance today, a chart of the balance and forecast, and what needs attention" priority />
              </div>
              <div className="lp-float f1" aria-hidden="true">
                <span className="ico ok">
                  <Icon name="check" size={16} />
                </span>
                <span>
                  <strong>No dip ahead</strong>
                  <small>lowest €4,262 in February</small>
                </span>
              </div>
              <div className="lp-float f2" aria-hidden="true">
                <span className="ico">
                  <Icon name="trend" size={16} />
                </span>
                <span>
                  <strong>Safe to spend</strong>
                  <small>€176 a day until payday</small>
                </span>
              </div>
              <div className="lp-float f3" aria-hidden="true">
                <span className="ico warn">
                  <Icon name="bell" size={16} />
                </span>
                <span>
                  <strong>Rent is due in 3 days</strong>
                  <small>€780 · on your calendar</small>
                </span>
              </div>
              <div className="lp-float f4" aria-hidden="true">
                <span className="ico">
                  <Icon name="users" size={16} />
                </span>
                <span>
                  <strong>Sam added a payment</strong>
                  <small>to Home, your shared budget</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-marquee" aria-label="What Penny covers">
          <div className="lp-marquee-track">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={m + i} aria-hidden={i >= MARQUEE.length ? 'true' : undefined}>
                <i /> {m}
              </span>
            ))}
          </div>
        </div>

        <ForecastDemo signupsOpen={signupsOpen} />

        <Bento />

        <Tour />

        <section id="how" className="lp-section lp-tint">
          <div className="lp-wrap">
            <p className="lp-eyebrow lp-center lp-reveal">How it works</p>
            <h2 className="lp-reveal">Three steps, then it looks after itself</h2>
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
            <p className="lp-eyebrow lp-center lp-reveal">Privacy</p>
            <h2 className="lp-reveal">Your money, your data</h2>
            <p className="lp-sub lp-reveal">A budget is personal. Penny is built so that it stays that way.</p>
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
              Read the <Link to="/privacy">privacy policy</Link> and the <Link to="/terms">terms of use</Link>.
            </p>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-narrow">
            <p className="lp-eyebrow lp-center lp-reveal">Questions</p>
            <h2 className="lp-reveal">Good to know</h2>
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
            <h2>Ready to see what is ahead?</h2>
            <p>{signupsOpen ? 'Make an account in a minute, and add your first payment.' : 'Sign-ups are closed for now. If you already have an account, log in.'}</p>
            <div className="lp-cta lp-cta-center">
              {signupsOpen && (
                <Link className="btn lp-big lp-white" to="/signup">
                  Create your account
                  <Icon name="right" size={18} />
                </Link>
              )}
              <Link className={`btn lp-big ${signupsOpen ? 'lp-ghost' : 'lp-white'}`} to="/login">
                Log in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <Wordmark height={22} />
          <nav aria-label="Footer">
            <Link to="/terms">Terms of use</Link>
            <Link to="/privacy">Privacy policy</Link>
            <Link to="/login">Log in</Link>
            {signupsOpen && <Link to="/signup">Sign up</Link>}
            <Link to="/contact">Contact</Link>
          </nav>
          <span className="lp-theme-foot">
            <ThemeToggle compact />
          </span>
          <span className="lp-copy">© {new Date().getFullYear()} Penny</span>
        </div>
      </footer>
    </div>
  );
}
