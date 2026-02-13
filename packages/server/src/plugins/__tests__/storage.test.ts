import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PluginStorage } from '../storage';

const TEST_DIR = join(import.meta.dir, '__test-plugins__');

describe('PluginStorage', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test('set and get a value', async () => {
    const storage = new PluginStorage(TEST_DIR, 'test-plugin');

    await storage.set('key1', 'value1');
    const result = await storage.get('key1');

    expect(result).toBe('value1');
  });

  test('get returns undefined for missing key', async () => {
    const storage = new PluginStorage(TEST_DIR, 'test-plugin');

    const result = await storage.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('set overwrites existing value', async () => {
    const storage = new PluginStorage(TEST_DIR, 'test-plugin');

    await storage.set('key1', 'first');
    await storage.set('key1', 'second');

    const result = await storage.get('key1');
    expect(result).toBe('second');
  });

  test('stores complex objects', async () => {
    const storage = new PluginStorage(TEST_DIR, 'test-plugin');

    const data = { nested: { array: [1, 2, 3], flag: true } };
    await storage.set('complex', data);

    const result = await storage.get('complex');
    expect(result).toEqual(data);
  });

  test('delete removes a key', async () => {
    const storage = new PluginStorage(TEST_DIR, 'test-plugin');

    await storage.set('key1', 'value1');
    await storage.delete('key1');

    const result = await storage.get('key1');
    expect(result).toBeUndefined();
  });

  test('clear removes all keys', async () => {
    const storage = new PluginStorage(TEST_DIR, 'test-plugin');

    await storage.set('a', 1);
    await storage.set('b', 2);
    await storage.clear();

    expect(await storage.get('a')).toBeUndefined();
    expect(await storage.get('b')).toBeUndefined();
  });

  test('persists data across instances', async () => {
    const storage1 = new PluginStorage(TEST_DIR, 'test-plugin');
    await storage1.set('persistent', 'data');

    // New instance should load from disk
    const storage2 = new PluginStorage(TEST_DIR, 'test-plugin');
    const result = await storage2.get('persistent');

    expect(result).toBe('data');
  });

  test('creates storage directory if it does not exist', () => {
    const storageDir = join(TEST_DIR, 'new-plugin', 'storage');
    expect(existsSync(storageDir)).toBe(false);

    new PluginStorage(TEST_DIR, 'new-plugin');

    expect(existsSync(storageDir)).toBe(true);
  });

  test('isolates data between plugins', async () => {
    const storageA = new PluginStorage(TEST_DIR, 'plugin-a');
    const storageB = new PluginStorage(TEST_DIR, 'plugin-b');

    await storageA.set('shared-key', 'from-a');
    await storageB.set('shared-key', 'from-b');

    expect(await storageA.get('shared-key')).toBe('from-a');
    expect(await storageB.get('shared-key')).toBe('from-b');
  });
});
