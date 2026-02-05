import chalk from 'chalk';
import type { SessionStatus } from '../types/session';

/**
 * Format success message with checkmark
 */
export function success(message: string): string {
  return chalk.green(`✓ ${message}`);
}

/**
 * Format error message with cross
 */
export function error(message: string): string {
  return chalk.red(`✗ ${message}`);
}

/**
 * Format warning message with warning symbol
 */
export function warning(message: string): string {
  return chalk.yellow(`⚠ ${message}`);
}

/**
 * Format info message with info symbol
 */
export function info(message: string): string {
  return chalk.blue(`ℹ ${message}`);
}

/**
 * Format session status with color
 */
export function formatStatus(status: SessionStatus): string {
  switch (status) {
    case 'ACTIVE':
      return chalk.green('ACTIVE');
    case 'PAUSED':
      return chalk.yellow('PAUSED');
    case 'COMPLETED':
      return chalk.gray('COMPLETED');
  }
}

/**
 * Format task name with highlighting
 */
export function formatTaskName(name: string): string {
  return chalk.bold.cyan(name);
}

/**
 * Format duration with color based on length
 */
export function formatDurationColored(durationStr: string): string {
  // Parse hours from duration string (e.g., "2h 15m" -> 2)
  const hoursMatch = durationStr.match(/(\d+)h/);
  const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;

  if (hours >= 4) {
    return chalk.green(durationStr); // Long session
  } else if (hours >= 2) {
    return chalk.yellow(durationStr); // Medium session
  } else {
    return chalk.gray(durationStr); // Short session
  }
}

/**
 * Format heading with bold and underline
 */
export function heading(text: string): string {
  return chalk.bold.underline(text);
}

/**
 * Format dim text for secondary information
 */
export function dim(text: string): string {
  return chalk.dim(text);
}

/**
 * Format bold text for emphasis
 */
export function bold(text: string): string {
  return chalk.bold(text);
}

/**
 * Format code/monospace text
 */
export function code(text: string): string {
  return chalk.cyan(text);
}

/**
 * Format URL with color
 */
export function url(text: string): string {
  return chalk.blue.underline(text);
}

/**
 * Format a key-value pair for display
 */
export function keyValue(key: string, value: string): string {
  return `${chalk.gray(key + ':')} ${value}`;
}

/**
 * Format a list bullet point
 */
export function bullet(text: string): string {
  return `${chalk.gray('•')} ${text}`;
}

/**
 * Format a numbered list item
 */
export function numbered(number: number, text: string): string {
  return `${chalk.gray(`${number}.`)} ${text}`;
}

/**
 * Strip ANSI color codes from string (for testing or plain output)
 */
export function stripColors(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
