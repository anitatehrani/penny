// Builders for the files the importer reads, so tests need no real statement: a PDF from positioned words, an .xlsx from rows, and the word
// positions of statements laid out the ways banks lay them out. Everything in them is invented.

import { zipSync, strToU8 } from 'fflate';

// ---------------------------------------------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------------------------------------------

const pdfText = (s) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/€/g, '\\200'); // the euro sign in WinAnsi

/** A one-font PDF. `pages` is [{ items: [{ str, x, y, size? }] }] with y counted from the top of an A4 page. */
export function makePdf(pages, { height = 842, width = 595 } = {}) {
  const objs = [];
  const add = (s) => {
    objs.push(s);
    return objs.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled in below
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const page of pages) {
    const ops = page.items.map((it) => `BT /F1 ${it.size ?? 9} Tf ${it.x} ${(height - it.y).toFixed(2)} Td (${pdfText(it.str)}) Tj ET`).join('\n');
    const contentId = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    kids.push(`${pageId} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/**
 * The positioned words of a table, ready for makePdf or for the layout code. `cols` is [{ title, x, align?: 'left' | 'right', w? }], `rows` is
 * [{ cells: [string | string[]] }] where a cell with several strings wraps over several lines. `align` says where the cells of a row sit in it:
 * 'top' (the first line of every cell on the same baseline, the rest below), 'center' or 'bottom'. Numbers in a right-aligned column end at x + w.
 */
export function tableItems({ cols, rows, align = 'top', y = 150, pitch = 7.5, rowGap = 12, size = 9, header = true, headerAlign = 'left' }) {
  const items = [];
  const width = (s) => s.length * size * 0.5;
  const put = (str, col, yy) => {
    const w = width(str);
    const x = col.align === 'right' ? col.x + (col.w ?? 40) - w : col.align === 'middle' ? col.x + ((col.w ?? 40) - w) / 2 : col.x;
    items.push({ str, x, y: yy, w, h: size });
  };
  let cursor = y;
  if (header) {
    for (const c of cols) {
      const w = width(c.title);
      items.push({ str: c.title, x: headerAlign === 'right' ? c.x + (c.w ?? 40) - w : c.x, y: cursor, w, h: size });
    }
    cursor += pitch + rowGap + 4;
  }
  for (const row of rows) {
    const lines = row.cells.map((c) => (Array.isArray(c) ? c : [c]));
    const most = Math.max(...lines.map((l) => l.length));
    lines.forEach((cell, ci) => {
      // 'top': every cell starts on the first line of the row; 'bottom' ends on its last; 'center' is in the middle
      const own = align === 'top' ? 0 : align === 'bottom' ? most - cell.length : (most - cell.length) / 2;
      cell.forEach((str, li) => put(str, cols[ci], cursor + (own + li) * pitch));
    });
    cursor += most * pitch + rowGap;
  }
  return { items, end: cursor };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? '' : '');

/**
 * An .xlsx from sheets of rows. A cell is a string, a number, or { date: serial } (a date cell), { inline: 'text' }, { bool: true }.
 * `options`: { date1904, hidden: [sheet index], customFormat: 'dd/mm/yyyy' (a custom date style used by { custom: serial }) }.
 */
export function makeXlsx(sheets, options = {}) {
  const strings = [];
  const sst = (s) => {
    let i = strings.indexOf(s);
    if (i < 0) {
      strings.push(s);
      i = strings.length - 1;
    }
    return i;
  };
  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows
      .map((cells, r) => {
        const cs = cells
          .map((v, c) => {
            const ref = `${colName(c)}${r + 1}`;
            if (v === '' || v == null) return '';
            if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
            if (v.date !== undefined) return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
            if (v.custom !== undefined) return `<c r="${ref}" s="2"><v>${v.custom}</v></c>`;
            if (v.time !== undefined) return `<c r="${ref}" s="3"><v>${v.time}</v></c>`;
            if (v.inline !== undefined) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.inline)}</t></is></c>`;
            if (v.bool !== undefined) return `<c r="${ref}" t="b"><v>${v.bool ? 1 : 0}</v></c>`;
            if (v.rich !== undefined) return `<c r="${ref}" t="s"><v>${sst({ rich: v.rich })}</v></c>`;
            return `<c r="${ref}" t="s"><v>${sst(String(v))}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cs}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const sstXml = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
    .map((s) => (typeof s === 'string' ? `<si><t xml:space="preserve">${esc(s)}</t></si>` : `<si>${s.rich.map((p) => `<r><t>${esc(p)}</t></r>`).join('')}<rPh sb="0" eb="1"><t>ignored</t></rPh></si>`))
    .join('')}</sst>`;
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${
    options.date1904 ? '<workbookPr date1904="1"/>' : ''
  }<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" ${options.hidden?.includes(i) ? 'state="hidden" ' : ''}r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}</Relationships>`;
  const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="${esc(options.customFormat ?? '[$-409]dd/mm/yyyy;@')}"/><numFmt numFmtId="165" formatCode="0.00&quot; EUR&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="20"/></cellXfs></styleSheet>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/sharedStrings.xml': strToU8(sstXml),
    'xl/styles.xml': strToU8(styles),
  };
  sheetXml.forEach((x, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x);
  });
  return zipSync(files);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Whole statements, invented, laid out like the real kinds
// ---------------------------------------------------------------------------------------------------------------------------------

/** Page furniture every statement has: a title, the date it was made, and a footer that repeats on every page. */
export const furniture = (page, pages, title = 'Statement') => [
  { str: title, x: 420, y: 80, w: 80, h: 12 },
  { str: 'Generated on Oct 8, 2026', x: 400, y: 94, w: 110, h: 8 },
  { str: 'Page', x: 500, y: 805, w: 20, h: 8 },
  { str: String(page + 1), x: 524, y: 805, w: 5, h: 8 },
  { str: 'of', x: 534, y: 805, w: 8, h: 8 },
  { str: String(pages), x: 546, y: 805, w: 5, h: 8 },
  { str: 'If you have any questions, please reach out to us in the app. Registered address and licence text goes here.', x: 85, y: 760, w: 420, h: 6 },
  { str: 'A second line of the same small print that every page carries at the bottom of the page.', x: 85, y: 767, w: 400, h: 6 },
];

/** The date column as one string of every kind of format, for statements with a day, month, year. */
export const REVOLUT_COLS = [
  { title: 'Date', x: 43, w: 60 },
  { title: 'Description', x: 125, w: 200 },
  { title: 'Money out', x: 335, w: 60 },
  { title: 'Money in', x: 417, w: 60 },
  { title: 'Balance', x: 500, w: 56, align: 'right' },
];

export const ISY_COLS = [
  { title: 'DATE', x: 50, w: 60, align: 'middle' },
  { title: 'DETAILS', x: 126, w: 160 },
  { title: 'BOOKED', x: 302, w: 88, align: 'middle' },
  { title: 'CATEGORY', x: 396, w: 90, align: 'middle' },
  { title: 'AMOUNT', x: 498, w: 56, align: 'right' },
];
