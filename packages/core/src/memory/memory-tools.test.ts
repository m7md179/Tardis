import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { MemoryStore } from './memory-store.js';
import { createMemoryExecutor, MEMORY_TOOLS } from './memory-tools.js';
import type { MemoryExecutor } from './memory-tools.js';

function makeTestDb() {
  const path = `/tmp/tardis-memtools-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

describe('memory-tools', () => {
  let store: MemoryStore;
  let executor: MemoryExecutor;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = makeTestDb();
    store = new MemoryStore(testDb.db);
    executor = createMemoryExecutor(store);
    cleanup = testDb.cleanup;
  });

  afterEach(() => cleanup());

  describe('MEMORY_TOOLS definitions', () => {
    it('should define 3 tools', () => {
      expect(MEMORY_TOOLS.length).toBe(3);
    });

    it('should have correct tool names', () => {
      const names = MEMORY_TOOLS.map((t) => t.name);
      expect(names).toContain('memory.save');
      expect(names).toContain('memory.recall');
      expect(names).toContain('memory.forget');
    });

    it('should all be direct action type', () => {
      for (const tool of MEMORY_TOOLS) {
        expect(tool.actionType).toBe('direct');
      }
    });
  });

  describe('memory.save', () => {
    it('should save a new memory', async () => {
      const result = await executor.execute('memory.save', {
        key: 'ahmad_email',
        value: 'ahmad@example.com',
        type: 'user_fact',
      });

      expect(result).toEqual({ success: true, message: 'Saved "ahmad_email" to memory' });

      const stored = await store.getByKey('ahmad_email');
      expect(stored).not.toBeNull();
      expect(stored!.value).toBe('ahmad@example.com');
    });

    it('should default type to user_fact', async () => {
      await executor.execute('memory.save', {
        key: 'test_key',
        value: 'test_value',
      });

      const stored = await store.getByKey('test_key');
      expect(stored!.type).toBe('user_fact');
    });

    it('should upsert existing memory', async () => {
      await executor.execute('memory.save', { key: 'color', value: 'blue' });
      await executor.execute('memory.save', { key: 'color', value: 'green' });

      const stored = await store.getByKey('color');
      expect(stored!.value).toBe('green');
    });

    it('should reject empty key or value', async () => {
      const result = await executor.execute('memory.save', { key: '', value: 'test' });
      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  describe('memory.recall', () => {
    it('should find matching memories', async () => {
      await store.create({ type: 'user_fact', key: 'ahmad_email', value: 'ahmad@example.com' });

      const result = (await executor.execute('memory.recall', { query: 'ahmad' })) as {
        success: boolean;
        memories: { key: string; value: string }[];
      };

      expect(result.success).toBe(true);
      expect(result.memories.length).toBe(1);
      expect(result.memories[0]!.key).toBe('ahmad_email');
    });

    it('should return empty when no matches', async () => {
      const result = (await executor.execute('memory.recall', { query: 'nonexistent' })) as {
        success: boolean;
        memories: unknown[];
        message: string;
      };

      expect(result.success).toBe(true);
      expect(result.memories).toEqual([]);
    });
  });

  describe('memory.forget', () => {
    it('should delete an existing memory', async () => {
      await store.create({ type: 'user_fact', key: 'to_forget', value: 'bye' });

      const result = await executor.execute('memory.forget', { key: 'to_forget' });
      expect(result).toEqual({ success: true, message: 'Forgot "to_forget"' });

      const stored = await store.getByKey('to_forget');
      expect(stored).toBeNull();
    });

    it('should return failure for non-existent key', async () => {
      const result = (await executor.execute('memory.forget', { key: 'nope' })) as {
        success: boolean;
      };
      expect(result.success).toBe(false);
    });
  });
});
