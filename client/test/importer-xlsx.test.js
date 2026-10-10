import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { isOle, isZip, readXlsx, serialToDate } from '../src/importer/xlsx.js';
import { ymd } from '../src/importer/values.js';
import { makeXlsx } from './helpers/files.js';

// Excel's day numbers: 46296 is 1 October 2026
const OCT_1 = 46296;

describe('an Excel workbook as grids of text', () => {
  const book = makeXlsx([
    {
      name: 'Movimenti',
      rows: [
        ['Account statement'],
        [],
        ['Data', 'Descrizione', 'Importo', 'Saldo'],
        [{ date: OCT_1 }, 'Caffè & Co', -2.5, 997.5],
        [{ date: OCT_1 + 1 }, { inline: 'Stipendio' }, 1200, 2197.5],
        [{ custom: OCT_1 + 2 }, { rich: ['Super', 'market'] }, -20.329999999999998, 2177.17],
        ['text date', 'Row with a boolean', { bool: true }, ''],
      ],
    },
    { name: 'Hidden', rows: [['secret']] },
  ], { hidden: [1] });

  it('reads the visible sheets, with strings, numbers and dates in a form the rest can use', () => {
    const sheets = readXlsx(book);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].name, 'Movimenti');
    assert.deepEqual(sheets[0].rows[0], ['Account statement']);
    assert.deepEqual(sheets[0].rows[1], []);
    assert.deepEqual(sheets[0].rows[2], ['Data', 'Descrizione', 'Importo', 'Saldo']);
    assert.deepEqual(sheets[0].rows[3], ['2026-10-01', 'Caffè & Co', '-2.50', '997.50']);
  });
  it('dates come from the cell format, not from the number: a plain number stays a number', () => {
    const rows = readXlsx(book)[0].rows;
    assert.equal(rows[4][0], '2026-10-02');
    assert.equal(rows[5][0], '2026-10-03', 'a custom date format');
    assert.equal(rows[4][2], '1200');
  });
  it('writes numbers plainly, rounding the dust, and reads rich text without its phonetic hints', () => {
    const rows = readXlsx(book)[0].rows;
    assert.equal(rows[5][2], '-20.33');
    assert.equal(rows[5][1], 'Supermarket');
    assert.equal(rows[6][2], 'TRUE');
  });
  it('knows the 1904 date system of old Mac files', () => {
    const old = makeXlsx([{ name: 'S', rows: [[{ date: OCT_1 - 1462 }]] }], { date1904: true });
    assert.equal(readXlsx(old)[0].rows[0][0], '2026-10-01');
  });
  it('serial numbers to dates', () => {
    assert.equal(ymd(serialToDate(OCT_1)), '2026-10-01');
    assert.equal(ymd(serialToDate(OCT_1 + 0.75)), '2026-10-01');
    assert.equal(ymd(serialToDate(61)), '1900-03-01');
    assert.equal(ymd(serialToDate(44197)), '2021-01-01');
  });
  it('a time-only format is not a date', () => {
    const time = makeXlsx([{ name: 'S', rows: [[{ time: 0.5 }]] }]);
    assert.equal(readXlsx(time)[0].rows[0][0], '0.50');
  });
});

describe('files that are not what they seem', () => {
  it('knows a zip and an old binary Excel file by their first bytes', () => {
    assert.equal(isZip(makeXlsx([{ name: 'S', rows: [['a']] }])), true);
    assert.equal(isZip(new Uint8Array([1, 2, 3, 4, 5])), false);
    assert.equal(isOle(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), true);
  });
  it('a zip that is not a workbook is refused in plain words', () => {
    const zip = zipSync({ 'readme.txt': strToU8('hello') });
    assert.throws(() => readXlsx(zip), (e) => e.code === 'unreadable');
  });
  it('a damaged file is refused in plain words', () => {
    const book = makeXlsx([{ name: 'S', rows: [['a']] }]);
    assert.throws(() => readXlsx(book.slice(0, 40)), (e) => e.code === 'unreadable' && /Excel/.test(e.message));
  });
  it('an empty workbook is refused', () => {
    const empty = makeXlsx([{ name: 'S', rows: [] }]);
    assert.throws(() => readXlsx(empty), (e) => e.code === 'empty');
  });
  it('a part that claims to be enormous is not opened', () => {
    // a real zip bomb would be too slow to build here; the guard looks at the size the archive declares for each part
    const big = zipSync({
      'xl/workbook.xml': strToU8('<workbook/>'),
      'xl/worksheets/sheet1.xml': new Uint8Array(41 * 1024 * 1024),
    });
    assert.throws(() => readXlsx(big), (e) => e.code === 'toobig');
  });
  it('does not read parts it does not need (macros, pictures, scripts)', () => {
    const files = {
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>'),
      'xl/vbaProject.bin': new Uint8Array(100 * 1024 * 1024 > 0 ? 10 : 0),
      'xl/media/image1.png': new Uint8Array(10),
    };
    assert.deepEqual(readXlsx(zipSync(files))[0].rows, [['ok']]);
  });
});
