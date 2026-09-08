import { describe, it, expect } from 'bun:test';
import { activityKey, recordActivity, readActivity } from './activity.js';

function store(): {
  get: <T>(k: string) => Promise<T | null>;
  set: (k: string, v: unknown) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
  map: Map<string, unknown>;
} {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async <T>(k: string): Promise<T | null> => (map.get(k) as T) ?? null,
    set: async (k: string, v: unknown): Promise<void> => void map.set(k, v),
    list: async (prefix: string): Promise<string[]> =>
      [...map.keys()].filter((k) => k.startsWith(prefix)),
  };
}

// 2026-09-07 09:30 and 10:15 UTC
const T0 = Math.floor(Date.parse('2026-09-07T09:30:00Z') / 1000);
const T1 = Math.floor(Date.parse('2026-09-07T10:15:00Z') / 1000);

describe('recordActivity', () => {
  it('files each commit under the day it was authored', async () => {
    const s = store();
    await recordActivity(s, 'org/a', 'feat/x', [
      { sha: 'a1', at: T0 },
      { sha: 'a2', at: T1 },
    ]);

    const day = await readActivity(s, '2026-09-07');
    expect(day).toHaveLength(2);
    expect(day[0]!.branch).toBe('feat/x');
    expect(s.map.has(activityKey('2026-09-07'))).toBe(true);
  });

  it('is idempotent per commit, so re-pushing a branch does not double its day', async () => {
    // pre-push sends every commit on the branch each time, so the same sha
    // arrives again on the next push. Counting it twice would inflate the
    // very number this exists to keep honest.
    const s = store();
    await recordActivity(s, 'org/a', 'feat/x', [{ sha: 'a1', at: T0 }]);
    await recordActivity(s, 'org/a', 'feat/x', [
      { sha: 'a1', at: T0 },
      { sha: 'a2', at: T1 },
    ]);

    expect(await readActivity(s, '2026-09-07')).toHaveLength(2);
  });

  it('ignores a commit with no timestamp rather than filing it under today', async () => {
    const s = store();
    await recordActivity(s, 'org/a', 'feat/x', [{ sha: 'a1' }]);
    expect(await readActivity(s, '2026-09-07')).toHaveLength(0);
  });

  it('splits a push that spans midnight across both days', async () => {
    const s = store();
    const late = Math.floor(Date.parse('2026-09-07T23:50:00Z') / 1000);
    const early = Math.floor(Date.parse('2026-09-08T00:10:00Z') / 1000);
    await recordActivity(s, 'org/a', 'feat/x', [
      { sha: 'a1', at: late },
      { sha: 'a2', at: early },
    ]);

    expect(await readActivity(s, '2026-09-07')).toHaveLength(1);
    expect(await readActivity(s, '2026-09-08')).toHaveLength(1);
  });

  it('keeps branches of the same name in different repos apart', async () => {
    const s = store();
    await recordActivity(s, 'org/a', 'fix/x', [{ sha: 'a1', at: T0 }]);
    await recordActivity(s, 'org/b', 'fix/x', [{ sha: 'b1', at: T1 }]);

    const day = await readActivity(s, '2026-09-07');
    expect(new Set(day.map((c) => c.repoFullName)).size).toBe(2);
  });
});
