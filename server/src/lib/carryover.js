/**
 * Cents carried into `month` ('YYYY-MM'). `netCents` maps each month with payments to its income less expenses, in cents.
 * leftover(m) = max(0, carried into m + net(m)); the first month has nothing carried in. Only money is carried, never a shortfall.
 * A month with no payments changes nothing, so only the months that have payments are visited, however far apart they are.
 */
export function carriedInto(netCents, month) {
  let left = 0;
  for (const m of Object.keys(netCents).sort()) {
    if (m >= month) break;
    left = Math.max(0, left + netCents[m]);
  }
  return left;
}
