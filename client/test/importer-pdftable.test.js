import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestGap, buildLines, extractRows, findHeaderBlocks, gridsFromTables, layoutLoose, layoutPdf } from '../src/importer/pdfTable.js';
import { furniture, ISY_COLS, REVOLUT_COLS, tableItems } from './helpers/files.js';

const cellsOf = (t) => t.rows.map((r) => r.cells);

describe('lines and cells from words', () => {
  it('puts words on one baseline in one line and splits cells at the wide gaps', () => {
    const lines = buildLines([
      { str: 'Date', x: 40, y: 100, w: 20, h: 9 },
      { str: 'Description', x: 120, y: 100.4, w: 55, h: 9 },
      { str: 'Of', x: 178, y: 100, w: 10, h: 9 },
      { str: 'which', x: 190, y: 100, w: 25, h: 9 },
      { str: 'Second line', x: 120, y: 112, w: 50, h: 9 },
    ]);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0].cells.map((c) => c.text), ['Date', 'Description Of which']);
    assert.deepEqual(lines[1].cells.map((c) => c.text), ['Second line']);
  });
  it('ignores empty words', () => {
    assert.equal(buildLines([{ str: ' ', x: 1, y: 1, w: 2, h: 9 }]).length, 0);
  });
});

describe('finding the heading of a table', () => {
  it('needs a date and an amount', () => {
    const only = buildLines(tableItems({ cols: REVOLUT_COLS, rows: [] }).items);
    assert.equal(findHeaderBlocks(only).length, 1);
    const none = buildLines([
      { str: 'Product', x: 40, y: 100, w: 30, h: 9 },
      { str: 'Opening balance', x: 250, y: 100, w: 60, h: 9 },
      { str: 'Closing balance', x: 400, y: 100, w: 60, h: 9 },
    ]);
    assert.equal(findHeaderBlocks(none).length, 0, 'a summary of balances is not a list of payments');
  });
  it('joins a heading written over two lines', () => {
    const items = [
      { str: 'DATE', x: 66, y: 100, w: 28, h: 9 },
      { str: 'POSTED', x: 51, y: 112, w: 58, h: 9 },
      { str: 'DETAILS', x: 127, y: 106, w: 45, h: 9 },
      { str: 'AMOUNT', x: 498, y: 106, w: 47, h: 9 },
    ];
    const [block] = findHeaderBlocks(buildLines(items));
    assert.deepEqual(block.cols.map((c) => [c.text, c.role]), [['DATE POSTED', 'date'], ['DETAILS', 'description'], ['AMOUNT', 'amount']]);
  });
});

for (const align of ['top', 'center', 'bottom']) {
  describe(`payments that wrap over several lines, cells ${align}-aligned`, () => {
    const rows = [
      { cells: ['Oct 1, 2026', ['Corner Bakery', 'Transaction Id: 11111111-2222-3333-4444-555555555555', 'To: Corner Bakery, Genova', 'Card: 411111******1111'], '4.50', '', '95.50'] },
      { cells: ['Oct 2, 2026', 'Salary Acme', '', '1,000.00', '1,095.50'] },
      { cells: ['Oct 3, 2026', ['Transfer to JOHN DOE', 'Reference: dinner'], '20.00', '', '1,075.50'] },
      { cells: ['Oct 4, 2026', 'Pharmacy', '12.30', '', '1,063.20'] },
      { cells: ['Oct 4, 2026', ['Water bill', 'January to March'], '30.00', '', '1,033.20'] },
    ];
    const { items } = tableItems({ cols: REVOLUT_COLS, rows, align, pitch: 11, rowGap: 14 });
    const { tables } = layoutPdf([{ items: [...items, ...furniture(0, 1)] }]);
    it('keeps each payment as one row with its lines', () => {
      assert.equal(tables.length, 1);
      const t = tables[0];
      assert.equal(t.rows.length, 5);
      assert.deepEqual(t.rows[0].cells[1].split('\n'), ['Corner Bakery', 'Transaction Id: 11111111-2222-3333-4444-555555555555', 'To: Corner Bakery, Genova', 'Card: 411111******1111']);
      assert.deepEqual(t.rows[2].cells[1].split('\n'), ['Transfer to JOHN DOE', 'Reference: dinner']);
      assert.deepEqual(t.rows[4].cells[1].split('\n'), ['Water bill', 'January to March']);
    });
    it('puts money out, money in and the balance in their own columns', () => {
      const t = tables[0];
      assert.deepEqual(t.rows.map((r) => r.cells.slice(2)), [
        ['4.50', '', '95.50'],
        ['', '1,000.00', '1,095.50'],
        ['20.00', '', '1,075.50'],
        ['12.30', '', '1,063.20'],
        ['30.00', '', '1,033.20'],
      ]);
    });
    it('leaves the page furniture out of every row', () => {
      assert.ok(!cellsOf(tables[0]).flat().some((c) => /Statement|Generated|Registered|print|Page/.test(c)));
    });
  });
}

describe('sections and pages', () => {
  const title = (str, y) => ({ str, x: 40, y, w: 250, h: 10 });
  const pending = tableItems({ cols: REVOLUT_COLS.slice(0, 4), rows: [{ cells: ['Oct 7, 2026', ['Online Shop', 'Transaction Id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], '', '29.99'] }], y: 200 });
  const booked = (rows, y) => tableItems({ cols: REVOLUT_COLS, rows, y });
  const pageOne = [title('Pending from October 1, 2026 to October 8, 2026', 175), ...pending.items, title('Account transactions from October 1, 2026 to October 8, 2026', 290), ...booked([{ cells: ['Oct 1, 2026', 'Coffee', '2.00', '', '98.00'] }, { cells: ['Oct 2, 2026', 'Book', '10.00', '', '88.00'] }], 320).items];
  const pageTwo = booked([{ cells: ['Oct 3, 2026', 'Cinema', '8.00', '', '80.00'] }, { cells: ['Oct 4, 2026', 'Refund', '', '3.00', '83.00'] }], 150).items;
  const pageThree = tableItems({ cols: REVOLUT_COLS, rows: [{ cells: ['Oct 5, 2026', 'Gift', '5.00', '', '78.00'] }], header: false, y: 150 }).items;
  const reverted = [title('Reverted from October 1, 2026 to October 8, 2026', 400), ...tableItems({ cols: REVOLUT_COLS.slice(0, 4), rows: [{ cells: ['Oct 4, 2026', 'Cancelled order', '4.99', ''] }], y: 425 }).items];
  const doc = layoutPdf([
    { items: [...pageOne, ...furniture(0, 3)] },
    { items: [...pageTwo, ...furniture(1, 3)] },
    { items: [...pageThree, ...reverted, ...furniture(2, 3)] },
  ]);
  it('finds one table for each heading and says what each is', () => {
    assert.deepEqual(doc.tables.map((t) => [t.kind, t.rows.length]), [['pending', 1], ['booked', 5], ['reverted', 1]]);
    assert.match(doc.tables[0].title, /^Pending from/);
    assert.match(doc.tables[2].title, /^Reverted/);
  });
  it('continues a table over pages, with or without the heading repeated', () => {
    assert.deepEqual(doc.tables[1].rows.map((r) => r.cells[1]), ['Coffee', 'Book', 'Cinema', 'Refund', 'Gift']);
    assert.deepEqual(doc.tables[1].rows.map((r) => r.page), [0, 0, 1, 1, 2]);
  });
  it('does not take the next heading as part of the last payment above it', () => {
    assert.ok(doc.tables[0].rows[0].cells.every((c) => !/Account transactions/.test(c)));
    assert.ok(doc.tables[1].rows.every((r) => r.cells.every((c) => !/Reverted/.test(c))));
  });
  it('gives plain grids with the heading first', () => {
    const grids = gridsFromTables(doc.tables);
    assert.equal(grids.length, 3);
    assert.deepEqual(grids[1].rows[0], ['Date', 'Description', 'Money out', 'Money in', 'Balance']);
    assert.equal(grids[1].kind, 'booked');
    assert.equal(grids[0].kind, 'pending');
  });
});

describe('columns that line up differently from their headings', () => {
  it('right-aligned numbers under a heading written on the left', () => {
    const cols = [
      { title: 'Date', x: 50, w: 60 },
      { title: 'Description', x: 130, w: 200 },
      { title: 'Amount', x: 420, w: 130, align: 'right' }, // heading on the left of a wide column, numbers end on the right
    ];
    const rows = [
      { cells: ['01/10/2026', 'Shop one', '-12.50'] },
      { cells: ['02/10/2026', 'Shop two', '-5.00'] },
      { cells: ['03/10/2026', 'Salary', '1,500.00'] },
      { cells: ['04/10/2026', 'Shop three', '-100.25'] },
    ];
    const { tables } = layoutPdf([{ items: tableItems({ cols, rows }).items }]);
    assert.deepEqual(tables[0].rows.map((r) => r.cells[2]), ['-12.50', '-5.00', '1,500.00', '-100.25']);
  });
  it('a heading of the amount written on the right and numbers also on the right', () => {
    const { tables } = layoutPdf([
      {
        items: tableItems({
          cols: [{ title: 'Date', x: 50, w: 60 }, { title: 'Text', x: 130, w: 200 }, { title: 'Amount', x: 480, w: 70, align: 'right' }],
          rows: [{ cells: ['01/10/2026', 'One', '-1.00'] }, { cells: ['02/10/2026', 'Two', '-22.00'] }, { cells: ['03/10/2026', 'Three', '-333.00'] }],
          headerAlign: 'right',
        }).items,
      },
    ]);
    assert.deepEqual(tables[0].rows.map((r) => r.cells[2]), ['-1.00', '-22.00', '-333.00']);
  });
});

describe('what is not a payment', () => {
  it('lines with money but no date are dropped when nearly every payment has a date', () => {
    const rows = Array.from({ length: 6 }, (_v, i) => ({ cells: [`Oct ${i + 1}, 2026`, `Item ${i}`, `${i + 1}.00`, '', '50.00'] }));
    const foot = { str: 'Stamp duty on the statement', x: 43, y: 0, w: 120, h: 9 };
    const { items, end } = tableItems({ cols: REVOLUT_COLS, rows });
    const more = [{ ...foot, y: end + 30 }, { str: '34.20', x: 417, y: end + 30, w: 22, h: 9 }];
    const { tables } = layoutPdf([{ items: [...items, ...more] }]);
    assert.equal(tables[0].rows.length, 6);
  });
  it('a table of one payment is still one payment, and a footer far below is not part of it', () => {
    const { items, end } = tableItems({ cols: REVOLUT_COLS, rows: [{ cells: ['Oct 1, 2026', ['Only one', 'with a second line'], '1.00', '', '9.00'] }] });
    const foot = { str: 'Attention: all contents of this statement are approved if you do not complain', x: 40, y: end + 60, w: 400, h: 9 };
    const { tables } = layoutPdf([{ items: [...items, foot] }]);
    assert.equal(tables[0].rows.length, 1);
    assert.equal(tables[0].rows[0].cells[1], 'Only one\nwith a second line');
  });
});

describe('the gap that separates payments', () => {
  it('picks the gap that gives every block one payment', () => {
    const line = (y, anchor) => ({ y, h: 9, page: 0, anchor });
    const lines = [line(100, true), line(107, false), line(114, false), line(140, true), line(170, true), line(177, false)];
    const tau = bestGap(lines, lines.map((l) => l.anchor));
    assert.ok(tau >= 7 && tau < 26, `got ${tau}`);
  });
  it('with only one line it has nothing to cut', () => {
    assert.equal(bestGap([{ y: 1, h: 9, page: 0 }], [true]), Infinity);
  });
});

describe('a statement with no heading', () => {
  it('reads lines that start with a date and end with money', () => {
    const items = [];
    const rows = [
      ['01/10/2026', 'Coffee Bar Roma', '-2.50', '997.50'],
      ['02/10/2026', 'Salary', '1,200.00', '2,197.50'],
    ];
    rows.forEach((r, i) => {
      items.push({ str: r[0], x: 40, y: 100 + i * 14, w: 50, h: 9 }, { str: r[1], x: 120, y: 100 + i * 14, w: 90, h: 9 }, { str: r[2], x: 380, y: 100 + i * 14, w: 40, h: 9 }, { str: r[3], x: 480, y: 100 + i * 14, w: 50, h: 9 });
    });
    items.push({ str: 'continued on the next line', x: 120, y: 100 + 14 + 10, w: 120, h: 9 });
    const found = layoutPdf([{ items }]);
    assert.equal(found.tables.length, 0);
    const loose = layoutLoose(found.lines);
    assert.equal(loose.rows.length, 2);
    assert.deepEqual(loose.rows[0].cells, ['01/10/2026', 'Coffee Bar Roma', '-2.50', '997.50']);
    assert.equal(loose.rows[1].cells[1], 'Salary continued on the next line');
  });
  it('gives nothing back when there are no such lines', () => {
    assert.equal(layoutLoose([buildLines([{ str: 'Hello', x: 1, y: 1, w: 20, h: 9 }])]), null);
  });
});

describe('extractRows on its own', () => {
  it('returns the stray lines too', () => {
    const { items } = tableItems({ cols: REVOLUT_COLS, rows: [{ cells: ['Oct 1, 2026', 'A', '1.00', '', '9.00'] }, { cells: ['Oct 2, 2026', 'B', '2.00', '', '7.00'] }] });
    const lines = buildLines([...items, { str: 'Far away note', x: 43, y: 700, w: 60, h: 9 }]);
    const [block] = findHeaderBlocks(lines);
    const body = lines.filter((_l, i) => i > block.last);
    const { rows, stray } = extractRows(body, block.cols);
    assert.equal(rows.length, 2);
    assert.deepEqual(stray.map((l) => l.text), ['Far away note']);
  });
});

describe('the same statement in the layout of a different bank', () => {
  it('centred cells, a status column, a category column, euro signs on the amounts', () => {
    const rows = [
      { cells: ['10.10.2026', 'Corner Cafe', 'NO', 'Other spending', '€ -20,33'] },
      { cells: ['08.10.2026', ['Cash withdrawal', 'Branch of the group'], 'SI', 'Cash', '€ -50,00'] },
      { cells: ['08.10.2026', ['Direct debit to', 'ACME LOANS', 'Viale Roma', '7654321098765432109876'], 'SI', ['Loan', 'payments'], '€ -87,68'] },
      { cells: ['07.10.2026', 'Pension', 'SI', 'Transfers received', '€ 1.074,34'] },
    ];
    const { items } = tableItems({ cols: ISY_COLS, rows, align: 'center', pitch: 14.4, rowGap: 14 });
    const { tables } = layoutPdf([{ items }]);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows.map((r) => [r.cells[0], r.cells[2], r.cells[4]]), [
      ['10.10.2026', 'NO', '€ -20,33'],
      ['08.10.2026', 'SI', '€ -50,00'],
      ['08.10.2026', 'SI', '€ -87,68'],
      ['07.10.2026', 'SI', '€ 1.074,34'],
    ]);
    assert.equal(tables[0].rows[2].cells[1], 'Direct debit to\nACME LOANS\nViale Roma\n7654321098765432109876');
    assert.equal(tables[0].rows[2].cells[3], 'Loan\npayments');
  });
});
