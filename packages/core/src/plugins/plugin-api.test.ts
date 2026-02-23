import { describe, it, expect } from 'bun:test';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { createPluginApi } from './plugin-api.js';
import { PermissionDeniedError } from './permission-guard.js';
import { createDb, migrate } from '@tardis/db';
import type { SystemConfig } from '@tardis/shared';

const TEST_DB_PATH = `/tmp/tardis-api-test-${randomUUID()}.db`;

function makeDb() {
  migrate(TEST_DB_PATH);
  return createDb(TEST_DB_PATH);
}

const MOCK_CONFIG: SystemConfig = {
  server: { host: '0.0.0.0', port: 3000, dataDir: '/tmp' },
  auth: { jwtSecret: 'a-very-long-secret-that-is-at-least-32-chars', jwtExpiry: '30d' },
  llm: { provider: 'ollama', model: 'qwen3:4b' },
  agent: {
    maxSteps: 10,
    conversationHistoryLength: 10,
    memoryTokenBudget: 2000,
    enableFallbackIntent: true,
    actionOverrides: {},
  },
  proactive: { enabled: true },
};

function cleanup() {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
}

describe('PluginAPI.storage', () => {
  it('can set and get a value with storage permissions', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('my-key', { hello: 'world' });
    const val = await api.storage.get<{ hello: string }>('my-key');
    expect(val).toEqual({ hello: 'world' });
    cleanup();
  });

  it('returns null for missing key', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read'],
      db,
      config: MOCK_CONFIG,
    });

    const val = await api.storage.get('nonexistent');
    expect(val).toBeNull();
    cleanup();
  });

  it('overwrites existing value on set', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('key', 'first');
    await api.storage.set('key', 'second');
    const val = await api.storage.get<string>('key');
    expect(val).toBe('second');
    cleanup();
  });

  it('can delete a key', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('key', 'value');
    await api.storage.delete('key');
    const val = await api.storage.get('key');
    expect(val).toBeNull();
    cleanup();
  });

  it('lists keys for this plugin only', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });
    const api2 = createPluginApi({
      pluginName: 'other-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('alpha', 1);
    await api.storage.set('beta', 2);
    await api2.storage.set('gamma', 3); // different plugin

    const keys = await api.storage.list();
    expect(keys).toContain('alpha');
    expect(keys).toContain('beta');
    expect(keys).not.toContain('gamma');
    cleanup();
  });

  it('lists keys with prefix filter', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('session:abc', 1);
    await api.storage.set('session:def', 2);
    await api.storage.set('config:main', 3);

    const sessionKeys = await api.storage.list('session:');
    expect(sessionKeys).toHaveLength(2);
    expect(sessionKeys.every((k) => k.startsWith('session:'))).toBe(true);
    cleanup();
  });

  it('throws PermissionDeniedError on storage:read without permission', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'no-perm-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.get('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('throws PermissionDeniedError on storage:write without permission', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'read-only-plugin',
      permissions: ['storage:read'],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.set('key', 'val')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });
});

describe('PluginAPI.logger', () => {
  it('logger methods are always available (no permission required)', () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    expect(() => api.logger.info('test message')).not.toThrow();
    expect(() => api.logger.warn('test warning')).not.toThrow();
    expect(() => api.logger.error('test error')).not.toThrow();
    expect(() => api.logger.debug('test debug')).not.toThrow();
    cleanup();
  });
});

describe('PluginAPI.events', () => {
  it('emits and receives events via the event emitter', async () => {
    const db = makeDb();
    const received: unknown[] = [];

    const eventEmitter = {
      emit: (name: string, data?: unknown) => {
        if (name === 'test:event') received.push(data);
      },
      on: () => {},
    };

    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      eventEmitter,
    });

    api.events.emit('test:event', { value: 42 });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ value: 42 });
    cleanup();
  });
});

describe('PluginAPI stubs', () => {
  it('notifications.send throws permission denied without notifications:send', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'silent-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.notifications.send('hello')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.getActive throws permission denied without sessions:read', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'no-session-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.sessions.getActive()).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.start throws permission denied without sessions:write', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'no-session-plugin',
      permissions: ['sessions:read'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.sessions.start({ taskName: 'test' })).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('memory.get throws permission denied without memory:read', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'no-memory-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.memory.get('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('http.get throws not-yet-implemented', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'http-plugin',
      permissions: ['http:external'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.http.get('https://example.com')).rejects.toThrow('not yet implemented');
    cleanup();
  });

  it('llm.generate throws not-yet-implemented', async () => {
    const db = makeDb();
    const api = createPluginApi({
      pluginName: 'llm-plugin',
      permissions: ['llm:use'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.llm.generate('hello')).rejects.toThrow('not yet implemented');
    cleanup();
  });
});
