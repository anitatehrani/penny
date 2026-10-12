// Applying a column mapping to a table: one clean row per payment (docs/DESIGN.md section 41). Dates become 2026-10-01, amounts become
// positive numbers with a type (income or expense), descriptions are tidied and stripped of account and card numbers, and every line that is
// not a payment (a total, a heading, an empty line) is listed in `left` with its reason instead of silently disappearing.

import { directionOf, statusOf } from './headers.js';
import { redact } from './redact.js';
import { parseAmount, parseDate, roundCents, tidy, ymd } from './values.js';
import { t } from '../i18n/translate.js';

const MAX_DESCRIPTION = 200;
const MAX_NOTE = 300;

const TOTAL = /^(total|totale|totals|subtotal|sub total|saldo( iniziale| finale| precedente| contabile| disponibile| a riporto)?|riporto|opening balance|closing balance|balance( brought forward| carried forward| b\/f| c\/f)?|brought forward|carried forward|anfangssaldo|endsaldo|kontostand|solde( initial| final)?|saldo anterior|saldo final)\b/i;

// lines inside a description that name something rather than say something
const ID_LINE = /^(transaction id|transaction number|id transazione|id operazione|trn|cro|transaktions-?id)\s*[:#]\s*(.+)$/i;
const CARD_LINE = /^(card|carta|karte|tarjeta|cartao)\s*[:#]/i;
const NOTE_LINE = /^(from|to|reference|riferimento|causale|payee|beneficiary|beneficiario|mandate|mandato|ordinante|da|a favore di|note|nota|notes|memo|message|messaggio)\s*[:#]\s*(.+)$/i;

/**
 * The text of a description cell, which may have several lines (a PDF row). Lines that are labels ("Reference: ...", "To: ...") become the
 * note, the bank's transaction id becomes the reference, a card line is dropped, and the rest is the description (wrapped lines joined).
 */
export function splitDescription(raw) {
  const lines = String(raw ?? '').split('\n').map(tidy).filter(Boolean);
  const body = [];
  const notes = [];
  let ref = null;
  for (const line of lines) {
    let m = line.match(ID_LINE);
    if (m) {
      ref ||= m[2].replace(/\s+/g, '');
      continue;
    }
    if (CARD_LINE.test(line)) continue;
    m = line.match(NOTE_LINE);
    if (m && lines.length > 1) {
      notes.push(line);
      continue;
    }
    body.push(line);
  }
  let title = body.join(' ');
  if (!title && notes.length) {
    title = notes[0].replace(NOTE_LINE, '$2');
    notes.shift();
  }
  return { title, notes, ref };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// the cells of a row by role; the line breaks of a cell that wrapped over several lines (a PDF) are kept, everything else is tidied
const tidyLines = (s) => String(s ?? '').split('\n').map(tidy).filter(Boolean).join('\n');
function parts(roles, row) {
  const out = {};
  roles.forEach((role, i) => {
    if (role === 'ignore') return;
    (out[role] ??= []).push(tidyLines(row[i]));
  });
  return out;
}

const firstOf = (list) => (list ?? []).find((tt) => tt) ?? '';

/**
 * Apply `mapping` (from detect.js, possibly edited by the person) to `grid`. `ref` is today ({y,m,d}) for dates written without a year.
 * Returns { rows, left } where rows are { line, date, description, note, amount, type, currency, reference, bankCategory, balance, final, status, signed }.
 */
export function extractRows(grid, mapping, { ref = null } = {}) {
  const rows = [];
  const left = [];
  const { roles, dateOrder, decimal, sign } = mapping;
  const opts = { decimal };
  const dateOpts = { order: dateOrder, ref, compact: !!mapping.compactDates };
  let lastDate = null;
  for (let r = mapping.dataStart; r < grid.rows.length; r++) {
    const raw = grid.rows[r];
    if (!raw || !raw.some((c) => tidy(c))) continue;
    const p = parts(roles, raw);
    const line = r + 1;
    const preview = clip(raw.map(tidy).filter(Boolean).join(' · '), 80);

    // the date; a line with money but a blank date shares the date above it (banks that print the date once for several payments)
    const dateText = [...(p.date ?? []), ...(p.valueDate ?? [])].find((tt) => tt) ?? '';
    let date = dateText ? parseDate(dateText, dateOpts) : null;
    let carried = false;
    if (!date && !dateText && lastDate) {
      date = lastDate;
      carried = true;
    }
    const descriptionText = [...(p.description ?? []), ...(p.payee ?? []), ...(p.counterparty ?? []), ...(p.details ?? [])].join(' ');
    if (!date) {
      left.push({ line, reason: TOTAL.test(tidy(descriptionText)) || TOTAL.test(tidy(raw[0] ?? '')) ? 'total' : 'nodate', text: preview });
      continue;
    }

    // the amount and its direction
    let value = null;
    let type = null;
    if (sign === 'debitcredit') {
      const d = parseAmount(firstOf(p.debit), opts);
      const c = parseAmount(firstOf(p.credit), opts);
      if (d !== null && d !== 0 && (c === null || c === 0)) [value, type] = [Math.abs(d), 'expense'];
      else if (c !== null && c !== 0 && (d === null || d === 0)) [value, type] = [Math.abs(c), 'income'];
      else if (d !== null && c !== null && (d !== 0 || c !== 0)) {
        const net = Math.abs(c) - Math.abs(d);
        if (net !== 0) [value, type] = [Math.abs(net), net > 0 ? 'income' : 'expense'];
      } else if (d === 0 || c === 0) [value, type] = [0, 'expense'];
    } else {
      const a = parseAmount(firstOf(p.amount), opts);
      if (a !== null) {
        const dir = sign === 'direction' ? directionOf(firstOf(p.direction)) : 0;
        if (sign === 'direction') {
          if (dir === 0 && a >= 0) {
            left.push({ line, reason: 'nodirection', text: preview });
            continue;
          }
          [value, type] = [Math.abs(a), dir !== 0 ? (dir < 0 ? 'expense' : 'income') : a < 0 ? 'expense' : 'income'];
        } else if (sign === 'positiveOut') [value, type] = [Math.abs(a), a > 0 ? 'expense' : 'income'];
        else if (sign === 'positiveIn') [value, type] = [Math.abs(a), a > 0 ? 'income' : 'expense'];
        else [value, type] = [Math.abs(a), a < 0 ? 'expense' : 'income'];
      }
    }
    if (value === null) {
      left.push({ line, reason: TOTAL.test(tidy(descriptionText)) ? 'total' : 'noamount', text: preview });
      continue;
    }
    const amount = roundCents(value);
    if (amount === 0) {
      left.push({ line, reason: 'zero', text: preview });
      continue;
    }
    if (TOTAL.test(tidy(descriptionText)) && !tidy(firstOf(p.payee) || firstOf(p.counterparty))) {
      left.push({ line, reason: 'total', text: preview });
      continue;
    }

    // the words: the other party first (the payee for money out, the payer for money in), then the description, then the details
    const party = type === 'income' ? firstOf(p.payer) || firstOf(p.counterparty) || firstOf(p.payee) : firstOf(p.payee) || firstOf(p.counterparty) || firstOf(p.payer);
    const pieces = [party, ...(p.description ?? []), ...(p.details ?? [])].filter((tt, i, all) => tt && all.indexOf(tt) === i);
    const split = pieces.map(splitDescription);
    const title = split.map((s) => s.title).filter(Boolean);
    const noteParts = [...title.slice(1), ...split.flatMap((s) => s.notes), ...(p.category ? [] : [])];
    const reference = (firstOf(p.reference) || split.map((s) => s.ref).find(Boolean) || '').trim();
    const description = clip(redact(title[0] ?? '') || t('Bank transaction'), MAX_DESCRIPTION);
    const note = clip(noteParts.map(redact).filter(Boolean).join(' · '), MAX_NOTE);

    // is it final? a status column, or the table's own heading ("Pending ...")
    const statusCode = p.status ? statusOf(firstOf(p.status)) : 0;
    const status = grid.kind === 'reverted' || statusCode === -2 ? 'reverted' : grid.kind === 'pending' || statusCode === -1 ? 'pending' : 'booked';

    const currency = (firstOf(p.currency) || mapping.currency || '').toUpperCase().slice(0, 3) || null;
    const balanceText = firstOf(p.balance);
    const balance = balanceText ? parseAmount(balanceText, opts) : null;
    const dateYMD = ymd(date);
    if (!carried) lastDate = date;
    rows.push({
      line,
      date: dateYMD,
      description,
      note,
      amount,
      type,
      currency,
      reference: reference.slice(0, 80),
      bankCategory: clip(tidy(firstOf(p.category)), 80),
      balance,
      status,
      guessedYear: !!date.guessedYear,
    });

    // a fee column becomes its own line
    const fee = p.fee ? parseAmount(firstOf(p.fee), opts) : null;
    if (fee !== null && fee !== 0) {
      rows.push({
        line,
        date: dateYMD,
        description: clip(t('Fee: {description}', { description }), MAX_DESCRIPTION),
        note: '',
        amount: roundCents(Math.abs(fee)),
        type: 'expense',
        currency,
        reference: '',
        bankCategory: '',
        balance: null,
        status,
        guessedYear: false,
        isFee: true,
      });
    }
  }
  return { rows, left };
}

/**
 * Check the amounts against the statement's own balance column, where it has one: each line's balance should be the line before's plus or minus
 * its amount. Returns { checked, agree } (both 0 when there is no balance column or too few lines), which the review screen shows as proof
 * that the signs were read correctly.
 */
export function balanceCheck(rows) {
  const withBalance = rows.filter((r) => r.balance !== null && !r.isFee);
  if (withBalance.length < 4) return { checked: 0, agree: 0 };
  const signed = (r) => (r.type === 'income' ? r.amount : -r.amount);
  const run = (list, newestFirst) => {
    let checked = 0;
    let agree = 0;
    for (let i = 1; i < list.length; i++) {
      const [before, row] = newestFirst ? [list[i], list[i - 1]] : [list[i - 1], list[i]];
      checked++;
      if (Math.abs(before.balance + signed(row) - row.balance) < 0.011) agree++;
    }
    return { checked, agree };
  };
  const down = run(withBalance, false);
  const up = run(withBalance, true);
  return up.agree > down.agree ? up : down;
}
