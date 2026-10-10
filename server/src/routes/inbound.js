import express, { Router } from 'express';
import { secretMatches, takeIncoming } from '../lib/inbound.js';
import { HttpError, wrap } from '../lib/http.js';

/**
 * Where Brevo delivers parsed incoming e-mail (docs/DESIGN.md section 40). No session, no origin check: it is not a browser. Brevo does not sign
 * its requests, so the secret in the address is the lock; a wrong or missing secret looks like a page that does not exist. Mounted before the
 * ordinary JSON reader because a mail with pictures is far bigger than anything else the API takes.
 */
const router = Router();

router.post(
  '/mail/:secret',
  express.json({ limit: '3mb' }),
  wrap(async (req, res) => {
    if (!secretMatches(req.params.secret)) throw new HttpError(404, 'Not found');
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
    const results = [];
    for (const item of items) {
      try {
        results.push(await takeIncoming(item ?? {}));
      } catch (err) {
        console.error('inbound: could not take a message -', err.message);
        results.push('error');
      }
    }
    res.json({ ok: true, results });
  }),
);

export default router;
