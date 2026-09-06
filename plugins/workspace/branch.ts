/**
 * branch.ts — the local half of the branch↔work-item mapping.
 *
 * See docs/specs/2026-09-06-branch-linked-work-items-design.md §9.
 *
 * Records live in `api.storage` under `branch:<provider>:<repo>:<branch>`.
 * Git forbids ':' in a ref name and GitHub forbids it in a repo name, so ':'
 * is the one separator that cannot appear inside any of the three parts —
 * '/' appears in nearly every branch name and in every repo full name, so
 * splitting on it would silently truncate `feat/auto-submit-week` to `feat`.
 */

export const BRANCH_KEY_PREFIX = 'branch:';

export interface BranchKeyParts {
  provider: 'github';
  repoFullName: string;
  branch: string;
}

export function branchKey(repoFullName: string, branch: string): string {
  return `${BRANCH_KEY_PREFIX}github:${repoFullName}:${branch}`;
}

/**
 * `drafting` — checkout seen, nothing on the board yet.
 * `created`  — we made the item. `adopted` — it was attached to an existing one.
 * `failed`   — creation was attempted and did not finish.
 */
export type BranchState = 'drafting' | 'created' | 'failed' | 'adopted';

export interface BranchRecord {
  provider: 'github';
  repoFullName: string;
  branch: string;
  baseBranch: string | null;
  state: BranchState;
  createdAt: string;
  updatedAt: string;
  itemId?: number;
  itemKey?: string;
  gitLinkId?: number;
  parentId?: number | null;
  error?: string;
  attempts: number;
}

export function newRecord(
  repoFullName: string,
  branch: string,
  baseBranch: string | null,
  now: string
): BranchRecord {
  return {
    provider: 'github',
    repoFullName,
    branch,
    baseBranch,
    state: 'drafting',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
}

/**
 * True when a work item already exists for this branch. The single guard
 * against a second push, a force push, or a replayed queue entry producing a
 * duplicate item — `failed` is deliberately NOT settled, so a retry can run.
 */
export function isSettled(record: BranchRecord): boolean {
  return record.state === 'created' || record.state === 'adopted';
}

/**
 * Only an unsettled record can expire. A `created` record is the local half of
 * the branch↔item mapping: sweeping it would orphan the git link and let the
 * next push to that branch create a second item.
 */
export function isExpired(record: BranchRecord, ttlDays: number, now: string): boolean {
  if (isSettled(record)) return false;
  const age = Date.parse(now) - Date.parse(record.createdAt);
  return age > ttlDays * 86400000;
}

/**
 * The branch's URL, built to be byte-identical to the one
 * `workspace-git-link.service.ts` builds when GitHub reports a push:
 * `https://github.com/${repoFullName}/tree/${encodeURI(branch)}`.
 *
 * Deliberately `encodeURI` and not `encodeURIComponent` — the latter escapes
 * '/', which would turn `feat/x` into `feat%2Fx` and produce a second, distinct
 * link row on the same work item for the same branch.
 */
export function branchUrl(repoFullName: string, branch: string): string {
  return `https://github.com/${repoFullName}/tree/${encodeURI(branch)}`;
}

/** `owner/repo` from an https or ssh GitHub remote; null for anything else. */
export function repoFullNameFromRemote(remote: string): string | null {
  const cleaned = remote.trim().replace(/\.git$/, '');
  if (cleaned === '') return null;

  const https = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/]+)$/.exec(cleaned);
  if (https) return https[1] ?? null;

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/]+)$/.exec(cleaned);
  if (ssh) return ssh[1] ?? null;

  return null;
}

export function parseBranchKey(key: string): BranchKeyParts | null {
  if (!key.startsWith(BRANCH_KEY_PREFIX)) return null;
  const rest = key.slice(BRANCH_KEY_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 3) return null;
  const [provider, repoFullName, branch] = parts as [string, string, string];
  if (provider !== 'github' || repoFullName === '' || branch === '') return null;
  return { provider, repoFullName, branch };
}
