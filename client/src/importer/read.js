// From a file to payments: open it, find its tables, understand their columns, make one clean row per payment (docs/DESIGN.md section 41).
// Two steps, so the matching screen can change a mapping and see the result without opening the file again:
//   openStatement(bytes)            -> { kind, grids }                  (parsing)
//   interpret(grids, { overrides }) -> { sections, rows, left, ... }    (understanding and normalising)

import { analyseGrid, headerSignature, mappingProblem, widthOf } from './detect.js';
import { decodeText, looksLikeHtmlTable, readDelimited, readHtmlTable, MAX_TEXT_BYTES } from './csv.js';
import { ImportError } from './errors.js';
import { sectionKind } from './headers.js';
import { balanceCheck, extractRows } from './normalize.js';
import { layoutLoose, layoutPdf, gridsFromTables } from './pdfTable.js';
import { MAX_PDF_BYTES, readPdfWords } from './pdf.js';
import { isOle, isZip, readXlsx } from './xlsx.js';
import { currencyIn } from './values.js';

export const MAX_ROWS = 3000;

const startsWithPdf = (b) => {
  const head = new TextDecoder('latin1').decode(b.subarray(0, 1024));
  return head.includes('%PDF-');
};

/**
 * Open a file. `pdfjs` is the PDF library (see pdf.js). Returns { kind: 'csv' | 'xlsx' | 'pdf' | 'html', grids }.
 * Throws an ImportError (with a message for the person) when the file cannot be read.
 */
export async function openStatement(bytes, { pdfjs, password } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length) throw new ImportError('empty', 'That file is empty.');
  if (startsWithPdf(b)) {
    if (b.length > MAX_PDF_BYTES) throw new ImportError('toobig', 'That PDF is larger than 15 MB. Download the CSV or Excel version from your bank instead.');
    const pages = await readPdfWords(b, { pdfjs, password });
    if (!pages.some((p) => p.items.length)) {
      throw new ImportError('scan', 'This PDF has no text in it: it is probably a scan, a photo of paper. Penny cannot read pictures. Download the statement as CSV or Excel from your bank, or as a PDF made by the bank.');
    }
    const found = layoutPdf(pages);
    let tables = found.tables;
    if (!tables.length) {
      const loose = layoutLoose(found.lines);
      if (loose) tables = [loose];
    }
    if (!tables.length) {
      throw new ImportError('notable', 'Penny could not find a table of payments in this PDF. If your bank also offers the statement as CSV or Excel, that is the more reliable way.');
    }
    // the words near the top of the first page (the currency of the statement) are all that is read outside the tables
    const header = found.lines[0]?.slice(0, 12).map((l) => l.text).join(' ') ?? '';
    return { kind: 'pdf', grids: gridsFromTables(tables), hintText: header };
  }
  if (isZip(b)) return { kind: 'xlsx', grids: readXlsx(b) };
  if (isOle(b)) {
    throw new ImportError('oldexcel', 'That is an old Excel file (.xls). Open it in Excel and use Save As to make an .xlsx or CSV file, then choose that one.');
  }
  if (b.length > MAX_TEXT_BYTES) throw new ImportError('toobig', 'That file is larger than 12 MB.');
  const text = decodeText(b);
  if (looksLikeHtmlTable(text)) return { kind: 'html', grids: [readHtmlTable(text)] };
  return { kind: 'csv', grids: [readDelimited(text)] };
}

const roleList = (m) => m.roles.filter((r) => r !== 'ignore');

/**
 * Understand every table of an opened statement.
 *   overrides: { [gridIndex]: mapping } the person's own choices;  saved: Map of header signature -> mapping made by hand before;
 *   hint: { dateOrder, decimal } for the first guess;  today: { y, m, d }.
 * Returns {
 *   sections: [{ id, name, title, kind, count, confidence, mapping, headerRow, problem }],
 *   rows: [{ id, section, ... }], left: [{ section, line, reason, text }], currency, check: { checked, agree }, needsMapping (index or -1), notes
 * }
 */
export function interpret(opened, { overrides = {}, saved = new Map(), hint = {}, today = null } = {}) {
  const sections = [];
  const rows = [];
  const left = [];
  const notes = [];
  let needsMapping = -1;
  const currencies = new Map();
  // a file writes its dates one way: a table that cannot tell day first from month first (one line, all numbers below 13) takes the order
  // of a table of the same file that can, or else of the biggest table
  const guesses = opened.grids.map((grid, gi) => overrides[gi] ?? analyseGrid(grid, { hint, saved: grid.rows.length ? savedFor(grid, saved) : null }));
  const dated = guesses.map((g, gi) => ({ g, gi })).filter(({ g }) => g.roles?.includes('date'));
  const sure = dated.find(({ g, gi }) => !overrides[gi] && !g.dateAmbiguous) ?? dated.reduce((best, d) => (!best || opened.grids[d.gi].rows.length > opened.grids[best.gi].rows.length ? d : best), null);
  if (sure) {
    guesses.forEach((g, gi) => {
      if (g.roles && !overrides[gi] && g.dateAmbiguous && g.dateOrder !== sure.g.dateOrder) guesses[gi] = { ...g, dateOrder: sure.g.dateOrder };
    });
  }
  opened.grids.forEach((grid, gi) => {
    const forced = overrides[gi];
    const guess = guesses[gi];
    const mapping = { ...guess };
    const problem = mapping.roles ? mappingProblem(mapping) : 'empty';
    const usable = !problem && (forced || mapping.confidence !== 'low');
    const kind = grid.kind && grid.kind !== 'booked' ? grid.kind : sectionKind(`${grid.name ?? ''} ${grid.title ?? ''}`);
    const section = {
      id: gi,
      name: grid.name,
      title: grid.title || grid.name,
      kind,
      count: 0,
      confidence: forced ? 'high' : mapping.confidence,
      mapping,
      problem,
      notes: mapping.notes ?? [],
      width: widthOf(grid.rows),
    };
    if (usable) {
      const out = extractRows({ ...grid, kind }, mapping, { ref: today });
      out.rows.forEach((r, i) => rows.push({ ...r, id: `${gi}:${i}`, section: gi }));
      for (const l of out.left) left.push({ ...l, section: gi });
      section.count = out.rows.length;
      if (mapping.currency) currencies.set(mapping.currency, (currencies.get(mapping.currency) ?? 0) + out.rows.length);
    } else if (needsMapping < 0 && grid.rows.length > 1) {
      needsMapping = gi;
    }
    sections.push(section);
  });
  // a statement is one thing even when the file holds several tables: a sheet of notes next to the payments needs no help,
  // and if no table could be read at all, the biggest one goes to the matching screen
  if (rows.length) needsMapping = -1;
  else if (needsMapping < 0 && opened.grids.length) {
    needsMapping = opened.grids.reduce((best, g, i) => (g.rows.length > opened.grids[best].rows.length ? i : best), 0);
  }
  const currency = [...currencies].sort((a, b) => b[1] - a[1])[0]?.[0] ?? currencyIn(opened.hintText ?? '') ?? null;
  const tooMany = rows.length > MAX_ROWS;
  if (tooMany) notes.push(`This file has ${rows.length} lines; Penny imports up to ${MAX_ROWS} at a time. Choose a shorter period.`);
  // each table has its own running balance (the account and a pocket are different balances)
  const check = { checked: 0, agree: 0 };
  for (const section of sections) {
    const c = balanceCheck(rows.filter((r) => r.section === section.id && r.status === 'booked'));
    check.checked += c.checked;
    check.agree += c.agree;
  }
  return { sections, rows: tooMany ? rows.slice(0, MAX_ROWS) : rows, left, currency, check, needsMapping, notes, tooMany };
}

function savedFor(grid, saved) {
  if (!saved?.size) return null;
  const guessRow = Number.isInteger(grid.headerRow) ? grid.headerRow : 0;
  for (let r = guessRow; r < Math.min(grid.rows.length, guessRow + 40); r++) {
    const m = saved.get(headerSignature(grid.rows[r]));
    if (m) return { signature: headerSignature(grid.rows[r]), mapping: { ...m, headerRow: r, dataStart: r + 1 }, headerRow: r };
  }
  return null;
}

/** What to remember about a mapping a person made by hand, to apply it to the next file with the same headings. */
export function mappingToRemember(grid, mapping) {
  if (!(mapping.headerRow >= 0)) return null;
  const sig = headerSignature(grid.rows[mapping.headerRow] ?? []);
  if (!sig) return null;
  const { roles, dateOrder, decimal, sign, currency } = mapping;
  return { signature: sig, mapping: { roles, dateOrder, decimal, sign, currency, confidence: 'high', notes: [] } };
}

export { roleList };
