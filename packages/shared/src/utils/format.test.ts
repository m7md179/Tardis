import { describe, test, expect } from 'bun:test';
import {
  success,
  error,
  warning,
  info,
  formatStatus,
  formatTaskName,
  formatDurationColored,
  heading,
  dim,
  bold,
  code,
  url,
  keyValue,
  bullet,
  numbered,
  stripColors,
} from './format';

describe('message formatters', () => {
  test('success formats with checkmark', () => {
    const result = success('Task completed');
    expect(stripColors(result)).toBe('✓ Task completed');
  });

  test('error formats with cross', () => {
    const result = error('Task failed');
    expect(stripColors(result)).toBe('✗ Task failed');
  });

  test('warning formats with warning symbol', () => {
    const result = warning('Task incomplete');
    expect(stripColors(result)).toBe('⚠ Task incomplete');
  });

  test('info formats with info symbol', () => {
    const result = info('Task details');
    expect(stripColors(result)).toBe('ℹ Task details');
  });
});

describe('formatStatus', () => {
  test('formats ACTIVE status', () => {
    const result = formatStatus('ACTIVE');
    expect(stripColors(result)).toBe('ACTIVE');
    expect(result).toContain('\x1b['); // Has color codes
  });

  test('formats PAUSED status', () => {
    const result = formatStatus('PAUSED');
    expect(stripColors(result)).toBe('PAUSED');
    expect(result).toContain('\x1b[');
  });

  test('formats COMPLETED status', () => {
    const result = formatStatus('COMPLETED');
    expect(stripColors(result)).toBe('COMPLETED');
    expect(result).toContain('\x1b[');
  });
});

describe('formatTaskName', () => {
  test('formats task name with bold and cyan', () => {
    const result = formatTaskName('My Task');
    expect(stripColors(result)).toBe('My Task');
    expect(result).toContain('\x1b['); // Has color codes
  });
});

describe('formatDurationColored', () => {
  test('formats long duration in green', () => {
    const result = formatDurationColored('4h 30m');
    expect(stripColors(result)).toBe('4h 30m');
    expect(result).toContain('\x1b['); // Has color codes
  });

  test('formats medium duration in yellow', () => {
    const result = formatDurationColored('2h 15m');
    expect(stripColors(result)).toBe('2h 15m');
    expect(result).toContain('\x1b[');
  });

  test('formats short duration in gray', () => {
    const result = formatDurationColored('45m');
    expect(stripColors(result)).toBe('45m');
    expect(result).toContain('\x1b[');
  });

  test('formats very short duration in gray', () => {
    const result = formatDurationColored('30s');
    expect(stripColors(result)).toBe('30s');
    expect(result).toContain('\x1b[');
  });
});

describe('text formatters', () => {
  test('heading formats with bold and underline', () => {
    const result = heading('Section Title');
    expect(stripColors(result)).toBe('Section Title');
    expect(result).toContain('\x1b[');
  });

  test('dim formats with dim style', () => {
    const result = dim('Secondary info');
    expect(stripColors(result)).toBe('Secondary info');
    expect(result).toContain('\x1b[');
  });

  test('bold formats with bold style', () => {
    const result = bold('Important');
    expect(stripColors(result)).toBe('Important');
    expect(result).toContain('\x1b[');
  });

  test('code formats with cyan', () => {
    const result = code('function()');
    expect(stripColors(result)).toBe('function()');
    expect(result).toContain('\x1b[');
  });

  test('url formats with blue and underline', () => {
    const result = url('https://example.com');
    expect(stripColors(result)).toBe('https://example.com');
    expect(result).toContain('\x1b[');
  });
});

describe('list formatters', () => {
  test('keyValue formats key-value pair', () => {
    const result = keyValue('Name', 'Value');
    expect(stripColors(result)).toBe('Name: Value');
  });

  test('bullet formats bullet point', () => {
    const result = bullet('List item');
    expect(stripColors(result)).toBe('• List item');
  });

  test('numbered formats numbered item', () => {
    const result = numbered(1, 'First item');
    expect(stripColors(result)).toBe('1. First item');
  });

  test('numbered formats multiple items', () => {
    expect(stripColors(numbered(1, 'First'))).toBe('1. First');
    expect(stripColors(numbered(2, 'Second'))).toBe('2. Second');
    expect(stripColors(numbered(10, 'Tenth'))).toBe('10. Tenth');
  });
});

describe('stripColors', () => {
  test('removes ANSI color codes', () => {
    const colored = '\x1b[32mGreen text\x1b[0m';
    expect(stripColors(colored)).toBe('Green text');
  });

  test('removes multiple color codes', () => {
    const colored = '\x1b[1m\x1b[31mBold red\x1b[0m text';
    expect(stripColors(colored)).toBe('Bold red text');
  });

  test('returns plain text unchanged', () => {
    expect(stripColors('Plain text')).toBe('Plain text');
  });

  test('handles empty string', () => {
    expect(stripColors('')).toBe('');
  });
});
