/**
 * branch-time.ts — write a day's divided working time onto the work items its
 * branches belong to.
 *
 * The division happens on the laptop (scripts/branch-link/sessions.ts), where
 * the commits are. This is the half that knows which item a branch became, and
 * it is deliberately dumb about arithmetic: it writes what it is given and
 * never scales, re-splits, or tops up. Two places doing the maths is how a
 * timesheet quietly stops adding up.
 */

import { branchKey } from './branch.js';
import type { BranchRecord } from './branch.js';

export interface Allocation {
  repoFullName: string;
  branch: string;
  seconds: number;
}

export interface TimeDeps {
  storage: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  client: {
    createTimeEntry: (
      itemId: number,
      entry: { seconds: number; logged_date: string; note?: string }
    ) => Promise<{ id: number }>;
    deleteTimeEntry: (itemId: number, entryId: number) => Promise<void>;
  };
  logger: { debug: (msg: string) => void; warn: (msg: string) => void };
}

export interface TimeArgs {
  /** YYYY-MM-DD. */
  date: string;
  allocations: Allocation[];
  /** Delete this day's previous entries and write again. */
  replace?: boolean;
}

export interface TimeResult {
  logged: number;
  seconds: number;
  alreadyLogged: boolean;
  /** Time attributed to branches that never became work items. */
  unlinked: Allocation[];
  failed: { branch: string; reason: string }[];
}

interface DayRecord {
  date: string;
  entries: { itemId: number; entryId: number }[];
  writtenAt: string;
}

const dayKey = (date: string): string => `branchtime:${date}`;

export async function logBranchTime(deps: TimeDeps, args: TimeArgs): Promise<TimeResult> {
  const key = dayKey(args.date);
  const previous = await deps.storage.get<DayRecord>(key);

  if (previous !== null && args.replace !== true) {
    // Appending a second day's worth to the same date is the one thing this
    // must never do — an inflated timesheet is exactly what it exists to avoid.
    return {
      logged: 0,
      seconds: 0,
      alreadyLogged: true,
      unlinked: [],
      failed: [],
    };
  }

  if (previous !== null && args.replace === true) {
    for (const entry of previous.entries) {
      try {
        await deps.client.deleteTimeEntry(entry.itemId, entry.entryId);
      } catch (err) {
        // A previous entry that cannot be removed would be double-counted
        // against the new ones, so say so loudly rather than write over it.
        deps.logger.warn(
          `branch-time: could not delete entry ${entry.entryId} on #${entry.itemId} — ` +
            `${String(err)}; ${args.date} may now be double-counted`
        );
      }
    }
  }

  const written: DayRecord['entries'] = [];
  const unlinked: Allocation[] = [];
  const failed: TimeResult['failed'] = [];
  let seconds = 0;

  for (const allocation of args.allocations) {
    if (!Number.isFinite(allocation.seconds) || allocation.seconds <= 0) continue;

    const record = await deps.storage.get<BranchRecord>(
      branchKey(allocation.repoFullName, allocation.branch)
    );
    const itemId = record?.itemId;
    if (itemId === undefined) {
      // Not an error: a branch may be drafting, failed, or from before any of
      // this existed. But its time would otherwise vanish without trace.
      unlinked.push(allocation);
      continue;
    }

    try {
      const entry = await deps.client.createTimeEntry(itemId, {
        seconds: allocation.seconds,
        logged_date: args.date,
        note: `branch ${allocation.branch}`,
      });
      written.push({ itemId, entryId: entry.id });
      seconds += allocation.seconds;
    } catch (err) {
      failed.push({ branch: allocation.branch, reason: String(err) });
      deps.logger.warn(`branch-time: #${itemId} rejected its entry — ${String(err)}`);
    }
  }

  // Recorded even when some entries failed: the ones that succeeded are real,
  // and a re-run without `replace` must not write them a second time.
  await deps.storage.set(key, {
    date: args.date,
    entries: written,
    writtenAt: new Date().toISOString(),
  } satisfies DayRecord);

  return { logged: written.length, seconds, alreadyLogged: false, unlinked, failed };
}
