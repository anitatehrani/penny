import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './hooks.js';

/**
 * Shows a number that eases to its new value instead of jumping (about 400 ms), so a payment that changes
 * the balance is noticed. `format` turns the number into text. With reduced motion it simply switches.
 */
export function AnimatedNumber({ value, format, duration = 420 }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced || !Number.isFinite(value) || !Number.isFinite(from.current)) {
      from.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const origin = from.current;
    const tick = (now) => {
      const tt = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - tt) ** 3;
      const v = origin + (value - origin) * eased;
      from.current = v;
      setShown(v);
      if (tt < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, reduced, duration]);

  return <>{format(shown)}</>;
}
