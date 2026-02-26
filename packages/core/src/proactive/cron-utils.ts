import CronExpressionParser from 'cron-parser';

/**
 * Check if a cron expression should fire at the given time.
 * We check if `now` falls within the current minute of a scheduled occurrence.
 */
export function isTimeToRun(cronExpr: string, now: Date = new Date()): boolean {
  try {
    // Parse with currentDate set 1 minute before `now` so .next() gives us
    // the occurrence at or after (now - 60s).
    const parsed = CronExpressionParser.parse(cronExpr, {
      currentDate: new Date(now.getTime() - 60_000),
    });
    const next = parsed.next();
    const nextDate = next.toDate();
    // Check if the next occurrence is within the 60-second window
    const diffMs = Math.abs(now.getTime() - nextDate.getTime());
    return diffMs < 60_000;
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
