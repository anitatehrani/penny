// Guessing the category of a line of a bank statement (docs/DESIGN.md section 41). Pure functions: the route loads what is needed from the
// database (the budget's categories, what the person taught Penny, their earlier payments) and hands it over here.
//
// The order of trust: what the person taught Penny for that merchant, then what their own earlier payments to that merchant used, then the
// built-in knowledge of names and words together with what the bank itself calls the line. A guess that is not sure is marked "check";
// no guess at all is marked "none". Income is never given an expense category.

import { BANK_MAP, EXPENSE_FOR, INCOME_FOR, INDEX, LABELS, normalize } from './merchants.js';

// ---------------------------------------------------------------------------------------------------------------------------------
// The merchant behind a description
// ---------------------------------------------------------------------------------------------------------------------------------

// payment services that put the real merchant after a star: "PAYPAL *SPOTIFY", "SQ *COFFEE"
const PROCESSORS = new Set(['paypal', 'sumup', 'sq', 'square', 'zettle', 'izettle', 'klarna', 'stripe', 'amzn', 'mktp', 'google', 'pos', 'pay', 'ppro', 'adyen', 'checkout', 'twint', 'mollie', 'satispay', 'tpay', 'worldpay', 'nexi', 'lyra']);
// words of the payment itself, not of the shop
const NOISE = new Set(['pagamento', 'pag', 'acquisto', 'pos', 'carta', 'card', 'visa', 'mastercard', 'maestro', 'bancomat', 'contactless', 'payment', 'purchase', 'debit', 'credit', 'addebito', 'accredito', 'bonifico', 'istantaneo', 'disposto', 'favore', 'sepa', 'direct', 'standing', 'order', 'transfer', 'trasferimento', 'ordine', 'from', 'to', 'by', 'at', 'presso', 'ref', 'riferimento', 'causale', 'mandato', 'mandate', 'via', 'viale', 'piazza', 'numero', 'nr', 'no', 'transaction', 'id', 'sent', 'received', 'ricevuto', 'effettuato', 'operazione', 'dal', 'www', 'com', 'it', 'eu', 'de', 'co', 'uk', 'net', 'org', 'srl', 'spa', 'snc', 'sas', 'ltd', 'llc', 'inc', 'gmbh', 'bv', 'nv', 'plc', 'sarl', 'ag', 'oy', 'corp', 'kg', 'sl']);
const STOP = new Set(['il', 'lo', 'la', 'le', 'gli', 'di', 'da', 'del', 'della', 'dei', 'delle', 'dello', 'degli', 'de', 'des', 'du', 'the', 'el', 'los', 'las', 'der', 'die', 'das', 'den', 'al', 'in', 'on', 'and', 'et', 'und', 'una', 'uno', 'per', 'con', 'su', 'for', 'of']);
// a place after the name tells nothing about the shop, and the same shop has many places
const PLACES = new Set(['milano', 'roma', 'torino', 'napoli', 'genova', 'firenze', 'bologna', 'palermo', 'bari', 'catania', 'venezia', 'verona', 'padova', 'trieste', 'brescia', 'parma', 'modena', 'livorno', 'pisa', 'cagliari', 'perugia', 'trento', 'bolzano', 'paris', 'london', 'dublin', 'berlin', 'munich', 'madrid', 'barcelona', 'lisbon', 'amsterdam', 'brussels', 'vienna', 'zurich', 'luxembourg', 'copenhagen', 'stockholm', 'oslo', 'helsinki', 'warsaw', 'prague', 'budapest', 'athens', 'italia', 'italy', 'france', 'germany', 'spain', 'ireland', 'sanvincenzo', 'san', 'santa', 'santo']);

// a piece after a star with no real word in it (a code such as p478c2, or only digits) belongs to the payment service, not the shop
const looksLikeId = (seg) => !seg.split(/[^a-z0-9]+/i).some((t) => /^[a-z]{3,}$/i.test(t));

/** The words that name the merchant of a description: "Paypal *spotify*p478c2" is "spotify", "Pagamento POS ESSELUNGA MILANO 0123" is "esselunga milano". */
export function merchantWords(description) {
  let s = String(description ?? '').replace(/https?:\/\//gi, '').replace(/\bwww\./gi, '');
  if (s.includes('*')) {
    let segs = s.split('*').map((x) => x.trim()).filter(Boolean);
    const kept = segs.filter((seg) => !PROCESSORS.has(normalize(seg)) && !looksLikeId(seg));
    if (kept.length) segs = kept;
    s = segs.join(' ');
  }
  return normalize(s)
    .split(' ')
    .filter((t) => t.length > 1 && !/\d/.test(t) && !STOP.has(t) && !NOISE.has(t));
}

/** The words used to look a merchant up (up to three, in the order written). */
export const merchantKey = (description) => merchantWords(description).slice(0, 3).join(' ');

/** The short name a rule is saved under: up to two words, without a trailing place. */
export function ruleKey(description) {
  const words = merchantWords(description);
  while (words.length > 1 && PLACES.has(words[words.length - 1])) words.pop();
  return words.slice(0, 2).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Looking things up
// ---------------------------------------------------------------------------------------------------------------------------------

/** The keys a line is looked up under: its first two words, then its first word (when that is a name in itself, not a short word). */
const lookupKeys = (words) => {
  const keys = [];
  if (words.length >= 2) keys.push(words.slice(0, 2).join(' '));
  if (words.length >= 1 && words[0].length >= 4) keys.push(words[0]);
  return keys;
};

/**
 * What is known from the budget: `rules` are rows of import_rules ({ merchant_key, kind, category_id, hits }); `history` are earlier payments
 * ({ description, type, category_id }). Returns { learned(type, words), seen(type, words) } giving { category_id, ... } or null.
 */
export function memoryOf(rules, history) {
  const learned = new Map(rules.map((r) => [`${r.kind}:${r.merchant_key}`, r]));
  const seen = new Map(); // "type:key" -> Map(category_id -> count)
  for (const h of history) {
    if (!h.category_id) continue;
    const words = merchantWords(h.description);
    const key = ruleKey(h.description);
    if (!key) continue;
    for (const k of new Set([key, words[0]?.length >= 4 ? words[0] : null].filter(Boolean))) {
      const id = `${h.type}:${k}`;
      const m = seen.get(id) ?? new Map();
      m.set(h.category_id, (m.get(h.category_id) ?? 0) + 1);
      seen.set(id, m);
    }
  }
  return {
    learned(type, words) {
      for (const k of lookupKeys(words)) {
        const hit = learned.get(`${type}:${k}`);
        if (hit) return hit;
      }
      return null;
    },
    seen(type, words) {
      for (const k of lookupKeys(words)) {
        const counts = seen.get(`${type}:${k}`);
        if (!counts) continue;
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        const [id, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
        return { category_id: id, count: n, share: n / total, total };
      }
      return null;
    },
  };
}

/** The best built-in match for a text: { label, name?, strength, via: 'brand' | 'word' } or null. */
export function matchKnown(text) {
  const hay = normalize(text.replace(/\*/g, ' '));
  if (!hay) return null;
  const padded = ` ${hay} `;
  const tokens = [...new Set(hay.split(' '))];
  let best = null;
  const consider = (c) => {
    if (!best || c.strength > best.strength || (c.strength === best.strength && c.len > best.len)) best = c;
  };
  for (const tok of tokens) {
    for (const e of INDEX.brandIndex.get(tok) ?? []) {
      if (padded.includes(` ${e.phrase} `)) consider({ label: e.label, name: e.name, strength: e.weak ? 0.6 : 0.92, via: 'brand', len: e.phrase.length });
    }
    for (const e of INDEX.wordIndex.get(tok) ?? []) {
      if (padded.includes(` ${e.phrase} `)) consider({ label: e.label, strength: e.weak ? 0.55 : 0.78, via: 'word', len: e.phrase.length });
    }
  }
  for (const st of INDEX.stems) {
    if (tokens.some((t) => t.startsWith(st.stem))) consider({ label: st.label, strength: st.weak ? 0.55 : 0.78, via: 'word', len: st.stem.length });
  }
  return best;
}

/** What the bank itself calls the line, as a label: { label } (null when the bank's word says nothing) or undefined when it is unknown to us. */
export function bankLabel(bankCategory) {
  const k = normalize(bankCategory ?? '');
  if (!k) return undefined;
  if (BANK_MAP.has(k)) return BANK_MAP.get(k);
  // "Rate Mutuo e Finanziamento" wrapped or cut: the longest known phrase it starts with or contains
  let best;
  let len = 0;
  for (const [phrase, label] of BANK_MAP) {
    if (phrase.length > len && phrase.length >= 5 && (` ${k} `.includes(` ${phrase} `) || phrase.startsWith(k) && k.length >= 8)) {
      best = label;
      len = phrase.length;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Labels and the budget's own categories
// ---------------------------------------------------------------------------------------------------------------------------------

const same = (a, b) => normalize(a) === normalize(b);

/** The category of the budget a label means for a line of this type: an existing one by name (or a common alias), or a new one to be created. */
export function resolveCategory(label, type, categories) {
  const def = LABELS[label];
  if (!def) return null;
  const mine = categories.filter((c) => c.kind === type);
  for (const alias of def.alias) {
    const found = mine.find((c) => same(c.name, alias));
    if (found) return { id: found.id, name: found.name, kind: found.kind, color: found.color };
  }
  return { id: null, name: def.name, kind: type, color: def.color, isNew: true };
}

/** Does a label make sense for this type of line? A spending label for money coming in becomes the matching income label, and the reverse. */
function fitLabel(label, type) {
  const def = LABELS[label];
  if (!def) return { label: type === 'income' ? 'income_other' : 'other', changed: true };
  if (def.kind === 'both' || def.kind === type) return { label, changed: false };
  return { label: type === 'income' ? INCOME_FOR[label] ?? INCOME_FOR.default : EXPENSE_FOR[label] ?? EXPENSE_FOR.default, changed: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The guess
// ---------------------------------------------------------------------------------------------------------------------------------

export const SURE = 0.75; // a guess below this is marked "check"

const nameOf = (c) => c?.name ?? '';

/**
 * Guess the category of one line { description, note, type, bank_category }. `categories` are the budget's ([{ id, name, kind }]), `memory` is
 * memoryOf(...). Returns {
 *   merchant (the words, for grouping lines of the same merchant), brand (the well-known name when one was recognised, else null),
 *   category: { id, name, kind, isNew? } | null, source: 'learned' | 'history' | 'known' | 'bank' | null, confidence, review: null | 'check' | 'none',
 *   reason (a short sentence for the person), transfer
 * }.
 */
export function suggest(line, categories, memory) {
  const type = line.type;
  const words = merchantWords(line.description);
  const merchant = ruleKey(line.description) || ruleKey(line.note) || '';
  const text = `${line.description ?? ''} ${line.note ?? ''}`;
  const known = matchKnown(text);
  const out = { merchant, brand: known?.via === 'brand' && known.strength >= 0.9 ? known.name : null, category: null, source: null, confidence: 0, review: 'none', reason: 'Penny has no idea what this is. Pick a category.', transfer: false };

  const learned = words.length ? memory.learned(type, words) : null;
  const byId = (id) => categories.find((c) => c.id === id && c.kind === type);
  if (learned && byId(learned.category_id)) {
    const c = byId(learned.category_id);
    return { ...out, category: { id: c.id, name: c.name, kind: c.kind }, source: 'learned', confidence: 0.98, review: null, reason: `You chose ${c.name} for ${merchant || 'this'} before.` };
  }
  const seen = words.length ? memory.seen(type, words) : null;
  if (seen && byId(seen.category_id) && seen.share >= 0.6) {
    const c = byId(seen.category_id);
    const sure = seen.count >= 2 && seen.share >= 0.8;
    return { ...out, category: { id: c.id, name: c.name, kind: c.kind }, source: 'history', confidence: sure ? 0.9 : 0.78, review: sure ? null : 'check', reason: `${seen.count} of your earlier payments to ${merchant} are in ${c.name}.` };
  }

  // the built-in knowledge, and what the bank calls it
  let label = null;
  let conf = 0;
  let via = null;
  let why = '';
  const bank = bankLabel(line.bank_category);
  if (known) {
    [label, conf, via] = [known.label, known.strength, 'known'];
    why = known.via === 'brand' ? `${known.name} is usually ${LABELS[known.label]?.name ?? known.label}.` : `Looks like ${LABELS[known.label]?.name ?? known.label}.`;
  }
  if (bank) {
    const bankConf = 0.72;
    if (!label) {
      [label, conf, via] = [bank, bankConf, 'bank'];
      why = `The bank calls this "${line.bank_category}".`;
    } else if (bank === label) {
      conf = Math.min(0.97, conf + 0.08);
      why += ` The bank agrees ("${line.bank_category}").`;
    } else if (known.strength < 0.9) {
      [label, conf, via] = [bank, bankConf, 'bank'];
      why = `The bank calls this "${line.bank_category}".`;
      conf -= 0.1;
    } else {
      conf -= 0.2; // a well-known name that the bank files differently: keep the name, but look
      why += ` The bank files it as "${line.bank_category}".`;
    }
  }
  if (!label) return out;
  const fit = fitLabel(label, type);
  if (fit.changed) {
    conf = Math.min(conf, 0.6);
    why = type === 'income' ? 'Money came in from a place you usually spend at: a refund?' : 'Money went out where income is expected.';
  }
  const category = resolveCategory(fit.label, type, categories);
  if (!category) return out;
  const transfer = fit.label === 'transfers';
  // transfers are real movements of the balance but easy to get wrong: always worth a look
  const review = conf < SURE || transfer ? 'check' : null;
  return { ...out, category, source: via, confidence: Math.round(conf * 100) / 100, review, reason: transfer ? 'Looks like a transfer between accounts or to a person. Check it, and leave it out if it is your own money moving.' : why, transfer };
}

export { nameOf };
