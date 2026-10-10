import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact } from '../src/lib/redact.js';

// the same cases as client/test/importer-redact.test.js: the server runs its own copy because it does not trust the browser
const CASES = [
  ['To: Mario Rossi, IT60X0542811101000000123456', 'To: Mario Rossi, IT…3456'],
  ['Bonifico DE89 3704 0044 0532 0130 00 grazie', 'Bonifico DE…3000 grazie'],
  ['Card: 512345******6789', 'Card: ••••6789'],
  ['Pagamento 5123 45** **** 6789', 'Pagamento ••••6789'],
  ['Acquisto carta 4111 1111 1111 1111 presso Shop', 'Acquisto carta ••••1111 presso Shop'],
  ['Carta 4111111111111111', 'Carta ••••1111'],
  ['Addebito diretto MANDATO 7654321098765432109876', 'Addebito diretto MANDATO …9876'],
  ['Account Number 123456789012', 'Account Number …9012'],
  ['Ricarica +39 347 1234567', 'Ricarica …4567'],
  ['Paypal *mario.rossi@example.com', 'Paypal *…@example.com'],
  ['Transaction Id: 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'Transaction Id:'],
  ['Amazon Mktp IT*Nk6OO4Bs4X1234567', 'Amazon Mktp IT*…4567'],
];

describe('the server removes sensitive strings too', () => {
  for (const [input, expected] of CASES) it(input, () => assert.equal(redact(input), expected));
  it('leaves ordinary descriptions alone and is safe on odd input', () => {
    assert.equal(redact('Esselunga Milano via Roma 12'), 'Esselunga Milano via Roma 12');
    assert.equal(redact(null), '');
    assert.equal(redact('x'.repeat(10000)).length, 10000);
  });
  it('is the same as what the browser does to what it already cleaned', () => {
    for (const [, once] of CASES) assert.equal(redact(once), once);
  });
});
