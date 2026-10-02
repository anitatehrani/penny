import { useId } from 'react';

/**
 * A small label for an icon-only control. Pure CSS (shown on hover and keyboard focus), so it costs nothing
 * and never traps focus. The control it wraps must still have its own accessible name (aria-label).
 * `side`: where the label appears ('top' | 'right' | 'bottom').
 */
export function Tooltip({ label, side = 'top', children, disabled }) {
  const id = useId();
  const show = !disabled && !!label;
  return (
    <span className={`tip-wrap tip-${side}`}>
      {children}
      {show && (
        <span className="tip" role="tooltip" id={id}>
          {label}
        </span>
      )}
    </span>
  );
}
