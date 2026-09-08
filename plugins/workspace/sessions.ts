/**
 * sessions.ts — turn a day's commits into an honest division of working time.
 *
 * The problem this exists for: several branches are worked in parallel, often
 * by several agents at once. The workspace's AUTO timer starts on entering
 * IN_PROGRESS and stops on leaving it, with no way to be in progress without
 * one running — so five live branches bill five concurrent 8h sessions, and a
 * nightly sweep writes them whether or not anyone was at the desk. Forty hours
 * in a day, on a real timesheet.
 *
 * So time is measured ONCE and divided, never accumulated per item. The
 * invariant is the whole design, and there is a test named after it: the sum
 * of what is billed can never exceed the time actually worked.
 *
 * ── What this can and cannot see ────────────────────────────────────────
 * Commits are a proxy. Reviewing, debugging without committing, and a day
 * spent reading code all read as zero here. `leadInSeconds` is a crude
 * correction for the work before the first commit of a session and nothing
 * corrects the rest. The model therefore under-reports rather than over-,
 * which is the safer direction — but it is a guess, not a measurement, and
 * anything built on top should say so.
 */

export interface CommitEvent {
  repoFullName: string;
  branch: string;
  /** Author time, epoch seconds. */
  at: number;
}

export interface SessionOptions {
  /** Commits further apart than this start a new session. */
  gapSeconds: number;
  /** Credited before a session's first commit, for the work that produced it. */
  leadInSeconds: number;
}

export interface Session {
  startedAt: number;
  endedAt: number;
  /** Span plus the lead-in. */
  seconds: number;
  commits: CommitEvent[];
}

export interface AllocateOptions {
  /** Hard ceiling for the day; the split is scaled, never truncated. */
  maxDaySeconds?: number;
  /** Shares below this are dropped — a zero-minute entry is timesheet noise. */
  minSeconds?: number;
}

export interface Allocation {
  repoFullName: string;
  branch: string;
  seconds: number;
}

/**
 * Parse `git log --all --source --format=%S%x00%at%x1e`.
 *
 * `%S` is the ref the commit was reached from, which is what makes one command
 * cover every branch in the repo — the alternative is looping `git log
 * base..branch` over hundreds of refs, once per repo, on every run.
 *
 * `%S` emits TWO different shapes depending on the traversal, which is not
 * documented anywhere obvious and was found by running it: under `--all` it
 * prints the full `refs/heads/feat/x`, under `--branches` just `feat/x`.
 * Accepting only the long form found zero commits on a day with twenty-two.
 *
 * Any other `refs/` prefix is rejected. A commit reached from
 * `refs/remotes/origin/main` arrived by someone else's merge and is not your
 * working time; a tag is not work at all. `--branches` should never produce
 * either, so this is a belt on top of braces.
 */
export function parseSourceLog(raw: string, repoFullName: string): CommitEvent[] {
  const out: CommitEvent[] = [];
  for (const record of raw.split('\x1e')) {
    if (record.trim() === '') continue;
    const [ref = '', at = ''] = record.split('\x00');

    let branch = ref.trim();
    if (branch.startsWith('refs/heads/')) branch = branch.slice('refs/heads/'.length);
    else if (branch.startsWith('refs/')) continue;
    if (branch === '') continue;

    const seconds = Number(at.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) continue;

    out.push({ repoFullName, branch, at: seconds });
  }
  return out;
}

function key(c: { repoFullName: string; branch: string }): string {
  // Repo included: `fix/x` can exist in two repos and be two different items.
  return `${c.repoFullName}\u0000${c.branch}`;
}

export function sessionize(commits: CommitEvent[], opts: SessionOptions): Session[] {
  if (commits.length === 0) return [];

  const sorted = [...commits].sort((a, b) => a.at - b.at);
  const sessions: Session[] = [];
  let current: CommitEvent[] = [sorted[0]!];

  for (const commit of sorted.slice(1)) {
    const previous = current[current.length - 1]!;
    if (commit.at - previous.at > opts.gapSeconds) {
      sessions.push(build(current, opts));
      current = [commit];
    } else {
      current.push(commit);
    }
  }
  sessions.push(build(current, opts));

  return sessions;
}

function build(commits: CommitEvent[], opts: SessionOptions): Session {
  const startedAt = commits[0]!.at;
  const endedAt = commits[commits.length - 1]!.at;
  return {
    startedAt,
    endedAt,
    seconds: endedAt - startedAt + opts.leadInSeconds,
    commits,
  };
}

/**
 * Divide each session among the branches committed to within it, weighted by
 * how many commits each contributed. Weighting by count rather than splitting
 * evenly is a better proxy for effort; both are defensible, this one is the
 * default.
 */
export function allocate(sessions: Session[], opts: AllocateOptions): Allocation[] {
  const totals = new Map<string, number>();

  for (const session of sessions) {
    const counts = new Map<string, number>();
    for (const commit of session.commits) {
      counts.set(key(commit), (counts.get(key(commit)) ?? 0) + 1);
    }
    const commitCount = session.commits.length;
    for (const [k, count] of counts) {
      totals.set(k, (totals.get(k) ?? 0) + (session.seconds * count) / commitCount);
    }
  }

  let out: Allocation[] = [...totals].map(([k, seconds]) => {
    const [repoFullName = '', branch = ''] = k.split('\u0000');
    return { repoFullName, branch, seconds };
  });

  // Scale rather than truncate: lopping off the last branch would silently
  // drop real work and make the numbers depend on iteration order.
  const max = opts.maxDaySeconds;
  if (max !== undefined && max > 0) {
    const total = out.reduce((n, a) => n + a.seconds, 0);
    if (total > max) {
      const factor = max / total;
      out = out.map((a) => ({ ...a, seconds: a.seconds * factor }));
    }
  }

  const min = opts.minSeconds ?? 0;
  return out
    .map((a) => ({ ...a, seconds: Math.round(a.seconds) }))
    .filter((a) => a.seconds >= min && a.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}
