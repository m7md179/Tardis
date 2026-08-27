/**
 * Deciding when a vector result is worth believing.
 *
 * The obvious gate is an absolute similarity floor, and it does not work. From
 * a real measurement against nomic-embed-text over 20 memories, 15 questions
 * the store could answer and 12 it could not:
 *
 *   "what am I coding"            → correct memory at 0.526
 *   "what is the capital of Peru" → nearest (irrelevant) memory at 0.526
 *
 * The distributions overlap exactly. Any floor admitting the true hit admits
 * the junk. What separates them is not the score but the **gap** to the runner
 * up:
 *
 *   relevant queries, gap to 2nd:  0.021 … 0.316   (median 0.114)
 *   unanswerable queries, gap:     0.000 … 0.123   (median 0.024)
 *
 * So the test is whether one memory stands clearly apart from the field. When
 * nothing stands out, the vector signal is uninformative for this query and
 * contributes nothing — which is the behaviour that keeps "hello" from
 * dredging up a memory about rent.
 */

/**
 * How far ahead of the next candidate a result must be to count as
 * distinguished. Chosen from the table above:
 *
 *   0.03 → surfaces 14/15, admits 5/12 noise
 *   0.05 → surfaces 12/15, admits 1/12 noise   ← here
 *   0.08 → surfaces 11/15, admits 1/12 noise
 *
 * 0.05 is the knee: below it precision collapses, above it recall bleeds for
 * nothing. Keyword search already covers literal matches, so the vector half
 * exists purely to catch paraphrase and should be the conservative half.
 */
export const VECTOR_MARGIN = 0.05;

/**
 * How many results the leading cluster may contain before we conclude that
 * nothing is distinguished.
 *
 * One, on the same evidence: at MAX=3 the measurement surfaces 13/15 rather
 * than 12/15 but admits three times the noise. The data supports recognising a
 * single standout, and nothing stronger. Raising this needs new measurements,
 * not an intuition.
 */
export const MAX_VECTOR_CANDIDATES = 1;

export interface VectorCandidate<T> {
  item: T;
  score: number;
}

/**
 * The leading cluster of a descending-sorted candidate list: everything before
 * the first gap of at least `margin`. Returns an empty array when no such gap
 * appears within `max`, meaning the field is undifferentiated.
 *
 * A single candidate is trivially distinguished — there is nothing for it to be
 * confused with.
 */
export function leadingCluster<T>(
  candidates: VectorCandidate<T>[],
  margin: number = VECTOR_MARGIN,
  max: number = MAX_VECTOR_CANDIDATES
): T[] {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [candidates[0]!.item];

  const limit = Math.min(max, candidates.length - 1);
  for (let i = 0; i < limit; i++) {
    if (candidates[i]!.score - candidates[i + 1]!.score >= margin) {
      return candidates.slice(0, i + 1).map((c) => c.item);
    }
  }
  return [];
}
