// How a person is shown when they have no picture: initials on a colour that is theirs alone.

/** Same person, same colour everywhere (8 tones that keep the initials readable in both themes). */
export const avatarTone = (key = '') => {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
};

/** "Alex Morgan" -> "AM", "Sam" -> "S", "  " -> "". */
export const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
