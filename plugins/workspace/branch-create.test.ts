import { describe, it, expect } from 'bun:test';
import { createFromBranch } from './branch-create.js';
import type { CreateDeps } from './branch-create.js';
import { branchKey, newRecord } from './branch.js';
import type { BranchRecord } from './branch.js';
import type { WorkItem } from './types.js';

function story(id: number, title: string): WorkItem {
  return {
    id,
    workspace_id: 1,
    type: 'STORY',
    title,
    description: null,
    status: 'BACKLOG',
    priority: 'MEDIUM',
    story_points: null,
    estimate_hours: null,
    start_date: null,
    due_date: null,
    parent_id: null,
    sprint_id: null,
    reporter_account_id: 1,
    assignees: [],
    archived_at: null,
  };
}

const CONFIG = {
  workspaceId: 1,
  defaultEpicId: 80,
  dueDateOffsetDays: 7,
  defaultPriority: 'MEDIUM' as const,
  draftTtlDays: 14,
};

interface Harness {
  deps: CreateDeps;
  store: Map<string, unknown>;
  created: Record<string, unknown>[];
  links: { itemId: number; url: string }[];
  notes: string[];
}

function harness(over: Partial<CreateDeps> = {}, seed?: BranchRecord): Harness {
  const store = new Map<string, unknown>();
  if (seed) store.set(branchKey(seed.repoFullName, seed.branch), seed);
  const created: Record<string, unknown>[] = [];
  const links: { itemId: number; url: string }[] = [];
  const notes: string[] = [];

  const deps: CreateDeps = {
    storage: {
      get: async <T,>(k: string): Promise<T | null> => (store.get(k) as T) ?? null,
      set: async (k: string, v: unknown): Promise<void> => void store.set(k, v),
    },
    client: {
      createItem: async (_wid, payload) => {
        created.push(payload);
        return { ...story(900, String(payload['title'])), ...payload, id: 900 } as WorkItem;
      },
      registerGitLink: async (itemId, url) => {
        links.push({ itemId, url });
        return { id: 5 };
      },
    },
    listStories: async () => [story(12, 'Task Management Websit')],
    compose: async () => ({ title: 'Composed title', description: 'Composed description' }),
    rank: async () => [{ id: 12, title: 'Task Management Websit', reason: 'matches' }],
    notify: (msg: string) => void notes.push(msg),
    logger: { debug: (): void => {}, warn: (): void => {} },
    now: '2026-09-06T00:00:00.000Z',
    config: CONFIG,
    ...over,
  };
  return { deps, store, created, links, notes };
}

const ARGS = {
  repoFullName: 'taj-alsafa/internal-operation-server',
  branch: 'feat/auto-submit-week',
  commits: [{ subject: 'Auto-submit the week', body: '', sha: 'abc' }],
};

describe('createFromBranch', () => {
  it('creates a SUB_TASK under the story the ranker chose', async () => {
    const h = harness();
    const out = await createFromBranch(h.deps, ARGS);

    expect(out.created).toBe(true);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]!['type']).toBe('SUB_TASK');
    expect(h.created[0]!['parent_id']).toBe(12);
    expect(h.created[0]!['title']).toBe('Composed title');
  });

  it('supplies a due date, which the server requires and a hook cannot ask for', async () => {
    const h = harness();
    await createFromBranch(h.deps, ARGS);
    expect(h.created[0]!['due_date']).toBe('2026-09-13');
  });

  it('opens in BACKLOG — a branch existing is not a claim that work started', async () => {
    const h = harness();
    await createFromBranch(h.deps, ARGS);
    expect(h.created[0]!['status']).toBe('BACKLOG');
  });

  it('creates nothing the second time the same branch is pushed', async () => {
    // A force push, a re-push, or a queued request replayed after TARDIS came
    // back must not produce a second item.
    const settled: BranchRecord = {
      ...newRecord(ARGS.repoFullName, ARGS.branch, 'main', '2026-09-01T00:00:00.000Z'),
      state: 'created',
      itemId: 143,
    };
    const h = harness({}, settled);

    const out = await createFromBranch(h.deps, ARGS);

    expect(out.created).toBe(false);
    expect(out.itemId).toBe(143);
    expect(h.created).toHaveLength(0);
  });

  it('falls back to a STORY under the epic when the ranker offers nothing', async () => {
    // rankCandidates returns [] rather than three arbitrary items when nothing
    // matches. A SUB_TASK with no parent would be rejected by the server, so
    // the type changes rather than the parent being invented.
    const h = harness({ rank: async () => [] });
    await createFromBranch(h.deps, ARGS);

    expect(h.created[0]!['type']).toBe('STORY');
    expect(h.created[0]!['parent_id']).toBe(80);
  });

  it('fails cleanly when it has neither a parent nor an epic to fall back to', async () => {
    const h = harness({
      rank: async () => [],
      config: { ...CONFIG, defaultEpicId: null },
    });

    const out = await createFromBranch(h.deps, ARGS);

    expect(out.created).toBe(false);
    expect(h.created).toHaveLength(0);
    const rec = h.store.get(branchKey(ARGS.repoFullName, ARGS.branch)) as BranchRecord;
    expect(rec.state).toBe('failed');
    expect(rec.error).toBeTruthy();
  });

  it('registers the branch link on the item it just made', async () => {
    const h = harness();
    await createFromBranch(h.deps, ARGS);
    expect(h.links).toEqual([
      {
        itemId: 900,
        url: 'https://github.com/taj-alsafa/internal-operation-server/tree/feat/auto-submit-week',
      },
    ]);
  });

  it('keeps the item when only the git link fails', async () => {
    // The item exists and matters more than the link; branch-adopt repairs it.
    const h = harness({
      client: {
        createItem: async (_w, p) => ({ ...story(900, 'x'), ...p, id: 900 }) as WorkItem,
        registerGitLink: async () => {
          throw new Error('link rejected');
        },
      },
    });

    const out = await createFromBranch(h.deps, ARGS);

    expect(out.created).toBe(true);
    const rec = h.store.get(branchKey(ARGS.repoFullName, ARGS.branch)) as BranchRecord;
    expect(rec.state).toBe('created');
    expect(rec.gitLinkId).toBeUndefined();
  });

  it('records failure rather than throwing when item creation itself fails', async () => {
    const h = harness({
      client: {
        createItem: async () => {
          throw new Error('server said no');
        },
        registerGitLink: async () => ({ id: 5 }),
      },
    });

    const out = await createFromBranch(h.deps, ARGS);

    expect(out.created).toBe(false);
    const rec = h.store.get(branchKey(ARGS.repoFullName, ARGS.branch)) as BranchRecord;
    expect(rec.state).toBe('failed');
    expect(rec.attempts).toBe(1);
  });

  it('notifies with the key and the due date it guessed', async () => {
    // The due date and parent are guesses; a notification is what makes a wrong
    // guess visible now instead of at sprint review.
    const h = harness();
    await createFromBranch(h.deps, ARGS);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toContain('Composed title');
    expect(h.notes[0]).toContain('2026-09-13');
  });
});
