import { Link } from 'react-router-dom';
import { Wordmark } from '../components/Logo.jsx';
import { ThemeToggle } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

/**
 * The terms and the privacy policy (docs/DESIGN.md section 36). Public: they work signed in or out, and are linked from the sign-in and
 * sign-up pages and from Settings. The text says what Penny really does; when what Penny does changes, change it here AND bump
 * TERMS_VERSION in server/src/lib/legal.js, so people are asked again.
 */
const longDate = (version) => {
  const d = new Date(`${version}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? version : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export function LegalShell({ which, title, children }) {
  const { user, legal } = useAuth();
  return (
    <div className="legal-page">
      <header className="legal-top">
        <Link to="/" className="legal-brand" aria-label="Penny, home">
          <Wordmark height={26} />
        </Link>
        <nav aria-label="Legal pages" className="legal-nav">
          <Link to="/terms" aria-current={which === 'terms' ? 'page' : undefined}>
            Terms of use
          </Link>
          <Link to="/privacy" aria-current={which === 'privacy' ? 'page' : undefined}>
            Privacy policy
          </Link>
          <Link to="/contact" aria-current={which === 'contact' ? 'page' : undefined}>
            Contact
          </Link>
        </nav>
        <div className="legal-theme">
          <ThemeToggle compact />
        </div>
      </header>
      <main className="legal-main" id="main">
        <article className="legal-article">
          <h1>{title}</h1>
          {which !== 'contact' && <p className="legal-updated">Last updated {longDate(legal.termsVersion)}</p>}
          {children}
        </article>
        <p className="legal-back">
          <Link to="/">{user ? 'Back to Penny' : 'Back to the home page'}</Link>
        </p>
      </main>
    </div>
  );
}

/** Who runs the site and how to reach them: always the contact form, and the address too when one has been set. */
function Operator() {
  const { legal } = useAuth();
  return (
    <p>
      <strong>{legal.operatorName ?? 'The person who runs this site'}</strong> runs Penny. You can write about anything on this page, your data or your account
      through the <Link to="/contact">contact form</Link>
      {legal.contactEmail ? (
        <>
          {' '}
          or by e-mail to <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>.
        </>
      ) : (
        '.'
      )}
    </p>
  );
}

export function Terms() {
  return (
    <LegalShell which="terms" title="Terms of use">
      <p className="legal-lead">
        These are the rules for using Penny, in plain language. By creating an account you agree to them and to the{' '}
        <Link to="/privacy">privacy policy</Link>.
      </p>
      <Operator />

      <h2>1. What Penny is</h2>
      <p>
        Penny is a tool for planning your own money: you enter payments, recurring items, installments and debts, and it shows what is
        coming and where your balance is heading. It is <strong>not financial, tax or legal advice</strong>. What it shows is only as good as
        what you enter, and a forecast is an estimate, not a promise. Decisions about your money are yours.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 16 years old.</li>
        <li>Give true details and keep your password to yourself. One account is for one person.</li>
        <li>You are responsible for what happens in your account. If you think someone else got in, change your password at once and tell us.</li>
        <li>You can sign in with an e-mail address and password, or with Google if it is switched on.</li>
        <li>Sign-ups may be closed or limited at any time.</li>
      </ul>

      <h2>3. Your data</h2>
      <p>
        What you enter is yours. You allow us to store it and process it only to run Penny for you, as the <Link to="/privacy">privacy policy</Link>{' '}
        describes. You can download it and delete it at any time (Settings, then Account).
      </p>
      <p>
        <strong>Shared budgets:</strong> when you are in a shared budget, everyone in it sees what is in it. When you add someone to a
        payment, they see its description, date, amount and their own share. Think about that before you put something in.
      </p>

      <h2>4. How you may use Penny</h2>
      <p>Please do not:</p>
      <ul>
        <li>break the law, or use Penny to cheat, harass or threaten anyone;</li>
        <li>try to get into somebody else&apos;s account or into the parts of the site that are not meant for you;</li>
        <li>overload the site, copy it automatically in bulk, or probe it for weaknesses without permission (if you find one, please tell us);</li>
        <li>upload anything other than your own receipts and photo (images and PDFs), or anything unlawful or harmful.</li>
      </ul>

      <h2>5. Support access to an account</h2>
      <p>
        To help someone, the person who runs the site can open that person&apos;s account in a &ldquo;view as&rdquo; mode. It needs a written
        reason and the administrator&apos;s own password, lasts at most 30 minutes, is read-only unless changes are switched on for that
        visit, and never lets them sign in as you or change how you sign in. <strong>You are told when it happens</strong>, and it is written
        in the site&apos;s activity log.
      </p>

      <h2>6. Availability and backups</h2>
      <p>
        Penny is run by an individual, without a guarantee that it is always available or that nothing is ever lost. Backups are made every
        day (the last 14 days, and one a month for about six months are kept), but they are for recovering from a mistake or a failure, not a
        promise. <strong>Keep your own copy</strong> of anything you cannot lose: Settings, then Account, then &ldquo;Download my data&rdquo;.
      </p>

      <h2>7. Ending your use</h2>
      <p>
        You can delete your account whenever you like in Settings, then Account. We may suspend or delete an account that breaks these rules
        or puts the site or other people at risk, and where we can we will say why.
      </p>

      <h2>8. Responsibility</h2>
      <p>
        Penny is provided as it is. As far as the law allows, we are not responsible for losses that come from relying on the numbers it shows,
        from the site being unavailable, or from data being lost. Nothing here limits responsibility that cannot be limited by law, and nothing
        takes away the rights you have as a consumer where you live.
      </p>

      <h2>9. Changes</h2>
      <p>
        If these terms change in a way that matters, the date above changes and you are asked to accept them again the next time you use
        Penny. If you do not agree, you can download your data and delete your account.
      </p>

      <h2>10. Which law applies</h2>
      <p>
        These terms follow the law that applies where the person who runs the site lives, without taking away protection you have under the
        law of the country where you live.
      </p>
    </LegalShell>
  );
}

export function Privacy() {
  return (
    <LegalShell which="privacy" title="Privacy policy">
      <p className="legal-lead">What Penny knows about you, why, who else can see it, and what you can do about it.</p>
      <Operator />

      <section className="legal-summary" aria-label="In short">
        <h2>In short</h2>
        <ul>
          <li>Penny keeps what you enter and the details of your account. That is all it is for.</li>
          <li>No advertising, no selling your data, no tracking or analytics, no profiling.</li>
          <li>You can download everything and delete your account yourself, any time.</li>
          <li>The people you share a budget with see that budget. The person who runs the site cannot see your amounts in the admin pages, and can only look inside your account to help you, with a reason, and you are told.</li>
        </ul>
      </section>

      <h2>What Penny keeps</h2>
      <h3>About you</h3>
      <p>
        Your name, e-mail address and username; your phone number and profile photo if you give them; your password (kept only as a one-way
        scrambled value, never the password itself); if you use Google to sign in, Google&apos;s identifier for you and your Google photo. Your
        choices: who may find you, notification settings and how you like the pages to look.
      </p>
      <h3>What you enter</h3>
      <p>
        Payments, recurring items, installments, debts, categories, notes, receipts you upload, your budgets and who is in them, and your
        connections with other people.
      </p>
      <h3>Messages you send us</h3>
      <p>
        If you use the <Link to="/contact">contact form</Link>: your name, e-mail address, the topic and your message. The person who runs the site reads it and
        answers by e-mail. It is kept for a year and then deleted, or earlier if they delete it. A message sent while you are signed in is part of
        &ldquo;Download my data&rdquo; and is deleted with your account.
      </p>
      <h3>Technical and security records</h3>
      <ul>
        <li>When you last signed in and were last active, and the browser name of each signed-in device.</li>
        <li>
          An activity log of sign-ups, sign-ins, failed sign-ins and account changes. It holds a <strong>short code made from your network
          address</strong>, not the address itself, and is kept 90 days.
        </li>
        <li>A list of the e-mails sent to you (address, subject and whether it was delivered), removed when you delete your account.</li>
        <li>The web server does not keep access logs.</li>
      </ul>

      <h2>Why, and on what basis</h2>
      <ul>
        <li><strong>To give you Penny</strong> (the agreement between us): your account, your budgets, forecasts, alerts you turn on.</li>
        <li><strong>To keep the site safe</strong> (our legitimate interest): the activity log, limits on repeated tries, backups.</li>
        <li><strong>E-mails you asked for:</strong> confirming your address, resetting your password, and payment alerts only if you switch them on, which you can undo at any time.</li>
      </ul>
      <p>That is all. Your data is not used for anything else.</p>

      <h2>Who can see it</h2>
      <ul>
        <li><strong>You.</strong></li>
        <li><strong>People in a budget you share:</strong> everything in that budget. Other members only see your name and username, not your e-mail address or your other budgets.</li>
        <li>
          <strong>The person who runs the site</strong> sees account basics (name, username, e-mail, when you joined, how many entries you
          have), not what the entries are or their amounts. To help you they can open your account in &ldquo;view as&rdquo; mode, with a
          reason, for at most 30 minutes, and you are told.
        </li>
        <li>
          <strong>Service providers who work for us</strong> and only on our instructions: Microsoft Azure, which hosts Penny on servers in
          Spain; Brevo, a European e-mail delivery service, which handles your address and the e-mails we send you; and Google, only if
          you choose &ldquo;Sign in with Google&rdquo; (it knows you signed in).
        </li>
        <li>Public authorities, only where the law requires it.</li>
      </ul>
      <p>We do not sell your data and we do not pass it to advertisers or data brokers.</p>

      <h2>How long it is kept</h2>
      <ul>
        <li>Your account and everything in it: until you delete your account. Deleting is immediate and complete.</li>
        <li>Backups: daily copies are kept 14 days and one copy a month for about six months, so a deleted account can remain in a backup for up to about six months, then it is overwritten. Nobody looks inside backups except to recover from a failure.</li>
        <li>Activity log: 90 days, and after you delete your account it no longer points to you.</li>
        <li>Messages sent through the contact form: one year (a message sent while signed in is deleted with your account).</li>
      </ul>

      <h2>Cookies and what your browser stores</h2>
      <p>
        Penny sets <strong>one cookie</strong>, needed to keep you signed in (it lasts up to 30 days, or until you sign out). Your browser also
        keeps your theme, your layout choices and which budget you had open, so the pages look as you left them. There are no tracking or
        advertising cookies. If Google sign-in is switched on, the sign-in and sign-up pages load Google&apos;s button, and Google may set its
        own cookies there.
      </p>

      <h2>Your rights</h2>
      <p>If you are in the European Union or the United Kingdom (and in many other places) you can:</p>
      <ul>
        <li><strong>See and take your data:</strong> Settings, Account, &ldquo;Download my data&rdquo; gives you a file with everything.</li>
        <li><strong>Correct it:</strong> change your details and entries in Penny.</li>
        <li><strong>Delete it:</strong> Settings, Account, &ldquo;Delete my account&rdquo;. If you share a budget with others you leave it first.</li>
        <li><strong>Object or ask us to limit what we do:</strong> write to us through the <Link to="/contact">contact form</Link>.</li>
        <li><strong>Take back a consent</strong>, for example by switching e-mail alerts off.</li>
        <li><strong>Complain</strong> to your country&apos;s data protection authority. We would like the chance to put things right first.</li>
      </ul>

      <h2>Security</h2>
      <p>
        The site uses HTTPS, passwords are stored scrambled, repeated wrong guesses are blocked, signing out ends a session, and the database
        is not reachable from the internet. No system is perfectly safe. If something happens that puts your data at risk, we will tell you.
      </p>

      <h2>Children</h2>
      <p>Penny is not for people under 16, and we do not knowingly keep their data. If you think a child has an account, tell us and we will delete it.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, the date at the top changes and you are asked to accept it again. Older versions are
        not kept on the site, but you can ask for one.
      </p>
    </LegalShell>
  );
}
