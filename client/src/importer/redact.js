// Taking the sensitive strings out of text from a statement before it leaves the browser (docs/DESIGN.md section 41, "Safety").
// A description is kept readable ("Direct debit to AGOS DUCATO") while account and card numbers, IBANs and e-mail addresses are cut down to
// what a person needs to recognise them (the last four digits) or removed. server/src/lib/redact.js does the same on the server, which does
// not trust the browser; test/importer-redact.test.js and server/test/import-redact.test.js hold the same cases.

import { tidy } from './values.js';

const tail = (s) => s.replace(/[^A-Za-z0-9]/g, '').slice(-4);

/** Everything that identifies an account, a card, a mailbox or a single operation, made harmless. */
export function redact(input) {
  let s = tidy(input);
  if (!s) return '';
  // transaction ids (UUIDs) say nothing to a person and are the bank's own handle
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  // e-mail addresses
  s = s.replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, (_m, domain) => `…@${domain}`);
  // IBANs: country, check digits and 11 to 30 more letters or digits, in groups of four or not (a group of letters only is a word, not a number)
  s = s.replace(/\b([A-Za-z]{2})(\d{2})((?:\s?(?=[A-Za-z0-9]{0,3}\d)[A-Za-z0-9]{4}){2,7}(?:\s?(?=[A-Za-z0-9]{0,2}\d)[A-Za-z0-9]{1,3})?)\b/g, (m, cc) => {
    const compact = m.replace(/\s/g, '');
    if (compact.length < 15 || compact.length > 34) return m;
    return `${cc.toUpperCase()}…${tail(compact)}`;
  });
  // card numbers with the middle hidden: 512345******6789, 5123 45** **** 6789, XXXX XXXX XXXX 6789 (the hidden part must touch digits)
  s = s.replace(/\b(?:\d{1,6}[ -]?){0,3}(?:[*xX•·][ -]?){4,}\d{1,4}\b|\b\d{4,6}(?:[ -]?[*xX•·]){4,}/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••';
  });
  // card numbers in full (13 to 19 digits, grouped in fours or not)
  s = s.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => `••••${m.replace(/\D/g, '').slice(-4)}`);
  // phone numbers written with a plus
  s = s.replace(/\+\d[\d ()-]{7,}\d/g, (m) => `…${m.replace(/\D/g, '').slice(-4)}`);
  // any other long number (account, mandate, reference): keep the last four
  s = s.replace(/\b\d{9,}\b/g, (m) => `…${m.slice(-4)}`);
  // references written with letters and digits mixed, 12 characters or more (many card processors)
  s = s.replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{16,}\b/g, (m) => `…${m.slice(-4)}`);
  return tidy(s);
}
