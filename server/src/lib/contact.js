import { z } from 'zod';
import { query } from '../db.js';
import { notify } from './notifications.js';

/**
 * The contact form (docs/DESIGN.md section 38): what people write to the person who runs the site. Stored in `contact_messages`, shown to
 * admins, kept a year. The text of a message is personal data: it is never put in the activity log or in a notification.
 */
export const TOPICS = {
  question: 'Question',
  problem: 'Something is wrong',
  idea: 'Idea',
  account: 'My data or my account',
  other: 'Other',
};
export const MESSAGE_MIN = 10;
export const REPLY_MAX = 4000;
export const MESSAGE_MAX = 4000;
export const KEEP_DAYS = 365;
/** Most messages accepted in one day, from everybody together, so a flood cannot fill the database. */
export const DAILY_CAP = 200;

// Control characters are dropped (a message is text), line breaks and tabs are kept.
const text = (max) => z.string().transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim()).pipe(z.string().max(max, `must be at most ${max} characters`));

export const replyBody = z.object({ reply: text(REPLY_MAX).pipe(z.string().min(2, 'is required')) });
export const contactBody = z.object({
  name: text(80).pipe(z.string().min(1, 'is required')),
  email: z.string().trim().toLowerCase().email('must be a valid email address').max(254),
  topic: z.enum(Object.keys(TOPICS)).default('question'),
  message: text(MESSAGE_MAX).pipe(z.string().min(MESSAGE_MIN, `must be at least ${MESSAGE_MIN} characters`)),
  website: z.string().max(500).optional(), // the hidden field: people leave it empty
});

export const messagesToday = async () => (await query(`SELECT count(*)::int AS n FROM contact_messages WHERE created_at > now() - interval '1 day'`)).rows[0].n;

export async function saveMessage({ userId, name, email, topic, message }) {
  const { rows } = await query(
    `INSERT INTO contact_messages (user_id, name, email, topic, message) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [userId, name, email, topic, message],
  );
  return rows[0];
}

/** Tell every admin there is something to read. Only who and what kind: the message itself stays in the Messages tab. */
export async function notifyAdmins(id, name, topic) {
  const admins = (await query('SELECT id FROM users WHERE is_admin AND suspended_at IS NULL')).rows;
  for (const a of admins) {
    await notify(a.id, { kind: 'system', title: 'New message', body: `${name} wrote to you (${TOPICS[topic] ?? topic}).`, link: '/admin?tab=messages', dedupeKey: `contact:${id}` }).catch((e) => console.error('contact: could not notify an admin -', e.message));
  }
}

export const pruneContactMessages = (db = { query }) => db.query(`DELETE FROM contact_messages WHERE created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]);

/** The conversation under each of these messages (answers and replies), oldest first, keyed by message id. */
export async function threadsFor(ids, db = { query }) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const { rows } = await db.query(
    `SELECT r.id, r.message_id, r.created_at, r.direction, r.body, r.other_sender, r.from_email, a.name AS admin_name
     FROM contact_replies r LEFT JOIN users a ON a.id = r.admin_id WHERE r.message_id = ANY($1) ORDER BY r.created_at, r.id`,
    [ids],
  );
  for (const r of rows) {
    map.get(r.message_id).push({ id: r.id, direction: r.direction, body: r.body, created_at: r.created_at, admin_name: r.admin_name, other_sender: r.other_sender, from_email: r.from_email });
  }
  return map;
}

/** A message as the admin sees it, with its conversation. */
export const shapeMessage = (r, thread = []) => ({
  id: r.id,
  created_at: r.created_at,
  name: r.name,
  email: r.email,
  topic: r.topic,
  topic_label: TOPICS[r.topic] ?? r.topic,
  message: r.message,
  read: !!r.read_at,
  archived: !!r.archived_at,
  signed_in: r.user_id != null,
  replied: !!r.replied_at,
  replied_at: r.replied_at,
  reply: r.reply,
  thread,
});
