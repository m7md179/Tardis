/**
 * Format a duration in seconds to a human-readable string.
 * Examples: 0 → "0s", 90 → "1m 30s", 3661 → "1h 1m 1s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  seconds = Math.floor(seconds);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);

  return parts.join(' ');
}
