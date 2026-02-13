import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Per-plugin persistent key-value storage backed by a JSON file.
 * Data is cached in memory and flushed to disk on every write.
 */
export class PluginStorage {
  private storageFile: string;
  private cache: Map<string, unknown> = new Map();

  constructor(pluginsDir: string, pluginName: string) {
    const storageDir = join(pluginsDir, pluginName, 'storage');

    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    this.storageFile = join(storageDir, 'data.json');
    this.loadFromDisk();
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.cache.set(key, value);
    this.flush();
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.flush();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.flush();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) return;

    try {
      const content = readFileSync(this.storageFile, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;

      for (const [key, value] of Object.entries(data)) {
        this.cache.set(key, value);
      }
    } catch (error) {
      console.error(`[PluginStorage] Failed to load storage:`, error);
    }
  }

  private flush(): void {
    try {
      const data = Object.fromEntries(this.cache);
      writeFileSync(this.storageFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[PluginStorage] Failed to save storage:`, error);
    }
  }
}
