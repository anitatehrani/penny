import { z } from 'zod';
import { isValidYMD } from './dates.js';
import { N_, t } from './i18n.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

/** Wrap an async route handler so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, t('Invalid id'));
  return id;
}

/** The words the request checks use (they are written in English where the check is made, and put into the reader's language here). */
export const VALIDATION_WORDS = [
  N_('is required'),
  N_('is too large'),
  N_('cannot be negative'),
  N_('must be a number'),
  N_('must be a whole number'),
  N_('must be 0 or more'),
  N_('must be greater than 0'),
  N_('must be YYYY-MM'),
  N_('must be a month (YYYY-MM)'),
  N_('must be a date (YYYY-MM-DD)'),
  N_('must be a valid date (YYYY-MM-DD)'),
  N_('must be a valid email address'),
  N_('must be between 1 and 28'),
  N_('must be between 0 and the amount'),
  N_('must be a 3-letter currency code'),
  N_('must be a hex color like #2a78d6'),
  N_('Not a valid insight'),
];
function issueText(message) {
  const m = /^must be at (least|most) (\d+)( characters)?$/.exec(message);
  if (m) {
    const n = Number(m[2]);
    if (m[3]) return m[1] === 'least' ? t('must be at least {n} characters', { n }) : t('must be at most {n} characters', { n });
    return m[1] === 'least' ? t('must be at least {n}', { n }) : t('must be at most {n}', { n });
  }
  return t(message);
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof z.ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${issueText(i.message)}`).join('; ');
    return res.status(400).json({ error: message, issues: err.issues });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  if (err.code === '23505') return res.status(409).json({ error: t('That item already exists.') });
  if (err.code === '23503') return res.status(400).json({ error: t('Referenced item does not exist.') });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: t('Invalid JSON body.') });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: t('The request is too large.') });
  // Other client mistakes raised by the body parser (bad charset/encoding, aborted upload, ...).
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: t('The request could not be read.') });
  // Values that do not fit the database column (e.g. an id like 99999999999).
  if (err.code === '22003' || err.code === '22P02') return res.status(400).json({ error: t('A value is out of range or malformed.') });
  console.error(err);
  res.status(500).json({ error: t('Internal server error') });
}

// ---- shared zod pieces ----
export const ymd = z.string().refine(isValidYMD, 'must be a valid date (YYYY-MM-DD)');
/** A real number, or a non-empty numeric string. Unlike z.coerce.number(), null, [], '' and true are NOT silently turned into 0/1. */
export const strictNumber = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
  z.number({ invalid_type_error: 'must be a number', required_error: 'is required' }).finite('must be a number'),
);
export const cents = (v) => Math.round(v * 100) / 100;
export const money = strictNumber
  .refine((v) => v > 0, 'must be greater than 0')
  .refine((v) => v <= 9_999_999_999, 'is too large')
  .transform(cents);
export const txType = z.enum(['income', 'expense']);
export const categoryId = z.number().int().positive().nullable().optional();
export const text = (max = 200) => z.string().trim().min(1, 'is required').max(max);
export const note = z.string().trim().max(1000).nullable().optional();
