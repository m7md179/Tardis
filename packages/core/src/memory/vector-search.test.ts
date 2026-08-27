import { describe, it, expect } from 'bun:test';
import { leadingCluster, VECTOR_MARGIN, MAX_VECTOR_CANDIDATES } from './vector-search.js';

const c = (name: string, score: number) => ({ item: name, score });

describe('leadingCluster', () => {
  it('returns nothing for an empty field', () => {
    expect(leadingCluster([])).toEqual([]);
  });

  it('accepts a lone candidate — there is nothing to confuse it with', () => {
    expect(leadingCluster([c('only', 0.31)])).toEqual(['only']);
  });

  it('accepts a clear standout', () => {
    // Real numbers: "what did I say about the car" against a 20-memory store.
    expect(leadingCluster([c('car-savings', 0.62), c('work-project', 0.483)])).toEqual([
      'car-savings',
    ]);
  });

  it('rejects an undifferentiated field', () => {
    // "what is the capital of Peru" — nothing in the store is about Peru, and
    // the top two sit 0.006 apart. This is the case an absolute similarity
    // floor cannot catch: 0.526 is *higher* than a correct hit scored on
    // another query.
    expect(leadingCluster([c('rent', 0.526), c('gym', 0.52), c('coffee', 0.51)])).toEqual([]);
  });

  it('rejects a gap that falls just short of the margin', () => {
    expect(leadingCluster([c('a', 0.5), c('b', 0.5 - VECTOR_MARGIN + 0.001)])).toEqual([]);
  });

  it('accepts a gap comfortably past the margin', () => {
    // Not asserted *at* the boundary on purpose: 0.5 - 0.05 is not exactly
    // 0.45 in binary floating point, so `0.5 - (0.5 - VECTOR_MARGIN)` lands
    // just under the threshold. The margin came from measurement, not from
    // arithmetic, so pinning its last bit would be false precision.
    expect(leadingCluster([c('a', 0.5), c('b', 0.5 - VECTOR_MARGIN - 0.001)])).toEqual(['a']);
  });

  it('never returns more than the configured maximum', () => {
    // Two near-tied leaders then a cliff. With MAX_VECTOR_CANDIDATES at 1 the
    // cliff is out of reach, so the field counts as undifferentiated.
    const field = [c('a', 0.9), c('b', 0.89), c('c', 0.2)];
    const got = leadingCluster(field);
    expect(got.length).toBeLessThanOrEqual(MAX_VECTOR_CANDIDATES);
    expect(got).toEqual([]);
  });

  it('honours an explicit margin and max, so the constants can be retuned', () => {
    const field = [c('a', 0.9), c('b', 0.89), c('c', 0.2)];
    expect(leadingCluster(field, 0.05, 3)).toEqual(['a', 'b']);
  });

  it('reads the field in the order given, not by re-sorting', () => {
    // The caller sorts. Silently re-sorting here would hide a caller that
    // forgot to, and the bug would only surface as bad retrieval.
    expect(leadingCluster([c('low', 0.1), c('high', 0.9)])).toEqual([]);
  });
});
