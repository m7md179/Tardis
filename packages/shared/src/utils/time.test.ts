import { describe, test, expect } from 'bun:test';
import {
  parseTimeWindow,
  calculateDuration,
  formatDurationHuman,
  formatTime,
  formatDate,
  formatDateTime,
  getCurrentTimestamp,
  isTimeWindowActive,
  isWithinTimeWindow,
} from './time';

describe('parseTimeWindow', () => {
  test('parses 12-hour format with am/pm', () => {
    const result = parseTimeWindow('[9am-5pm]');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('09:00');
    expect(result?.end).toBe('17:00');
  });

  test('parses 12-hour format with uppercase AM/PM', () => {
    const result = parseTimeWindow('[9AM-5PM]');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('09:00');
    expect(result?.end).toBe('17:00');
  });

  test('parses 12-hour format with noon', () => {
    const result = parseTimeWindow('[10am-12pm]');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('10:00');
    expect(result?.end).toBe('12:00');
  });

  test('parses 12-hour format with midnight', () => {
    const result = parseTimeWindow('[11pm-12am]');
    expect(result).toBeNull(); // Start > end in same day
  });

  test('parses 24-hour format', () => {
    const result = parseTimeWindow('[09:00-17:00]');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('09:00');
    expect(result?.end).toBe('17:00');
  });

  test('parses 24-hour format with single digit hour', () => {
    const result = parseTimeWindow('[9:00-17:00]');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('09:00');
    expect(result?.end).toBe('17:00');
  });

  test('parses without brackets', () => {
    const result = parseTimeWindow('9am-5pm');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('09:00');
    expect(result?.end).toBe('17:00');
  });

  test('parses with extra whitespace', () => {
    const result = parseTimeWindow('  [ 9am - 5pm ]  ');
    expect(result).not.toBeNull();
    expect(result?.start).toBe('09:00');
    expect(result?.end).toBe('17:00');
  });

  test('returns null for invalid format', () => {
    expect(parseTimeWindow('9-5')).toBeNull();
    expect(parseTimeWindow('invalid')).toBeNull();
    expect(parseTimeWindow('')).toBeNull();
  });

  test('returns null when start >= end', () => {
    expect(parseTimeWindow('[17:00-09:00]')).toBeNull();
    expect(parseTimeWindow('[09:00-09:00]')).toBeNull();
  });

  test('returns null for invalid hours', () => {
    expect(parseTimeWindow('[25:00-17:00]')).toBeNull();
    expect(parseTimeWindow('[09:00-25:00]')).toBeNull();
  });

  test('returns null for invalid minutes', () => {
    expect(parseTimeWindow('[09:60-17:00]')).toBeNull();
    expect(parseTimeWindow('[09:00-17:60]')).toBeNull();
  });

  test('sets date to today', () => {
    const result = parseTimeWindow('[9am-5pm]');
    expect(result).not.toBeNull();
    // Date should be in YYYY-MM-DD format
    expect(result?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('calculateDuration', () => {
  test('calculates duration between two timestamps', () => {
    const start = '2024-01-15T09:00:00Z';
    const end = '2024-01-15T10:30:00Z';
    expect(calculateDuration(start, end)).toBe(5400); // 90 minutes
  });

  test('calculates duration across hours', () => {
    const start = '2024-01-15T09:00:00Z';
    const end = '2024-01-15T17:00:00Z';
    expect(calculateDuration(start, end)).toBe(28800); // 8 hours
  });

  test('calculates duration with seconds', () => {
    const start = '2024-01-15T09:00:00Z';
    const end = '2024-01-15T09:00:45Z';
    expect(calculateDuration(start, end)).toBe(45);
  });

  test('returns 0 for same timestamps', () => {
    const time = '2024-01-15T09:00:00Z';
    expect(calculateDuration(time, time)).toBe(0);
  });
});

describe('formatDurationHuman', () => {
  test('formats hours and minutes', () => {
    expect(formatDurationHuman(7200)).toBe('2h');
    expect(formatDurationHuman(5400)).toBe('1h 30m');
    expect(formatDurationHuman(9090)).toBe('2h 31m');
  });

  test('formats minutes only', () => {
    expect(formatDurationHuman(60)).toBe('1m');
    expect(formatDurationHuman(300)).toBe('5m');
    expect(formatDurationHuman(1800)).toBe('30m');
  });

  test('formats seconds only for short durations', () => {
    expect(formatDurationHuman(30)).toBe('30s');
    expect(formatDurationHuman(45)).toBe('45s');
  });

  test('omits seconds when hours are present', () => {
    expect(formatDurationHuman(3661)).toBe('1h 1m'); // 1h 1m 1s -> shows as 1h 1m
    expect(formatDurationHuman(7230)).toBe('2h 30s'); // 2h 0m 30s -> shows as 2h
  });

  test('formats zero duration', () => {
    expect(formatDurationHuman(0)).toBe('0s');
  });

  test('formats complex durations', () => {
    expect(formatDurationHuman(10825)).toBe('3h 25s'); // 3h 0m 25s
    expect(formatDurationHuman(3723)).toBe('1h 2m'); // 1h 2m 3s
  });
});

describe('formatTime', () => {
  test('formats time from ISO string', () => {
    expect(formatTime('2024-01-15T09:30:45Z')).toBe('09:30:45');
    expect(formatTime('2024-01-15T17:00:00Z')).toBe('17:00:00');
  });

  test('handles different timezones in input', () => {
    const result = formatTime('2024-01-15T09:30:45+00:00');
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatDate', () => {
  test('formats date from ISO string', () => {
    expect(formatDate('2024-01-15T09:30:45Z')).toBe('2024-01-15');
    expect(formatDate('2024-12-31T23:59:59Z')).toBe('2024-12-31');
  });
});

describe('formatDateTime', () => {
  test('formats datetime from ISO string', () => {
    expect(formatDateTime('2024-01-15T09:30:45Z')).toBe('2024-01-15 09:30:45');
    expect(formatDateTime('2024-12-31T23:59:59Z')).toBe('2024-12-31 23:59:59');
  });
});

describe('getCurrentTimestamp', () => {
  test('returns ISO timestamp', () => {
    const timestamp = getCurrentTimestamp();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('returns different timestamps when called multiple times', async () => {
    const ts1 = getCurrentTimestamp();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const ts2 = getCurrentTimestamp();
    expect(ts1).not.toBe(ts2);
  });
});

describe('isTimeWindowActive', () => {
  test('returns true when current time is within window', () => {
    const now = new Date();
    const currentHour = now.getHours();
    const nextHour = (currentHour + 1) % 24;

    const timeWindow = {
      start: `${currentHour.toString().padStart(2, '0')}:00`,
      end: `${nextHour.toString().padStart(2, '0')}:00`,
      date: formatDate(now.toISOString()),
    };

    expect(isTimeWindowActive(timeWindow)).toBe(true);
  });

  test('returns false when date is different', () => {
    const timeWindow = {
      start: '09:00',
      end: '17:00',
      date: '2099-12-31',
    };

    expect(isTimeWindowActive(timeWindow)).toBe(false);
  });
});

describe('isWithinTimeWindow', () => {
  test('returns true when time is within window', () => {
    const timeWindow = {
      start: '09:00',
      end: '17:00',
      date: '2024-01-15',
    };

    const checkTime = new Date('2024-01-15T12:00:00Z');
    expect(isWithinTimeWindow(timeWindow, checkTime)).toBe(true);
  });

  test('returns false when time is before window', () => {
    const timeWindow = {
      start: '09:00',
      end: '17:00',
      date: '2024-01-15',
    };

    const checkTime = new Date('2024-01-15T08:00:00Z');
    expect(isWithinTimeWindow(timeWindow, checkTime)).toBe(false);
  });

  test('returns false when time is after window', () => {
    const timeWindow = {
      start: '09:00',
      end: '17:00',
      date: '2024-01-15',
    };

    const checkTime = new Date('2024-01-15T18:00:00Z');
    expect(isWithinTimeWindow(timeWindow, checkTime)).toBe(false);
  });

  test('returns false when date is different', () => {
    const timeWindow = {
      start: '09:00',
      end: '17:00',
      date: '2024-01-15',
    };

    const checkTime = new Date('2024-01-16T12:00:00Z');
    expect(isWithinTimeWindow(timeWindow, checkTime)).toBe(false);
  });

  test('uses current time when checkTime is not provided', () => {
    const now = new Date();
    const timeWindow = {
      start: '00:00',
      end: '23:59',
      date: formatDate(now.toISOString()),
    };

    expect(isWithinTimeWindow(timeWindow)).toBe(true);
  });
});
