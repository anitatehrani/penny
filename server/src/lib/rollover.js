/**
 * Which purchases of a card bill roll over to a later bill when only part of it is paid (docs/DESIGN.md section 25).
 * `items` are the payments that can move, newest purchase first: { id, cents }. `restCents` is how much leaves this bill.
 * A payment that fits in what is left of the rest moves whole; the one that straddles the line is split (`cents` is the part that
 * moves, the remainder stays). Returns the steps, and `short`: the cents that could not be placed because too little can move.
 */
export function planRollover(items, restCents) {
  let left = Math.max(0, Math.floor(restCents));
  const steps = [];
  for (const it of items) {
    if (left <= 0) break;
    if (it.cents <= left) {
      steps.push({ id: it.id, action: 'move', cents: it.cents });
      left -= it.cents;
    } else {
      steps.push({ id: it.id, action: 'split', cents: left });
      left = 0;
    }
  }
  return { steps, short: left };
}
