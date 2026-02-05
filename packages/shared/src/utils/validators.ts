/**
 * Sanitize task name for use in filenames
 * - Removes special characters except hyphens, underscores, and spaces
 * - Converts spaces to underscores
 * - Converts to lowercase
 * - Limits to 50 characters
 */
export function sanitizeTaskName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9-_\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
      .substring(0, 50)
  );
}

/**
 * Validate Todoist API token format
 * Todoist tokens are 40-character hexadecimal strings
 */
export function isValidTodoistToken(token: string): boolean {
  return /^[a-f0-9]{40}$/.test(token);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate UUID v4 format
 */
export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Validate HH:MM time format
 */
export function isValidTimeFormat(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time);
}

/**
 * Validate YYYY-MM-DD date format
 */
export function isValidDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Validate ISO 8601 datetime format
 */
export function isValidISODateTime(datetime: string): boolean {
  const isoPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  return isoPattern.test(datetime);
}

/**
 * Validate port number (1-65535)
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Validate URL format
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize filename by removing or replacing invalid characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 255); // Max filename length
}

/**
 * Validate that a string is not empty or only whitespace
 */
export function isNonEmptyString(str: string): boolean {
  return typeof str === 'string' && str.trim().length > 0;
}

/**
 * Validate positive integer
 */
export function isPositiveInteger(num: number): boolean {
  return Number.isInteger(num) && num > 0;
}

/**
 * Validate non-negative integer
 */
export function isNonNegativeInteger(num: number): boolean {
  return Number.isInteger(num) && num >= 0;
}
