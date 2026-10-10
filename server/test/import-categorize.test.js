import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bankLabel, matchKnown, memoryOf, merchantKey, merchantWords, resolveCategory, ruleKey, SURE, suggest } from '../src/lib/importCategorize.js';
import { BANK_MAP, BRANDS, INDEX, LABELS, WORDS, normalize } from '../src/lib/merchants.js';

// the categories a new Penny budget starts with
const DEFAULTS = [
  ['Salary', 'income'], ['Freelance', 'income'], ['Gifts received', 'income'], ['Other income', 'income'], ['Rent / Mortgage', 'expense'], ['Utilities', 'expense'], ['Groceries', 'expense'],
  ['Transport', 'expense'], ['Subscriptions', 'expense'], ['Installments & loans', 'expense'], ['Birthdays & gifts', 'expense'], ['Health', 'expense'], ['Dining & leisure', 'expense'], ['Other', 'expense'],
].map(([name, kind], i) => ({ id: i + 1, name, kind, color: '#000000' }));
const nothing = memoryOf([], []);
const guess = (description, type = 'expense', extra = {}, categories = DEFAULTS, memory = nothing) => suggest({ description, note: '', type, bank_category: '', ...extra }, categories, memory);
const name = (r) => r.category?.name ?? null;

describe('the merchant behind a description', () => {
  it('drops the words of the payment itself, store numbers, dates and company endings', () => {
    assert.equal(merchantKey('Pagamento POS ESSELUNGA MILANO 0123'), 'esselunga milano');
    assert.equal(merchantKey('Penny Market S.r.l.'), 'penny market');
    assert.equal(merchantKey('Dedem Spa Pv012385'), 'dedem');
    assert.equal(merchantKey('Il Fornaio'), 'fornaio');
    assert.equal(merchantKey('Card payment 12/10/2026 14:33 LIDL 528'), 'lidl');
    assert.equal(merchantKey('Bonifico disposto da INPS'), 'inps');
    assert.equal(merchantKey('Transfer to JOHN DOE'), 'john doe');
  });
  it('finds the real merchant behind a payment service and its codes', () => {
    assert.equal(merchantKey('Paypal *spotify*p478c2'), 'spotify');
    assert.equal(merchantKey('PAYPAL *NETFLIX 12345678901'), 'netflix');
    assert.equal(merchantKey('Klarna* Sklum Paris'), 'sklum paris');
    assert.equal(merchantKey('Amazon* Xy7ab12c3, 99887766550'), 'amazon');
    assert.equal(merchantKey('Www.amazon.* Zq9wx45r6, Luxembourg'), 'amazon luxembourg');
    assert.equal(merchantKey('SQ *BLUE BOTTLE COFFEE'), 'blue bottle coffee');
    assert.equal(merchantKey('Revolut**0683*'), 'revolut');
  });
  it('a rule is saved under at most two words and no trailing place', () => {
    assert.equal(ruleKey('Revolut**6004* Dublin'), 'revolut');
    assert.equal(ruleKey('Esselunga Milano via Roma'), 'esselunga');
    assert.equal(ruleKey('Autolinee Toscane Borgo San Lor'), 'autolinee toscane');
    assert.equal(ruleKey('Il Fornaio Genova'), 'fornaio');
    assert.equal(ruleKey(''), '');
    assert.equal(ruleKey(null), '');
    assert.deepEqual(merchantWords('12345 6789'), []);
  });
});

describe('what is built in', () => {
  it('the dictionary is large and every label it uses exists', () => {
    assert.ok([...INDEX.brandIndex.values()].flat().length > 800);
    assert.ok(BANK_MAP.size > 250);
    for (const label of [...Object.keys(BRANDS), ...Object.keys(WORDS), ...[...BANK_MAP.values()].filter(Boolean)]) assert.ok(LABELS[label], `unknown label ${label}`);
  });
  it('brands and words are found whole, not as a piece of a bigger word', () => {
    assert.equal(matchKnown('ESSELUNGA MILANO')?.label, 'groceries');
    assert.equal(matchKnown('Barcelona airport shuttle')?.label !== 'dining', true, '"bar" inside Barcelona is not a bar');
    assert.equal(matchKnown('ZARAGOZA'), null, '"zara" inside Zaragoza is not Zara');
    assert.equal(matchKnown('H&M Hennes & Mauritz')?.label, 'clothing');
  });
  it('the longer name wins over the shorter one inside it', () => {
    assert.equal(matchKnown('UBER EATS HELP.UBER.COM')?.label, 'dining');
    assert.equal(matchKnown('UBER TRIP')?.label, 'transport');
    assert.equal(matchKnown('AMAZON PRIME VIDEO')?.label, 'subscriptions');
    assert.equal(matchKnown('AMAZON MKTP IT')?.label, 'shopping');
    assert.equal(matchKnown('ENI PLENITUDE SPA')?.label, 'utilities');
    assert.equal(matchKnown('ENI STATION 1234')?.label, 'transport');
    assert.equal(matchKnown('Apple.com/bill')?.label, 'subscriptions');
  });
  it('bank categories in several languages', () => {
    assert.equal(bankLabel('Generi alimentari e supermercato'), 'groceries');
    assert.equal(bankLabel('Ristoranti e bar'), 'dining');
    assert.equal(bankLabel('Rate Mutuo e Finanziamento'), 'loans');
    assert.equal(bankLabel('Imposte, bolli e commissioni'), 'fees');
    assert.equal(bankLabel('Hi-tech e informatica'), 'shopping');
    assert.equal(bankLabel('Lebensmittel'), 'groceries');
    assert.equal(bankLabel('Restaurants'), 'dining');
    assert.equal(bankLabel('Altre uscite'), null, 'the bank says nothing');
    assert.equal(bankLabel('Addebiti vari'), null);
    assert.equal(bankLabel(''), undefined);
    assert.equal(bankLabel('A category nobody has heard of'), undefined);
  });
});

describe('the examples people expect', () => {
  const cases = [
    ['Esselunga', 'Groceries'], ['ESSELUNGA SPA 0123 MILANO', 'Groceries'], ['Coop Alleanza 3.0', 'Groceries'], ['Penny Market S.r.l.', 'Groceries'], ['Il Fornaio', 'Groceries'], ['Dedem Spa Pv012385', 'Groceries'], ['Panificio Randazzo', 'Groceries'],
    ['Netflix', 'Subscriptions'], ['Paypal *spotify*p478c2', 'Subscriptions'], ['Anthropic* Claude Sub', 'Subscriptions'], ['APPLE.COM/BILL', 'Subscriptions'],
    ['Uber *trip', 'Transport'], ['Lime*prime N675 Milan', 'Transport'], ['Autolinee Toscane Borgo San Lor', 'Transport'], ['Trenitalia 4523', 'Transport'], ['ENI STATION', 'Transport'], ['FlixBus', 'Transport'],
    ['Enel Energia', 'Utilities'], ['Prodotti Servizi Windtre', 'Utilities'], ['Vodafone Italia', 'Utilities'],
    ['Deliveroo', 'Dining & leisure'], ['Autogrill 0373', 'Dining & leisure'], ['Pizzeria Da Mario', 'Dining & leisure'], ["McDonald's 1234", 'Dining & leisure'],
    ['Farmacia Comunale', 'Health'], ['Agos Ducato spa rata', 'Installments & loans'],
  ];
  for (const [text, want] of cases) {
    it(`${text} is ${want}`, () => assert.equal(name(guess(text)), want));
  }
  it('names the budget does not have a category for become new categories, with the standard name', () => {
    const z = guess('ZARA ITALIA SRL');
    assert.deepEqual([z.category.name, z.category.isNew, z.category.id], ['Clothing', true, null]);
    assert.equal(guess('Booking.com Amsterdam').category.name, 'Travel');
    assert.equal(guess('Amazon Mktp IT').category.name, 'Shopping');
    assert.equal(guess('Prelievo BANCOMAT Su Banche Del Gruppo').category.name, 'Cash');
    assert.equal(guess('Commissioni E Spese Adue').category.name, 'Bank fees');
    assert.equal(guess('Bonifico istantaneo disposto da Mario').category.name, 'Transfers');
  });
  it('and use the budget\'s own category when it has one under another name', () => {
    const own = [...DEFAULTS, { id: 50, name: 'Fashion', kind: 'expense' }, { id: 51, name: 'Eating out', kind: 'expense' }];
    assert.equal(guess('Zara', 'expense', {}, own).category.id, 50);
    assert.equal(guess('Deliveroo', 'expense', {}, own).category.name, 'Dining & leisure', 'the first alias that exists wins');
    assert.equal(resolveCategory('dining', 'expense', [{ id: 9, name: 'Eating out', kind: 'expense' }]).id, 9);
  });
  it('an income label never lands in an expense category', () => {
    const r = guess('Stipendio ACME SPA', 'income');
    assert.deepEqual([r.category.name, r.category.kind], ['Salary', 'income']);
    const refund = guess('Esselunga', 'income');
    assert.equal(refund.category.kind, 'income');
    assert.equal(refund.review, 'check', 'money coming in where you usually spend is worth a look');
    const inps = guess('Bonifico disposto da INPS', 'income');
    assert.equal(inps.category.name, 'Other income', 'INPS pays benefits and pensions; the budget has no Benefits category, so its Other income is used');
    assert.equal(guess('Bonifico disposto da INPS', 'income', {}, DEFAULTS.filter((c) => c.name !== 'Other income')).category.name, 'Benefits');
  });
});

describe('how sure Penny is', () => {
  it('a well-known name is sure, a common word is less sure, a weak sign is checked', () => {
    assert.equal(guess('Esselunga').review, null);
    assert.ok(guess('Esselunga').confidence >= SURE);
    assert.equal(guess('Pizza Da Asporto').review, null);
    assert.equal(guess('Bar Centrale').review, 'check', '"bar" alone is a weak sign');
    assert.equal(guess('Metro 12').review, 'check');
  });
  it('no idea at all is marked, not guessed', () => {
    const r = guess('Bianchi Mario');
    assert.deepEqual([r.category, r.review, r.source], [null, 'none', null]);
    assert.match(r.reason, /no idea|Pick a category/i);
  });
  it('transfers are always worth a look and are marked as such', () => {
    const r = guess('Transfer to JOHN DOE');
    assert.deepEqual([r.transfer, r.review, r.category.name], [true, 'check', 'Transfers']);
    assert.equal(guess('To pocket EUR Holiday').transfer, true);
    assert.equal(guess('Apple Pay deposit by *1010', 'income').transfer, true);
    assert.equal(guess('Revolut**0683*').transfer, true);
  });
  it('the bank\'s own category helps when the name is unknown, and agrees or disagrees with a known one', () => {
    const only = guess('Bianchi Mario', 'expense', { bank_category: 'Generi alimentari e supermercato' });
    assert.deepEqual([only.category.name, only.source, only.review], ['Groceries', 'bank', 'check']);
    const agree = guess('Il Fornaio', 'expense', { bank_category: 'Generi alimentari e supermercato' });
    assert.ok(agree.confidence > guess('Il Fornaio').confidence || agree.confidence >= 0.9);
    const clash = guess('Zara', 'expense', { bank_category: 'Cura della persona' });
    assert.equal(clash.category.name, 'Clothing');
    assert.equal(clash.review, 'check', 'a well-known name that the bank files elsewhere is checked');
    assert.equal(guess('Bianchi Mario', 'expense', { bank_category: 'Altre uscite' }).review, 'none');
  });
});

describe('what the person taught Penny comes first', () => {
  const rules = [{ merchant_key: 'esselunga', kind: 'expense', category_id: 14, hits: 1 }, { merchant_key: 'bianchi mario', kind: 'expense', category_id: 7, hits: 3 }];
  const memory = memoryOf(rules, []);
  it('overrules the built-in knowledge', () => {
    const r = guess('Pagamento POS ESSELUNGA MILANO 0123', 'expense', {}, DEFAULTS, memory);
    assert.deepEqual([r.category.name, r.source, r.review, r.confidence], ['Other', 'learned', null, 0.98]);
  });
  it('knows a merchant the dictionary has never heard of', () => {
    assert.equal(name(guess('Bianchi Mario', 'expense', {}, DEFAULTS, memory)), 'Groceries');
  });
  it('a rule is for one kind: money coming in from the same name is not caught by it', () => {
    assert.notEqual(guess('Esselunga', 'income', {}, DEFAULTS, memory).source, 'learned');
  });
  it('a rule whose category is gone, or of the wrong kind, is ignored', () => {
    const gone = memoryOf([{ merchant_key: 'zara', kind: 'expense', category_id: 999, hits: 1 }], []);
    assert.equal(guess('Zara', 'expense', {}, DEFAULTS, gone).source, 'known');
  });
});

describe('what the person\'s own earlier payments say', () => {
  const history = (n, category_id, description = 'Il Fornaio Genova') => Array.from({ length: n }, () => ({ description, type: 'expense', category_id }));
  it('uses the category they always chose for a merchant', () => {
    const r = guess('Il Fornaio', 'expense', {}, DEFAULTS, memoryOf([], history(3, 13)));
    assert.deepEqual([r.category.name, r.source, r.review], ['Dining & leisure', 'history', null]);
  });
  it('one earlier payment is only a hint, and a split history is not trusted', () => {
    const once = guess('Il Fornaio', 'expense', {}, DEFAULTS, memoryOf([], history(1, 13)));
    assert.deepEqual([once.source, once.review], ['history', 'check']);
    const split = guess('Il Fornaio', 'expense', {}, DEFAULTS, memoryOf([], [...history(1, 13), ...history(1, 7)]));
    assert.equal(split.source, 'known');
  });
  it('is below what the person taught directly', () => {
    const both = guess('Il Fornaio', 'expense', {}, DEFAULTS, memoryOf([{ merchant_key: 'fornaio', kind: 'expense', category_id: 7, hits: 1 }], history(3, 13)));
    assert.equal(both.source, 'learned');
  });
  it('payments without a category teach nothing', () => {
    const r = guess('Il Fornaio', 'expense', {}, DEFAULTS, memoryOf([], history(5, null)));
    assert.equal(r.source, 'known');
  });
});

describe('matching a label to the budget\'s categories', () => {
  it('finds an existing category by name, ignoring case and accents', () => {
    assert.equal(resolveCategory('groceries', 'expense', [{ id: 1, name: 'GROCERIES', kind: 'expense' }]).id, 1);
    assert.equal(resolveCategory('transport', 'expense', [{ id: 1, name: 'Trasporti', kind: 'expense' }]).id, 1);
  });
  it('only among categories of the right kind', () => {
    const r = resolveCategory('transfers', 'income', [{ id: 1, name: 'Transfers', kind: 'expense' }]);
    assert.deepEqual([r.id, r.isNew, r.kind], [null, true, 'income']);
  });
  it('an unknown label is nothing', () => {
    assert.equal(resolveCategory('no-such-label', 'expense', DEFAULTS), null);
    assert.equal(normalize('Märkte & Co.'), 'markte co');
  });
});
