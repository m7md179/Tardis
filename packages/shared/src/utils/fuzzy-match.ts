/**
 * Fuzzy string matching — used for task name matching in plugins like Todoist.
 * Returns a score between 0 (no match) and 1 (exact match).
 */
export function fuzzyScore(needle: string, haystack: string): number {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();

  if (h === n) return 1;
  if (h.includes(n)) return 0.9;

  let ni = 0;
  let matched = 0;

  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (h[hi] === n[ni]) {
      matched++;
      ni++;
    }
  }

  if (ni < n.length) return 0; // not all needle chars found

  return (matched / h.length) * 0.8;
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

/**
 * Find the best fuzzy match from a list of items.
 * @param needle - search string
 * @param items - list of items to search
 * @param toString - convert item to searchable string
 * @param threshold - minimum score to include (0–1, default 0.3)
 */
export function fuzzyFind<T>(
  needle: string,
  items: T[],
  toString: (item: T) => string,
  threshold = 0.3,
): FuzzyMatch<T>[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(needle, toString(item)) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Return the single best match, or null if nothing meets the threshold.
 */
export function fuzzyFindOne<T>(
  needle: string,
  items: T[],
  toString: (item: T) => string,
  threshold = 0.3,
): T | null {
  const results = fuzzyFind(needle, items, toString, threshold);
  return results[0]?.item ?? null;
}
