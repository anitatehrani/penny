// From the words of a PDF page to tables of cells (docs/DESIGN.md section 41). It works on positions only: every word comes as { str, x, y, w, h }
// (x from the left, y from the top, in points), whatever program or bank made the PDF. There is no code for any one bank.
//
//   words -> lines (words on one baseline) -> cells (words close together) -> header blocks (a line, or a few, naming date and amounts)
//   -> tables (a header and everything below it) -> rows (one anchor line with a date or an amount, plus the lines of the same payment)
//
// How a payment that wraps over several lines is kept together: the lines of a table body are cut into blocks wherever the vertical gap is
// larger than a threshold, and the threshold is the one that gives every block exactly one anchor line. That works whether the extra lines
// sit under the first one, around it (cells centred in the row) or above it.

import { headerRole, sectionKind } from './headers.js';
import { looksLikeDate, looksLikeMoney, tidy } from './values.js';

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const MONEY_ROLES = new Set(['amount', 'debit', 'credit', 'balance', 'fee']);
const DATE_ROLES = new Set(['date', 'valueDate']);

// ---------------------------------------------------------------------------------------------------------------------------------
// Lines and cells
// ---------------------------------------------------------------------------------------------------------------------------------

/** Group the words of a page into lines, and the words of a line into cells. */
export function buildLines(items, page = 0) {
  const words = items.filter((i) => i.str && i.str.trim() && Number.isFinite(i.x) && Number.isFinite(i.y)).map((i) => ({ ...i, h: Math.max(i.h || 8, 4) }));
  words.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.y - last.y) <= 0.45 * Math.min(w.h, last.h)) {
      last.items.push(w);
      last.ys.push(w.y);
      last.y = median(last.ys);
    } else {
      lines.push({ y: w.y, ys: [w.y], h: w.h, items: [w], page });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.h = median(line.items.map((i) => i.h));
    const cells = [];
    for (const it of line.items) {
      const prev = cells[cells.length - 1];
      const gap = prev ? it.x - prev.x1 : Infinity;
      if (prev && gap < Math.max(2.5, 0.65 * line.h)) {
        const glue = gap < 0.12 * line.h || prev.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ';
        prev.text += glue + it.str;
        prev.x1 = Math.max(prev.x1, it.x + it.w);
      } else {
        cells.push({ text: it.str, x0: it.x, x1: it.x + it.w, y: line.y, h: line.h });
      }
    }
    for (const c of cells) c.text = tidy(c.text);
    line.cells = cells.filter((c) => c.text);
    line.text = line.cells.map((c) => c.text).join(' ');
  }
  return lines.filter((l) => l.cells.length);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Header blocks
// ---------------------------------------------------------------------------------------------------------------------------------

const roleCells = (line) => line.cells.filter((c) => {
  const r = headerRole(c.text);
  return r && r.score >= 60;
});

/** A line that could be part of a heading: short words, no dates and no money. */
const headingish = (line) => line.cells.length <= 10 && line.cells.every((c) => c.text.length <= 32 && !looksLikeDate(c.text) && !looksLikeMoney(c.text));

const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;

/** Several heading lines (a two-line heading such as "DATA" over "CONTABILE") become one cell per column. */
function mergeHeader(lines) {
  const cells = lines.flatMap((l, li) => l.cells.map((c) => ({ ...c, li })));
  cells.sort((a, b) => a.x0 - b.x0 || a.li - b.li);
  const clusters = [];
  for (const c of cells) {
    const home = clusters.find((k) => overlaps(k, c) && !k.parts.some((p) => p.li === c.li));
    if (home) {
      home.parts.push(c);
      home.x0 = Math.min(home.x0, c.x0);
      home.x1 = Math.max(home.x1, c.x1);
    } else {
      clusters.push({ x0: c.x0, x1: c.x1, parts: [c] });
    }
  }
  clusters.sort((a, b) => a.x0 - b.x0);
  return clusters.map((k) => {
    const parts = [...k.parts].sort((a, b) => a.li - b.li || a.x0 - b.x0);
    const text = parts.map((p) => p.text).join(' ');
    // the heading as a whole first; if it means nothing, the part that does
    const whole = headerRole(text);
    const best = whole && whole.score >= 60 ? whole : parts.map((p) => headerRole(p.text)).filter(Boolean).sort((a, b) => b.score - a.score)[0] ?? whole ?? null;
    return { text, x0: k.x0, x1: k.x1, role: best?.role ?? null, alt: best?.alt ?? null, score: best?.score ?? 0 };
  });
}

const qualifies = (cols) => {
  const roles = new Set(cols.filter((c) => c.score >= 60).map((c) => c.role));
  return roles.has('date') && (roles.has('amount') || roles.has('debit') || roles.has('credit'));
};

/** Find the lines that name the columns of a table: { first, last (line indexes), cols } for each. */
export function findHeaderBlocks(lines) {
  const used = new Set();
  const found = [];
  const pivots = lines
    .map((l, i) => ({ i, n: roleCells(l).length }))
    .filter((p) => p.n >= 2)
    .sort((a, b) => b.n - a.n || a.i - b.i);
  for (const p of pivots) {
    if (used.has(p.i)) continue;
    const idx = [p.i];
    for (const dir of [-1, 1]) {
      let j = p.i;
      for (let steps = 0; steps < 2; steps++) {
        const k = j + dir;
        const cand = lines[k];
        if (!cand || used.has(k) || Math.abs(cand.y - lines[j].y) > 1.7 * Math.max(lines[j].h, cand.h) || !headingish(cand)) break;
        idx.push(k);
        j = k;
      }
    }
    idx.sort((a, b) => a - b);
    const cols = mergeHeader(idx.map((i) => lines[i]));
    if (!qualifies(cols)) continue;
    idx.forEach((i) => used.add(i));
    found.push({ first: idx[0], last: idx[idx.length - 1], cols });
  }
  return found.sort((a, b) => a.first - b.first);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------------------------------------------

/** How far a cell is from a header cell, whether both are left-aligned, right-aligned or centred. */
const headerDistance = (c, h) => Math.min(Math.abs(c.x0 - h.x0), Math.abs(c.x1 - h.x1), Math.abs((c.x0 + c.x1) / 2 - (h.x0 + h.x1) / 2));

const nearestByHeader = (c, cols) => {
  let best = 0;
  let bestD = Infinity;
  cols.forEach((h, i) => {
    const d = headerDistance(c, h);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
};

const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

/**
 * The cells of a column line up on their left edge, their right edge or their middle. Look at the cells under each heading (from the lines that
 * are plainly payments) and say which, and where: a heading written on the left over numbers that end on the right still works.
 */
function learnColumns(cols, anchorLines) {
  return cols.map((h, i) => {
    const mine = [];
    for (const line of anchorLines) for (const c of line.cells) if (nearestByHeader(c, cols) === i) mine.push(c);
    if (mine.length < 3) return { ...h, align: 'header', ref: null };
    const spread = { left: stdev(mine.map((c) => c.x0)), right: stdev(mine.map((c) => c.x1)), middle: stdev(mine.map((c) => (c.x0 + c.x1) / 2)) };
    const align = ['left', 'middle', 'right'].sort((a, b) => spread[a] - spread[b])[0];
    const point = (c) => (align === 'left' ? c.x0 : align === 'right' ? c.x1 : (c.x0 + c.x1) / 2);
    return { ...h, align, ref: median(mine.map(point)) };
  });
}

const cellPoint = (c, align) => (align === 'left' ? c.x0 : align === 'right' ? c.x1 : (c.x0 + c.x1) / 2);

function assign(c, learned) {
  let best = 0;
  let bestD = Infinity;
  learned.forEach((h, i) => {
    const d = h.align === 'header' ? headerDistance(c, h) : Math.abs(cellPoint(c, h.align) - h.ref);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------------------

/** Is this line the first line of a payment: a date in a date column, or money in an amount column? */
function isAnchor(line, cols) {
  return line.cells.some((c) => {
    const col = cols[nearestByHeader(c, cols)];
    if (!col) return false;
    if (DATE_ROLES.has(col.role)) return looksLikeDate(c.text);
    if (MONEY_ROLES.has(col.role)) return looksLikeMoney(c.text);
    return false;
  });
}

function cutIntoBlocks(lines, anchors, tau) {
  const blocks = [];
  let cur = null;
  lines.forEach((line, i) => {
    const gap = cur ? line.y - cur.lines[cur.lines.length - 1].y : Infinity;
    if (!cur || line.page !== cur.page || gap > tau) {
      cur = { page: line.page, lines: [], anchors: [] };
      blocks.push(cur);
    }
    cur.lines.push(line);
    if (anchors[i]) cur.anchors.push(line);
  });
  return blocks;
}

const scoreBlocks = (blocks) => blocks.reduce((s, b) => s + (b.anchors.length === 1 ? 1 : b.anchors.length === 0 ? -0.6 : -(b.anchors.length - 1)), 0);

/**
 * The vertical gap that cuts the lines into blocks of one payment each (see the note at the top). Two lines of one payment are never
 * further apart than about two lines' height, which keeps the heading of the next table away from the last payment of this one.
 */
export function bestGap(lines, anchors) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page) gaps.push(Math.round((lines[i].y - lines[i - 1].y) * 10) / 10);
  const uniq = [...new Set(gaps)].sort((a, b) => a - b);
  if (!uniq.length) return Infinity;
  const cap = 2.4 * median(lines.map((l) => l.h));
  const within = uniq.filter((g) => g <= cap);
  const set = new Set([uniq[0] / 2]);
  for (let i = 1; i < within.length; i++) set.add((within[i - 1] + within[i]) / 2);
  if (within.length) set.add(Math.min(within[within.length - 1] + 0.3, cap));
  const candidates = [...set].sort((a, b) => a - b);
  let best = -Infinity;
  let chosen = [];
  let run = [];
  candidates.forEach((tau, i) => {
    const s = scoreBlocks(cutIntoBlocks(lines, anchors, tau));
    if (s > best + 1e-9) {
      best = s;
      run = [i];
      chosen = run;
    } else if (Math.abs(s - best) <= 1e-9 && run.length && i === run[run.length - 1] + 1) {
      run.push(i);
    }
  });
  return candidates[chosen[Math.floor(chosen.length / 2)]];
}

/**
 * Turn the body lines of a table (all its pages) into rows of cells. Lines that belong to no payment (a footer, a heading, "Page 2 of 6")
 * form blocks with no anchor and are dropped; they are returned in `stray` so a section title can be found among them.
 */
export function extractRows(body, cols) {
  const hasDate = (line) => line.cells.some((c) => DATE_ROLES.has(cols[nearestByHeader(c, cols)]?.role) && looksLikeDate(c.text));
  let anchors = body.map((l) => isAnchor(l, cols));
  const counted = anchors.filter(Boolean).length;
  const dated = body.filter((l, i) => anchors[i] && hasDate(l)).length;
  // when almost every payment carries its date, a line with money and no date is a footer or a total, not a payment
  if (counted && dated / counted >= 0.8) anchors = anchors.map((a, i) => a && hasDate(body[i]));
  const learned = learnColumns(cols, body.filter((_l, i) => anchors[i]));
  const tau = bestGap(body, anchors);
  const blocks = cutIntoBlocks(body, anchors, tau);
  const rows = [];
  const stray = [];
  for (const b of blocks) {
    if (b.anchors.length === 0) {
      stray.push(...b.lines);
      continue;
    }
    // a block with several anchors (rows too close to tell apart) is split at the anchors; the other lines go to the nearest one
    const groups = b.anchors.map((a) => ({ anchor: a, lines: [a] }));
    for (const line of b.lines) {
      if (b.anchors.includes(line)) continue;
      const near = groups.reduce((m, g) => (Math.abs(g.anchor.y - line.y) < Math.abs(m.anchor.y - line.y) ? g : m), groups[0]);
      near.lines.push(line);
    }
    for (const g of groups) {
      g.lines.sort((a, b) => a.y - b.y);
      const cells = learned.map(() => []);
      for (const line of g.lines) for (const c of line.cells) cells[assign(c, learned)].push(c.text);
      rows.push({ page: g.anchor.page, y: g.anchor.y, cells: cells.map((parts) => parts.join('\n')) });
    }
  }
  return { rows, stray };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The whole document
// ---------------------------------------------------------------------------------------------------------------------------------

const signature = (cols) => cols.map((c) => c.text.toLowerCase().replace(/\s+/g, ' ')).join('|');

/**
 * Find every table of payments in the pages of a PDF. `pages` is [{ items }]. Returns { tables, lineCount }.
 * Each table: { title, kind ('booked' | 'pending' | 'reverted'), cols (heading texts and roles), rows ([{ cells, page }]) }.
 */
export function layoutPdf(pages) {
  const perPage = pages.map((p, i) => buildLines(p.items, i));
  // lines that repeat on several pages at the same height are the page's own header and footer, not payments and not section titles
  const seen = new Map();
  for (const lines of perPage) for (const l of lines) {
    const key = `${l.text.replace(/\d+/g, '#')}@${Math.round(l.y / 3)}`;
    const set = seen.get(key) ?? new Set();
    set.add(l.page);
    seen.set(key, set);
  }
  const recurring = (l) => (seen.get(`${l.text.replace(/\d+/g, '#')}@${Math.round(l.y / 3)}`)?.size ?? 0) >= 2;

  const tables = [];
  perPage.forEach((lines, pi) => {
    const blocks = findHeaderBlocks(lines);
    const bodyOf = (from, to) => lines.filter((_l, i) => i > from && i < to);
    // lines above the first heading on a page may continue the table of the page before
    const firstLine = blocks.length ? blocks[0].first : lines.length;
    const last = tables[tables.length - 1];
    if (last) {
      const lead = lines.filter((l, i) => i < firstLine && !recurring(l));
      if (lead.some((l) => isAnchor(l, last.cols))) last.body.push(...lead);
    }
    blocks.forEach((b, bi) => {
      const next = blocks[bi + 1];
      const body = bodyOf(b.last, next ? next.first : lines.length);
      // the closest line above the heading that is not page furniture names the section ("Pending from ...", "Reverted ...");
      // it starts at the left edge of the table, which the wrapped lines of a payment above it do not
      let title = '';
      for (let k = b.first - 1; k >= 0; k--) {
        const l = lines[k];
        if (lines[b.first].y - l.y > 5 * lines[b.first].h) break;
        if (blocks.some((o) => k >= o.first && k <= o.last)) break;
        if (recurring(l)) continue;
        if (l.cells.length <= 2 && l.cells[0].x0 <= b.cols[0].x1 + 2 && !/^page/i.test(l.text)) {
          title = l.text;
          break;
        }
      }
      const sig = signature(b.cols);
      const prev = tables[tables.length - 1];
      if (prev && prev.sig === sig && !title && bi === 0) {
        prev.body.push(...body);
      } else {
        tables.push({ title, sig, cols: b.cols, body: [...body], kind: sectionKind(title) });
      }
    });
  });

  const out = [];
  for (const t of tables) {
    const { rows } = extractRows(t.body, t.cols);
    if (!rows.length) continue;
    out.push({ title: t.title, kind: t.kind, cols: t.cols.map(({ text, role, alt }) => ({ text, role, alt })), rows });
  }
  return { tables: out, lines: perPage };
}

/**
 * A statement with no heading row at all (lines that start with a date and end with an amount): one table, one row per dated line, its
 * other words as the description, its money cells as columns. Used only when no heading was found.
 */
export function layoutLoose(perPageLines) {
  const rows = [];
  let widest = 0;
  for (const lines of perPageLines) {
    let current = null;
    let lastY = 0;
    for (const l of lines) {
      const dateAt = l.cells.findIndex((c) => looksLikeDate(c.text));
      const money = l.cells.map((c, i) => ({ c, i })).filter(({ c }) => looksLikeMoney(c.text));
      if (dateAt >= 0 && dateAt <= 1 && money.length) {
        current = {
          page: l.page,
          date: l.cells[dateAt].text,
          text: l.cells.filter((_c, i) => i !== dateAt && !money.some((m) => m.i === i)).map((c) => c.text),
          money: money.map((m) => m.c.text),
        };
        rows.push(current);
        widest = Math.max(widest, current.money.length);
        lastY = l.y;
      } else if (current && current.page === l.page && dateAt < 0 && !money.length && l.y - lastY <= 1.8 * l.h) {
        current.text.push(...l.cells.map((c) => c.text)); // the rest of a description that wrapped
        lastY = l.y;
      } else {
        current = null;
      }
    }
  }
  if (!rows.length) return null;
  const k = Math.min(widest, 3);
  const heads = ['Date', 'Description', ...Array.from({ length: k }, (_v, i) => (i === 0 ? 'Amount' : 'Balance'))];
  return {
    title: '',
    kind: 'booked',
    loose: true,
    cols: heads.map((text) => ({ text, role: null, alt: null })),
    rows: rows.map((r) => ({ page: r.page, cells: [r.date, r.text.join(' '), ...Array.from({ length: k }, (_v, i) => r.money[i] ?? '')] })),
  };
}

/** The tables as plain grids of text, header first, which is what the rest of the importer reads. */
export function gridsFromTables(tables) {
  return tables.map((t, i) => ({
    source: 'pdf',
    name: t.title || (tables.length > 1 ? `Table ${i + 1}` : 'Payments'),
    title: t.title,
    kind: t.kind,
    headerRow: 0,
    loose: !!t.loose,
    rows: [t.cols.map((c) => c.text), ...t.rows.map((r) => r.cells)],
  }));
}
