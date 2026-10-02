import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt cost parameters (N=2^15, r=8, p=1 ~ 32 MB, tens of ms). Stored with the hash so they can be raised later.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAXMEM = 128 * N * R * 2;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
  'qwerty', 'qwerty123', 'qwertyuiop', 'qwerty12345', '1234567890', '12345678910', 'iloveyou', 'welcome123',
  'letmein123', 'admin12345', 'changeme123', 'abc123456789', 'monkey1234', 'dragon1234', 'football123',
]);

/**
 * The password format rules. Keep in sync with client/src/passwordRules.js.
 * Returns a list of human-readable problems (empty = acceptable).
 */
export function validatePassword(password, { email = '', name = '', username = '' } = {}) {
  const problems = [];
  if (typeof password !== 'string') return ['Password is required.'];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) problems.push(`Use at most ${PASSWORD_MAX} characters.`);
  if (!/[a-z]/.test(password)) problems.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(password)) problems.push('Add an uppercase letter.');
  if (!/[0-9]/.test(password)) problems.push('Add a number.');
  if (!/[^A-Za-z0-9\s]/.test(password)) problems.push('Add a special character (for example ! ? # % &).');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push('That password is too common.');
  const local = email.split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) problems.push('Do not include your email name in the password.');
  const handle = String(username ?? '').toLowerCase();
  if (handle.length >= 4 && lower.includes(handle)) problems.push('Do not include your username in the password.');
  const first = name.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) problems.push('Do not include your name in the password.');
  return problems;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used to spend the same time on unknown emails as on real ones (no user-enumeration by timing).
let dummyHash;
export async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}
