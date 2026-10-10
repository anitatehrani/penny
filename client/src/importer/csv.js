// Reading delimited text (CSV, TSV, semicolon files, saved HTML tables) into rows of cells (docs/DESIGN.md section 41).
// The separator, the quotes and the text encoding are worked out from the file itself.

import { ImportError } from './errors.js';

export const MAX_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 60000;
const MAX_CELL = 2000;

/** Bytes to text: UTF-8 (with or without the mark), UTF-16 with its mark, otherwise Windows-1252, which is what older bank exports use. */
export function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    text = new TextDecoder('windows-1252').decode(b);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** Does this look like text at all, rather than a picture or a program? */
export function isProbablyText(text) {
  const sample = text.slice(0, 4000);
  if (!sample) return false;
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0 || c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) odd++;
  }
  return odd / sample.length < 0.02;
}

/** Split text into rows of cells for one separator. Quotes may hold the separator, doubled quotes and line breaks. */
export function splitRows(text, sep, limit = MAX_ROWS) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let started = false; // has the current cell had any character, quoted or not
  const endCell = () => {
    row.push(cell.length > MAX_CELL ? cell.slice(0, MAX_CELL) : cell);
    cell = '';
    started = false;
  };
  const endRow = () => {
    endCell();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !started) {
      quoted = true;
      started = true;
    } else if (ch === sep) endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      if (rows.length >= limit) return rows;
    } else {
      cell += ch;
      started = true;
    }
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

/** The separator that splits the first lines into the same number of cells most consistently. */
export function guessSeparator(text) {
  const head = text.split(/\r\n|\n|\r/).slice(0, 80).join('\n');
  let best = { sep: ',', score: 0 };
  for (const sep of [',', ';', '\t', '|']) {
    const rows = splitRows(head, sep, 60);
    if (rows.length < 1) continue;
    const counts = new Map();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let mode = 1;
    let modeN = 0;
    for (const [n, k] of counts) if (k > modeN || (k === modeN && n > mode)) [mode, modeN] = [n, k];
    if (mode < 2) continue;
    const score = (modeN / rows.length) * Math.sqrt(mode) * (rows.length > 1 ? 1 : 0.6);
    if (score > best.score) best = { sep, score };
  }
  return best.sep;
}

/** Text to a grid: { source: 'csv', name, rows }. A first line such as "sep=;" (Excel's own hint) is used and dropped. */
export function readDelimited(text) {
  if (!isProbablyText(text)) throw new ImportError('unreadable', 'That file does not look like a statement Penny can read.');
  let body = text;
  let sep = null;
  const hint = body.match(/^\s*sep=(.)\s*(?:\r\n|\n|\r)/i);
  if (hint) {
    sep = hint[1];
    body = body.slice(hint[0].length);
  }
  sep ||= guessSeparator(body);
  const rows = splitRows(body, sep);
  if (!rows.length) throw new ImportError('empty', 'That file is empty.');
  return { source: 'csv', name: 'File', rows, separator: sep };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tables saved as HTML (many banks offer "Excel" files that are really web pages)
// ---------------------------------------------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', deg: '°' };
export const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export const looksLikeHtmlTable = (text) => /^\s*(<\?xml[^>]*>\s*)?(<!doctype html[^>]*>\s*)?<(html|table|meta|head|body)\b/i.test(text) && /<tr\b/i.test(text);

/** The first big table of an HTML page as a grid of text. */
export function readHtmlTable(text) {
  const tables = [...text.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  const rowsOf = (html) =>
    [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
      [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decodeEntities(c[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/[ \t\r\f\v]+/g, ' ').trim().slice(0, MAX_CELL)),
    );
  const best = (tables.length ? tables : [text]).map(rowsOf).sort((a, b) => b.length - a.length)[0] ?? [];
  const rows = best.filter((r) => r.some((c) => c !== '')).slice(0, MAX_ROWS);
  if (!rows.length) throw new ImportError('empty', 'Penny found no list of payments in that file.');
  return { source: 'csv', name: 'File', rows };
}
