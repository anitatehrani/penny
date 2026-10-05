/**
 * A focused <input type="number"> changes its value when the mouse wheel or a trackpad scroll passes over it, so scrolling a form
 * with the cursor over the amount quietly turns 100 into 99 or 101. The fix is to let go of the field when a wheel event happens
 * on it: the page then scrolls as expected and the number is left alone. (Typing and the arrow keys still work as usual.)
 */

/** Whether a wheel event on `target` would change a number: it is a number box and it has focus. */
export function wheelWouldChangeNumber(target, active) {
  return !!target && target === active && String(target.tagName).toUpperCase() === 'INPUT' && String(target.type).toLowerCase() === 'number';
}

/** Start letting go of a focused number box on wheel, anywhere in the page. Returns a function that stops it. */
export function installNumberWheelGuard(doc = document) {
  const onWheel = (e) => {
    if (wheelWouldChangeNumber(e.target, doc.activeElement)) e.target.blur();
  };
  doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return () => doc.removeEventListener('wheel', onWheel, { capture: true });
}
