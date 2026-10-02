import { z } from 'zod';
import { isValidYMD } from './dates.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap an async route handler so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof z.ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return res.status(400).json({ error: message, issues: err.issues });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'That item already exists.' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced item does not exist.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
  // Other client mistakes raised by the body parser (bad charset/encoding, aborted upload, ...).
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'The request could not be read.' });
  // Values that do not fit the database column (e.g. an id like 99999999999).
  if (err.code === '22003' || err.code === '22P02') return res.status(400).json({ error: 'A value is out of range or malformed.' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
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
