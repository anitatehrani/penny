/**
 * The terms and the privacy policy (docs/DESIGN.md section 36).
 *
 * TERMS_VERSION is the date the text of the two pages (client/src/pages/Legal.jsx) last changed in a way people should be asked about
 * again. A person who accepted an older version, or none, is asked once. Change it only together with the pages.
 */
export const TERMS_VERSION = '2026-10-10';

const clean = (v) => {
  const tt = String(v ?? '').trim();
  return tt || null;
};

/** Who runs this site and how to reach them, shown on the two pages. Set OPERATOR_NAME and CONTACT_EMAIL in .env. */
export const legalConfig = () => ({
  operatorName: clean(process.env.OPERATOR_NAME),
  contactEmail: clean(process.env.CONTACT_EMAIL),
  termsVersion: TERMS_VERSION,
});
