/**
 * core.ts — the parts of the branch-link hook helper that are worth testing.
 *
 * See docs/specs/2026-09-06-branch-linked-work-items-design.md §7–§8.
 *
 * Everything here is pure. `cli.ts` shells out to git and talks to TARDIS;
 * this file decides what any of that output means, so the decisions can be
 * exercised without a repo or a server.
 */

export interface Commit {
  subject: string;
  body: string;
  sha: string;
}

export interface PushedRef {
  branch: string;
  sha: string;
}

/** Branches shared with other people never become someone's personal task. */
export const DEFAULT_PROTECTED = ['main', 'master', 'staging', 'develop'];

const ZERO_SHA = /^0{40}$/;

/**
 * `pre-push` receives one `<local ref> <local sha> <remote ref> <remote sha>`
 * line per ref on stdin. Two lines must be ignored: a deletion, which arrives
 * as an all-zero LOCAL sha (`git push --delete`), and anything that is not a
 * branch — a pushed tag is not work.
 */
export function parsePrePushRefs(stdin: string): PushedRef[] {
  const out: PushedRef[] = [];
  for (const line of stdin.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const [localRef, localSha] = parts as [string, string];
    if (!localRef.startsWith('refs/heads/')) continue;
    if (ZERO_SHA.test(localSha)) continue;

    out.push({ branch: localRef.slice('refs/heads/'.length), sha: localSha });
  }
  return out;
}

/**
 * Exact match, not substring: `fix/main-menu` is not `main`, and treating it
 * as protected would silently drop a real branch.
 */
export function shouldAct(branch: string, protectedBranches: string[]): boolean {
  if (branch.trim() === '') return false;
  return !protectedBranches.includes(branch);
}

/**
 * Parse `git log --format=%s%x00%b%x00%H%x1e`. NUL separates the fields and
 * RS separates the records, because both are impossible in a commit subject —
 * a newline is not, which is why the obvious line-based format cannot work
 * once a commit has a body.
 */
export function parseCommitLog(raw: string): Commit[] {
  const out: Commit[] = [];
  for (const record of raw.split('\x1e')) {
    if (record.trim() === '') continue;
    const [subject = '', body = '', sha = ''] = record.split('\x00');
    if (subject.trim() === '') continue;
    out.push({ subject: subject.trim(), body: body.trim(), sha: sha.trim() });
  }
  return out;
}
