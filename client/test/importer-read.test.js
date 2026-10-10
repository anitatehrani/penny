import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { interpret, mappingToRemember, MAX_ROWS, openStatement } from '../src/importer/read.js';
import { analyseGrid } from '../src/importer/detect.js';
import { furniture, ISY_COLS, makePdf, makeXlsx, REVOLUT_COLS, tableItems } from './helpers/files.js';

const TODAY = { y: 2026, m: 10, d: 10 };
const bytes = (s, enc = 'utf8') => new Uint8Array(Buffer.from(s, enc));
const read = async (input, opts = {}) => {
  const opened = await openStatement(typeof input === 'string' ? bytes(input) : input, { pdfjs });
  return { opened, ...interpret(opened, { today: TODAY, ...opts }) };
};
const brief = (r) => `${r.date} ${r.type === 'income' ? '+' : '-'}${r.amount.toFixed(2)} ${r.description}`;

// A statement as each kind of bank writes it. Everything is invented; only the layouts are real.
const CORPUS = [
  {
    name: 'Revolut CSV: time stamps, fee column, state column, a pending and a reverted line',
    text: `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-10-01 08:12:44,2026-10-02 03:10:12,Corner Bakery,-4.50,0.00,EUR,COMPLETED,95.50
TOPUP,Current,2026-10-02 09:00:00,2026-10-02 09:00:05,Top-Up by *1010,100.00,0.00,EUR,COMPLETED,195.50
TRANSFER,Current,2026-10-03 10:00:00,,To Jane Doe,-20.00,0.00,EUR,PENDING,
CARD_PAYMENT,Current,2026-10-03 11:00:00,2026-10-04 10:00:00,Cinema,-8.00,0.50,EUR,COMPLETED,167.00
CARD_PAYMENT,Current,2026-10-04 08:00:00,,Cancelled shop,-9.99,0.00,EUR,REVERTED,
`,
    rows: ['2026-10-02 -4.50 Corner Bakery', '2026-10-02 +100.00 Top-Up by *1010', '2026-10-03 -20.00 To Jane Doe', '2026-10-04 -8.00 Cinema', '2026-10-04 -0.50 Fee: Cinema', '2026-10-04 -9.99 Cancelled shop'],
    status: ['booked', 'booked', 'pending', 'booked', 'booked', 'reverted'],
    sign: 'signed',
    currency: 'EUR',
  },
  {
    name: 'N26 (German): payee, reference, category, ASCII quotes',
    text: `"Datum","Empfänger","Kontonummer","Transaktionstyp","Verwendungszweck","Kategorie","Betrag (EUR)","Betrag (Fremdwährung)"
"2026-10-01","REWE Markt GmbH","DE89370400440532013000","Ausgehende Überweisung","Wocheneinkauf","Lebensmittel","-45.30",""
"2026-10-02","Werkgeber AG","DE02120300000000202051","Eingehende Überweisung","Gehalt Oktober","Einkommen","1800.50",""
`,
    rows: ['2026-10-01 -45.30 REWE Markt GmbH', '2026-10-02 +1800.50 Werkgeber AG'],
    note: ['Wocheneinkauf', 'Gehalt Oktober'],
  },
  {
    name: 'Chase (US): month first, a Details column that is really debit and credit',
    text: `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,10/01/2026,"STARBUCKS STORE 12345",-4.50,DEBIT_CARD,995.50,
CREDIT,10/02/2026,"PAYROLL ACME",1500.00,ACH_CREDIT,2495.50,
DEBIT,10/03/2026,"SHELL OIL 5712",-40.00,DEBIT_CARD,2455.50,
`,
    rows: ['2026-10-01 -4.50 STARBUCKS STORE 12345', '2026-10-02 +1500.00 PAYROLL ACME', '2026-10-03 -40.00 SHELL OIL 5712'],
    dateOrder: 'mdy',
  },
  {
    name: 'Italian bank CSV: semicolons, decimal commas, two text columns, a booked column, a currency column',
    text: `Data;Operazione;Dettagli;Conto o carta;Contabilizzazione;Categoria;Valuta;Importo
01/10/2026;Pagamento POS;ESSELUNGA MILANO 0123;Conto 1000;Contabilizzato;Generi alimentari;EUR;-45,30
02/10/2026;Bonifico a favore di;Mario Rossi affitto;Conto 1000;Contabilizzato;Casa;EUR;-650,00
03/10/2026;Pagamento POS;ZARA ITALIA SRL;Conto 1000;Non contabilizzato;Abbigliamento;EUR;-29,99
04/10/2026;Accredito stipendio;ACME SPA;Conto 1000;Contabilizzato;Entrate;EUR;1.800,50
`,
    rows: ['2026-10-01 -45.30 ESSELUNGA MILANO 0123', '2026-10-02 -650.00 Mario Rossi affitto', '2026-10-03 -29.99 ZARA ITALIA SRL', '2026-10-04 +1800.50 ACME SPA'],
    status: ['booked', 'booked', 'pending', 'booked'],
    currency: 'EUR',
    category: ['Generi alimentari', 'Casa', 'Abbigliamento', 'Entrate'],
  },
  {
    name: 'Fineco-like: separate money in and money out columns, an underscore in the headings',
    text: `Data_Operazione;Data_Valuta;Entrate;Uscite;Descrizione;Descrizione_Completa;Stato
01/10/2026;01/10/2026;;45,30;Pagamento POS;ESSELUNGA MILANO;Contabilizzato
02/10/2026;02/10/2026;1.800,50;;Bonifico;STIPENDIO ACME;Contabilizzato
05/10/2026;06/10/2026;;12,00;Pagamento POS;BAR CENTRALE;Contabilizzato
`,
    rows: ['2026-10-01 -45.30 ESSELUNGA MILANO', '2026-10-02 +1800.50 STIPENDIO ACME', '2026-10-05 -12.00 BAR CENTRALE'],
    sign: 'debitcredit',
  },
  {
    name: 'ING (Dutch): a date like 20261001, an Af/Bij column, unsigned amounts, decimal commas',
    text: `"Datum","Naam / Omschrijving","Rekening","Tegenrekening","Code","Af Bij","Bedrag (EUR)","Mutatiesoort","Mededelingen"
"20261001","Albert Heijn 1234","NL01INGB0001234567","","BA","Af","45,30","Betaalautomaat","Pasvolgnr:001 01-10-2026 13:45"
"20261002","Werkgever BV","NL01INGB0001234567","NL02ABNA0123456789","OV","Bij","1.800,50","Overschrijving","Salaris"
`,
    rows: ['2026-10-01 -45.30 Albert Heijn 1234', '2026-10-02 +1800.50 Werkgever BV'],
    sign: 'direction',
  },
  {
    name: 'Sparkasse (German, Windows-1252): two-digit years, value date, one column for payer and payee',
    bytes: bytes('Buchungstag;Valuta;Auftraggeber/Begünstigter;Buchungstext;Verwendungszweck;Betrag;Währung\n01.10.26;01.10.26;REWE Markt;Lastschrift;Einkauf 4711;-45,30;EUR\n02.10.26;02.10.26;Arbeitgeber GmbH;Gutschrift;Gehalt;1.800,50;EUR\n', 'latin1'),
    rows: ['2026-10-01 -45.30 REWE Markt', '2026-10-02 +1800.50 Arbeitgeber GmbH'],
    currency: 'EUR',
  },
  {
    name: 'a UK bank: counter party, reference, spending category, pounds in the heading',
    text: `Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP),Spending Category
01/10/2026,Tesco Stores,CARD 1234,CARD,-12.40,987.60,GROCERIES
13/10/2026,Employer Ltd,SALARY,FASTER PAYMENT,2100.00,3087.60,INCOME
`,
    rows: ['2026-10-01 -12.40 Tesco Stores', '2026-10-13 +2100.00 Employer Ltd'],
    currency: 'GBP',
    dateOrder: 'dmy',
  },
  {
    name: 'a French bank: accents, euros in the headings, spaces in the thousands',
    text: `Date;Libellé;Débit euros;Crédit euros
01/10/2026;CARTE 01/10 BOULANGERIE PAUL;4,50;
02/10/2026;VIREMENT SALAIRE;;1 800,50
`,
    rows: ['2026-10-01 -4.50 CARTE 01/10 BOULANGERIE PAUL', '2026-10-02 +1800.50 VIREMENT SALAIRE'],
    sign: 'debitcredit',
  },
  {
    name: 'a card statement: purchases are positive, the payment is negative',
    text: `Transaction Date,Post Date,Description,Category,Amount
10/01/2026,10/02/2026,AMAZON MKTPLACE,Shopping,45.30
10/02/2026,10/03/2026,PAYMENT THANK YOU,Payment,-500.00
10/03/2026,10/04/2026,NETFLIX.COM,Entertainment,15.99
10/05/2026,10/05/2026,CAFE ROMA,Dining,4.50
10/06/2026,10/06/2026,CORNER SHOP,Shopping,9.99
`,
    rows: ['2026-10-01 -45.30 AMAZON MKTPLACE', '2026-10-02 +500.00 PAYMENT THANK YOU', '2026-10-03 -15.99 NETFLIX.COM', '2026-10-05 -4.50 CAFE ROMA', '2026-10-06 -9.99 CORNER SHOP'],
    sign: 'positiveOut',
  },
  {
    name: 'no headings at all: date, text, amount',
    text: `01/10/2026,Coffee Shop,-4.50
02/10/2026,Salary,1500.00
03/10/2026,Supermarket,-32.10
04/10/2026,Pharmacy,-12.00
`,
    rows: ['2026-10-01 -4.50 Coffee Shop', '2026-10-02 +1500.00 Salary', '2026-10-03 -32.10 Supermarket', '2026-10-04 -12.00 Pharmacy'],
    confidence: 'medium',
  },
  {
    name: 'no headings, money out and money in in separate columns and a running balance',
    text: `01/10/2026,Coffee Shop,4.50,,95.50
02/10/2026,Salary,,1500.00,1595.50
03/10/2026,Rent,650.00,,945.50
04/10/2026,Gas,40.00,,905.50
`,
    rows: ['2026-10-01 -4.50 Coffee Shop', '2026-10-02 +1500.00 Salary', '2026-10-03 -650.00 Rent', '2026-10-04 -40.00 Gas'],
    sign: 'debitcredit',
  },
  {
    name: 'explanations above the table, a total line below it, and a blank date that shares the date above',
    text: `Account statement;;;
Holder;Mario Rossi;;
Period;01/10/2026 - 31/10/2026;;

Date;Description;Amount;Balance
01/10/2026;Coffee;-2,00;98,00
;Croissant;-1,50;96,50
02/10/2026;Salary;1500,00;1596,50
Total;;1496,50;
`,
    rows: ['2026-10-01 -2.00 Coffee', '2026-10-01 -1.50 Croissant', '2026-10-02 +1500.00 Salary'],
    left: ['total'],
  },
  {
    name: 'amounts with currency signs, brackets and trailing minus',
    text: `Date;Details;Amount
01/10/2026;Shop one;€ -20,33
02/10/2026;Shop two;(15,00)
03/10/2026;Shop three;7,50-
04/10/2026;Refund;+12,00
`,
    rows: ['2026-10-01 -20.33 Shop one', '2026-10-02 -15.00 Shop two', '2026-10-03 -7.50 Shop three', '2026-10-04 +12.00 Refund'],
  },
  {
    name: 'dates written with month names',
    text: `Date,Description,Amount
"Oct 1, 2026",Shop one,-5.00
"Oct 2, 2026",Shop two,-6.00
"Oct 3, 2026",Shop three,-7.00
`,
    rows: ['2026-10-01 -5.00 Shop one', '2026-10-02 -6.00 Shop two', '2026-10-03 -7.00 Shop three'],
  },
];

describe('reading statements the way different banks write them', () => {
  for (const c of CORPUS) {
    it(c.name, async () => {
      const r = await read(c.bytes ?? c.text);
      assert.equal(r.needsMapping, -1, 'understood without help');
      assert.deepEqual(r.rows.map(brief), c.rows);
      if (c.status) assert.deepEqual(r.rows.map((x) => x.status), c.status);
      if (c.sign) assert.equal(r.sections[0].mapping.sign, c.sign);
      if (c.currency) assert.equal(r.currency, c.currency);
      if (c.note) assert.deepEqual(r.rows.map((x) => x.note), c.note);
      if (c.category) assert.deepEqual(r.rows.map((x) => x.bankCategory), c.category);
      if (c.dateOrder) assert.equal(r.sections[0].mapping.dateOrder, c.dateOrder);
      if (c.confidence) assert.equal(r.sections[0].confidence, c.confidence);
      if (c.left) assert.deepEqual(r.left.map((l) => l.reason), c.left);
    });
  }
});

describe('what is left out is listed, not lost', () => {
  it('names the reason for each line that is not a payment', async () => {
    const r = await read(`Date;Description;Amount
01/10/2026;Coffee;-2,00
Saldo finale;;96,00
not a date;Something;-1,00
02/10/2026;Free sample;0,00
03/10/2026;No amount here;
`);
    assert.deepEqual(r.rows.map(brief), ['2026-10-01 -2.00 Coffee']);
    assert.deepEqual(r.left.map((l) => l.reason), ['total', 'nodate', 'zero', 'noamount']);
    assert.ok(r.left.every((l) => l.text && l.line > 0));
  });
});

describe('dates that could be read two ways', () => {
  it('uses the order of the lines and says it was a choice', async () => {
    const r = await read('Date;Description;Amount\n01/02/2026;A;-1,00\n02/02/2026;B;-2,00\n03/02/2026;C;-3,00\n');
    assert.deepEqual(r.rows.map((x) => x.date), ['2026-02-01', '2026-02-02', '2026-02-03']);
    assert.equal(r.sections[0].mapping.dateAmbiguous, true);
    assert.equal(r.sections[0].confidence, 'medium');
  });
  it('follows the hint when nothing else can say', async () => {
    const r = await read('Date;Description;Amount\n01/02/2026;A;-1,00\n', { hint: { dateOrder: 'mdy' } });
    assert.equal(r.rows[0].date, '2026-01-02');
  });
  it('a year left out is the latest one that is not in the future', async () => {
    const r = await read('Date;Description;Amount\n01 Oct;A;-1,00\n28 Dec;B;-2,00\n');
    assert.deepEqual(r.rows.map((x) => [x.date, x.guessedYear]), [['2026-10-01', true], ['2025-12-28', true]]);
  });
});

describe('numbers that could be read two ways', () => {
  it('decides decimals from the whole column, not one cell', async () => {
    const r = await read('Date,Description,Amount\n01/10/2026,A,"1,234.50"\n02/10/2026,B,"5.50"\n03/10/2026,C,"-2.25"\n');
    assert.deepEqual(r.rows.map((x) => x.amount), [1234.5, 5.5, 2.25]);
  });
  it('a lone 1.234 in a comma-decimal file is a thousand', async () => {
    const r = await read('Date;Description;Amount\n01/10/2026;A;1.234\n02/10/2026;B;5,50\n03/10/2026;C;-2,25\n');
    assert.deepEqual(r.rows.map((x) => x.amount), [1234, 5.5, 2.25]);
  });
});

describe('Excel files', () => {
  it('reads a workbook with real dates and numbers', async () => {
    const book = makeXlsx([{
      name: 'Movements',
      rows: [
        ['Date', 'Description', 'Amount', 'Balance'],
        [{ date: 46296 }, 'Coffee', -2.5, 997.5],
        [{ date: 46297 }, 'Salary', 1200, 2197.5],
        [{ date: 46298 }, 'Rent', -650.1, 1547.4],
        [{ date: 46299 }, 'Bar', -3, 1544.4],
      ],
    }]);
    const r = await read(book);
    assert.equal(r.opened.kind, 'xlsx');
    assert.deepEqual(r.rows.map(brief), ['2026-10-01 -2.50 Coffee', '2026-10-02 +1200.00 Salary', '2026-10-03 -650.10 Rent', '2026-10-04 -3.00 Bar']);
    assert.deepEqual(r.check, { checked: 3, agree: 3 });
  });
  it('reads dates and amounts that were typed as text', async () => {
    const book = makeXlsx([{ name: 'S', rows: [['Data', 'Descrizione', 'Importo'], ['01/10/2026', 'Bar', '-2,50'], ['02/10/2026', 'Stipendio', '1.200,00']] }]);
    const r = await read(book);
    assert.deepEqual(r.rows.map(brief), ['2026-10-01 -2.50 Bar', '2026-10-02 +1200.00 Stipendio']);
  });
  it('reads every sheet as a section, and the one without payments is not forced', async () => {
    const book = makeXlsx([
      { name: 'Info', rows: [['Account', 'Mario'], ['Bank', 'Example']] },
      { name: 'Payments', rows: [['Date', 'Description', 'Amount'], ['01/10/2026', 'A', '-1,00'], ['02/10/2026', 'B', '-2,00']] },
    ]);
    const r = await read(book);
    assert.equal(r.rows.length, 2);
    assert.equal(r.sections.length, 2);
    assert.equal(r.sections[1].count, 2);
    assert.equal(r.needsMapping, -1);
  });
});

describe('PDF files', () => {
  it('a Revolut-like statement: sections, references, sign from the columns, and the balance column as a check', async () => {
    const title = (str, y) => ({ str, x: 40, y, w: 250, h: 10 });
    const pendingRows = [{ cells: ['Oct 7, 2026', ['Online Shop', 'Transaction Id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], '', '29.99'] }];
    const rows = [
      { cells: ['Oct 1, 2026', ['Corner Bakery', 'Transaction Id: 11111111-2222-3333-4444-555555555555', 'To: Corner Bakery, Genova', 'Card: 411111******1111'], '4.50', '', '95.50'] },
      { cells: ['Oct 2, 2026', ['Salary Acme', 'Transaction Id: 22222222-2222-3333-4444-555555555555', 'From: ACME SPA, IT60X0542811101000000123456'], '', '1,000.00', '1,095.50'] },
      { cells: ['Oct 3, 2026', ['Transfer to JOHN DOE', 'Reference: dinner', 'Transaction Id: 33333333-2222-3333-4444-555555555555'], '20.00', '', '1,075.50'] },
      { cells: ['Oct 4, 2026', 'Pharmacy', '12.30', '', '1,063.20'] },
      { cells: ['Oct 5, 2026', 'Gift shop', '3.20', '', '1,060.00'] },
    ];
    const items = [
      title('Pending from October 1, 2026 to October 8, 2026', 120),
      ...tableItems({ cols: REVOLUT_COLS.slice(0, 4), rows: pendingRows, y: 145, pitch: 11 }).items,
      title('Account transactions from October 1, 2026 to October 8, 2026', 260),
      ...tableItems({ cols: REVOLUT_COLS, rows, y: 285, pitch: 11, rowGap: 14 }).items,
      ...furniture(0, 1, 'EUR Statement'),
    ];
    const r = await read(makePdf([{ items }]));
    assert.equal(r.opened.kind, 'pdf');
    assert.equal(r.currency, 'EUR');
    assert.deepEqual(r.sections.map((s) => [s.kind, s.count]), [['pending', 1], ['booked', 5]]);
    const booked = r.rows.filter((x) => x.status === 'booked');
    assert.deepEqual(booked.map(brief), ['2026-10-01 -4.50 Corner Bakery', '2026-10-02 +1000.00 Salary Acme', '2026-10-03 -20.00 Transfer to JOHN DOE', '2026-10-04 -12.30 Pharmacy', '2026-10-05 -3.20 Gift shop']);
    assert.deepEqual(booked.map((x) => x.reference), ['11111111-2222-3333-4444-555555555555', '22222222-2222-3333-4444-555555555555', '33333333-2222-3333-4444-555555555555', '', '']);
    assert.equal(booked[0].note, 'To: Corner Bakery, Genova');
    assert.equal(booked[1].note, 'From: ACME SPA, IT…3456', 'the IBAN is cut down to its last four');
    assert.equal(booked[2].note, 'Reference: dinner');
    assert.ok(!JSON.stringify(r.rows).includes('411111'), 'the card number does not reach any row');
    assert.deepEqual(r.rows.find((x) => x.status === 'pending').description, 'Online Shop');
    assert.deepEqual(r.check, { checked: 4, agree: 4 }, 'every balance agrees with the amounts');
  });
  it('a bank that centres its cells, with a booked column, a category column and euro signs', async () => {
    const rows = [
      { cells: ['10.10.2026', 'Corner Cafe', 'NO', 'Other spending', '€ -20,33'] },
      { cells: ['09.10.2026', ['Cash withdrawal', 'Branch of the group'], 'SI', 'Cash', '€ -50,00'] },
      { cells: ['08.10.2026', ['Direct debit to', 'ACME LOANS', 'Viale Roma', '7654321098765432109876'], 'SI', ['Loan', 'payments'], '€ -87,68'] },
      { cells: ['07.10.2026', 'Pension', 'SI', 'Transfers received', '€ 1.074,34'] },
    ];
    const items = [...tableItems({ cols: ISY_COLS, rows, align: 'center', pitch: 14.4, rowGap: 14, y: 200 }).items, { str: 'List of movements', x: 220, y: 80, w: 120, h: 14 }];
    const r = await read(makePdf([{ items }]));
    assert.deepEqual(r.rows.map((x) => [x.date, x.type, x.amount, x.status]), [
      ['2026-10-10', 'expense', 20.33, 'pending'],
      ['2026-10-09', 'expense', 50, 'booked'],
      ['2026-10-08', 'expense', 87.68, 'booked'],
      ['2026-10-07', 'income', 1074.34, 'booked'],
    ]);
    assert.equal(r.rows[2].description, 'Direct debit to ACME LOANS Viale Roma …9876');
    assert.equal(r.rows[2].bankCategory, 'Loan payments');
    assert.equal(r.currency, 'EUR');
  });
  it('a PDF with no text in it is explained', async () => {
    await assert.rejects(() => read(makePdf([{ items: [] }])), (e) => e.code === 'scan' && /scan/.test(e.message));
  });
  it('a PDF with text but no table is explained', async () => {
    await assert.rejects(() => read(makePdf([{ items: [{ str: 'Dear customer, this is a letter.', x: 50, y: 100 }] }])), (e) => e.code === 'notable');
  });
  it('a statement without a heading is read from its lines', async () => {
    const lines = [['01/10/2026', 'Coffee Bar Roma', '-2.50', '997.50'], ['02/10/2026', 'Salary', '1,200.00', '2,197.50'], ['03/10/2026', 'Rent', '-650.00', '1,547.50']];
    const items = lines.flatMap((l, i) => [{ str: l[0], x: 40, y: 100 + i * 16 }, { str: l[1], x: 120, y: 100 + i * 16 }, { str: l[2], x: 380, y: 100 + i * 16 }, { str: l[3], x: 480, y: 100 + i * 16 }]);
    const r = await read(makePdf([{ items }]));
    assert.deepEqual(r.rows.map(brief), ['2026-10-01 -2.50 Coffee Bar Roma', '2026-10-02 +1200.00 Salary', '2026-10-03 -650.00 Rent']);
    assert.equal(r.sections[0].confidence, 'medium');
  });
});

describe('files that cannot be read are explained', () => {
  it('an empty file', async () => {
    await assert.rejects(() => openStatement(new Uint8Array(0), { pdfjs }), (e) => e.code === 'empty');
  });
  it('an old .xls file', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await assert.rejects(() => openStatement(ole, { pdfjs }), (e) => e.code === 'oldexcel' && /\.xlsx/.test(e.message));
  });
  it('a picture', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
    await assert.rejects(() => openStatement(png, { pdfjs }), (e) => e.code === 'unreadable');
  });
  it('text that has no table of payments needs the matching screen', async () => {
    const r = await read('Hello\nThis is a letter\nabout nothing in particular\n');
    assert.equal(r.rows.length, 0);
    assert.equal(r.needsMapping, 0);
  });
  it('too many lines are cut and the person is told', async () => {
    const lines = Array.from({ length: MAX_ROWS + 5 }, (_v, i) => `01/10/2026;Shop ${i};-1,00`).join('\n');
    const r = await read(`Date;Description;Amount\n${lines}\n`);
    assert.equal(r.rows.length, MAX_ROWS);
    assert.equal(r.tooMany, true);
    assert.match(r.notes[0], /up to 3000/);
  });
});

describe('matching the columns by hand', () => {
  const text = 'Col A;Col B;Col C\n01/10/2026;Coffee;-2,00\n02/10/2026;Bread;-3,00\n03/10/2026;Salary;1500,00\n';
  it('a file Penny cannot name by headings is still read from its content, with a note', async () => {
    const r = await read(text);
    assert.equal(r.rows.length, 3);
  });
  it('an override replaces what Penny guessed, and is remembered by its headings', async () => {
    const opened = await openStatement(bytes('When;What;Sum\n01/10/2026;Coffee;2,00\n02/10/2026;Bread;3,00\n03/10/2026;Salary;1500,00\n'), { pdfjs });
    const guess = analyseGrid(opened.grids[0], {});
    const mapping = { ...guess, roles: ['date', 'description', 'amount'], sign: 'positiveIn', confidence: 'high', notes: [] };
    const r = interpret(opened, { overrides: { 0: mapping }, today: TODAY });
    assert.deepEqual(r.rows.map((x) => x.type), ['income', 'income', 'income']);
    const keep = mappingToRemember(opened.grids[0], mapping);
    assert.equal(keep.signature, 'when|what|sum');
    const again = interpret(opened, { saved: new Map([[keep.signature, keep.mapping]]), today: TODAY });
    assert.equal(again.rows[0].type, 'income');
    assert.equal(again.sections[0].mapping.fromMemory, true);
  });
  it('says what is missing from a mapping', async () => {
    const opened = await openStatement(bytes(text), { pdfjs });
    const r = interpret(opened, { overrides: { 0: { ...analyseGrid(opened.grids[0], {}), roles: ['description', 'description', 'ignore'] } }, today: TODAY });
    assert.match(r.sections[0].problem, /date/i);
    const both = interpret(opened, { overrides: { 0: { ...analyseGrid(opened.grids[0], {}), roles: ['date', 'amount', 'debit'] } }, today: TODAY });
    assert.match(both.sections[0].problem, /either one amount column/i);
  });
});

describe('one file, one way of writing dates', () => {
  it('a table that cannot tell day first from month first follows the table of the same file that can', async () => {
    const title = (str, y) => ({ str, x: 40, y, w: 250, h: 10 });
    const items = [
      title('Pending from the first', 120),
      ...tableItems({ cols: REVOLUT_COLS.slice(0, 4), rows: [{ cells: ['03/10/2026', 'Online Shop', '', '29.99'] }], y: 145, pitch: 11 }).items,
      title('Account transactions from the first', 260),
      ...tableItems({ cols: REVOLUT_COLS, rows: [{ cells: ['25/09/2026', 'Coffee', '2.00', '', '98.00'] }, { cells: ['03/10/2026', 'Bread', '3.00', '', '95.00'] }], y: 285, pitch: 11, rowGap: 14 }).items,
    ];
    const r = await read(makePdf([{ items }]), { hint: { dateOrder: 'mdy' } });
    assert.deepEqual(r.rows.map((x) => x.date), ['2026-10-03', '2026-09-25', '2026-10-03'], 'the pending line is the 3rd of October, like the rest, not the 10th of March');
  });
});
