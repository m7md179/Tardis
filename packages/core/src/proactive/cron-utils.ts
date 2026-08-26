import CronExpressionParser from 'cron-parser';

/**
 * Whether a cron schedule has an occurrence to run now.
 *
 * Fires once for each occurrence in the half-open interval `(since, now]`.
 *
 * The previous implementation accepted any occurrence within 60 seconds of
 * `now` in *either* direction, so for `0 * * * *` the tick before the hour and
 * the tick after it both matched the same occurrence and every scheduled
 * message went out twice — 429 duplicate pairs in production before this was
 * caught.
 *
 * `since` is the scheduler's previous tick. Passing it matters because
 * `setInterval(60_000)` drifts: a strict same-minute test would eventually step
 * straight over an occurrence and drop it. Omitting `since` falls back to
 * matching the current minute exactly, which is what a one-off check wants.
 */
export function isTimeToRun(cronExpr: string, now: Date = new Date(), since?: Date): boolean {
  try {
    const from = since ?? new Date(new Date(now).setSeconds(0, 0) - 1);
    if (from.getTime() >= now.getTime()) return false;

    const parsed = CronExpressionParser.parse(cronExpr, { currentDate: from });
    return parsed.next().toDate().getTime() <= now.getTime();
  } catch {
    return false;
  }
}

/**
 * Check if the current time falls within quiet hours.
 * Handles wrapping past midnight (e.g. 22:00 → 08:00).
 *
 * @param now - Current date
 * @param start - Quiet hours start in "HH:MM" format
 * @param end - Quiet hours end in "HH:MM" format
 */
export function isDuringQuietHours(now: Date, start?: string, end?: string): boolean {
  if (!start || !end) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseHHMM(start);
  const endMinutes = parseHHMM(end);

  if (startMinutes === null || endMinutes === null) return false;

  // Same-day range (e.g. 09:00 → 17:00)
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Wraps midnight (e.g. 22:00 → 08:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function parseHHMM(time: string): number | null {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}
