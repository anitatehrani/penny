// The review step of a statement import, as plain functions (docs/DESIGN.md section 41): from the lines the reader found and what the server
// made of them to the rows the person edits, and from those rows to what is saved. No screen code here, so it is tested on its own.

export const WHY = { duplicate: 'Already in your payments', notbooked: 'Not booked by the bank yet', reverted: 'Cancelled by the bank', section: 'This part of the statement is switched off', you: 'You left it out' };

/** What the preview request carries for each line: only what the server needs to suggest a category and find duplicates. */
export const previewLines = (rows) =>
  rows.map((r, i) => ({ i, date: r.date, description: r.description, note: r.note ?? '', amount: r.amount, type: r.type, bank_category: r.bankCategory ?? '', reference: r.reference ?? '' }));

/** Is a part of the statement (a section) on by default? Pending and cancelled parts are not. */
export const sectionOnByDefault = (section) => section.kind === 'booked';

/**
 * The rows the person reviews. `lines` come from the reader, `answers` from the preview (matched by position), `sections` says which parts are on.
 * Each row keeps what the bank said (`original`) next to what will be saved (`description`, `category`, `type` ...).
 */
export function startReview(lines, answers, sectionOn = {}) {
  return lines.map((line, i) => {
    const a = answers[i] ?? {};
    const on = sectionOn[line.section] ?? true;
    const row = {
      i,
      id: line.id,
      section: line.section,
      line: line.line,
      date: line.date,
      description: line.description,
      original: line.description,
      note: line.note ?? '',
      amount: line.amount,
      type: line.type,
      originalType: line.type,
      status: line.status, // booked | pending | reverted
      guessedYear: !!line.guessedYear,
      ref: a.ref ?? null,
      merchant: a.merchant ?? '',
      category: a.category ?? null,
      suggested: a.category ?? null,
      source: a.source ?? null,
      confidence: a.confidence ?? 0,
      review: a.review ?? null,
      reason: a.reason ?? '',
      transfer: !!a.transfer,
      duplicate: a.duplicate ?? null,
      settleId: a.duplicate?.action === 'settle' ? a.duplicate.tx.id : null,
      action: 'import',
      why: null,
      touched: false, // the person changed the category
    };
    const w = defaultAction(row, on);
    row.action = w.action;
    row.why = w.why;
    return row;
  });
}

/** Import, mark a waiting payment as paid, or leave out, and why. */
export function defaultAction(row, sectionIsOn = true) {
  if (!sectionIsOn) return { action: 'skip', why: 'section' };
  if (row.status === 'reverted') return { action: 'skip', why: 'reverted' };
  if (row.status === 'pending') return { action: 'skip', why: 'notbooked' };
  if (row.duplicate?.action === 'skip') return { action: 'skip', why: 'duplicate' };
  if (row.duplicate?.action === 'settle') return { action: 'settle', why: null };
  return { action: 'import', why: null };
}

const same = (a, b) => (a?.id ?? null) === (b?.id ?? null) && (a?.name ?? null) === (b?.name ?? null);

/** Does the category of this row need the person's eye? Only rows that will be imported count. */
export const needsLook = (row) => row.action === 'import' && (row.category === null || (row.review !== null && !row.touched));

export function summary(rows) {
  const out = { total: rows.length, importing: 0, settling: 0, skipped: 0, check: 0, none: 0, duplicates: 0, notBooked: 0, transfers: 0, in: 0, out: 0, newCategories: [] };
  const fresh = new Map();
  for (const r of rows) {
    if (r.duplicate && r.duplicate.kind !== 'similar') out.duplicates++;
    if (r.status !== 'booked') out.notBooked++;
    if (r.action === 'skip') {
      out.skipped++;
      continue;
    }
    if (r.action === 'settle') {
      out.settling++;
      continue;
    }
    out.importing++;
    if (r.type === 'income') out.in += r.amount;
    else out.out += r.amount;
    if (r.transfer) out.transfers++;
    if (r.category === null) out.none++;
    else if (needsLook(r)) out.check++;
    if (r.category?.isNew) fresh.set(`${r.type}:${r.category.name}`, r.category);
  }
  out.in = Math.round(out.in * 100) / 100;
  out.out = Math.round(out.out * 100) / 100;
  out.newCategories = [...fresh.values()];
  return out;
}

/** The rows a view shows: everything, what needs a look, what is left out, duplicates, transfers; narrowed by a search and a section. */
export function visible(rows, { view = 'all', q = '', section = null } = {}) {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (section !== null && r.section !== section) return false;
    if (view === 'check' && !needsLook(r)) return false;
    if (view === 'skipped' && r.action !== 'skip') return false;
    if (view === 'duplicates' && !(r.duplicate && r.duplicate.kind !== 'similar')) return false;
    if (view === 'transfers' && !r.transfer) return false;
    if (needle && !`${r.description} ${r.original} ${r.note} ${r.category?.name ?? ''} ${r.amount}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const patch = (rows, ids, fn) => {
  const set = new Set(ids);
  return rows.map((r) => (set.has(r.i) ? { ...r, ...fn(r) } : r));
};

export const setAction = (rows, ids, action) => patch(rows, ids, (r) => ({ action, why: action === 'skip' ? 'you' : null, settleId: action === 'settle' ? r.duplicate?.tx?.id ?? null : r.settleId }));

/** A category chosen by the person. A category of the other kind is refused by the screen, so it is never offered. */
export const setCategory = (rows, ids, category) => patch(rows, ids, () => ({ category, touched: true }));

/** Money out becomes money in or the other way round (the bank's sign was read the wrong way): the category no longer fits, so it goes. */
export const flipType = (rows, ids) =>
  patch(rows, ids, (r) => ({ type: r.type === 'income' ? 'expense' : 'income', category: null, suggested: null, review: 'none', source: null, transfer: false, touched: false, duplicate: null }));

export const setText = (rows, id, fields) => patch(rows, [id], () => fields);

/** The other rows of the same merchant and kind that the person has not chosen a category for yet: offered the same one. */
export function sameMerchant(rows, row) {
  if (!row.merchant) return [];
  return rows.filter((r) => r.i !== row.i && r.merchant === row.merchant && r.type === row.type && !r.touched && r.action === 'import' && !same(r.category, row.category)).map((r) => r.i);
}

/** Put every row on or off for a whole section (a part of the statement): rows the person decided about keep their choice. */
export function setSection(rows, section, on) {
  return rows.map((r) => {
    if (r.section !== section || r.why === 'you') return r;
    const w = defaultAction(r, on);
    return { ...r, action: w.action, why: w.why, settleId: w.action === 'settle' ? r.duplicate?.tx?.id ?? null : null };
  });
}

/** Bring in the lines the bank has not booked yet (a card hold). */
export function includeNotBooked(rows) {
  return rows.map((r) => (r.action === 'skip' && (r.why === 'notbooked') ? { ...r, action: 'import', why: null } : r));
}

/**
 * What is sent to be saved. A category the person chose or changed is marked `taught`, so Penny remembers it. New categories go by name.
 * Rows that are left out are not sent at all.
 */
export function commitRows(rows) {
  return rows
    .filter((r) => r.action !== 'skip')
    .map((r) => {
      const c = r.category;
      const changed = r.touched && !same(c, r.suggested);
      return {
        date: r.date,
        description: r.description.trim() || r.original || 'Bank transaction',
        note: r.note ?? '',
        amount: r.amount,
        type: r.type,
        ...(c && !c.isNew ? { category_id: c.id } : {}),
        ...(c && c.isNew ? { new_category: { name: c.name } } : {}),
        ...(r.ref && r.type === r.originalType ? { ref: r.ref } : {}),
        key: r.merchant || r.original,
        action: r.action,
        ...(r.action === 'settle' ? { settle_id: r.settleId } : {}),
        taught: !!c && changed && r.action === 'import',
      };
    });
}

/** Dates of the lines that will be saved, to show the stretch of time and to open the Payments page on the latest month. */
export function span(rows) {
  const dates = rows.filter((r) => r.action !== 'skip').map((r) => r.date).sort();
  return dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null;
}
