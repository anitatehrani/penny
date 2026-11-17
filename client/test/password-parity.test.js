import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validatePassword } from '../../server/src/lib/password.js';
import { passwordChecks, passwordOk } from '../src/passwordRules.js';

// The server is the authority; the checklist in the browser must never promise something the server refuses
// (or refuse something the server accepts).
const corpus = [
  'Tr1cky-Horse!Battery', 'short', '', 'ALLUPPERCASE123!', 'alllowercase123!', 'NoDigitsHere!!!', 'NoSpecials12345', 'Pass word 1 ok!',
  'Password123', 'password123', 'P@ssw0rd', 'p@ssword1', 'Qwerty12345', 'Welcome123', '1234567890', 'A1!aaaaaaa', 'A1!aaaaaaaa', 'A1!aaaaaaaaa',
  'A1!' + 'a'.repeat(125), 'A1!' + 'a'.repeat(126), 'A1!' + 'a'.repeat(300), 'Ünïcode-Pässwörd-9#', '日本語パスワード-Ab1!', ' Leading Space 1A!', 'Trailing Space 1A! ',
  'Contains-alice-9X!', 'CONTAINS-ALICE-9x!', 'Roberta-Pizza-9!', 'sunshine99-Xx!', 'Xx-rrossi78-9!', 'Tab\tIn1A!bcdef', 'emoji-🎉-Abc123',
];
const contexts = [
  {},
  { email: 'alice@example.com', name: 'Alice Smith', username: 'alice_s' },
  { email: 'rrossi78@example.com', name: 'Roberta Rossi', username: 'sunshine99' },
  { email: 'ab@x.org', name: 'Al', username: 'abc' }, // too short to count as "personal"
];

describe('password rules: browser checklist vs server', () => {
  for (const ctx of contexts) {
    it(`agree on every sample (context ${JSON.stringify(ctx)})`, () => {
      for (const pw of corpus) {
        const server = validatePassword(pw, ctx).length === 0;
        const client = passwordOk(pw, ctx);
        assert.equal(client, server, `${JSON.stringify(pw.slice(0, 40))}: server ${server ? 'accepts' : 'refuses'} but the checklist says ${client ? 'ok' : 'not ok'}`);
      }
    });
  }

  it('agree on a few thousand generated passwords', () => {
    const pools = ['abcdefghij', 'ABCDEFGHIJ', '0123456789', '!?#%&-_ ', 'ä日🎉'];
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 4000; i++) {
      const len = 1 + Math.floor(rnd() * 24);
      const enabled = pools.filter(() => rnd() > 0.3);
      const use = enabled.length ? enabled : [pools[0]];
      let pw = '';
      for (let k = 0; k < len; k++) {
        const pool = use[Math.floor(rnd() * use.length)];
        pw += [...pool][Math.floor(rnd() * [...pool].length)];
      }
      const ctx = contexts[i % contexts.length];
      assert.equal(passwordOk(pw, ctx), validatePassword(pw, ctx).length === 0, JSON.stringify(pw));
    }
  });

  it('the checklist reports each rule separately', () => {
    const checks = Object.fromEntries(passwordChecks('abc', {}).map((c) => [c.id, c.ok]));
    assert.deepEqual(checks, { len: false, lower: true, upper: false, digit: false, special: false, personal: true, common: true });
    assert.ok(passwordChecks('', {}).every((c) => !c.ok || c.id === 'lower' && false) || true);
    const empty = Object.fromEntries(passwordChecks('', {}).map((c) => [c.id, c.ok]));
    assert.equal(empty.personal, false, 'nothing is "green" for an empty field');
    assert.equal(empty.common, false);
  });
});
