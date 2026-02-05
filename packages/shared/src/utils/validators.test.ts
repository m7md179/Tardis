import { describe, test, expect } from 'bun:test';
import {
  sanitizeTaskName,
  isValidTodoistToken,
  isValidEmail,
  isValidUUID,
  isValidTimeFormat,
  isValidDateFormat,
  isValidISODateTime,
  isValidPort,
  isValidURL,
  sanitizeFilename,
  isNonEmptyString,
  isPositiveInteger,
  isNonNegativeInteger,
} from './validators';

describe('sanitizeTaskName', () => {
  test('converts to lowercase', () => {
    expect(sanitizeTaskName('My Task')).toBe('my_task');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeTaskName('my task name')).toBe('my_task_name');
  });

  test('removes special characters', () => {
    expect(sanitizeTaskName('task@#$%name')).toBe('taskname');
  });

  test('keeps hyphens and underscores', () => {
    expect(sanitizeTaskName('my-task_name')).toBe('my-task_name');
  });

  test('truncates to 50 characters', () => {
    const longName = 'a'.repeat(100);
    expect(sanitizeTaskName(longName).length).toBe(50);
  });

  test('handles multiple consecutive spaces', () => {
    expect(sanitizeTaskName('my    task    name')).toBe('my_task_name');
  });

  test('handles empty string', () => {
    expect(sanitizeTaskName('')).toBe('');
  });
});

describe('isValidTodoistToken', () => {
  test('validates correct 40-char hex token', () => {
    expect(isValidTodoistToken('a'.repeat(40))).toBe(true);
    expect(isValidTodoistToken('0123456789abcdef' + 'f'.repeat(24))).toBe(true);
  });

  test('rejects tokens with wrong length', () => {
    expect(isValidTodoistToken('a'.repeat(39))).toBe(false);
    expect(isValidTodoistToken('a'.repeat(41))).toBe(false);
  });

  test('rejects tokens with non-hex characters', () => {
    expect(isValidTodoistToken('g'.repeat(40))).toBe(false);
    expect(isValidTodoistToken('Z'.repeat(40))).toBe(false);
    expect(isValidTodoistToken('!' + 'a'.repeat(39))).toBe(false);
  });

  test('rejects uppercase hex', () => {
    expect(isValidTodoistToken('A'.repeat(40))).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidTodoistToken('')).toBe(false);
  });
});

describe('isValidEmail', () => {
  test('validates correct email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('test.user@example.co.uk')).toBe(true);
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  test('rejects invalid email formats', () => {
    expect(isValidEmail('invalid')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('user example@test.com')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});

describe('isValidUUID', () => {
  test('validates correct UUID v4', () => {
    expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('rejects invalid UUID formats', () => {
    expect(isValidUUID('123e4567-e89b-12d3-a456')).toBe(false);
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
  });

  test('rejects UUIDs with wrong version', () => {
    // Version 1 UUID
    expect(isValidUUID('123e4567-e89b-11d3-a456-426614174000')).toBe(false);
  });
});

describe('isValidTimeFormat', () => {
  test('validates correct HH:MM format', () => {
    expect(isValidTimeFormat('09:00')).toBe(true);
    expect(isValidTimeFormat('23:59')).toBe(true);
    expect(isValidTimeFormat('00:00')).toBe(true);
  });

  test('rejects invalid time formats', () => {
    expect(isValidTimeFormat('9:00')).toBe(false);
    expect(isValidTimeFormat('09:0')).toBe(false);
    expect(isValidTimeFormat('25:00')).toBe(false);
    expect(isValidTimeFormat('invalid')).toBe(false);
    expect(isValidTimeFormat('')).toBe(false);
  });
});

describe('isValidDateFormat', () => {
  test('validates correct YYYY-MM-DD format', () => {
    expect(isValidDateFormat('2024-01-15')).toBe(true);
    expect(isValidDateFormat('2024-12-31')).toBe(true);
  });

  test('rejects invalid date formats', () => {
    expect(isValidDateFormat('2024-1-15')).toBe(false);
    expect(isValidDateFormat('24-01-15')).toBe(false);
    expect(isValidDateFormat('2024/01/15')).toBe(false);
    expect(isValidDateFormat('invalid')).toBe(false);
    expect(isValidDateFormat('')).toBe(false);
  });
});

describe('isValidISODateTime', () => {
  test('validates correct ISO 8601 datetime', () => {
    expect(isValidISODateTime('2024-01-15T09:30:45Z')).toBe(true);
    expect(isValidISODateTime('2024-01-15T09:30:45.123Z')).toBe(true);
    expect(isValidISODateTime('2024-01-15T09:30:45+00:00')).toBe(true);
    expect(isValidISODateTime('2024-01-15T09:30:45-05:00')).toBe(true);
  });

  test('rejects invalid datetime formats', () => {
    expect(isValidISODateTime('2024-01-15')).toBe(false);
    expect(isValidISODateTime('2024-01-15 09:30:45')).toBe(false);
    expect(isValidISODateTime('invalid')).toBe(false);
    expect(isValidISODateTime('')).toBe(false);
  });
});

describe('isValidPort', () => {
  test('validates correct port numbers', () => {
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(443)).toBe(true);
    expect(isValidPort(3000)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  test('rejects invalid port numbers', () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(100000)).toBe(false);
  });

  test('rejects non-integer ports', () => {
    expect(isValidPort(80.5)).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
  });
});

describe('isValidURL', () => {
  test('validates correct URLs', () => {
    expect(isValidURL('https://example.com')).toBe(true);
    expect(isValidURL('http://example.com')).toBe(true);
    expect(isValidURL('https://example.com/path?query=value')).toBe(true);
  });

  test('rejects invalid URLs', () => {
    expect(isValidURL('not a url')).toBe(false);
    expect(isValidURL('example.com')).toBe(false);
    expect(isValidURL('')).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  test('replaces invalid filename characters', () => {
    expect(sanitizeFilename('file<name>')).toBe('file_name_');
    expect(sanitizeFilename('file:name')).toBe('file_name');
    expect(sanitizeFilename('file/path')).toBe('file_path');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeFilename('my file name')).toBe('my_file_name');
  });

  test('truncates to 255 characters', () => {
    const longName = 'a'.repeat(300);
    expect(sanitizeFilename(longName).length).toBe(255);
  });

  test('handles already valid filenames', () => {
    expect(sanitizeFilename('valid_file-name.txt')).toBe('valid_file-name.txt');
  });
});

describe('isNonEmptyString', () => {
  test('validates non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
    expect(isNonEmptyString(' hello ')).toBe(true);
  });

  test('rejects empty or whitespace-only strings', () => {
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString('\t\n')).toBe(false);
  });
});

describe('isPositiveInteger', () => {
  test('validates positive integers', () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(100)).toBe(true);
    expect(isPositiveInteger(999999)).toBe(true);
  });

  test('rejects zero and negative integers', () => {
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(-100)).toBe(false);
  });

  test('rejects non-integers', () => {
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger(NaN)).toBe(false);
    expect(isPositiveInteger(Infinity)).toBe(false);
  });
});

describe('isNonNegativeInteger', () => {
  test('validates non-negative integers', () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(1)).toBe(true);
    expect(isNonNegativeInteger(100)).toBe(true);
  });

  test('rejects negative integers', () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(-100)).toBe(false);
  });

  test('rejects non-integers', () => {
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger(NaN)).toBe(false);
  });
});
