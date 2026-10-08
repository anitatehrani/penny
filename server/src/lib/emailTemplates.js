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

const shell = (title, inner, footer) => `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#161615">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-weight:700;font-size:18px;margin-bottom:16px">Penny</div>
  <div style="background:#ffffff;border:1px solid #e4e3de;border-radius:12px;padding:22px 24px">
    <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
    ${inner}
  </div>
  <div style="color:#6b6a65;font-size:12px;line-height:1.5;margin-top:14px">${footer}</div>
</div></body></html>`;

const button = (href, label) =>
  `<p style="margin:18px 0 0"><a href="${esc(href)}" style="background:#1f6bc4;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block;font-weight:600">${esc(label)}</a></p>`;

const footerFor = (unsubscribeUrl) =>
  unsubscribeUrl
    ? `You get this because e-mail alerts are on in your Penny settings.<br><a href="${esc(appUrl())}/notifications?tab=settings" style="color:#1a62b8">Change what you get</a> · <a href="${esc(unsubscribeUrl)}" style="color:#1a62b8">Turn e-mail alerts off</a>`
    : 'This is a one-time message from Penny.';

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
  const section = (heading, list, color) =>
    list.length
      ? `<h2 style="font-size:15px;margin:18px 0 6px;color:${color}">${esc(heading)}</h2><ul style="margin:0;padding-left:18px;line-height:1.6">${list.map((i) => `<li>${esc(line(i))}</li>`).join('')}</ul>`
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
    section('Overdue', overdue, '#c4302b') + section('Coming up', due, '#1a62b8') + section('Also', other, '#161615') + button(`${appUrl()}/notifications`, 'Open Penny'),
    footerFor(unsubscribeUrl),
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
  return {
    subject: 'Confirm your e-mail address',
    html: shell(
      'Confirm your e-mail address',
      `<p style="margin:0">Hi ${esc(name.split(' ')[0])}, confirm this address so Penny can send you payment alerts.</p>${button(link, 'Confirm e-mail address')}<p style="color:#6b6a65;font-size:13px">This link works once and expires in 24 hours. If you did not ask for it, you can ignore this message.</p>`,
      footerFor(null),
    ),
    text: `Hi ${name.split(' ')[0]},\n\nConfirm this address so Penny can send you payment alerts:\n${link}\n\nThe link works once and expires in 24 hours. If you did not ask for it, ignore this message.`,
  };
}

export function testEmail({ name, unsubscribeUrl }) {
  return {
    subject: 'Test alert from Penny',
    html: shell('It works', `<p style="margin:0">Hi ${esc(name.split(' ')[0])}, this is a test. Your e-mail alerts are set up correctly.</p>${button(`${appUrl()}/notifications?tab=settings`, 'Alert settings')}`, footerFor(unsubscribeUrl)),
    text: `Hi ${name.split(' ')[0]},\n\nThis is a test. Your e-mail alerts are set up correctly.\n${appUrl()}/notifications?tab=settings${unsubscribeUrl ? `\n\nTurn e-mail alerts off: ${unsubscribeUrl}` : ''}`,
  };
}

export function passwordResetEmail({ name, link, minutes = 60 }) {
  const first = name.split(' ')[0];
  return {
    subject: 'Reset your Penny password',
    html: shell(
      'Reset your password',
      `<p style="margin:0">Hi ${esc(first)}, someone asked to reset the password of your Penny account. If that was you, choose a new one here.</p>${button(link, 'Choose a new password')}<p style="color:#6b6a65;font-size:13px">This link works once and expires in ${minutes} minutes. If you did not ask for it, you can ignore this message: your password stays the same.</p>`,
      footerFor(null),
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
      `<p style="margin:0">Hi ${esc(first)}, the password of your Penny account was just reset with a link sent to this address, and every device was signed out.</p><p style="margin:12px 0 0">If this was you, there is nothing to do. If it was not, ask for another reset right away and check that nobody else can read your e-mail.</p>${button(`${appUrl()}/forgot-password`, 'Reset it again')}`,
      footerFor(null),
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
      `<p style="margin:0">Hi ${esc(first)}, your Penny account and everything in it was deleted, as you asked.</p><p style="margin:12px 0 0">Copies kept in our backups are overwritten within about six months. If you did not do this, reply to this e-mail or contact the person who runs the site right away.</p>`,
      footerFor(null),
    ),
    text: `Hi ${first},\n\nYour Penny account and everything in it was deleted, as you asked.\n\nCopies kept in our backups are overwritten within about six months. If you did not do this, contact the person who runs the site right away.`,
  };
}
