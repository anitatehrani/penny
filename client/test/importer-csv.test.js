import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeText, guessSeparator, isProbablyText, looksLikeHtmlTable, readDelimited, readHtmlTable, splitRows } from '../src/importer/csv.js';

const bytes = (s, enc = 'utf8') => new Uint8Array(Buffer.from(s, enc));

describe('splitting text into cells', () => {
  it('reads quotes, doubled quotes and line breaks inside quotes', () => {
    const rows = splitRows('a,"b,c","say ""hi""","line1\nline2",e\n1,2,3,4,5\n', ',');
    assert.deepEqual(rows, [['a', 'b,c', 'say "hi"', 'line1\nline2', 'e'], ['1', '2', '3', '4', '5']]);
  });
  it('handles Windows, Unix and old Mac line ends, and a last line without one', () => {
    assert.deepEqual(splitRows('a,b\r\nc,d\re,f\ng,h', ','), [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]);
  });
  it('keeps empty cells and skips blank lines', () => {
    assert.deepEqual(splitRows('a,,c\n\n,,\nd,e,f\n', ','), [['a', '', 'c'], ['', '', ''], ['d', 'e', 'f']]);
  });
  it('a quote in the middle of a cell is just a quote', () => {
    assert.deepEqual(splitRows('5" pipe,x\n', ','), [['5" pipe', 'x']]);
  });
  it('an unclosed quote ends at the end of the file instead of hanging', () => {
    assert.deepEqual(splitRows('a,"b\nc', ','), [['a', 'b\nc']]);
  });
  it('cuts absurdly long cells and many rows', () => {
    assert.equal(splitRows(`${'x'.repeat(5000)},y\n`, ',')[0][0].length, 2000);
    assert.equal(splitRows('a\nb\nc\nd\n', ',', 2).length, 2);
  });
});

describe('guessing the separator', () => {
  it('comma, semicolon, tab and pipe', () => {
    assert.equal(guessSeparator('Date,Description,Amount\n2026-10-01,Shop,-5.00\n2026-10-02,Shop 2,-6.00\n'), ',');
    assert.equal(guessSeparator('Data;Descrizione;Importo\n01/10/2026;Bar;-5,00\n02/10/2026;Bar 2;-6,00\n'), ';');
    assert.equal(guessSeparator('Date\tDescription\tAmount\n2026-10-01\tShop\t-5.00\n2026-10-02\tShop 2\t-6.00\n'), '\t');
    assert.equal(guessSeparator('Date|Description|Amount\n2026-10-01|Shop|-5.00\n2026-10-02|Shop 2|-6.00\n'), '|');
  });
  it('a semicolon file with decimal commas is not mistaken for a comma file', () => {
    const text = 'Data;Descrizione;Importo;Saldo\n01/10/2026;Bar;-5,00;995,00\n02/10/2026;Bar 2;-6,50;988,50\n03/10/2026;Bar 3;-7,25;981,25\n';
    assert.equal(guessSeparator(text), ';');
  });
  it('a comma file whose descriptions are quoted and hold commas', () => {
    const text = 'Date,Description,Amount\n2026-10-01,"Shop, big",-5.00\n2026-10-02,"Bar, small",-6.00\n';
    assert.equal(guessSeparator(text), ',');
  });
  it('lines of explanation above the table do not decide', () => {
    const text = 'Account statement\nAccount: 12345\n\nDate;Description;Amount;Balance\n01/10/2026;A;-1,00;9,00\n02/10/2026;B;-2,00;7,00\n03/10/2026;C;-3,00;4,00\n04/10/2026;D;-1,00;3,00\n';
    assert.equal(guessSeparator(text), ';');
  });
});

describe('reading bytes as text', () => {
  it('UTF-8 with and without the mark', () => {
    assert.equal(decodeText(bytes('﻿café')), 'café');
    assert.equal(decodeText(bytes('café')), 'café');
  });
  it('UTF-16 with its mark', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Data;Importo', 'utf16le')]);
    assert.equal(decodeText(new Uint8Array(le)), 'Data;Importo');
    const be = Buffer.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]);
    assert.equal(decodeText(new Uint8Array(be)), 'AB');
  });
  it('Windows-1252 when it is not valid UTF-8 (older bank exports)', () => {
    assert.equal(decodeText(bytes('Caffè € 5', 'latin1')).startsWith('Caff'), true);
    assert.equal(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0x66, 0xe8, 0x20, 0x80])), 'Caffè €');
  });
  it('knows binary from text', () => {
    assert.equal(isProbablyText('Date;Amount\n1;2\n'), true);
    assert.equal(isProbablyText('\u0000\u0001\u0002\u0003\u0004'), false);
    assert.equal(isProbablyText(''), false);
  });
});

describe('a delimited file as a grid', () => {
  it('uses and drops the sep= hint Excel writes', () => {
    const g = readDelimited('sep=;\nDate;Amount\n01/10/2026;-5,00\n');
    assert.equal(g.rows.length, 2);
    assert.equal(g.separator, ';');
  });
  it('refuses a binary file and an empty one', () => {
    assert.throws(() => readDelimited('\u0000\u0001\u0002 binary'), (e) => e.code === 'unreadable');
    assert.throws(() => readDelimited('\n\n'), (e) => e.code === 'empty');
  });
  it('rows may be ragged', () => {
    const g = readDelimited('Account;123\n\nDate;Desc;Amount\n01/10/2026;A;-1,00\n');
    assert.deepEqual(g.rows.map((r) => r.length), [2, 3, 3]);
  });
});

describe('tables saved as web pages', () => {
  const html = `<html><body><table><tr><th>Date</th><th>Details</th><th>Amount</th></tr>
    <tr><td>01/10/2026</td><td>Caff&egrave;<br>bar &amp; co</td><td>-5,00&nbsp;&euro;</td></tr>
    <tr><td>02/10/2026</td><td>Shop</td><td>-6,00</td></tr></table>
    <table><tr><td>tiny</td></tr></table></body></html>`;
  it('is recognised and read, keeping the biggest table', () => {
    assert.equal(looksLikeHtmlTable(html), true);
    assert.equal(looksLikeHtmlTable('Date;Amount\n1;2'), false);
    const g = readHtmlTable(html);
    assert.equal(g.rows.length, 3);
    assert.deepEqual(g.rows[1].slice(2), ['-5,00 €']);
    assert.match(g.rows[1][1], /bar & co/);
  });
  it('decodes numeric entities and ignores tags and scripts in cells', () => {
    const g = readHtmlTable('<table><tr><td>&#65;&#x42;<b>C</b></td><td><script>x</script>ok</td></tr></table>');
    assert.equal(g.rows[0][0], 'ABC');
  });
  it('a page with no table is an error', () => {
    assert.throws(() => readHtmlTable('<html><p>hello</p></html>'), (e) => e.code === 'empty');
  });
});
