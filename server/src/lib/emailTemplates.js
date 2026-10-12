import { appUrl } from './mailer.js';
import { localeOf, t, tn } from './i18n.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat(localeOf(), { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
};
export { money as formatMoney };

/** "today", "tomorrow", "in 3 days (Sat 5 Oct)", "2 days overdue" relative to `today` (YYYY-MM-DD). */
export function relativeDate(date, today) {
  const d = Math.round((Date.UTC(...date.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(...today.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))) / 86_400_000);
  const nice = new Date(`${date}T12:00:00Z`).toLocaleDateString(localeOf(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (d === 0) return t('due today ({nice})', { nice });
  if (d === 1) return t('due tomorrow ({nice})', { nice });
  if (d > 1) return t('due in {d} days ({nice})', { d, nice });
  if (d === -1) return t('1 day overdue ({nice})', { nice });
  return t('{value} days overdue ({nice})', { value: -d, nice });
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
  `<p class="muted" style="margin:16px 0 0;font-size:12.5px;line-height:1.6;color:#7a7a72">${esc(t('The button not working? Paste this address into your browser:'))}<br><a class="lnk" href="${esc(href)}" style="color:${VIOLET};word-break:break-all">${esc(href)}</a></p>`;

const small = (html) => `<p class="muted" style="margin:14px 0 0;font-size:13.5px;line-height:1.6;color:#6b6a65">${html}</p>`;

/** A tinted box for the one thing in the message that must not be missed. */
const callout = (html, tone = 'soft') => {
  const [bg, line] = tone === 'warn' ? ['#fdf0ee', '#f1c7c1'] : ['#f2effb', '#d9d0f3'];
  return `<div class="${tone} ink2" style="margin:18px 0 0;padding:14px 16px;background:${bg};border:1px solid ${line};border-radius:12px;font-size:14.5px;line-height:1.6;color:#3b3c42">${html}</div>`;
};

const footerFor = (unsubscribeUrl) =>
  unsubscribeUrl
    ? `${esc(t('You get this because e-mail alerts are on in your Penny settings.'))}<br><a class="lnk" href="${esc(appUrl())}/notifications?tab=settings" style="color:${VIOLET}">${esc(t('Change what you get'))}</a> · <a class="lnk" href="${esc(unsubscribeUrl)}" style="color:${VIOLET}">${esc(t('Turn e-mail alerts off'))}</a>`
    : `${esc(t('This is a one-time message from Penny, sent to the address on your account.'))}<br><a class="lnk" href="${esc(appUrl())}" style="color:${VIOLET}">${esc(appUrl().replace(/^https?:\/\//, ''))}</a> · <a class="lnk" href="${esc(appUrl())}/contact" style="color:${VIOLET}">${esc(t('Contact'))}</a>`;

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
      ? tn(due.length, '{length} overdue and {n} upcoming payment', '{length} overdue and {n} upcoming payments', { length: overdue.length })
      : overdue.length
        ? tn(overdue.length, '{n} overdue payment', '{n} overdue payments')
        : due.length
          ? tn(due.length, '{n} payment coming up', '{n} payments coming up')
          : count === 1
            ? items[0].title
            : t('{count} new notifications', { count });
  const html = shell(
    t('Hi {value}, here is what needs your attention', { value: name.split(' ')[0] }),
    section(t('Overdue'), overdue, '#d1453b') + section(t('Coming up'), due, VIOLET) + section(t('Also'), other, '#5b5c63') + button(`${appUrl()}/notifications`, t('Open Penny')),
    footerFor(unsubscribeUrl),
    { preheader: subject },
  );
  const text = [
    t('Hi {value},', { value: name.split(' ')[0] }),
    '',
    ...(overdue.length ? [t('OVERDUE'), ...overdue.map((i) => `- ${line(i)}`), ''] : []),
    ...(due.length ? [t('COMING UP'), ...due.map((i) => `- ${line(i)}`), ''] : []),
    ...(other.length ? [t('ALSO'), ...other.map((i) => `- ${line(i)}`), ''] : []),
    t('Open Penny: {appUrl}/notifications', { appUrl: appUrl() }),
    ...(unsubscribeUrl ? ['', t('Turn e-mail alerts off: {unsubscribeUrl}', { unsubscribeUrl })] : []),
  ].join('\n');
  return { subject, html, text };
}

export function verificationEmail({ name, link }) {
  const first = name.split(' ')[0];
  return {
    subject: t('Confirm your e-mail address'),
    html: shell(
      t('Confirm your e-mail address'),
      `${para(t('Hi {esc}, confirm this address so Penny can send you payment alerts.', { esc: esc(first) }))}${button(link, t('Confirm e-mail address'))}${small(t('This link works once and expires in 24 hours. If you did not ask for it, you can ignore this message.'))}${linkFallback(link)}`,
      footerFor(null),
      { preheader: t('One tap to confirm your address and switch on payment alerts.') },
    ),
    text: t('Hi {first},\n\nConfirm this address so Penny can send you payment alerts:\n{link}\n\nThe link works once and expires in 24 hours. If you did not ask for it, ignore this message.', { first, link }),
  };
}

export function testEmail({ name, unsubscribeUrl }) {
  const first = name.split(' ')[0];
  return {
    subject: t('Test alert from Penny'),
    html: shell(
      t('It works'),
      `${para(t('Hi {esc}, this is a test. Your e-mail alerts are set up correctly.', { esc: esc(first) }))}${button(`${appUrl()}/notifications?tab=settings`, t('Alert settings'))}`,
      footerFor(unsubscribeUrl),
      { preheader: t('Your e-mail alerts are set up correctly.') },
    ),
    text: unsubscribeUrl ? t('Hi {first},\n\nThis is a test. Your e-mail alerts are set up correctly.\n{appUrl}/notifications?tab=settings\n\nTurn e-mail alerts off: {unsubscribeUrl}', { first, appUrl: appUrl(), unsubscribeUrl }) : t('Hi {first},\n\nThis is a test. Your e-mail alerts are set up correctly.\n{appUrl}/notifications?tab=settings', { first, appUrl: appUrl() }),
  };
}

export function passwordResetEmail({ name, link, minutes = 60 }) {
  const first = name.split(' ')[0];
  return {
    subject: t('Reset your Penny password'),
    html: shell(
      t('Reset your password'),
      `${para(t('Hi {esc}, someone asked to reset the password of your Penny account. If that was you, choose a new one here.', { esc: esc(first) }))}${button(link, t('Choose a new password'))}${small(t('This link works once and expires in {minutes} minutes. If you did not ask for it, you can ignore this message: your password stays the same.', { minutes }))}${linkFallback(link)}`,
      footerFor(null),
      { preheader: t('Choose a new password. The link works for {minutes} minutes.', { minutes }) },
    ),
    text: t('Hi {first},\n\nSomeone asked to reset the password of your Penny account. If that was you, choose a new one here:\n{link}\n\nThe link works once and expires in {minutes} minutes. If you did not ask for it, ignore this message: your password stays the same.', { first, link, minutes }),
  };
}

export function passwordChangedEmail({ name }) {
  const first = name.split(' ')[0];
  return {
    subject: t('Your Penny password was changed'),
    html: shell(
      t('Your password was changed'),
      `${para(t('Hi {esc}, the password of your Penny account was just reset with a link sent to this address, and every device was signed out.', { esc: esc(first) }))}${para(t('If this was you, there is nothing to do.'))}${callout(`<strong>${esc(t('Not you?'))}</strong> ${esc(t('Ask for another reset right away, and check that nobody else can read your e-mail.'))}`, 'warn')}${button(`${appUrl()}/forgot-password`, t('Reset it again'))}`,
      footerFor(null),
      { preheader: t('Your password was reset and every device was signed out.') },
    ),
    text: t('Hi {first},\n\nThe password of your Penny account was just reset with a link sent to this address, and every device was signed out.\n\nIf this was you, there is nothing to do. If it was not, ask for another reset right away: {appUrl}/forgot-password', { first, appUrl: appUrl() }),
  };
}

export function accountDeletedEmail({ name }) {
  const first = name.split(' ')[0];
  return {
    subject: t('Your Penny account was deleted'),
    html: shell(
      t('Your account was deleted'),
      `${para(t('Hi {esc}, your Penny account and everything in it was deleted, as you asked.', { esc: esc(first) }))}${para(t('Copies kept in our backups are overwritten within about six months.'))}${callout(`<strong>${esc(t('Did not ask for this?'))}</strong> ${t('Reply to this e-mail or {link} right away.', { link: `<a class="lnk" href="${esc(appUrl())}/contact" style="color:${VIOLET}">${esc(t('contact the person who runs the site'))}</a>` })}`, 'warn')}`,
      footerFor(null),
      { preheader: t('Your account and everything in it was deleted, as you asked.') },
    ),
    text: t('Hi {first},\n\nYour Penny account and everything in it was deleted, as you asked.\n\nCopies kept in our backups are overwritten within about six months. If you did not do this, contact the person who runs the site right away.', { first }),
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
    subject: t('Re: your message to Penny ({topic})', { topic }),
    html: shell(
      t('Hi {first}', { first }),
      `<div class="ink2" style="font-size:16px;line-height:1.65;color:#3b3c42;white-space:pre-wrap">${esc(reply)}</div><div class="quote" style="margin-top:24px;padding:2px 0 2px 14px;border-left:3px solid #d9d0f3"><div class="muted" style="margin-bottom:4px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7a7a72">${esc(t('You wrote'))}</div><div class="muted" style="font-size:14px;line-height:1.6;color:#6b6a65;white-space:pre-wrap">${esc(original)}</div></div>`,
      t('You get this because you wrote to Penny through the contact form. Just reply to this e-mail to answer.'),
      { preheader: reply.replace(/\s+/g, ' ').slice(0, 110) },
    ),
    text: t('Hi {first},\n\n{reply}\n\n---\nYou wrote:\n{quoted}\n', { first, reply, quoted }),
  };
}
