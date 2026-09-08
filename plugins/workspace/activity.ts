/**
 * activity.ts — remember when work happened, so TARDIS can divide a day
 * without ever seeing the machine it happened on.
 *
 * The commits are on a laptop; TARDIS runs on a server and cannot read them.
 * But `pre-push` already hands the plugin every commit on a branch, so the
 * timestamps are already arriving — they were simply being thrown away after
 * the title was composed. Keeping them means "log my time for today" is a
 * question TARDIS can answer on its own, instead of a command run locally.
 *
 * The cost of that trade, stated plainly: only work that has been PUSHED is
 * visible here. Commits sitting unpushed at 4pm are not part of the day until
 * they are pushed, and a day logged before the last push of it will be short.
 */

export interface ActivityCommit {
  repoFullName: string;
  branch: string;
  sha: string;
  /** Author time, epoch seconds. */
  at: number;
}

export interface ActivityStore {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

export const ACTIVITY_KEY_PREFIX = 'activity:';

export const activityKey = (date: string): string => `${ACTIVITY_KEY_PREFIX}${date}`;

/** YYYY-MM-DD in UTC. */
function dayOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * File a branch's commits under the days they were authored.
 *
 * `pre-push` sends the whole branch every time, so the same sha arrives again
 * on the next push — de-duplication by sha is what stops a re-push inflating
 * the very number this exists to keep honest. A push spanning midnight is
 * split across both days rather than being attributed to whichever one the
 * push happened in.
 */
export async function recordActivity(
  store: ActivityStore,
  repoFullName: string,
  branch: string,
  commits: { sha?: string; at?: number }[]
): Promise<void> {
  const byDay = new Map<string, ActivityCommit[]>();

  for (const commit of commits) {
    const at = commit.at;
    const sha = commit.sha;
    // No timestamp means no day. Filing it under "now" would credit old work
    // to today, which is the one direction that inflates.
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue;
    if (typeof sha !== 'string' || sha === '') continue;

    const day = dayOf(at);
    const list = byDay.get(day) ?? [];
    list.push({ repoFullName, branch, sha, at });
    byDay.set(day, list);
  }

  for (const [day, incoming] of byDay) {
    const key = activityKey(day);
    const existing = (await store.get<ActivityCommit[]>(key)) ?? [];
    const seen = new Set(existing.map((c) => `${c.repoFullName} ${c.sha}`));

    const merged = [...existing];
    for (const commit of incoming) {
      const id = `${commit.repoFullName} ${commit.sha}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(commit);
    }

    if (merged.length !== existing.length) {
      merged.sort((a, b) => a.at - b.at);
      await store.set(key, merged);
    }
  }
}

export async function readActivity(store: ActivityStore, date: string): Promise<ActivityCommit[]> {
  return (await store.get<ActivityCommit[]>(activityKey(date))) ?? [];
}
