import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { currencyIn, inferDateOrder, inferDecimal, looksLikeAmount, looksLikeDate, looksLikeMoney, parseAmount, parseDate, roundCents, tidy, ymd } from '../src/importer/values.js';

const REF = { y: 2026, m: 10, d: 10 };
const d = (s, opts) => {
  const r = parseDate(s, { ref: REF, ...opts });
  return r ? ymd(r) : null;
};

describe('dates: every way a bank writes one', () => {
  it('year first', () => {
    assert.equal(d('2026-10-01'), '2026-10-01');
    assert.equal(d('2026/10/1'), '2026-10-01');
    assert.equal(d('2026.10.01'), '2026-10-01');
    assert.equal(d('2026-10-01 13:45:10'), '2026-10-01');
    assert.equal(d('2026-10-01T13:45:10Z'), '2026-10-01');
    assert.equal(d('2026-10-01T13:45:10.123+02:00'), '2026-10-01');
  });
  it('day first with any separator, a time, a two-digit year', () => {
    assert.equal(d('01/10/2026'), '2026-10-01');
    assert.equal(d('01.10.2026'), '2026-10-01');
    assert.equal(d('1-10-2026'), '2026-10-01');
    assert.equal(d('01/10/26'), '2026-10-01');
    assert.equal(d('01/10/2026 13:45'), '2026-10-01');
    assert.equal(d('31.12.2025'), '2025-12-31');
  });
  it('month first when the file says so', () => {
    assert.equal(d('10/01/2026', { order: 'mdy' }), '2026-10-01');
    assert.equal(d('10/01/2026', { order: 'dmy' }), '2026-01-10');
    assert.equal(d('12/25/2026', { order: 'mdy' }), '2026-12-25');
    assert.equal(d('25/12/2026', { order: 'mdy' }), null, 'there is no month 25');
  });
  it('months written out in seven languages', () => {
    assert.equal(d('Oct 1, 2026'), '2026-10-01');
    assert.equal(d('October 1, 2026'), '2026-10-01');
    assert.equal(d('1 Oct 2026'), '2026-10-01');
    assert.equal(d('01-Oct-26'), '2026-10-01');
    assert.equal(d('01OCT2026'), '2026-10-01');
    assert.equal(d('1st October 2026'), '2026-10-01');
    assert.equal(d('1 ottobre 2026'), '2026-10-01');
    assert.equal(d('3 set 2026'), '2026-09-03');
    assert.equal(d('1. Oktober 2026'), '2026-10-01');
    assert.equal(d('15. März 2026'), '2026-03-15');
    assert.equal(d('1 octobre 2026'), '2026-10-01');
    assert.equal(d('14 août 2026'), '2026-08-14');
    assert.equal(d('1 de octubre de 2026'), '2026-10-01');
    assert.equal(d('20 dez 2025'), '2025-12-20');
    assert.equal(d('3 mei 2026'), '2026-05-03');
    assert.equal(d('2026 Oct 1'), '2026-10-01');
  });
  it('ignores a weekday name', () => {
    assert.equal(d('Mon, 01 Oct 2026'), '2026-10-01');
    assert.equal(d('Thursday 1 October 2026'), '2026-10-01');
    assert.equal(d('lun 05/10/2026'), '2026-10-05');
    assert.equal(d('Mar 5, 2026'), '2026-03-05', '"Mar" here is March, not Tuesday');
  });
  it('a missing year is the latest one that is not in the future', () => {
    assert.equal(d('1 Oct'), '2026-10-01');
    assert.equal(d('05/10'), '2026-10-05');
    assert.equal(d('28 Dec'), '2025-12-28', 'last December, not next');
    assert.equal(d('12 Oct'), '2026-10-12', 'within a week of today still counts as this year');
    assert.equal(parseDate('1 Oct', { ref: REF }).guessedYear, true);
    assert.equal(parseDate('1 Oct 2026', { ref: REF }).guessedYear, undefined);
  });
  it('refuses what is not a date', () => {
    for (const bad of ['', '   ', 'Amazon', '2026', 'Oct 2026', '31/02/2026', '32/01/2026', '13/13/2026', '12.50', '0', 'Prelievo 12', '1989-12-31', 'x'.repeat(60)]) {
      assert.equal(d(bad), null, JSON.stringify(bad));
    }
  });
  it('leap days are real only in leap years', () => {
    assert.equal(d('29/02/2024'), '2024-02-29');
    assert.equal(d('29/02/2026'), null);
  });
  it('compact dates only when asked', () => {
    assert.equal(d('20261001'), null);
    assert.equal(d('20261001', { compact: true }), '2026-10-01');
  });
  it('looksLikeDate is stricter than parseDate: a quantity is not a date', () => {
    assert.equal(looksLikeDate('01/10/2026'), true);
    assert.equal(looksLikeDate('1.10'), false);
    assert.equal(looksLikeDate('3,5'), false);
    assert.equal(looksLikeDate('Oct 1, 2026'), true);
    assert.equal(looksLikeDate('hello'), false);
  });
});

describe('which way round are the all-number dates?', () => {
  it('a first number above 12 can only be a day', () => {
    assert.deepEqual(inferDateOrder(['03/10/2026', '25/10/2026', '04/10/2026']), { order: 'dmy', ambiguous: false });
  });
  it('a second number above 12 means month first', () => {
    assert.deepEqual(inferDateOrder(['10/03/2026', '10/25/2026'], 'dmy'), { order: 'mdy', ambiguous: false });
  });
  it('with nothing above 12 it follows the order of the lines and the shorter stretch of time', () => {
    // 01/10, 02/10, 03/10 read month first would be January, February, March: three months for a three-line statement
    const r = inferDateOrder(['01/10/2026', '02/10/2026', '03/10/2026'], 'mdy');
    assert.equal(r.order, 'dmy');
    assert.equal(r.ambiguous, true);
    const mdy = inferDateOrder(['10/01/2026', '10/02/2026', '10/03/2026'], 'dmy');
    assert.equal(mdy.order, 'mdy');
  });
  it('descending statements work the same', () => {
    assert.equal(inferDateOrder(['03/10/2026', '02/10/2026', '01/10/2026'], 'mdy').order, 'dmy');
  });
  it('uses the hint only when nothing else can say', () => {
    assert.deepEqual(inferDateOrder(['01/02/2026'], 'mdy'), { order: 'mdy', ambiguous: true });
    assert.deepEqual(inferDateOrder(['01/02/2026'], 'dmy'), { order: 'dmy', ambiguous: true });
  });
  it('dates that are not all-number do not matter', () => {
    assert.deepEqual(inferDateOrder(['2026-10-01', 'Oct 3, 2026']), { order: 'dmy', ambiguous: false });
  });
});

describe('amounts: every way a bank writes one', () => {
  const a = (s, decimal) => parseAmount(s, { decimal });
  it('plain and signed', () => {
    assert.equal(a('20.33'), 20.33);
    assert.equal(a('-20.33'), -20.33);
    assert.equal(a('+20.33'), 20.33);
    assert.equal(a('−20.33'), -20.33, 'the typographic minus');
    assert.equal(a('–20.33'), -20.33, 'an en dash');
    assert.equal(a('0'), 0);
    assert.equal(a('-0.00'), 0);
    assert.equal(a('1234'), 1234);
  });
  it('European and English thousands and decimals', () => {
    assert.equal(a('1.074,34'), 1074.34);
    assert.equal(a('1,074.34'), 1074.34);
    assert.equal(a('-1.074,34'), -1074.34);
    assert.equal(a('1.234.567,89'), 1234567.89);
    assert.equal(a('1,234,567.89'), 1234567.89);
    assert.equal(a("1'074.34"), 1074.34, 'Swiss');
    assert.equal(a('1 074,34'), 1074.34, 'a space');
    assert.equal(a('1 074,34'), 1074.34, 'a no-break space');
    assert.equal(a('20,33'), 20.33);
    assert.equal(a('0,5'), 0.5);
  });
  it('a lone separator with three digits is thousands, unless the file says otherwise', () => {
    assert.equal(a('1.234'), 1234);
    assert.equal(a('1,234'), 1234);
    assert.equal(a('1.234', '.'), 1.234);
    assert.equal(a('1,234', ','), 1.234);
    assert.equal(a('1.234', ','), 1234);
    assert.equal(a('1.2'), 1.2);
    assert.equal(a('1.234.567'), 1234567);
  });
  it('currency marks and codes', () => {
    assert.equal(a('€ -20,33'), -20.33);
    assert.equal(a('-€20.33'), -20.33);
    assert.equal(a('$1,000.50'), 1000.5);
    assert.equal(a('£5'), 5);
    assert.equal(a('EUR 5,00'), 5);
    assert.equal(a('5,00 EUR'), 5);
    assert.equal(a('CHF 1\'000.00'), 1000);
    assert.equal(a('-5.00 USD'), -5);
  });
  it('brackets, trailing signs and credit/debit marks', () => {
    assert.equal(a('(20.00)'), -20);
    assert.equal(a('20.00-'), -20);
    assert.equal(a('20.00+'), 20);
    assert.equal(a('20.00 CR'), 20);
    assert.equal(a('20.00 DR'), -20);
    assert.equal(a('20.00DR'), -20);
    assert.equal(a('DR 20.00'), -20);
    assert.equal(a('(€ 20,00)'), -20);
  });
  it('refuses what is not an amount', () => {
    for (const bad of ['', '  ', 'abc', 'Amazon 12', '12abc', '1.2.3,4,5x', '--', '€', '-', '12/10/2026', 'IT60X0542811101000000123456', 'x'.repeat(50)]) {
      assert.equal(a(bad), null, JSON.stringify(bad));
    }
  });
  it('rounds the dust Excel leaves behind', () => {
    assert.equal(roundCents(-20.329999999999998), -20.33);
    assert.equal(roundCents(1074.3400000000001), 1074.34);
    assert.equal(roundCents(0.1 + 0.2), 0.3);
    assert.equal(roundCents(2.675), 2.68);
    assert.equal(roundCents(-2.675), -2.68);
  });
  it('looks like money only when it carries a sign, decimals, brackets or a currency', () => {
    assert.equal(looksLikeMoney('20,33'), true);
    assert.equal(looksLikeMoney('-20'), true);
    assert.equal(looksLikeMoney('€ 5'), true);
    assert.equal(looksLikeMoney('2026'), false, 'a bare year or id is not money');
    assert.equal(looksLikeMoney('hello'), false);
    assert.equal(looksLikeAmount('2026'), true);
    assert.equal(looksLikeAmount(''), false);
  });
  it('says which currency a cell mentions', () => {
    assert.equal(currencyIn('€ -20,33'), 'EUR');
    assert.equal(currencyIn('20 GBP'), 'GBP');
    assert.equal(currencyIn('£5'), 'GBP');
    assert.equal(currencyIn('$5'), 'USD');
    assert.equal(currencyIn('5'), null);
    assert.equal(currencyIn('usd'), 'USD');
  });
});

describe('how a file writes its decimals', () => {
  it('reads the evidence of all the values', () => {
    assert.deepEqual(inferDecimal(['1.074,34', '-20,33', '5,00']), { decimal: ',', ambiguous: false });
    assert.deepEqual(inferDecimal(['1,074.34', '-20.33', '5.00']), { decimal: '.', ambiguous: false });
    assert.deepEqual(inferDecimal(['€ -20,33', '(5,00)', '12,10 EUR']), { decimal: ',', ambiguous: false });
  });
  it('a stray value that disagrees does not change the answer, but is noted', () => {
    assert.deepEqual(inferDecimal(['1,50', '2,50', '3,50', '4.50']), { decimal: ',', ambiguous: true });
  });
  it('three digits after a lone separator whisper that it is a thousands mark', () => {
    assert.equal(inferDecimal(['1.234', '2.500', '10.000']).decimal, ',');
    assert.equal(inferDecimal(['1,234', '2,500']).decimal, '.');
  });
  it('falls back to the hint when there is no evidence', () => {
    assert.equal(inferDecimal(['100', '200'], '.').decimal, '.');
    assert.equal(inferDecimal([], ',').decimal, ',');
  });
});

describe('tidy', () => {
  it('collapses every kind of space', () => {
    assert.equal(tidy('  a  b \t c\n d  '), 'a b c d');
    assert.equal(tidy(null), '');
  });
});
