import { describe, it, expect } from 'bun:test';
import { isTimeToRun, isDuringQuietHours } from './cron-utils.js';

describe('isTimeToRun', () => {
  it('should match every-minute cron at any time', () => {
    const now = new Date('2026-02-26T14:30:00');
    expect(isTimeToRun('* * * * *', now)).toBe(true);
  });

  it('should match specific minute', () => {
    const now = new Date('2026-02-26T14:30:00');
    expect(isTimeToRun('30 14 * * *', now)).toBe(true);
  });

  it('should not match wrong minute', () => {
    const now = new Date('2026-02-26T14:31:00');
    expect(isTimeToRun('30 14 * * *', now)).toBe(false);
  });

  it('should match every-15-minutes cron', () => {
    const now = new Date('2026-02-26T14:15:00');
    expect(isTimeToRun('*/15 * * * *', now)).toBe(true);
  });

  it('should not match every-15-minutes at :16', () => {
    const now = new Date('2026-02-26T14:16:30');
    expect(isTimeToRun('*/15 * * * *', now)).toBe(false);
  });

  it('should return false for invalid cron', () => {
    expect(isTimeToRun('invalid cron', new Date())).toBe(false);
  });

  it('should match 0 18 * * * at 18:00', () => {
    const now = new Date('2026-02-26T18:00:30');
    expect(isTimeToRun('0 18 * * *', now)).toBe(true);
  });
});

describe('isDuringQuietHours', () => {
  it('should return false if start/end not provided', () => {
    const now = new Date('2026-02-26T23:00:00');
    expect(isDuringQuietHours(now)).toBe(false);
    expect(isDuringQuietHours(now, undefined, undefined)).toBe(false);
  });

  it('should detect same-day quiet hours', () => {
    const now = new Date('2026-02-26T12:00:00');
    expect(isDuringQuietHours(now, '09:00', '17:00')).toBe(true);
  });

  it('should not be quiet outside same-day range', () => {
    const now = new Date('2026-02-26T18:00:00');
    expect(isDuringQuietHours(now, '09:00', '17:00')).toBe(false);
  });

  it('should handle midnight-wrapping quiet hours (in range)', () => {
    const now = new Date('2026-02-26T23:30:00');
    expect(isDuringQuietHours(now, '22:00', '08:00')).toBe(true);
  });

  it('should handle midnight-wrapping quiet hours (after midnight, still quiet)', () => {
    const now = new Date('2026-02-27T03:00:00');
    expect(isDuringQuietHours(now, '22:00', '08:00')).toBe(true);
  });

  it('should handle midnight-wrapping quiet hours (outside range)', () => {
    const now = new Date('2026-02-26T12:00:00');
    expect(isDuringQuietHours(now, '22:00', '08:00')).toBe(false);
  });

  it('should return false for invalid time format', () => {
    const now = new Date('2026-02-26T12:00:00');
    expect(isDuringQuietHours(now, 'bad', 'format')).toBe(false);
  });
});
