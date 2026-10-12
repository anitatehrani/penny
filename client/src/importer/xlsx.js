// Reading an Excel workbook (.xlsx) into grids of text (docs/DESIGN.md section 41). An .xlsx is a zip of XML files; only the few parts that matter
// are opened, with limits on their size, and nothing in the file is run. Dates are recognised by the number format of their cell and written
// as 2026-10-01; numbers are written plainly (-20.33), so the rest of the importer need not guess how they were displayed.

import { unzipSync } from 'fflate';
import { ImportError } from './errors.js';
import { decodeEntities } from './csv.js';
import { ymd } from './values.js';
import { t } from '../i18n/translate.js';

const MAX_PART_BYTES = 40 * 1024 * 1024;
const MAX_ROWS = 20000;
const MAX_COLS = 60;
const MAX_SHEETS = 8;

export const isZip = (bytes) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
/** The old binary Excel format (.xls) and other OLE2 files. */
export const isOle = (bytes) => bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

const utf8 = (u8) => new TextDecoder('utf-8').decode(u8);

const attrs = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
};

const textOf = (xml) => {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
  return decodeEntities([...clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
};

const columnIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// number formats that show a date (built in); 18 to 21 and 45 to 47 are times only
const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, ...Array.from({ length: 10 }, (_v, i) => 27 + i), ...Array.from({ length: 9 }, (_v, i) => 50 + i)]);
const isDateCode = (code) => {
  const c = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '').toLowerCase();
  if (/^general$/.test(c.trim())) return false;
  return /[yd]/.test(c) && !/^[#0,.%\s]*$/.test(c);
};

function readStyles(xml) {
  if (!xml) return () => false;
  const custom = new Map();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.numFmtId) custom.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const dateStyle = [];
  if (cellXfs) {
    for (const m of cellXfs[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
      const id = Number(attrs(m[1]).numFmtId ?? 0);
      dateStyle.push(BUILTIN_DATE.has(id) || (custom.has(id) && isDateCode(custom.get(id))));
    }
  }
  return (styleIndex) => !!dateStyle[styleIndex];
}

/** Excel's day number to a date. Day 1 is 1900-01-01 (with Excel's famous phantom 29 February 1900), or 1904-01-01 in files from old Macs. */
export function serialToDate(serial, date1904 = false) {
  const days = Math.floor(serial);
  const ms = date1904 ? Date.UTC(1904, 0, 1) + days * 86400000 : Date.UTC(1899, 11, 30) + days * 86400000;
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const plainNumber = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) < 1e-6) return (cents / 100).toFixed(Number.isInteger(n) ? 0 : 2);
  return String(parseFloat(n.toFixed(6)));
};

/** An .xlsx file as a list of grids { source: 'xlsx', name, rows }. Throws an ImportError a person can read. */
export function readXlsx(bytes) {
  let total = 0;
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(f.name)) return false;
        if (f.originalSize > MAX_PART_BYTES) throw new ImportError('toobig', t('That spreadsheet is too big to read here.'));
        total += f.originalSize;
        if (total > MAX_PART_BYTES * 2) throw new ImportError('toobig', t('That Excel file is too big to read here.'));
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('unreadable', t('Penny could not open that Excel spreadsheet. It may be damaged or protected with a password.'));
  }
  const workbook = files['xl/workbook.xml'] && utf8(files['xl/workbook.xml']);
  if (!workbook) throw new ImportError('unreadable', t('That does not look like an Excel spreadsheet.'));
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const rels = new Map();
  for (const m of (files['xl/_rels/workbook.xml.rels'] ? utf8(files['xl/_rels/workbook.xml.rels']) : '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const strings = [];
  if (files['xl/sharedStrings.xml']) for (const m of utf8(files['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) strings.push(textOf(m[1]));
  const isDate = readStyles(files['xl/styles.xml'] && utf8(files['xl/styles.xml']));

  const sheets = [];
  const sheetTags = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => attrs(m[1]));
  for (const tag of sheetTags.slice(0, MAX_SHEETS)) {
    if (tag.state === 'hidden' || tag.state === 'veryHidden') continue;
    const path = rels.get(tag['r:id']);
    const xml = path && files[path] && utf8(files[path]);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= MAX_ROWS) break;
      const rowNo = Number(attrs(rm[1]).r ?? 0) - 1;
      const row = [];
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = attrs(cm[1]);
        const at = a.r ? columnIndex(a.r) : row.length;
        if (at >= MAX_COLS) continue;
        const inner = cm[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = '';
        if (a.t === 's') value = strings[Number(v)] ?? '';
        else if (a.t === 'inlineStr') value = textOf(inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? '');
        else if (a.t === 'str') value = decodeEntities(v ?? '');
        else if (a.t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (a.t === 'e') value = '';
        else if (v !== undefined && v !== '') {
          const n = Number(v);
          value = Number.isFinite(n) && isDate(Number(a.s ?? -1)) ? ymd(serialToDate(n, date1904)) : plainNumber(v);
        }
        while (row.length < at) row.push('');
        row[at] = value;
      }
      if (rowNo >= 0 && rowNo < MAX_ROWS) {
        while (rows.length < rowNo) rows.push([]);
        rows[rowNo] = row;
      } else rows.push(row);
    }
    const trimmed = rows.map((r) => {
      let end = r.length;
      while (end > 0 && (r[end - 1] ?? '') === '') end--;
      return r.slice(0, end).map((c) => c ?? '');
    });
    if (trimmed.some((r) => r.length)) sheets.push({ source: 'xlsx', name: tag.name || t('Sheet {value}', { value: sheets.length + 1 }), rows: trimmed });
  }
  if (!sheets.length) throw new ImportError('empty', t('Penny found no data in that spreadsheet.'));
  return sheets;
}
