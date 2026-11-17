import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, validatePassword, verifyPassword } from '../src/lib/password.js';

test('a strong password passes', () => {
  assert.deepEqual(validatePassword('Tr1cky-Horse!Battery', { email: 'anita@example.com', name: 'Anita' }), []);
});

test('each missing character class is reported', () => {
  const has = (pw, text) => validatePassword(pw).some((p) => p.includes(text));
  assert.ok(has('Short1!a', 'at least 10'));
  assert.ok(has('ALLUPPER123!!', 'lowercase'));
  assert.ok(has('alllower123!!', 'uppercase'));
  assert.ok(has('NoDigitsHere!!', 'number'));
  assert.ok(has('NoSpecials12345', 'special'));
  assert.ok(has('A'.repeat(129) + 'a1!', 'at most 128'));
});

test('common passwords and personal info are rejected', () => {
  assert.ok(validatePassword('Password123').length > 0);
  assert.ok(validatePassword('P@ssw0rd', {}).length > 0);
  const withEmail = validatePassword('Anita-Secret-99!', { email: 'anita.t@example.com', name: '' });
  assert.deepEqual(withEmail, []); // "anita.t" is not a substring, so this one is fine
  assert.ok(validatePassword('Xx!rrossi78Yy9', { email: 'rrossi78@example.com' }).some((p) => p.includes('email name')));
  assert.ok(validatePassword('Marcello-Is-Great1!', { name: 'Marcello Rossi' }).some((p) => p.includes('your name')));
  assert.deepEqual(validatePassword(undefined), ['Password is required.']);
});

test('hashes are salted, verifiable and not reversible text', async () => {
  const a = await hashPassword('Tr1cky-Horse!Battery');
  const b = await hashPassword('Tr1cky-Horse!Battery');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('scrypt$32768$8$1$'));
  assert.ok(!a.includes('Horse'));
  assert.equal(await verifyPassword('Tr1cky-Horse!Battery', a), true);
  assert.equal(await verifyPassword('tr1cky-horse!battery', a), false);
  assert.equal(await verifyPassword('anything', 'garbage'), false);
  assert.equal(await verifyPassword('anything', 'bcrypt$x$y$z$a$b'), false);
});
