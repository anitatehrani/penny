import { MONOGRAM, MONOGRAM_CENTER, STROKE, WORDMARK, WORDMARK_BOX } from '../brand/paths.js';

/** The "penny" wordmark. It takes the colour of the text around it, so it works in light and dark. Decorative: put the name next to it for screen readers. */
export function Wordmark({ height = 20, className = '' }) {
  const [x, y, w, h] = WORDMARK_BOX;
  return (
    <svg className={`wordmark ${className}`.trim()} viewBox={`${x} ${y} ${w} ${h}`} width={(height * w) / h} height={height} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {WORDMARK.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The p on a rounded square, for places too small or narrow for the whole word (the collapsed sidebar). Inverts with the theme. */
export function LogoMark({ size = 30, className = '' }) {
  const [cx, cy] = MONOGRAM_CENTER;
  return (
    <svg className={`logo-mark ${className}`.trim()} viewBox="0 0 512 512" width={size} height={size} aria-hidden="true" focusable="false">
      <rect className="logo-mark-bg" width="512" height="512" rx="116" />
      <path className="logo-mark-glyph" d={MONOGRAM} transform={`translate(256 256) scale(1.55) translate(${-cx} ${-cy})`} fill="none" strokeWidth={STROKE + 4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
