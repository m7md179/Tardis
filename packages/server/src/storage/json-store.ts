import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Generic JSON file storage
 */
export class JsonStore<T> {
  constructor(private baseDir: string) {
    this.ensureDirectory(baseDir);
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Write JSON to file
   */
  write(filepath: string, data: T): void {
    const fullPath = join(this.baseDir, filepath);
    this.ensureDirectory(dirname(fullPath));
    writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Read JSON from file
   */
  read(filepath: string): T | null {
    const fullPath = join(this.baseDir, filepath);
    if (!existsSync(fullPath)) {
      return null;
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      console.error(`Failed to read ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Delete file
   */
  delete(filepath: string): boolean {
    const fullPath = join(this.baseDir, filepath);
    if (!existsSync(fullPath)) {
      return false;
    }

    try {
      unlinkSync(fullPath);
      return true;
    } catch (error) {
      console.error(`Failed to delete ${filepath}:`, error);
      return false;
    }
  }

  /**
   * List all JSON files in directory
   */
  list(subdir: string = ''): string[] {
    const fullPath = join(this.baseDir, subdir);
    if (!existsSync(fullPath)) {
      return [];
    }

    return readdirSync(fullPath, { withFileTypes: true })
      .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.json'))
      .map((dirent) => join(subdir, dirent.name));
  }

  /**
   * List all subdirectories
   */
  listDirectories(subdir: string = ''): string[] {
    const fullPath = join(this.baseDir, subdir);
    if (!existsSync(fullPath)) {
      return [];
    }

    return readdirSync(fullPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  }

  /**
   * Check if file exists
   */
  exists(filepath: string): boolean {
    const fullPath = join(this.baseDir, filepath);
    return existsSync(fullPath);
  }
}
