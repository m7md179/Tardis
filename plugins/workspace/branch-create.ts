/**
 * branch-create.ts — turn a pushed branch into a work item.
 *
 * See docs/specs/2026-09-06-branch-linked-work-items-design.md §11.
 *
 * Everything here runs AFTER `git push` has already succeeded, in a detached
 * background process nobody is watching. That shapes every decision below:
 * this function does not throw, it records what happened, and it prefers a
 * plainly-worded item over no item at all.
 */

import { branchKey, branchUrl, isSettled, newRecord } from './branch.js';
import type { BranchRecord } from './branch.js';
import type { Commit, Composition } from './compose.js';
import type { Candidate } from './ranking.js';
import type { WorkItem, WorkItemPriority } from './types.js';

export interface BranchLinkConfig {
  workspaceId: number;
  /** Fallback parent for the STORY path. null means "no fallback available". */
  defaultEpicId: number | null;
  dueDateOffsetDays: number;
  defaultPriority: WorkItemPriority;
  draftTtlDays: number;
}

export interface CreateDeps {
  storage: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  client: {
    createItem: (workspaceId: number, payload: Record<string, unknown>) => Promise<WorkItem>;
    registerGitLink: (itemId: number, url: string) => Promise<{ id: number }>;
  };
  listStories: () => Promise<WorkItem[]>;
  compose: (branch: string, commits: Commit[]) => Promise<Composition>;
  rank: (query: string, items: WorkItem[]) => Promise<Candidate[]>;
  notify: (message: string) => void;
  logger: { debug: (msg: string) => void; warn: (msg: string) => void };
  now: string;
  config: BranchLinkConfig;
}

export interface CreateArgs {
  repoFullName: string;
  branch: string;
  commits: Commit[];
  baseBranch?: string | null;
}

export interface CreateResult {
  created: boolean;
  itemId?: number;
  title?: string;
  reason?: string;
}

/** ISO date (no time) `days` after `now` — the server wants `YYYY-MM-DD`. */
function dueDate(now: string, days: number): string {
  const at = new Date(Date.parse(now) + days * 86400000);
  return at.toISOString().slice(0, 10);
}

export async function createFromBranch(
  deps: CreateDeps,
  args: CreateArgs
): Promise<CreateResult> {
  const key = branchKey(args.repoFullName, args.branch);
  const existing = await deps.storage.get<BranchRecord>(key);

  // A push with no prior checkout hook (installed mid-branch) is normal, so a
  // missing record is created rather than treated as an error.
  const record =
    existing ?? newRecord(args.repoFullName, args.branch, args.baseBranch ?? null, deps.now);

  if (isSettled(record)) {
    deps.logger.debug(`branch-create: ${args.branch} already has item ${String(record.itemId)}`);
    return {
      created: false,
      ...(record.itemId === undefined ? {} : { itemId: record.itemId }),
      reason: 'already linked',
    };
  }

  const save = async (patch: Partial<BranchRecord>): Promise<void> => {
    await deps.storage.set(key, { ...record, ...patch, updatedAt: deps.now });
  };

  try {
    const composition = await deps.compose(args.branch, args.commits);
    const query = `${composition.title}\n${composition.description}`;
    const candidates = await deps.rank(query, await deps.listStories());

    // D8: a confident parent, or a STORY under the epic. Never a SUB_TASK with
    // an invented parent — the server rejects one with no parent anyway, so
    // guessing would trade a clean fallback for a failed creation.
    const parent = candidates[0];
    const type = parent === undefined ? 'STORY' : 'SUB_TASK';
    const parentId = parent === undefined ? deps.config.defaultEpicId : parent.id;

    if (parentId === null) {
      const reason =
        'no parent story matched and no defaultEpicId is configured, so there is nowhere to put it';
      await save({ state: 'failed', error: reason, attempts: record.attempts + 1 });
      deps.logger.warn(`branch-create: ${args.branch} — ${reason}`);
      return { created: false, reason };
    }

    const due = dueDate(deps.now, deps.config.dueDateOffsetDays);
    const item = await deps.client.createItem(deps.config.workspaceId, {
      type,
      title: composition.title,
      description: composition.description,
      parent_id: parentId,
      due_date: due,
      priority: deps.config.defaultPriority,
      status: 'BACKLOG',
    });

    // The item exists now. A failure past this point must not lose it.
    let gitLinkId: number | undefined;
    try {
      gitLinkId = (await deps.client.registerGitLink(item.id, branchUrl(args.repoFullName, args.branch)))
        .id;
    } catch (err) {
      deps.logger.warn(
        `branch-create: item ${item.id} created but its branch link failed (${String(err)}) — ` +
          'workspace.branch-adopt can repair it'
      );
    }

    await save({
      state: 'created',
      itemId: item.id,
      title: composition.title,
      parentId,
      ...(gitLinkId === undefined ? {} : { gitLinkId }),
      attempts: record.attempts + 1,
    } as Partial<BranchRecord>);

    deps.notify(
      `#${item.id} ${composition.title} — ${type === 'SUB_TASK' ? `under #${parentId}` : `story under epic #${parentId}`}, due ${due}. From branch ${args.branch}.`
    );

    return { created: true, itemId: item.id, title: composition.title };
  } catch (err) {
    const reason = String(err instanceof Error ? err.message : err);
    await save({ state: 'failed', error: reason, attempts: record.attempts + 1 });
    deps.logger.warn(`branch-create: ${args.branch} failed — ${reason}`);
    return { created: false, reason };
  }
}
