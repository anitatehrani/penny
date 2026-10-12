import { t } from './i18n/translate.js';
// Password format rules. Keep in sync with server/src/lib/password.js (the server is the authority;
// client/test/password-parity.test.js checks the two agree).
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
  'qwerty', 'qwerty123', 'qwertyuiop', 'qwerty12345', '1234567890', '12345678910', 'iloveyou', 'welcome123',
  'letmein123', 'admin12345', 'changeme123', 'abc123456789', 'monkey1234', 'dragon1234', 'football123',
]);

/** Live checklist for the password field. */
export function passwordChecks(pw, { email = '', name = '', username = '' } = {}) {
  const lower = pw.toLowerCase();
  const local = email.split('@')[0].toLowerCase();
  const handle = String(username ?? '').toLowerCase();
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const personal =
    (local.length >= 4 && lower.includes(local)) || (handle.length >= 4 && lower.includes(handle)) || (first.length >= 4 && lower.includes(first));
  return [
    { id: 'len', label: t('At least {PASSWORD_MIN} characters', { PASSWORD_MIN }), ok: pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX },
    { id: 'lower', label: t('A lowercase letter (a–z)'), ok: /[a-z]/.test(pw) },
    { id: 'upper', label: t('An uppercase letter (A–Z)'), ok: /[A-Z]/.test(pw) },
    { id: 'digit', label: t('A number (0–9)'), ok: /[0-9]/.test(pw) },
    { id: 'special', label: t('A special character (! ? # % & …)'), ok: /[^A-Za-z0-9\s]/.test(pw) },
    { id: 'personal', label: t('Does not contain your name, username or email'), ok: pw.length > 0 && !personal },
    { id: 'common', label: t('Not a very common password'), ok: pw.length > 0 && !COMMON.has(lower) },
  ];
}

export const passwordOk = (pw, ctx) => passwordChecks(pw, ctx).every((c) => c.ok);
