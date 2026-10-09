import { Router } from 'express';
import { record } from '../lib/audit.js';
import { rateLimit } from '../lib/auth.js';
import { contactBody, DAILY_CAP, messagesToday, notifyAdmins, saveMessage } from '../lib/contact.js';
import { HttpError, wrap } from '../lib/http.js';

/**
 * The contact form's one public route (docs/DESIGN.md section 38). Anyone may send; a signed-in person's message is tied to their account.
 * Mounted before the sign-in check, like the other public routes.
 */
const router = Router();

const ipLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyFn: (req) => `contact:${req.ip}`,
  message: 'You have sent a few messages already. Please try again in an hour.',
  onLimit: (req) => record('rate_limited', { req, detail: 'too many contact messages from one place' }),
});

router.post(
  '/contact',
  ipLimiter,
  wrap(async (req, res) => {
    const body = contactBody.parse(req.body ?? {});
    // The hidden field is only ever filled by a program. Say "sent" and keep nothing, so it learns nothing.
    if (body.website) return res.status(201).json({ ok: true });
    if ((await messagesToday()) >= DAILY_CAP) {
      record('rate_limited', { req, detail: 'the daily limit of contact messages was reached' });
      throw new HttpError(429, 'Penny has received a lot of messages today. Please try again tomorrow.');
    }
    // an admin who is "viewing as" somebody is not that person: the message is not tied to their account
    const userId = req.user && !req.admin ? req.user.id : null;
    const saved = await saveMessage({ userId, name: body.name, email: body.email, topic: body.topic, message: body.message });
    res.status(201).json({ ok: true });
    notifyAdmins(saved.id, body.name, body.topic).catch((e) => console.error('contact:', e.message)); // after the reply: the writer should not wait for it
  }),
);

export default router;
