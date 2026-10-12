// The categories every new budget starts with, and the ones a bank-statement import can create (lib/accounts.js). They are stored in English; where the server writes them into a sentence they go
// through catName(), so an Italian reader gets "Spesa" for "Groceries". A category somebody made up themselves comes out exactly as they wrote it.
import { N_, t } from './i18n.js';

export const DEFAULT_CATEGORY_NAMES = [
  N_('Salary'),
  N_('Freelance'),
  N_('Gifts received'),
  N_('Other income'),
  N_('Rent / Mortgage'),
  N_('Utilities'),
  N_('Groceries'),
  N_('Transport'),
  N_('Subscriptions'),
  N_('Installments & loans'),
  N_('Birthdays & gifts'),
  N_('Health'),
  N_('Dining & leisure'),
  N_('Other'),
  N_('Restaurants'),
  N_('Clothing'),
  N_('Shopping'),
  N_('Fitness'),
  N_('Personal care'),
  N_('Entertainment'),
  N_('Travel'),
  N_('Insurance'),
  N_('Education'),
  N_('Gifts'),
  N_('Home'),
  N_('Pets'),
  N_('Kids'),
  N_('Donations'),
  N_('Bank fees'),
  N_('Taxes'),
  N_('Cash'),
  N_('Transfers'),
  N_('Benefits'),
  N_('Refunds'),
  N_('Interest'),
  N_('Uncategorized'),
];

/** The name to write for a category name that came from the budget. */
export const catName = (name) => (name ? t(name) : name);
