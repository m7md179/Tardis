import { describe, it, expect } from 'bun:test';
import { formatDuration } from './format-duration.js';

describe('formatDuration', () => {
  it('returns "0s" for zero seconds', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns seconds only for < 60s', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('returns minutes and seconds for 60s–3599s', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('returns hours, minutes, seconds for >= 3600s', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3661)).toBe('1h 1m 1s');
    expect(formatDuration(7200)).toBe('2h');
    expect(formatDuration(7384)).toBe('2h 3m 4s');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(90.9)).toBe('1m 30s');
  });

  it('treats negative values as 0', () => {
    expect(formatDuration(-10)).toBe('0s');
  });
});
