/**
 * Penny's wordmark, redrawn as strokes from the supplied artwork (docs/brand/penny-wordmark.webp) so it stays sharp at any size
 * and takes any colour. One monoline weight (STROKE) with round caps and joins, in the artwork's 1256 x 1256 coordinates.
 * Everything that shows the logo (the sidebar, the sign-in page, the favicon and app icons) is drawn from these paths.
 */
export const STROKE = 20;

/** p, e, n, n, y (the y is two strokes: the bowl, then the stem and its tail). */
export const WORDMARK = [
  'M290 725V619A56.5 55 0 1 1 346.5 674H327',
  'M475 633L543.1 604.3A55 55 0 1 0 538.6 644.3',
  'M578 673V613A50 50 0 0 1 678 613V673',
  'M718 673V614A50.5 50.5 0 0 1 819 614V673',
  'M860 563V619A53.5 55.5 0 0 0 967 619',
  'M967 563V671A60 60 0 0 1 872 720',
];

/** x, y, width, height of the ink, stroke edges included. */
export const WORDMARK_BOX = [280, 553, 697, 188];

/** The monogram is the p alone; it is centred on this point when drawn in a square. */
export const MONOGRAM = WORDMARK[0];
export const MONOGRAM_CENTER = [346.5, 644];
