import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefUser, normalizePhone, usernameField, usernameProblem } from '../src/lib/profile.js';

test('usernames: allowed shapes', () => {
  for (const ok of ['abc', 'anita', 'anita.t', 'a_b_c1', 'user123', 'x'.repeat(24)]) assert.equal(usernameProblem(ok), null, ok);
});

test('usernames: rejected shapes', () => {
  for (const bad of ['ab', 'x'.repeat(25), '.abc', '_abc', 'has space', 'UPPER', 'a..b', 'a__b', 'a._b', 'ünï', 'admin', 'login', 'me']) {
    assert.ok(usernameProblem(bad), `${bad} should be rejected`);
  }
});

test('username field trims, lowercases and drops a leading @', () => {
  assert.equal(usernameField.parse('  @Anita.T '), 'anita.t');
  assert.throws(() => usernameField.parse('@a'));
});

test('phone numbers are normalised to +digits', () => {
  assert.equal(normalizePhone('+49 170 1234567'), '+491701234567');
  assert.equal(normalizePhone('0049 (170) 123-4567'), '+491701234567');
  assert.equal(normalizePhone('+1.415.555.2671'), '+14155552671');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone('   '), null);
});

test('ambiguous or invalid phone numbers are refused', () => {
  for (const bad of ['0170 1234567', '12345', '+0123456789', '+49abc', '++491701234567', '+1234567890123456']) {
    assert.throws(() => normalizePhone(bad), /international format/, bad);
  }
});

test('what other people see never includes contact details', () => {
  const shown = briefUser({ id: 1, name: 'A', username: 'a', email: 'a@x.com', phone: '+123456789', avatar_url: null, password_hash: 'x' });
  assert.deepEqual(shown, { name: 'A', username: 'a', avatar_url: null });
});
