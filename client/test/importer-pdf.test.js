import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfWords } from '../src/importer/pdf.js';
import { layoutPdf } from '../src/importer/pdfTable.js';
import { furniture, makePdf, REVOLUT_COLS, tableItems } from './helpers/files.js';

describe('the words of a real PDF file, with their positions', () => {
  const rows = [
    { cells: ['Oct 1, 2026', ['Corner Bakery', 'Card: 411111******1111'], '4.50', '', '95.50'] },
    { cells: ['Oct 2, 2026', 'Salary Acme', '', '1,000.00', '1,095.50'] },
    { cells: ['Oct 3, 2026', 'Euro sign € in text', '5.00', '', '1,090.50'] },
  ];
  const bytes = makePdf([{ items: [...tableItems({ cols: REVOLUT_COLS, rows, pitch: 11, rowGap: 14 }).items, ...furniture(0, 1)] }]);

  it('reads the text and where it is', async () => {
    const pages = await readPdfWords(bytes, { pdfjs });
    assert.equal(pages.length, 1);
    const find = (s) => pages[0].items.find((i) => i.str === s);
    assert.ok(find('Corner Bakery'));
    assert.ok(Math.abs(find('Date').x - 43) < 1);
    assert.ok(find('Salary Acme').y > find('Date').y, 'y counts down from the top of the page');
    assert.ok(find('Salary Acme').w > 30, 'a word has a width');
    assert.ok(pages[0].items.some((i) => i.str.includes('€')));
  });
  it('lays a PDF out into the table it holds, end to end', async () => {
    const pages = await readPdfWords(bytes, { pdfjs });
    const { tables } = layoutPdf(pages);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows.map((r) => r.cells[0]), ['Oct 1, 2026', 'Oct 2, 2026', 'Oct 3, 2026']);
    assert.equal(tables[0].rows[0].cells[1], 'Corner Bakery\nCard: 411111******1111');
    assert.deepEqual(tables[0].rows.map((r) => [r.cells[2], r.cells[3]]), [['4.50', ''], ['', '1,000.00'], ['5.00', '']]);
  });
  it('does not change the bytes it was given', async () => {
    const copy = bytes.slice();
    await readPdfWords(bytes, { pdfjs });
    assert.deepEqual(bytes, copy);
  });
  it('refuses something that is not a PDF', async () => {
    await assert.rejects(() => readPdfWords(new TextEncoder().encode('%PDF-1.4 but not really'), { pdfjs }), (e) => e.code === 'unreadable');
  });
  it('refuses a file that is too big, and one with too many pages, in plain words', async () => {
    await assert.rejects(() => readPdfWords(new Uint8Array(16 * 1024 * 1024), { pdfjs }), (e) => e.code === 'toobig');
    const many = makePdf(Array.from({ length: 61 }, () => ({ items: [{ str: 'x', x: 10, y: 10 }] })));
    await assert.rejects(() => readPdfWords(many, { pdfjs }), (e) => e.code === 'toobig' && /61 pages/.test(e.message));
  });
  it('asks for a password when the library says one is needed, and says when it was wrong', async () => {
    const fake = (code) => ({ getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('x'), { name: 'PasswordException', code })) }) });
    await assert.rejects(() => readPdfWords(bytes, { pdfjs: fake(1) }), (e) => e.code === 'password' && e.wrong === false);
    await assert.rejects(() => readPdfWords(bytes, { pdfjs: fake(2) }), (e) => e.code === 'password' && e.wrong === true);
  });
  it('is opened with scripts and eval off and nothing fetched', async () => {
    let seen;
    const spy = { ...pdfjs, getDocument: (opts) => ((seen = opts), pdfjs.getDocument(opts)) };
    await readPdfWords(bytes, { pdfjs: spy });
    assert.equal(seen.isEvalSupported, false);
    assert.equal(seen.enableXfa, false);
    assert.equal(seen.useWorkerFetch, false);
    assert.equal(seen.useSystemFonts, false);
  });
});
