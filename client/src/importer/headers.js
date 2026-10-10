// What a column is for, judged from its heading (docs/DESIGN.md section 41). The names are those banks really use, in English, Italian, German,
// French, Spanish, Portuguese and Dutch. The data confirms or overrules the heading later (detect.js); this only proposes.

import { fold } from './values.js';

/** The roles a column can have. `label` is what the matching screen shows. */
export const ROLES = [
  { role: 'date', label: 'Date' },
  { role: 'valueDate', label: 'Value date (not used)' },
  { role: 'description', label: 'Description' },
  { role: 'payee', label: 'Payee or shop' },
  { role: 'payer', label: 'Who paid you' },
  { role: 'counterparty', label: 'Other party' },
  { role: 'details', label: 'More details' },
  { role: 'amount', label: 'Amount (one column)' },
  { role: 'debit', label: 'Money out' },
  { role: 'credit', label: 'Money in' },
  { role: 'direction', label: 'In or out marker' },
  { role: 'balance', label: 'Balance (not used)' },
  { role: 'currency', label: 'Currency' },
  { role: 'category', label: 'Bank category' },
  { role: 'status', label: 'Booked or pending' },
  { role: 'reference', label: 'Reference or id' },
  { role: 'fee', label: 'Fee' },
  { role: 'ignore', label: 'Do not use' },
];

// role -> phrases (already folded). A phrase matches a heading when the heading's words contain it in a row.
const PHRASES = {
  date: [
    'date', 'data', 'datum', 'fecha', 'dia', 'transaction date', 'booking date', 'posting date', 'posted date', 'trans date', 'started date', 'completed date', 'start date',
    'date started', 'date completed', 'date operation', 'date de comptabilisation', 'date comptable', 'date de l operation', 'date operazione', 'data operazione',
    'data contabile', 'data registrazione', 'data movimento', 'data mov', 'data contabilizzazione', 'data transazione', 'data addebito', 'data di addebito',
    'buchungstag', 'buchungsdatum', 'buchung', 'datum buchung', 'umsatzdatum', 'fecha operacion', 'fecha contable', 'fecha de operacion', 'fecha movimiento',
    'data da transacao', 'data lancamento', 'data do movimento', 'boekingsdatum', 'transactiedatum', 'datum transactie', 'trade date', 'effective date', 'transaction posted',
    'bokforingsdag', 'when', 'time', 'timestamp', 'date time', 'datetime',
  ],
  valueDate: [
    'value date', 'data valuta', 'valutadatum', 'valuta datum', 'wertstellung', 'wertstellungsdatum', 'date de valeur', 'date valeur', 'fecha valor', 'fecha de valor',
    'data de valor', 'valutadatum', 'settlement date', 'settled date', 'effective value date',
  ],
  description: [
    'description', 'descrizione', 'descrizione operazione', 'descrizione movimento', 'descripcion', 'descricao', 'beschreibung', 'omschrijving', 'libelle', 'details of transaction',
    'transaction description', 'transaction details', 'narrative', 'narration', 'particulars', 'text', 'transaction', 'operazione', 'operazioni', 'causale', 'causale operazione', 'causale movimento',
    'movimento', 'concepto', 'concept', 'buchungstext', 'verwendungszweck', 'libelle de l operation', 'motif', 'remarks', 'payment details', 'detail', 'details', 'dettaglio', 'dettagli',
    'memo', 'merchant name', 'name description', 'naam omschrijving', 'tegenpartij omschrijving', 'info', 'informazioni',
  ],
  payee: [
    'payee', 'beneficiary', 'beneficiario', 'begunstigter', 'zahlungsempfanger', 'zahlungsempfanger in', 'empfanger', 'merchant', 'merchant name', 'shop', 'store', 'vendor',
    'beneficiaire', 'destinatario', 'ontvanger', 'paid to', 'pagato a', 'name', 'nome', 'nom', 'naam', 'nombre', 'payee name', 'beguenstigter', 'empfaenger', 'zahlungsempfaenger', 'zahlungsempfaenger in', 'merchant name', 'nome beneficiario', 'name of payee',
  ],
  payer: [
    'payer', 'ordinante', 'zahlungspflichtiger', 'zahlungspflichtige r', 'zahlungspflichtige', 'auftraggeber', 'donneur d ordre', 'remitter', 'originator', 'sender', 'received from',
    'ricevuto da', 'ordenante', 'afzender', 'pagador', 'payer name', 'zahlungspflichtige r', 'name of payer', 'nome ordinante',
  ],
  counterparty: [
    'counterparty', 'counter party', 'counterparty name', 'controparte', 'gegenpartei', 'auftraggeber empfanger', 'empfanger zahlungspflichtiger', 'beguenstigter zahlungspflichtiger',
    'begunstigter zahlungspflichtiger', 'auftraggeber begunstigter', 'auftraggeber beguenstigter', 'beguenstigter zahlungspflichtiger', 'tegenpartij', 'contrepartie', 'contraparte', 'other party', 'beneficiario ordenante', 'naam tegenpartij', 'counter party name',
  ],
  details: [
    'payment reference', 'reference', 'riferimento', 'riferimenti', 'referenz', 'referencia', 'verwendungszweck', 'mededelingen', 'note', 'notes', 'nota', 'notas', 'memo', 'remarks',
    'additional info', 'additional information', 'extra', 'notes and tags', 'notes tags', 'communication', 'communication structuree', 'zusatzinfo', 'info zusatz', 'dettagli aggiuntivi', 'ulteriori dettagli',
    'description complementaire', 'details complementaires', 'free text', 'testo libero', 'note aggiuntive', 'your reference', 'reference number',
  ],
  amount: [
    'amount', 'importo', 'importe', 'betrag', 'montant', 'bedrag', 'valor', 'quantia', 'summe', 'sum', 'total', 'totale', 'transaction amount', 'importo in euro', 'importo eur', 'amount eur',
    'importo movimento', 'importo operazione', 'valore', 'valeur', 'amount in eur', 'betrag eur', 'betrag in eur', 'amount original', 'amount gbp', 'amount usd', 'umsatz', 'monto', 'importe eur', 'importo euro',
  ],
  debit: [
    'debit', 'debits', 'debit amount', 'money out', 'paid out', 'withdrawal', 'withdrawals', 'outgoing', 'out', 'spent', 'payments', 'uscite', 'uscita', 'addebiti', 'addebito', 'dare', 'importo addebito',
    'importo dare', 'ausgaben', 'ausgang', 'soll', 'debit eur', 'debe', 'cargo', 'cargos', 'debito', 'debitos', 'saida', 'saidas', 'af', 'charges', 'paiements', 'importo uscita', 'sorties',
  ],
  credit: [
    'credit', 'credits', 'credit amount', 'money in', 'paid in', 'deposit', 'deposits', 'incoming', 'in', 'received', 'entrate', 'entrata', 'accrediti', 'accredito', 'avere', 'importo accredito',
    'importo avere', 'einnahmen', 'eingang', 'haben', 'credit eur', 'haber', 'abono', 'abonos', 'credito', 'creditos', 'entrada', 'entradas', 'bij', 'encaissements', 'importo entrata', 'entrees',
  ],
  direction: [
    'type', 'tipo', 'art', 'transaction type', 'tipo operazione', 'tipo movimento', 'af bij', 'dr cr', 'cr dr', 'debit credit', 'credit debit', 'd c', 'c d', 'segno', 'direction', 'sens',
    'sign', 'indicator', 'debit credit indicator', 'dc', 'cd', 'tipo de movimiento', 'soll haben', 'haben soll', 'mutatiesoort', 'af bij',
  ],
  balance: [
    'balance', 'saldo', 'running balance', 'saldo contabile', 'saldo disponibile', 'saldo finale', 'saldo progressivo', 'kontostand', 'saldo nach buchung', 'solde', 'balance after', 'balance eur', 'saldo eur',
    'closing balance', 'available balance', 'ledger balance', 'saldo apres', 'resulting balance', 'saldo resultante', 'balanco', 'balance after transaction', 'running bal', 'running bal.',
  ],
  currency: ['currency', 'valuta', 'divisa', 'devise', 'wahrung', 'moneda', 'moeda', 'munt', 'ccy', 'curr', 'currency code', 'iso currency'],
  category: [
    'category', 'categoria', 'kategorie', 'categorie', 'categoria', 'categoría', 'spending category', 'subcategory', 'sottocategoria', 'categoria spesa', 'budget category', 'tags', 'tag', 'etichetta',
  ],
  status: [
    'status', 'stato', 'state', 'contabilizzato', 'contabilizzata', 'contabilizzazione', 'booked', 'pending', 'completed', 'estado', 'statut', 'gebucht', 'buchungsstatus', 'transaction status',
    'cleared', 'posted', 'processed', 'stato operazione', 'stato movimento', 'info buchung', 'vorgemerkt',
  ],
  reference: [
    'transaction id', 'transactionid', 'id', 'transaction number', 'numero operazione', 'numero transazione', 'cro', 'trn', 'transferwise id', 'transfer id', 'wise id', 'id transazione', 'id operazione',
    'reference id', 'ref', 'ref no', 'ref number', 'id de transaccion', 'transaction ref',
    'bank reference', 'unique id', 'uuid', 'numero de operacion', 'mandate id', 'mandatsreferenz', 'kundenreferenz', 'end to end id', 'endtoend',
  ],
  fee: [
    'fee', 'fees', 'commissione', 'commissioni', 'gebuhr', 'gebuhren', 'frais', 'comision', 'comisiones', 'total fees', 'spese', 'costs', 'transaction fee', 'fee eur', 'commission', 'taxa', 'kosten',
  ],
};

const tokens = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// phrase table with its tokens, built once
const TABLE = [];
for (const [role, list] of Object.entries(PHRASES)) {
  for (const p of new Set(list)) TABLE.push({ role, words: tokens(p) });
}

const containsRun = (hay, needle) => {
  if (!needle.length || needle.length > hay.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

// words that say a heading is not what it seems, e.g. "payment type" is not an amount
const NOISE = new Set(['eur', 'euro', 'euros', 'usd', 'gbp', 'chf', 'in', 'of', 'the', 'di', 'del', 'de', 'der', 'die', 'des', 'du', 'la', 'le', 'il', 'a', 'amount', 'betrag', 'importo']);

/**
 * The role a heading suggests, with how sure that is (0 to 100), or null. Headings are matched as runs of words, the longest and most exact
 * phrase wins, so "Data valuta" is a value date although "data" alone means date.
 * `alt` is set when the heading can mean two things (Italian "Valuta": the value date or the currency); the data decides.
 */
export function headerRole(text) {
  const words = tokens(text);
  if (!words.length || words.length > 8) return null;
  let best = null;
  for (const { role, words: phrase } of TABLE) {
    const at = containsRun(words, phrase);
    if (at < 0) continue;
    let score;
    if (phrase.length === words.length) score = 100;
    else {
      const extra = words.length - phrase.length;
      const outsiders = words.filter((_w, i) => i < at || i >= at + phrase.length);
      const harmless = outsiders.every((w) => NOISE.has(w) || /^\d+$/.test(w));
      score = harmless ? 88 : at === 0 || at + phrase.length === words.length ? 70 - extra * 4 : 40 - extra * 4;
    }
    score += phrase.length * 3; // the longer phrase wins a tie
    if (!best || score > best.score) best = { role, score };
  }
  if (!best) return null;
  const joined = words.join(' ');
  const out = { role: best.role, score: Math.min(100, best.score) };
  if (joined === 'valuta') out.alt = 'valueDate';
  if (best.role === 'details' && /^(reference|riferimento|referenz|ref)$/.test(joined)) out.alt = 'reference';
  if (best.role === 'payee' && /^(name|nome|nom|naam|nombre)$/.test(joined)) out.generic = true;
  if (best.role === 'direction' && /^(type|tipo|art)$/.test(joined)) out.generic = true;
  return out;
}

/** The values that say money went out (-1) or came in (+1) in a column of kind direction, or 0 when the word says nothing about it. */
const OUT = /^(af|d|dr|db|deb|debit|debito|debet|dare|addebito|addebiti|uscita|uscite|out|outgoing|expense|spesa|soll|ausgang|sortie|egreso|saida|payment|pagamento|withdrawal|prelievo|purchase|acquisto|-|−|negative)$/;
const IN = /^(bij|c|cr|cre|cred|credit|credito|crédito|haben|avere|accredito|accrediti|entrata|entrate|in|incoming|income|deposit|versamento|eingang|entree|ingreso|entrada|received|\+|positive|refund|rimborso)$/;

export function directionOf(value) {
  const w = fold(value).replace(/[^a-z+\-−]/g, '');
  if (OUT.test(w)) return -1;
  if (IN.test(w)) return 1;
  return 0;
}

/** Does this "status" value say the line is final (+1), still pending (-1), cancelled (-2), or is it unknown (0)? */
export function statusOf(value) {
  const w = fold(value).replace(/[^a-z0-9]/g, '');
  if (!w) return 0;
  if (/^(non|not|nicht|pas|no)(contabilizzat|booked|gebucht|bucht|definitiv|final|posted|complet|processed|eseguit)/.test(w)) return -1;
  if (/^(si|yes|y|true|1|ok|booked|posted|completed|complete|done|settled|cleared|processed|gebucht|contabilizzato|contabilizzata|eseguito|eseguita|effettuato|contabilizzata)$/.test(w)) return 1;
  if (/^(no|n|false|0|pending|pendente|reserved|authorised|authorized|authorization|vorgemerkt|inelaborazione|nonprocessato|nonfinal|hold|onhold|pendiente|inprogress|scheduled|programmato)$/.test(w) || /^(pending|inattesa|incorso|insospeso|insospesa|sospes|enattente|inattesa)/.test(w)) return -1;
  if (/^(reverted|declined|cancelled|canceled|failed|rejected|annullato|annullata|stornato|stornata|rifiutato|rifiutata|abgelehnt|storniert|refused|void|returned|reversed|expired)$/.test(w)) return -2;
  return 0;
}

/** Section titles in a file (the heading above a table of a PDF, a sheet's name): pending (−1) and reverted (−2) ones are off by default. */
export function sectionKind(title) {
  const w = fold(title);
  if (/\b(pending|in sospeso|non contabilizzat|autorizzat|reserved|authoris|authoriz|in attesa|vorgemerkt|pendiente|en attente|in behandeling)/.test(w)) return 'pending';
  if (/\b(reverted|cancel|declined|failed|rejected|annullat|stornat|storniert|refused|reversed|returned)/.test(w)) return 'reverted';
  return 'booked';
}
