import { appUrl } from './mailer.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
};
export { money as formatMoney };

/** "today", "tomorrow", "in 3 days (Sat 5 Oct)", "2 days overdue" relative to `today` (YYYY-MM-DD). */
export function relativeDate(date, today) {
  const d = Math.round((Date.UTC(...date.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(...today.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))) / 86_400_000);
  const nice = new Date(`${date}T12:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (d === 0) return `due today (${nice})`;
  if (d === 1) return `due tomorrow (${nice})`;
  if (d > 1) return `due in ${d} days (${nice})`;
  if (d === -1) return `1 day overdue (${nice})`;
  return `${-d} days overdue (${nice})`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The look of every e-mail (docs/DESIGN.md section 39): one frame, a few building blocks, inline styles (mail programs ignore most CSS),
// a dark version for programs that honour prefers-color-scheme, and a hidden "preheader" line that shows next to the subject in the inbox.
// ---------------------------------------------------------------------------------------------------------------------------------
const VIOLET = '#6a4fc9';
const GRADIENT = 'linear-gradient(90deg,#6a4fc9,#e8409a 60%,#ff7a45)';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const DARK_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .bg { background: #0e0f0d !important; }
    .card { background: #171815 !important; border-color: #2a2b27 !important; }
    .ink { color: #f1f1ec !important; }
    .ink2 { color: #c9cac2 !important; }
    .muted { color: #9a9b93 !important; }
    .rule { border-color: #2a2b27 !important; }
    .soft { background: #211d3a !important; border-color: #3a3270 !important; }
    .warn { background: #3a1f1c !important; border-color: #6b2f2a !important; }
    .quote { border-color: #4a3f8a !important; }
    .lnk { color: #b4a2f6 !important; }
  }
  @media (max-width: 600px) {
    .pad { padding: 24px 20px 26px !important; }
    .h1 { font-size: 22px !important; }
  }`;

const shell = (title, inner, footer, { preheader = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title><style>${DARK_CSS}</style></head>
<body class="bg" style="margin:0;padding:0;background:#f4f3ee;font-family:${FONT};color:#16171a;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(preheader)}${'&#8199;&zwnj;'.repeat(preheader ? 40 : 0)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#f4f3ee"><tr><td align="center" style="padding:30px 12px 36px">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
    <tr><td style="padding:0 6px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle"><img src="${esc(appUrl())}/icon-192.png" width="34" height="34" alt="" style="display:block;border:0;border-radius:9px"></td>
        <td class="ink" style="vertical-align:middle;padding-left:10px;font-size:21px;font-weight:700;letter-spacing:-0.02em;color:#16171a">Penny</td>
      </tr></table>
    </td></tr>
    <tr><td class="card" style="background:#ffffff;border:1px solid #e6e3da;border-radius:18px;overflow:hidden">
      <div style="height:5px;line-height:5px;font-size:0;background:${VIOLET};background-image:${GRADIENT}">&nbsp;</div>
      <div class="pad" style="padding:32px 34px 34px">
        <h1 class="h1 ink" style="margin:0 0 16px;font-size:24px;line-height:1.25;letter-spacing:-0.02em;font-weight:750;color:#16171a">${esc(title)}</h1>
        ${inner}
      </div>
    </td></tr>
    <tr><td class="muted" style="padding:20px 10px 0;color:#7a7a72;font-size:12px;line-height:1.65">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;

/** A paragraph of body text. `html` is trusted markup built by the callers below, everything typed by a person goes through esc() first. */
const para = (html, extra = '') => `<p class="ink2" style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#3b3c42;${extra}">${html}</p>`;

const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px"><tr><td style="border-radius:12px;background:${VIOLET};background-image:linear-gradient(135deg,#6a4fc9,#8b4fd0 55%,#c8399a)"><a href="${esc(href)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:12px">${esc(label)}</a></td></tr></table>`;

/** For links that matter (confirm, reset): the address in full, for the person whose mail program does not show the button. */
const linkFallback = (href) =>
  `<p class="muted" style="margin:16px 0 0;font-size:12.5px;line-height:1.6;color:#7a7a72">The button not working? Paste this address into your browser:<br><a class="lnk" href="${esc(href)}" style="color:${VIOLET};word-break:break-all">${esc(href)}</a></p>`;

const small = (html) => `<p class="muted" style="margin:14px 0 0;font-size:13.5px;line-height:1.6;color:#6b6a65">${html}</p>`;

/** A tinted box for the one thing in the message that must not be missed. */
const callout = (html, tone = 'soft') => {
  const [bg, line] = tone === 'warn' ? ['#fdf0ee', '#f1c7c1'] : ['#f2effb', '#d9d0f3'];
  return `<div class="${tone} ink2" style="margin:18px 0 0;padding:14px 16px;background:${bg};border:1px solid ${line};border-radius:12px;font-size:14.5px;line-height:1.6;color:#3b3c42">${html}</div>`;
};

const footerFor = (unsubscribeUrl) =>
  unsubscribeUrl
    ? `You get this because e-mail alerts are on in your Penny settings.<br><a class="lnk" href="${esc(appUrl())}/notifications?tab=settings" style="color:${VIOLET}">Change what you get</a> · <a class="lnk" href="${esc(unsubscribeUrl)}" style="color:${VIOLET}">Turn e-mail alerts off</a>`
    : `This is a one-time message from Penny, sent to the address on your account.<br><a class="lnk" href="${esc(appUrl())}" style="color:${VIOLET}">${esc(appUrl().replace(/^https?:\/\//, ''))}</a> · <a class="lnk" href="${esc(appUrl())}/contact" style="color:${VIOLET}">Contact</a>`;

/**
 * Digest / instant alert e-mail.
 * items: [{ kind, title, body, link, data }]; today is the recipient's local date (YYYY-MM-DD).
 */
export function alertEmail({ name, items, today, unsubscribeUrl }) {
  const due = items.filter((i) => i.kind === 'payment_due');
  const overdue = items.filter((i) => i.kind === 'payment_overdue');
  const other = items.filter((i) => !['payment_due', 'payment_overdue'].includes(i.kind));
  const line = (i) =>
    i.data?.date
      ? `${i.data.description} — ${money(i.data.amount, i.data.currency)}, ${relativeDate(i.data.date, today)}${i.data.workspace ? ` [${i.data.workspace}]` : ''}`
      : `${i.title}${i.body ? ` — ${i.body}` : ''}`;
  // one row per item: what it is in bold, the details underneath in grey
  const row = (i) => {
    const [main, detail] = i.data?.date
      ? [i.data.description, `${money(i.data.amount, i.data.currency)} · ${relativeDate(i.data.date, today)}${i.data.workspace ? ` · ${i.data.workspace}` : ''}`]
      : [i.title, i.body || ''];
    return `<tr><td class="rule" style="padding:11px 0;border-top:1px solid #eeece5"><div class="ink" style="font-size:15.5px;font-weight:650;color:#16171a">${esc(main)}</div>${detail ? `<div class="muted" style="margin-top:2px;font-size:13.5px;color:#6b6a65">${esc(detail)}</div>` : ''}</td></tr>`;
  };
  const section = (heading, list, color) =>
    list.length
      ? `<div style="margin:22px 0 0"><span style="display:inline-block;padding:3px 11px;border-radius:999px;background:${color};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${esc(heading)} · ${list.length}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${list.map(row).join('')}</table></div>`
      : '';
  const count = items.length;
  const subject =
    overdue.length && due.length
      ? `${overdue.length} overdue and ${due.length} upcoming payment${due.length === 1 ? '' : 's'}`
      : overdue.length
        ? `${overdue.length} overdue payment${overdue.length === 1 ? '' : 's'}`
        : due.length
          ? `${due.length} payment${due.length === 1 ? '' : 's'} coming up`
          : count === 1
            ? items[0].title
            : `${count} new notifications`;
  const html = shell(
    `Hi ${name.split(' ')[0]}, here is what needs your attention`,
    section('Overdue', overdue, '#d1453b') + section('Coming up', due, VIOLET) + section('Also', other, '#5b5c63') + button(`${appUrl()}/notifications`, 'Open Penny'),
    footerFor(unsubscribeUrl),
    { preheader: subject },
  );
  const text = [
    `Hi ${name.split(' ')[0]},`,
    '',
    ...(overdue.length ? ['OVERDUE', ...overdue.map((i) => `- ${line(i)}`), ''] : []),
    ...(due.length ? ['COMING UP', ...due.map((i) => `- ${line(i)}`), ''] : []),
    ...(other.length ? ['ALSO', ...other.map((i) => `- ${line(i)}`), ''] : []),
    `Open Penny: ${appUrl()}/notifications`,
    ...(unsubscribeUrl ? ['', `Turn e-mail alerts off: ${unsubscribeUrl}`] : []),
  ].join('\n');
  return { subject, html, text };
}

export function verificationEmail({ name, link }) {
  const first = name.split(' ')[0];
  return {
    subject: 'Confirm your e-mail address',
    html: shell(
      'Confirm your e-mail address',
      `${para(`Hi ${esc(first)}, confirm this address so Penny can send you payment alerts.`)}${button(link, 'Confirm e-mail address')}${small('This link works once and expires in 24 hours. If you did not ask for it, you can ignore this message.')}${linkFallback(link)}`,
      footerFor(null),
      { preheader: 'One tap to confirm your address and switch on payment alerts.' },
    ),
    text: `Hi ${first},\n\nConfirm this address so Penny can send you payment alerts:\n${link}\n\nThe link works once and expires in 24 hours. If you did not ask for it, ignore this message.`,
  };
}

export function testEmail({ name, unsubscribeUrl }) {
  const first = name.split(' ')[0];
  return {
    subject: 'Test alert from Penny',
    html: shell(
      'It works',
      `${para(`Hi ${esc(first)}, this is a test. Your e-mail alerts are set up correctly.`)}${button(`${appUrl()}/notifications?tab=settings`, 'Alert settings')}`,
      footerFor(unsubscribeUrl),
      { preheader: 'Your e-mail alerts are set up correctly.' },
    ),
    text: `Hi ${first},\n\nThis is a test. Your e-mail alerts are set up correctly.\n${appUrl()}/notifications?tab=settings${unsubscribeUrl ? `\n\nTurn e-mail alerts off: ${unsubscribeUrl}` : ''}`,
  };
}

export function passwordResetEmail({ name, link, minutes = 60 }) {
  const first = name.split(' ')[0];
  return {
    subject: 'Reset your Penny password',
    html: shell(
      'Reset your password',
      `${para(`Hi ${esc(first)}, someone asked to reset the password of your Penny account. If that was you, choose a new one here.`)}${button(link, 'Choose a new password')}${small(`This link works once and expires in ${minutes} minutes. If you did not ask for it, you can ignore this message: your password stays the same.`)}${linkFallback(link)}`,
      footerFor(null),
      { preheader: `Choose a new password. The link works for ${minutes} minutes.` },
    ),
    text: `Hi ${first},\n\nSomeone asked to reset the password of your Penny account. If that was you, choose a new one here:\n${link}\n\nThe link works once and expires in ${minutes} minutes. If you did not ask for it, ignore this message: your password stays the same.`,
  };
}

export function passwordChangedEmail({ name }) {
  const first = name.split(' ')[0];
  return {
    subject: 'Your Penny password was changed',
    html: shell(
      'Your password was changed',
      `${para(`Hi ${esc(first)}, the password of your Penny account was just reset with a link sent to this address, and every device was signed out.`)}${para('If this was you, there is nothing to do.')}${callout('<strong>Not you?</strong> Ask for another reset right away, and check that nobody else can read your e-mail.', 'warn')}${button(`${appUrl()}/forgot-password`, 'Reset it again')}`,
      footerFor(null),
      { preheader: 'Your password was reset and every device was signed out.' },
    ),
    text: `Hi ${first},\n\nThe password of your Penny account was just reset with a link sent to this address, and every device was signed out.\n\nIf this was you, there is nothing to do. If it was not, ask for another reset right away: ${appUrl()}/forgot-password`,
  };
}

export function accountDeletedEmail({ name }) {
  const first = name.split(' ')[0];
  return {
    subject: 'Your Penny account was deleted',
    html: shell(
      'Your account was deleted',
      `${para(`Hi ${esc(first)}, your Penny account and everything in it was deleted, as you asked.`)}${para('Copies kept in our backups are overwritten within about six months.')}${callout(`<strong>Did not ask for this?</strong> Reply to this e-mail or <a class="lnk" href="${esc(appUrl())}/contact" style="color:${VIOLET}">contact the person who runs the site</a> right away.`, 'warn')}`,
      footerFor(null),
      { preheader: 'Your account and everything in it was deleted, as you asked.' },
    ),
    text: `Hi ${first},\n\nYour Penny account and everything in it was deleted, as you asked.\n\nCopies kept in our backups are overwritten within about six months. If you did not do this, contact the person who runs the site right away.`,
  };
}

/** An admin's answer to a message sent through the contact form. The original is quoted so the answer makes sense on its own. */
export function contactReplyEmail({ name, reply, original, topic }) {
  const first = name.split(' ')[0];
  const quoted = original
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return {
    subject: `Re: your message to Penny (${topic})`,
    html: shell(
      `Hi ${first}`,
      `<div class="ink2" style="font-size:16px;line-height:1.65;color:#3b3c42;white-space:pre-wrap">${esc(reply)}</div><div class="quote" style="margin-top:24px;padding:2px 0 2px 14px;border-left:3px solid #d9d0f3"><div class="muted" style="margin-bottom:4px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7a7a72">You wrote</div><div class="muted" style="font-size:14px;line-height:1.6;color:#6b6a65;white-space:pre-wrap">${esc(original)}</div></div>`,
      'You get this because you wrote to Penny through the contact form. Just reply to this e-mail to answer.',
      { preheader: reply.replace(/\s+/g, ' ').slice(0, 110) },
    ),
    text: `Hi ${first},\n\n${reply}\n\n---\nYou wrote:\n${quoted}\n`,
  };
}
