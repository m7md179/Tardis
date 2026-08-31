import CronExpressionParser from 'cron-parser';
import { rrulestr } from 'rrule';
import { isDuringQuietHours } from './cron-utils.js';

/**
 * Schedules, in either dialect TARDIS accepts.
 *
 * Cron covers almost everything and cannot say "the last Friday of the month",
 * which is exactly the shape a budget assistant reporting on a pay cycle needs.
 * RRULE says it in one line: `FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0`.
 *
 * Both dialects answer the same two questions, and nothing outside this file
 * needs to know which one a given schedule is written in.
 */

export type ScheduleKind = 'cron' | 'rrule';

/**
 * Which dialect a schedule string is written in.
 *
 * `FREQ=` is required in every RRULE and cannot appear in a cron expression, so
 * this needs no heuristics. A `RRULE:` prefix and a `DTSTART` line are both
 * optional and both accepted.
 */
export function scheduleKind(schedule: string): ScheduleKind {
  return /FREQ=/i.test(schedule) ? 'rrule' : 'cron';
}

// ─── Local time ───────────────────────────────────────────────────────────────
//
// rrule generates dates in "floating" time: the *UTC* fields of what it returns
// carry the wall-clock values from the rule, so `BYHOUR=9` comes back as
// 09:00Z regardless of where the machine is.
//
// Cron, through cron-parser's defaults, is local. Two schedule dialects on one
// server disagreeing about what "9am" means would be a genuinely nasty bug, so
// RRULE is read as local wall-clock too, matching cron.
//
// TZID is deliberately NOT supported. rrule needs luxon for it and, without
// luxon installed, does not error — it silently applies the *machine's* offset
// to another zone's rule. Measured: `DTSTART;TZID=Europe/London:20260115T090000`
// produced 12:00Z on an Asia/Amman box, which is 09:00 Amman, not 09:00 London.
// A schedule that is quietly three hours wrong is worse than one that is
// unsupported.

function floatingToLocal(d: Date): Date {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  );
}

function localToFloating(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    )
  );
}

// ─── The two questions ────────────────────────────────────────────────────────

/**
 * Does this schedule have an occurrence in the half-open interval
 * `(since, now]`?
 *
 * The interval, rather than a "close to now" test, is the hard-won part. The
 * original implementation accepted any occurrence within 60 seconds of `now` in
 * *either* direction, so for `0 * * * *` the tick before the hour and the tick
 * after it both matched the same occurrence and every scheduled message went
 * out twice — 429 duplicate pairs in production before it was caught. The
 * interval also survives `setInterval` drift, which a strict same-minute test
 * would eventually step straight over.
 *
 * rrule replaces the *expression*. It does not touch this.
 */
export function occursIn(schedule: string, now: Date, since?: Date): boolean {
  const from = since ?? new Date(new Date(now).setSeconds(0, 0) - 1);
  if (from.getTime() >= now.getTime()) return false;

  try {
    if (scheduleKind(schedule) === 'cron') {
      const parsed = CronExpressionParser.parse(schedule, { currentDate: from });
      return parsed.next().toDate().getTime() <= now.getTime();
    }

    // `inc: false` on the lower bound keeps the interval half-open, so an
    // occurrence landing exactly on a tick boundary fires once, not twice.
    const rule = rrulestr(normalizeRRule(schedule));
    const hits = rule.between(localToFloating(from), localToFloating(now), true);
    return hits.some((d) => {
      const at = floatingToLocal(d).getTime();
      return at > from.getTime() && at <= now.getTime();
    });
  } catch {
    return false;
  }
}

/**
 * When this schedule next runs after `from`, or null if never (or unparseable).
 *
 * Stored on the row so *"when will you next tell me about my spending?"* is a
 * lookup rather than a simulation of the matcher.
 *
 * Quiet hours are honoured, because the tick *skips* a run that lands inside
 * them rather than deferring it — so an occurrence at 02:00 under quiet hours
 * of 22:00–08:00 is not the next run, and reporting it would be a lie. The
 * search is bounded: quiet hours can cover every occurrence a rule ever has,
 * and an unbounded walk would hang the scheduler rather than return null.
 */
export function nextRunAt(
  schedule: string,
  from: Date = new Date(),
  quietHours?: { start?: string | undefined; end?: string | undefined }
): Date | null {
  const MAX_CANDIDATES = 500;

  try {
    if (scheduleKind(schedule) === 'cron') {
      const parsed = CronExpressionParser.parse(schedule, { currentDate: from });
      for (let i = 0; i < MAX_CANDIDATES; i++) {
        const candidate = parsed.next().toDate();
        if (!isDuringQuietHours(candidate, quietHours?.start, quietHours?.end)) return candidate;
      }
      return null;
    }

    const rule = rrulestr(normalizeRRule(schedule));
    let cursor = localToFloating(from);
    for (let i = 0; i < MAX_CANDIDATES; i++) {
      const raw = rule.after(cursor, false);
      if (!raw) return null;
      cursor = raw;
      const candidate = floatingToLocal(raw);
      if (!isDuringQuietHours(candidate, quietHours?.start, quietHours?.end)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/** Whether a schedule string parses at all, in either dialect. */
export function isValidSchedule(schedule: string): boolean {
  try {
    if (scheduleKind(schedule) === 'cron') {
      CronExpressionParser.parse(schedule);
      return true;
    }
    const rule = rrulestr(normalizeRRule(schedule));
    // A rule that parses but can never fire is not a usable schedule.
    return rule.after(new Date(0), true) !== null;
  } catch {
    return false;
  }
}

/**
 * Gives a bare `FREQ=…` line the DTSTART rrulestr needs to anchor on.
 *
 * Without one, rrule anchors to "now", so `FREQ=MONTHLY;BYMONTHDAY=1` written
 * on the 15th would first fire next month rather than on the 1st. A fixed
 * epoch anchor makes a rule mean the same thing whenever it is written.
 */
function normalizeRRule(schedule: string): string {
  const text = schedule.trim();
  if (/DTSTART/i.test(text)) return text;
  const body = text.replace(/^RRULE:/i, '');
  return `DTSTART:19700101T000000Z\nRRULE:${body}`;
}
