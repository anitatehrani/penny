import { N_, t } from './i18n.js';
// Can new people sign up? (docs/DESIGN.md section 34.) SIGNUPS=closed lets Penny go online for the people who already have an account
// (you and your family) before it is opened to everyone. Anything else, or nothing, means open. Read at each request, so a restart applies it.
export const signupsOpen = () => String(process.env.SIGNUPS ?? 'open').trim().toLowerCase() !== 'closed';
export const SIGNUPS_CLOSED = N_('Sign-ups are closed for now.');
