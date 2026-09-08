import { describe, it, expect } from 'bun:test';
import { logBranchTime } from './branch-time.js';
import type { TimeDeps } from './branch-time.js';
import { branchKey, newRecord } from './branch.js';
import type { BranchRecord } from './branch.js';

function linked(repo: string, branch: string, itemId: number): BranchRecord {
  return {
    ...newRecord(repo, branch, 'main', '2026-09-01T00:00:00.000Z'),
    state: 'created',
    itemId,
  };
}

interface Harness {
  deps: TimeDeps;
  store: Map<string, unknown>;
  written: { itemId: number; seconds: number; date: string; note: string | undefined }[];
  deleted: { itemId: number; entryId: number }[];
}

function harness(records: BranchRecord[]): Harness {
  const store = new Map<string, unknown>();
  for (const r of records) store.set(branchKey(r.repoFullName, r.branch), r);
  const written: Harness['written'] = [];
  const deleted: Harness['deleted'] = [];

  return {
    store,
    written,
    deleted,
    deps: {
      storage: {
        get: async <T>(k: string): Promise<T | null> => (store.get(k) as T) ?? null,
        set: async (k: string, v: unknown): Promise<void> => void store.set(k, v),
      },
      client: {
        createTimeEntry: async (itemId, e) => {
          written.push({ itemId, seconds: e.seconds, date: e.logged_date, note: e.note });
          return { id: 500 + written.length };
        },
        deleteTimeEntry: async (itemId, entryId) => void deleted.push({ itemId, entryId }),
      },
      logger: { debug: (): void => {}, warn: (): void => {} },
    },
  };
}

const ALLOCS = [
  { repoFullName: 'org/a', branch: 'feat/x', seconds: 7200 },
  { repoFullName: 'org/a', branch: 'feat/y', seconds: 3600 },
];

describe('logBranchTime', () => {
  it('writes one entry per branch, against its linked item', async () => {
    const h = harness([linked('org/a', 'feat/x', 11), linked('org/a', 'feat/y', 22)]);

    const out = await logBranchTime(h.deps, { date: '2026-09-07', allocations: ALLOCS });

    expect(out.logged).toBe(2);
    expect(h.written).toEqual([
      { itemId: 11, seconds: 7200, date: '2026-09-07', note: 'branch feat/x' },
      { itemId: 22, seconds: 3600, date: '2026-09-07', note: 'branch feat/y' },
    ]);
  });

  it('reports a branch with no work item instead of silently dropping its time', async () => {
    // Time attributed to a branch nobody linked is time that vanishes. Saying
    // so is the difference between an under-count and an invisible one.
    const h = harness([linked('org/a', 'feat/x', 11)]);

    const out = await logBranchTime(h.deps, { date: '2026-09-07', allocations: ALLOCS });

    expect(out.logged).toBe(1);
    expect(out.unlinked).toEqual([{ repoFullName: 'org/a', branch: 'feat/y', seconds: 3600 }]);
  });

  it('refuses to log the same day twice', async () => {
    // Re-running must never append a second day's worth to the same date.
    const h = harness([linked('org/a', 'feat/x', 11)]);
    await logBranchTime(h.deps, { date: '2026-09-07', allocations: [ALLOCS[0]!] });
    const before = h.written.length;

    const out = await logBranchTime(h.deps, { date: '2026-09-07', allocations: [ALLOCS[0]!] });

    expect(out.logged).toBe(0);
    expect(out.alreadyLogged).toBe(true);
    expect(h.written).toHaveLength(before);
  });

  it('replaces a day when asked, deleting what it wrote before', async () => {
    const h = harness([linked('org/a', 'feat/x', 11)]);
    await logBranchTime(h.deps, { date: '2026-09-07', allocations: [ALLOCS[0]!] });

    const out = await logBranchTime(h.deps, {
      date: '2026-09-07',
      allocations: [{ repoFullName: 'org/a', branch: 'feat/x', seconds: 1800 }],
      replace: true,
    });

    expect(h.deleted).toEqual([{ itemId: 11, entryId: 501 }]);
    expect(out.logged).toBe(1);
    expect(h.written[h.written.length - 1]!.seconds).toBe(1800);
  });

  it('never writes a zero or negative entry', async () => {
    const h = harness([linked('org/a', 'feat/x', 11)]);
    const out = await logBranchTime(h.deps, {
      date: '2026-09-07',
      allocations: [{ repoFullName: 'org/a', branch: 'feat/x', seconds: 0 }],
    });
    expect(out.logged).toBe(0);
    expect(h.written).toHaveLength(0);
  });

  it('keeps the day recorded even when one item rejects its entry', async () => {
    const h = harness([linked('org/a', 'feat/x', 11), linked('org/a', 'feat/y', 22)]);
    h.deps.client.createTimeEntry = async (itemId, e) => {
      if (itemId === 11) throw new Error('item is archived');
      h.written.push({ itemId, seconds: e.seconds, date: e.logged_date, note: e.note });
      return { id: 999 };
    };

    const out = await logBranchTime(h.deps, { date: '2026-09-07', allocations: ALLOCS });

    expect(out.logged).toBe(1);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]!.branch).toBe('feat/x');
  });
});
