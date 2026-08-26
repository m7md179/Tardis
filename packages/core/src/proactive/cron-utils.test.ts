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

// ─── Firing exactly once per occurrence ──────────────────────────────────────
//
// Production evidence: `0 * * * *` fired at :59 and again at :00, every hour,
// 429 times each. The old check accepted any occurrence within 60s of `now` in
// either direction, so the tick before the hour and the tick after it both
// matched the same occurrence. Every scheduled message arrived twice.

describe('isTimeToRun: fires once per occurrence', () => {
  it('does not fire in the minute BEFORE the scheduled time', () => {
    expect(isTimeToRun('0 18 * * *', new Date('2026-02-26T17:59:33'))).toBe(false);
  });

  it('fires in the scheduled minute', () => {
    expect(isTimeToRun('0 18 * * *', new Date('2026-02-26T18:00:33'))).toBe(true);
  });

  it('does not fire in the minute after', () => {
    expect(isTimeToRun('0 18 * * *', new Date('2026-02-26T18:01:33'))).toBe(false);
  });

  it('an hourly schedule matches the top of the hour only', () => {
    const fires = [];
    for (let m = 57; m < 63; m++) {
      const t = new Date(Date.UTC(2026, 1, 26, 12, 0, 0));
      t.setMinutes(m);
      if (isTimeToRun('0 * * * *', t)) fires.push(t.getHours() + ':' + t.getMinutes());
    }
    expect(fires).toHaveLength(1);
  });
});

// ─── Drift ───────────────────────────────────────────────────────────────────
//
// setInterval(60s) wanders — observed offsets :33, :43, :55 across one day. A
// strict same-minute check would eventually step straight over an occurrence
// and skip it silently, so the scheduler passes the previous tick time and asks
// for occurrences in the interval it actually covered.

describe('isTimeToRun: interval form survives tick drift', () => {
  it('catches an occurrence the tick stepped over', () => {
    const previous = new Date('2026-02-26T17:59:59.500');
    const now = new Date('2026-02-26T18:01:00.100');
    expect(isTimeToRun('0 18 * * *', now, previous)).toBe(true);
  });

  it('does not re-fire the same occurrence on the next tick', () => {
    const previous = new Date('2026-02-26T18:01:00.100');
    const now = new Date('2026-02-26T18:02:00.300');
    expect(isTimeToRun('0 18 * * *', now, previous)).toBe(false);
  });

  it('fires nothing when no time has passed (a restart must not replay)', () => {
    const t = new Date('2026-02-26T18:00:30');
    expect(isTimeToRun('0 18 * * *', t, t)).toBe(false);
  });
});
