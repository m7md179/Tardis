import { describe, it, expect } from 'bun:test';
import { fuzzyScore, fuzzyFind, fuzzyFindOne } from './fuzzy-match.js';

describe('fuzzyScore', () => {
  it('returns 1 for exact match', () => {
    expect(fuzzyScore('hello', 'hello')).toBe(1);
  });

  it('returns 0.9 for substring match', () => {
    expect(fuzzyScore('ell', 'hello')).toBe(0.9);
  });

  it('returns 0 when not all needle chars are found', () => {
    expect(fuzzyScore('xyz', 'hello')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('HELLO', 'hello')).toBe(1);
    expect(fuzzyScore('Hello', 'HELLO')).toBe(1);
  });

  it('returns a positive score for a partial fuzzy match', () => {
    const score = fuzzyScore('hlo', 'hello');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('fuzzyFind', () => {
  const tasks = ['Write documentation', 'Fix login bug', 'Add unit tests', 'Write unit tests'];

  it('returns items above threshold sorted by score', () => {
    const results = fuzzyFind('write', tasks, (t) => t);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results.at(-1)!.score);
  });

  it('excludes items below threshold', () => {
    const results = fuzzyFind('zzz', tasks, (t) => t);
    expect(results).toHaveLength(0);
  });

  it('works with object items via toString', () => {
    const items = [{ name: 'Alpha task' }, { name: 'Beta task' }, { name: 'Gamma work' }];
    const results = fuzzyFind('task', items, (i) => i.name);
    expect(results.every((r) => r.item.name.toLowerCase().includes('task'))).toBe(true);
  });
});

describe('fuzzyFindOne', () => {
  const tasks = ['Buy groceries', 'Buy milk', 'Call dentist'];

  it('returns the best match', () => {
    const result = fuzzyFindOne('buy', tasks, (t) => t);
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain('buy');
  });

  it('returns null when no match meets threshold', () => {
    const result = fuzzyFindOne('zzzz', tasks, (t) => t);
    expect(result).toBeNull();
  });
});
