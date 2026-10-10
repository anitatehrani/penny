import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact } from '../src/importer/redact.js';

// the same cases are in server/test/import-redact.test.js, for the copy of this function the server runs
export const CASES = [
  ['IBANs keep only the country and the last four', 'To: Mario Rossi, IT60X0542811101000000123456', 'To: Mario Rossi, IT…3456'],
  ['IBANs written in groups', 'Bonifico DE89 3704 0044 0532 0130 00 grazie', 'Bonifico DE…3000 grazie'],
  ['masked card numbers keep the last four', 'Card: 512345******6789', 'Card: ••••6789'],
  ['masked in groups', 'Pagamento 5123 45** **** 6789', 'Pagamento ••••6789'],
  ['card numbers in full', 'Acquisto carta 4111 1111 1111 1111 presso Shop', 'Acquisto carta ••••1111 presso Shop'],
  ['card numbers in full, joined', 'Carta 4111111111111111', 'Carta ••••1111'],
  ['long reference and mandate numbers keep the last four', 'Addebito diretto MANDATO 7654321098765432109876', 'Addebito diretto MANDATO …9876'],
  ['an account number', 'Account Number 123456789012', 'Account Number …9012'],
  ['phone numbers written with a plus', 'Ricarica +39 347 1234567', 'Ricarica …4567'],
  ['e-mail addresses lose the name before the @', 'Paypal *mario.rossi@example.com', 'Paypal *…@example.com'],
  ['transaction ids', 'Transaction Id: 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'Transaction Id:'],
  ['long mixed codes from card processors', 'Amazon Mktp IT*Nk6OO4Bs4X1234567', 'Amazon Mktp IT*…4567'],
];

describe('taking sensitive strings out of a description', () => {
  for (const [name, input, expected] of CASES) {
    it(name, () => assert.equal(redact(input), expected));
  }
  it('leaves ordinary descriptions alone', () => {
    for (const s of ['Esselunga Milano via Roma 12', 'Netflix.com', 'Prelievo BANCOMAT 50,00', "In's Mercato", 'Penny Market S.r.l.', 'Autolinee Toscane Borgo San Lor', 'Il Fornaio 0373', 'Order 123456 shipped', 'Revolut**0683*']) {
      assert.equal(redact(s), s.replace('Revolut**0683*', 'Revolut**0683*'));
    }
  });
  it('a long word that merely starts with letters and digits is not an IBAN', () => {
    assert.equal(redact('AB12 Congratulations to everyone'), 'AB12 Congratulations to everyone');
  });
  it('is safe on empty and odd input', () => {
    assert.equal(redact(''), '');
    assert.equal(redact(null), '');
    assert.equal(redact(undefined), '');
    assert.equal(redact('   '), '');
    assert.equal(redact('x'.repeat(10000)).length, 10000);
  });
  it('does not take long text long to read (no runaway matching)', () => {
    const started = Date.now();
    redact(`${'1234 '.repeat(4000)}${'AB12 '.repeat(4000)}${'a@'.repeat(4000)}`);
    assert.ok(Date.now() - started < 1500, 'redaction of 60 KB took too long');
  });
});
