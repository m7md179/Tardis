import { format, differenceInSeconds, parseISO } from 'date-fns';
import { TimeWindow } from '../types/session';

/**
 * Parse time window from string like "[1pm-3pm]" or "[09:00-12:00]"
 */
export function parseTimeWindow(input: string): TimeWindow | null {
  // Remove brackets and extra whitespace
  const cleaned = input.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();

  // Match patterns:
  //   "1pm-3pm", "2:30pm-3:00pm", "2:30 PM - 3:00 PM" (12hr with optional minutes)
  //   "09:00-12:00" (24hr)
  const pattern12 = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
  const pattern24 = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

  let startHour = 0;
  let startMin = 0;
  let endHour = 0;
  let endMin = 0;

  const match12 = cleaned.match(pattern12);
  if (match12) {
    const startH = match12[1] ?? '0';
    const startM = match12[2];
    const startPeriod = match12[3] ?? 'am';
    const endH = match12[4] ?? '0';
    const endM = match12[5];
    const endPeriod = match12[6] ?? 'am';
    startHour = convertTo24Hour(parseInt(startH), startPeriod);
    startMin = startM ? parseInt(startM) : 0;
    endHour = convertTo24Hour(parseInt(endH), endPeriod);
    endMin = endM ? parseInt(endM) : 0;
  } else {
    const match24 = cleaned.match(pattern24);
    if (match24) {
      startHour = parseInt(match24[1] ?? '0');
      startMin = parseInt(match24[2] ?? '0');
      endHour = parseInt(match24[3] ?? '0');
      endMin = parseInt(match24[4] ?? '0');
    } else {
      return null;
    }
  }

  // Validate
  if (
    startHour < 0 ||
    startHour > 23 ||
    endHour < 0 ||
    endHour > 23 ||
    startMin < 0 ||
    startMin > 59 ||
    endMin < 0 ||
    endMin > 59
  ) {
    return null;
  }

  const start = `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
  const end = `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`;

  // Start must be before end
  if (start >= end) {
    return null;
  }

  return {
    start,
    end,
  };
}

/**
 * Convert 12-hour time to 24-hour format
 */
function convertTo24Hour(hour: number, period: string): number {
  const normalizedPeriod = period.toLowerCase();
  if (normalizedPeriod === 'am') {
    return hour === 12 ? 0 : hour;
  } else {
    return hour === 12 ? 12 : hour + 12;
  }
}

/**
 * Calculate duration in seconds between two ISO timestamps
 */
export function calculateDuration(start: string, end: string): number {
  return differenceInSeconds(parseISO(end), parseISO(start));
}

/**
 * Format duration (seconds) as "2h 15m" or "45m" or "30s"
 */
export function formatDurationHuman(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  // Show seconds only if no minutes are present (or if there are no hours/minutes at all)
  if (secs > 0 && minutes === 0) {
    parts.push(`${secs}s`);
  }

  return parts.join(' ') || '0s';
}

/**
 * Format ISO timestamp as human-readable time (HH:mm:ss)
 */
export function formatTime(isoString: string): string {
  return format(parseISO(isoString), 'HH:mm:ss');
}

/**
 * Format ISO timestamp as human-readable date (yyyy-MM-dd)
 */
export function formatDate(isoString: string): string {
  return format(parseISO(isoString), 'yyyy-MM-dd');
}

/**
 * Format ISO timestamp as human-readable datetime
 */
export function formatDateTime(isoString: string): string {
  return format(parseISO(isoString), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Get current timestamp in ISO format
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Check if a time window is currently active
 */
export function isTimeWindowActive(timeWindow: TimeWindow): boolean {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const currentTime = format(now, 'HH:mm');

  return timeWindow.date === today && currentTime >= timeWindow.start && currentTime <= timeWindow.end;
}

/**
 * Check if current time is within a time window
 */
export function isWithinTimeWindow(timeWindow: TimeWindow, checkTime?: Date): boolean {
  const timeToCheck = checkTime || new Date();
  const checkDate = format(timeToCheck, 'yyyy-MM-dd');
  const checkTimeStr = format(timeToCheck, 'HH:mm');

  return (
    timeWindow.date === checkDate &&
    checkTimeStr >= timeWindow.start &&
    checkTimeStr <= timeWindow.end
  );
}
