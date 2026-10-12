import { z } from 'zod';
import { t } from './i18n.js';

const RESERVED = new Set([
  'admin', 'administrator', 'api', 'app', 'root', 'support', 'help', 'me', 'you', 'user', 'users', 'login', 'logout',
  'signup', 'signin', 'register', 'settings', 'profile', 'people', 'groups', 'group', 'shared', 'budget', 'null',
  'undefined', 'system', 'moderator', 'official', 'staff', 'team',
]);

const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,23}$/;

export function usernameProblem(value) {
  if (!USERNAME_RE.test(value)) {
    return t('Use 3–24 characters: lowercase letters, numbers, dots or underscores, starting with a letter or number.');
  }
  if (value.includes('..') || value.includes('__') || value.includes('._') || value.includes('_.')) {
    return t('Do not put dots or underscores right next to each other.');
  }
  if (RESERVED.has(value)) return t('That username is reserved.');
  return null;
}

export const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ''))
  .superRefine((v, ctx) => {
    const problem = usernameProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/**
 * Normalise a phone number to "+<digits>" (international format). Returns null for empty input and
 * throws a user-facing Error for numbers that cannot be interpreted unambiguously.
 */
export function normalizePhone(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!/^\+[1-9]\d{6,14}$/.test(s)) {
    throw new Error(t('Enter the phone number in international format, e.g. +49 170 1234567.'));
  }
  return s;
}

export const phoneField = z
  .string()
  .max(40)
  .nullable()
  .optional()
  .transform((v, ctx) => {
    try {
      return normalizePhone(v);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: e.message });
      return z.NEVER;
    }
  });

/** Pick a free username based on a seed (e-mail local part or display name). */
export async function generateUsername(query, seed) {
  let base = String(seed || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/^[._]+/, '')
    .replace(/[._]{2,}/g, '_')
    .slice(0, 20);
  if (base.length < 3) base = `user${base}`;
  if (RESERVED.has(base)) base = `${base}1`;
  let candidate = base;
  for (let n = 1; n < 1000; n++) {
    const { rowCount } = await query('SELECT 1 FROM users WHERE lower(username) = $1', [candidate]);
    if (!rowCount) return candidate;
    candidate = `${base}${n}`;
  }
  return `${base}${Math.floor(Math.random() * 1e6)}`;
}

/** What other people may see about a user. Never includes e-mail or phone. */
export const briefUser = (u) => ({ name: u.name, username: u.username, avatar_url: u.avatar_url ?? null });
