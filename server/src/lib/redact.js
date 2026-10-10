// Taking the sensitive strings out of text from a bank statement (docs/DESIGN.md section 41, "Safety"). The browser does this before anything
// is sent; the server does it again because it does not trust the browser. It is the same function as client/src/importer/redact.js, and
// client/test/importer-redact.test.js and server/test/import-redact.test.js hold the same cases.

const tidy = (s) =>
  String(s ?? '')
    .replace(/[  -​  　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tail = (s) => s.replace(/[^A-Za-z0-9]/g, '').slice(-4);

/** Everything that identifies an account, a card, a mailbox or a single operation, made harmless. */
export function redact(input) {
  let s = tidy(input);
  if (!s) return '';
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  s = s.replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, (_m, domain) => `…@${domain}`);
  s = s.replace(/\b([A-Za-z]{2})(\d{2})((?:\s?(?=[A-Za-z0-9]{0,3}\d)[A-Za-z0-9]{4}){2,7}(?:\s?(?=[A-Za-z0-9]{0,2}\d)[A-Za-z0-9]{1,3})?)\b/g, (m, cc) => {
    const compact = m.replace(/\s/g, '');
    if (compact.length < 15 || compact.length > 34) return m;
    return `${cc.toUpperCase()}…${tail(compact)}`;
  });
  s = s.replace(/\b(?:\d{1,6}[ -]?){0,3}(?:[*xX•·][ -]?){4,}\d{1,4}\b|\b\d{4,6}(?:[ -]?[*xX•·]){4,}/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••';
  });
  s = s.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => `••••${m.replace(/\D/g, '').slice(-4)}`);
  s = s.replace(/\+\d[\d ()-]{7,}\d/g, (m) => `…${m.replace(/\D/g, '').slice(-4)}`);
  s = s.replace(/\b\d{9,}\b/g, (m) => `…${m.slice(-4)}`);
  s = s.replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{16,}\b/g, (m) => `…${m.slice(-4)}`);
  return tidy(s);
}
