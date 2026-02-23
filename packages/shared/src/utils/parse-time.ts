/**
 * Parse a time string like "2h 30m", "90m", "1h", "45s" into seconds.
 * Returns null if the string can't be parsed.
 */
export function parseTimeToSeconds(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let total = 0;
  let matched = false;

  const patterns: [RegExp, number][] = [
    [/(\d+(?:\.\d+)?)\s*h(?:ours?)?/g, 3600],
    [/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?/g, 60],
    [/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?/g, 1],
  ];

  for (const [re, multiplier] of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
      const val = match[1];
      if (val !== undefined) {
        total += parseFloat(val) * multiplier;
        matched = true;
      }
    }
  }

  return matched ? Math.floor(total) : null;
}

/**
 * Parse a time window string like "[9am-5pm]" or "[14:00-15:30]"
 * Returns { start, end } as "HH:MM" strings, or null if unparseable.
 */
export function parseTimeWindow(input: string): { start: string; end: string } | null {
  const match = /\[(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?(?:am|pm)?)\]/i.exec(
    input
  );
  if (!match) return null;

  const start = normalizeTime(match[1] ?? '');
  const end = normalizeTime(match[2] ?? '');
  if (!start || !end) return null;

  return { start, end };
}

function normalizeTime(raw: string): string | null {
  const lower = raw.toLowerCase();

  // HH:MM format
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(lower);
  if (hhmm) {
    const h = parseInt(hhmm[1] ?? '0', 10);
    const m = parseInt(hhmm[2] ?? '0', 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // 12h format: "9am", "12pm", "5pm"
  const ampm = /^(\d{1,2})(am|pm)$/.exec(lower);
  if (ampm) {
    let h = parseInt(ampm[1] ?? '0', 10);
    const suffix = ampm[2];
    if (suffix === 'pm' && h !== 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    if (h > 23) return null;
    return `${String(h).padStart(2, '0')}:00`;
  }

  return null;
}
