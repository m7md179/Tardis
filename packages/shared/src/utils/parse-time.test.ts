import { describe, it, expect } from 'bun:test';
import { parseTimeToSeconds, parseTimeWindow } from './parse-time.js';

describe('parseTimeToSeconds', () => {
  it('parses hours', () => {
    expect(parseTimeToSeconds('2h')).toBe(7200);
    expect(parseTimeToSeconds('1hour')).toBe(3600);
    expect(parseTimeToSeconds('1.5h')).toBe(5400);
  });

  it('parses minutes', () => {
    expect(parseTimeToSeconds('30m')).toBe(1800);
    expect(parseTimeToSeconds('90min')).toBe(5400);
    expect(parseTimeToSeconds('90minutes')).toBe(5400);
  });

  it('parses seconds', () => {
    expect(parseTimeToSeconds('45s')).toBe(45);
    expect(parseTimeToSeconds('120sec')).toBe(120);
  });

  it('parses combined values', () => {
    expect(parseTimeToSeconds('2h 30m')).toBe(9000);
    expect(parseTimeToSeconds('1h 30m 15s')).toBe(5415);
    expect(parseTimeToSeconds('1h15m')).toBe(4500);
  });

  it('returns null for empty string', () => {
    expect(parseTimeToSeconds('')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseTimeToSeconds('hello')).toBeNull();
  });

  it('floors fractional seconds', () => {
    expect(parseTimeToSeconds('1.5s')).toBe(1);
  });
});

describe('parseTimeWindow', () => {
  it('parses 24h time windows', () => {
    expect(parseTimeWindow('[14:00-15:30]')).toEqual({ start: '14:00', end: '15:30' });
    expect(parseTimeWindow('[09:00-17:00]')).toEqual({ start: '09:00', end: '17:00' });
  });

  it('parses 12h am/pm time windows', () => {
    expect(parseTimeWindow('[9am-5pm]')).toEqual({ start: '09:00', end: '17:00' });
    expect(parseTimeWindow('[12pm-3pm]')).toEqual({ start: '12:00', end: '15:00' });
    expect(parseTimeWindow('[12am-6am]')).toEqual({ start: '00:00', end: '06:00' });
  });

  it('handles em dash and surrounding text', () => {
    const result = parseTimeWindow('Meeting [10am–11am] with team');
    expect(result).toEqual({ start: '10:00', end: '11:00' });
  });

  it('returns null when no time window present', () => {
    expect(parseTimeWindow('Buy groceries')).toBeNull();
    expect(parseTimeWindow('')).toBeNull();
  });
});
