import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { directionOf, headerRole, sectionKind, statusOf } from '../src/importer/headers.js';

const role = (s) => headerRole(s)?.role ?? null;

describe('what a heading says the column is', () => {
  it('English', () => {
    for (const [h, r] of [
      ['Date', 'date'], ['Transaction Date', 'date'], ['Started Date', 'date'], ['Completed Date', 'date'], ['Posting Date', 'date'], ['Booking date', 'date'],
      ['Description', 'description'], ['Narrative', 'description'], ['Memo', 'description'],
      ['Amount', 'amount'], ['Amount (EUR)', 'amount'], ['Transaction Amount', 'amount'],
      ['Debit', 'debit'], ['Money out', 'debit'], ['Paid out', 'debit'], ['Withdrawals', 'debit'],
      ['Credit', 'credit'], ['Money in', 'credit'], ['Paid in', 'credit'], ['Deposits', 'credit'],
      ['Balance', 'balance'], ['Running Balance', 'balance'], ['Closing balance', 'balance'],
      ['Currency', 'currency'], ['Category', 'category'], ['Status', 'status'], ['State', 'status'], ['Fee', 'fee'], ['Payee', 'payee'], ['Merchant', 'payee'], ['Counterparty', 'counterparty'],
      ['Transaction ID', 'reference'], ['Type', 'direction'], ['Value date', 'valueDate'], ['Settlement date', 'valueDate'],
    ]) assert.equal(role(h), r, h);
  });
  it('Italian', () => {
    for (const [h, r] of [
      ['Data', 'date'], ['DATA CONTABILE', 'date'], ['Data operazione', 'date'], ['Data valuta', 'valueDate'],
      ['Descrizione', 'description'], ['Descrizione operazione', 'description'], ['Causale', 'description'], ['OPERAZIONE', 'description'], ['Dettagli', 'description'],
      ['Importo', 'amount'], ['IMPORTO', 'amount'], ['Importo (EUR)', 'amount'], ['Uscite', 'debit'], ['Entrate', 'credit'], ['Addebiti', 'debit'], ['Accrediti', 'credit'], ['Dare', 'debit'], ['Avere', 'credit'],
      ['Importo addebito', 'debit'], ['Importo accredito', 'credit'], ['Saldo', 'balance'], ['Saldo contabile', 'balance'], ['Categoria', 'category'], ['CONTABILIZZATO', 'status'], ['Stato', 'status'], ['Divisa', 'currency'], ['Commissioni', 'fee'],
      ['Tipo operazione', 'direction'],
    ]) assert.equal(role(h), r, h);
  });
  it('German, French, Spanish, Portuguese and Dutch', () => {
    for (const [h, r] of [
      ['Buchungstag', 'date'], ['Buchungsdatum', 'date'], ['Wertstellung', 'valueDate'], ['Verwendungszweck', 'description'], ['Betrag', 'amount'], ['Betrag (€)', 'amount'], ['Soll', 'debit'], ['Haben', 'credit'], ['Kontostand', 'balance'], ['Währung', 'currency'], ['Zahlungsempfänger*in', 'payee'], ['Zahlungspflichtige*r', 'payer'],
      ['Date opération', 'date'], ['Libellé', 'description'], ['Montant', 'amount'], ['Débit', 'debit'], ['Crédit', 'credit'], ['Solde', 'balance'], ['Date de valeur', 'valueDate'],
      ['Fecha', 'date'], ['Fecha operación', 'date'], ['Concepto', 'description'], ['Importe', 'amount'], ['Cargo', 'debit'], ['Abono', 'credit'], ['Saldo', 'balance'],
      ['Data lançamento', 'date'], ['Descrição', 'description'], ['Valor', 'amount'], ['Débito', 'debit'], ['Crédito', 'credit'],
      ['Datum', 'date'], ['Omschrijving', 'description'], ['Bedrag (EUR)', 'amount'], ['Af Bij', 'direction'], ['Mededelingen', 'details'], ['Naam / Omschrijving', 'description'], ['Tegenpartij', 'counterparty'],
    ]) assert.equal(role(h), r, h);
  });
  it('knows a heading that means two things and says so', () => {
    assert.deepEqual(headerRole('Valuta'), { role: 'currency', score: 100, alt: 'valueDate' });
    assert.equal(headerRole('Reference').alt, 'reference');
    assert.equal(headerRole('Name').generic, true);
  });
  it('a longer, more exact phrase wins over a short one inside it', () => {
    assert.equal(role('Data valuta'), 'valueDate');
    assert.equal(role('Tipo operazione'), 'direction');
    assert.equal(role('Descrizione operazione'), 'description');
    assert.equal(role('Payment reference'), 'details');
    assert.equal(role('Importo addebito'), 'debit');
    assert.equal(role('Started Date'), 'date');
  });
  it('is not fooled by words it does not know, or by long sentences', () => {
    assert.equal(headerRole('Product'), null);
    assert.equal(headerRole(''), null);
    assert.ok((headerRole('Account Number')?.score ?? 0) < 60, 'weak matches are not trusted');
    assert.equal(headerRole('this is a very long sentence that is certainly not a heading of a column in a table'), null);
  });
});

describe('words in a column that says in or out', () => {
  it('money out, money in, and nothing it can tell', () => {
    for (const w of ['Af', 'D', 'DR', 'Debit', 'Addebito', 'Uscita', 'Soll', 'OUT', '-']) assert.equal(directionOf(w), -1, w);
    for (const w of ['Bij', 'C', 'CR', 'Credit', 'Accredito', 'Entrata', 'Haben', 'IN', '+']) assert.equal(directionOf(w), 1, w);
    for (const w of ['', 'Card payment', 'ACH_DEBIT', 'TRANSFER']) assert.equal(directionOf(w), 0, w);
  });
});

describe('words in a column that says if a line is final', () => {
  it('booked, pending, cancelled and unknown', () => {
    for (const w of ['SI', 'Sì', 'Yes', 'COMPLETED', 'Booked', 'Gebucht', 'TRUE', '1', 'Posted']) assert.equal(statusOf(w), 1, w);
    for (const w of ['NO', 'No', 'PENDING', 'Reserved', 'Vorgemerkt', 'In sospeso', 'false', '0']) assert.equal(statusOf(w), -1, w);
    for (const w of ['REVERTED', 'Declined', 'Annullato', 'Cancelled', 'FAILED', 'Rejected']) assert.equal(statusOf(w), -2, w);
    for (const w of ['', 'maybe', 'card']) assert.equal(statusOf(w), 0, w);
  });
});

describe('what a section title says', () => {
  it('pending, reverted and ordinary', () => {
    assert.equal(sectionKind('Pending from October 1, 2026 to October 8, 2026'), 'pending');
    assert.equal(sectionKind('Operazioni non contabilizzate'), 'pending');
    assert.equal(sectionKind('Movimenti in sospeso'), 'pending');
    assert.equal(sectionKind('Reverted from October 1, 2026 to October 8, 2026'), 'reverted');
    assert.equal(sectionKind('Cancelled payments'), 'reverted');
    assert.equal(sectionKind('Account transactions from October 1, 2026 to October 8, 2026'), 'booked');
    assert.equal(sectionKind('Personal and Group Pockets transactions'), 'booked');
    assert.equal(sectionKind(''), 'booked');
  });
});
