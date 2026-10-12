// Small fuzzy matcher for the command palette.
// A query matches when its letters appear in order in the text ("adpay" finds "Add payment").
// Better matches (letters together, at the start of words, early in the text) score higher.

const isWordStart = (text, i) => i === 0 || !/[a-z0-9]/i.test(text[i - 1]);

/** Best way to lay `query` over `text`; null when it does not fit. Returns { score, indexes }. */
export function fuzzyMatch(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, indexes: [] };
  const tt = text.toLowerCase();
  if (q.length > tt.length) return null;

  // best[i][j]: best score with q[i] matched at t[j]; from[i][j]: where q[i-1] was matched
  const n = q.length;
  const m = tt.length;
  const best = Array.from({ length: n }, () => new Array(m).fill(-Infinity));
  const from = Array.from({ length: n }, () => new Array(m).fill(-1));
  for (let j = 0; j < m; j++) {
    if (tt[j] !== q[0]) continue;
    best[0][j] = 10 + (isWordStart(text, j) ? 8 : 0) + (j === 0 ? 6 : 0) - Math.min(j, 12) * 0.3;
  }
  for (let i = 1; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (tt[j] !== q[i]) continue;
      for (let k = i - 1; k < j; k++) {
        if (best[i - 1][k] === -Infinity) continue;
        const gap = j - k - 1;
        const score = best[i - 1][k] + 10 + (gap === 0 ? 9 : -Math.min(gap, 8) * 0.8) + (isWordStart(text, j) ? 8 : 0);
        if (score > best[i][j]) {
          best[i][j] = score;
          from[i][j] = k;
        }
      }
    }
  }
  let end = -1;
  let top = -Infinity;
  for (let j = 0; j < m; j++) {
    if (best[n - 1][j] > top) {
      top = best[n - 1][j];
      end = j;
    }
  }
  if (end < 0) return null;
  const indexes = new Array(n);
  for (let i = n - 1, j = end; i >= 0; i--) {
    indexes[i] = j;
    j = from[i][j];
  }
  return { score: top - m * 0.05, indexes }; // among equals, the shorter text wins
}

/** Match against a label first, then against hidden keywords (which score lower and highlight nothing). */
export function matchItem(query, item) {
  if (!query.trim()) return { score: 0, indexes: [] };
  const direct = fuzzyMatch(query, item.label);
  if (direct) return { ...direct, score: direct.score + 6 };
  if (item.keywords) {
    const viaWords = fuzzyMatch(query, item.keywords);
    if (viaWords) return { score: viaWords.score - 4, indexes: [] };
  }
  return null;
}

/** Filter and rank items for a query; with no query, the original order is kept. */
export function rank(query, items) {
  if (!query.trim()) return items.map((item) => ({ item, indexes: [] }));
  return items
    .map((item) => ({ item, match: matchItem(query, item) }))
    .filter((r) => r.match)
    .sort((a, b) => b.match.score - a.match.score)
    .map((r) => ({ item: r.item, indexes: r.match.indexes }));
}
