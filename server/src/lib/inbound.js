import { createHmac, timingSafeEqual } from 'node:crypto';
import { query } from '../db.js';
import { getSecret } from './secret.js';
import { notify } from './notifications.js';
import { t } from './i18n.js';

/**
 * Replies to an admin's answer come back into the Messages tab (docs/DESIGN.md section 40).
 *
 * Switched on by REPLY_DOMAIN (the domain whose MX records point at Brevo's inbound parsing) and INBOUND_SECRET (the secret part of the web
 * address Brevo calls). Every answer then carries its own "reply to" address, m<id>-<signature>@<domain>; mail to any other address, or with a
 * wrong signature, is thrown away.
 */
export const replyDomain = () => (process.env.REPLY_DOMAIN || '').trim().toLowerCase().replace(/^@/, '') || null;
export const inboundSecret = () => (process.env.INBOUND_SECRET || '').trim() || null;
/** Replies by e-mail work only when both settings are present. */
export const inboundOn = () => !!(replyDomain() && inboundSecret());

export const BODY_MAX = 4000;
export const DAILY_INCOMING_CAP = 500;
export const THREAD_CAP = 50;
const SPAM_ABOVE = 10;

const sign = async (messageId) => createHmac('sha256', await getSecret()).update(`contact-reply:${messageId}`).digest('hex').slice(0, 16);

/** The address replies to one message are sent to, or null when replies by e-mail are not set up. */
export async function replyAddress(messageId) {
  const domain = replyDomain();
  return inboundOn() ? `m${messageId}-${await sign(messageId)}@${domain}` : null;
}

/** The message an address belongs to, if it is one of ours and its signature is right. */
export async function messageIdFromAddress(address) {
  const m = /^m(\d{1,9})-([0-9a-f]{16})@(.+)$/i.exec(String(address ?? '').trim());
  if (!m || m[3].toLowerCase() !== replyDomain()) return null;
  const expected = Buffer.from(await sign(Number(m[1])));
  const given = Buffer.from(m[2].toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected) ? Number(m[1]) : null;
}

/** Whether the web address's secret part is right (compared in constant time). */
export function secretMatches(given) {
  const secret = inboundSecret();
  if (!secret || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const header = (headers, name) => {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? headers[key] : undefined;
  return String(Array.isArray(v) ? v[0] : (v ?? '')).trim().toLowerCase();
};

/** Out-of-office replies, mailing-list and other automatic mail: nobody wrote it. */
export function isAutomatic(headers) {
  const auto = header(headers, 'Auto-Submitted');
  if (auto && auto !== 'no') return true;
  return ['bulk', 'junk', 'auto_reply', 'auto-reply'].includes(header(headers, 'Precedence')) || !!header(headers, 'X-Autoreply') || !!header(headers, 'X-Autorespond');
}

// control characters go (a message is text); line breaks and tabs stay
const tidy = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim();

/** The new part of the mail, as plain text: Brevo's extraction without the older quoted mail and signature, else the plain text. */
export function bodyOf(item) {
  const text = tidy(item.ExtractedMarkdownMessage) || tidy(item.RawTextBody);
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1).trimEnd()}…` : text;
}

const spamScore = (item) => Number(item.Spam?.Score ?? item.SpamScore ?? 0) || 0;

/**
 * One parsed e-mail from Brevo. Returns what happened ('stored', or why it was ignored): the caller always answers "ok" so Brevo does not retry.
 */
export async function takeIncoming(item) {
  const recipients = [...(item.To ?? []), ...(item.Recipients ?? [])].map((r) => r?.Address);
  let messageId = null;
  for (const a of recipients) {
    messageId = await messageIdFromAddress(a);
    if (messageId) break;
  }
  if (!messageId) return 'not for us';
  if (spamScore(item) > SPAM_ABOVE) return 'spam';
  if (isAutomatic(item.Headers)) return 'automatic';
  const body = bodyOf(item);
  if (!body) return 'empty';

  const m = (await query('SELECT id, name, email FROM contact_messages WHERE id = $1', [messageId])).rows[0];
  if (!m) return 'message is gone';
  const today = (await query(`SELECT count(*)::int AS n FROM contact_replies WHERE direction = 'in' AND created_at > now() - interval '1 day'`)).rows[0].n;
  if (today >= DAILY_INCOMING_CAP) return 'daily limit';
  const inThread = (await query('SELECT count(*)::int AS n FROM contact_replies WHERE message_id = $1', [messageId])).rows[0].n;
  if (inThread >= THREAD_CAP) return 'conversation limit';

  const from = String(item.From?.Address ?? '').trim().toLowerCase().slice(0, 254);
  const mailId = String(item.MessageId ?? '').trim().slice(0, 300) || null;
  const { rows } = await query(
    `INSERT INTO contact_replies (message_id, direction, body, from_email, other_sender, mail_id)
     VALUES ($1, 'in', $2, $3, $4, $5) ON CONFLICT (mail_id) WHERE mail_id IS NOT NULL DO NOTHING RETURNING id`,
    [messageId, body, from || null, !!from && from !== m.email.toLowerCase(), mailId],
  );
  if (!rows[0]) return 'duplicate';
  // the conversation is waiting for an answer again: unread, and back out of the archive
  await query('UPDATE contact_messages SET read_at = NULL, archived_at = NULL WHERE id = $1', [messageId]);
  const admins = (await query('SELECT id FROM users WHERE is_admin AND suspended_at IS NULL')).rows;
  for (const a of admins) {
    await notify(a.id, { kind: 'system', title: () => t('New reply'), body: () => t('{name} replied to your answer.', { name: m.name }), link: '/admin?tab=messages', dedupeKey: `contact-reply:${rows[0].id}` }).catch((e) => console.error('inbound: could not notify an admin -', e.message));
  }
  return 'stored';
}
