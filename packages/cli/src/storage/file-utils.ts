import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDirectoryExists(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

/**
 * Check if a path exists
 */
export function pathExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Check if a path is a directory
 */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a file
 */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Get all JSON files in a directory
 */
export function getJsonFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  try {
    const files = readdirSync(dirPath);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => join(dirPath, file));
  } catch {
    return [];
  }
}

/**
 * Get all subdirectories in a directory
 */
export function getSubdirectories(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  try {
    const items = readdirSync(dirPath);
    return items
      .map((item) => join(dirPath, item))
      .filter((itemPath) => isDirectory(itemPath));
  } catch {
    return [];
  }
}

/**
 * Parse a date directory name (YYYY-MM-DD) to Date
 */
export function parseDateDirectory(dirname: string): Date | null {
  try {
    // Match YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dirname)) {
      return null;
    }

    const date = new Date(dirname);
    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  } catch {
    return null;
  }
}

/**
 * Format date as YYYY-MM-DD for directory names
 */
export function formatDateForDirectory(date: Date): string {
  return date.toISOString().split('T')[0];
}
