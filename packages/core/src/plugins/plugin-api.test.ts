import { describe, it, expect } from 'bun:test';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { createPluginApi } from './plugin-api.js';
import { PermissionDeniedError } from './permission-guard.js';
import { createDb, migrate } from '@tardis/db';
import type { SystemConfig } from '@tardis/shared';

// ─── Test DB helpers ───

/** Each test gets its own isolated DB to prevent cross-test pollution. */
function makeTestDb() {
  const path = `/tmp/tardis-api-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
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
    readOnly: false,
  },
  proactive: { enabled: true },
  memory: {},
  rateLimit: { enabled: false, windowMs: 60000, maxRequests: 120, maxLoginAttempts: 5 },
};

// ─── Storage ───

describe('PluginAPI.storage: basic CRUD', () => {
  it('set() and get() round-trip a value', async () => {
    const { db, cleanup } = makeTestDb();
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

  it('get() returns null for a key that does not exist', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read'],
      db,
      config: MOCK_CONFIG,
    });

    expect(await api.storage.get('nonexistent')).toBeNull();
    cleanup();
  });

  it('set() overwrites an existing value', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('key', 'first');
    await api.storage.set('key', 'second');
    expect(await api.storage.get<string>('key')).toBe('second');
    cleanup();
  });

  it('delete() removes a key so get() returns null', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('key', 'value');
    await api.storage.delete('key');
    expect(await api.storage.get('key')).toBeNull();
    cleanup();
  });

  it('list() returns all keys for this plugin', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await api.storage.set('alpha', 1);
    await api.storage.set('beta', 2);
    const keys = await api.storage.list();
    expect(keys).toContain('alpha');
    expect(keys).toContain('beta');
    cleanup();
  });

  it('list() filters by prefix', async () => {
    const { db, cleanup } = makeTestDb();
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
});

describe('PluginAPI.storage: namespace isolation', () => {
  it('Plugin A cannot see Plugin B keys via list()', async () => {
    const { db, cleanup } = makeTestDb();
    const apiA = createPluginApi({
      pluginName: 'plugin-a',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });
    const apiB = createPluginApi({
      pluginName: 'plugin-b',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    await apiA.storage.set('alpha', 1);
    await apiA.storage.set('beta', 2);
    await apiB.storage.set('gamma', 3);

    const keysA = await apiA.storage.list();
    expect(keysA).toContain('alpha');
    expect(keysA).toContain('beta');
    expect(keysA).not.toContain('gamma');

    const keysB = await apiB.storage.list();
    expect(keysB).toContain('gamma');
    expect(keysB).not.toContain('alpha');
    cleanup();
  });

  it('Plugin A cannot read Plugin B key via get() — returns null', async () => {
    const { db, cleanup } = makeTestDb();
    const apiA = createPluginApi({
      pluginName: 'plugin-a',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });
    const apiB = createPluginApi({
      pluginName: 'plugin-b',
      permissions: ['storage:read', 'storage:write'],
      db,
      config: MOCK_CONFIG,
    });

    // Plugin B sets a value under the same key name as plugin A will try to read
    await apiB.storage.set('shared-key-name', 'secret-value');

    // Plugin A reads same key name — should get null (different namespace)
    const val = await apiA.storage.get('shared-key-name');
    expect(val).toBeNull();
    cleanup();
  });
});

describe('PluginAPI.storage: permission enforcement', () => {
  it('storage:read allows get() and list()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'read-only-plugin',
      permissions: ['storage:read'],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.get('key')).resolves.toBeNull();
    await expect(api.storage.list()).resolves.toEqual([]);
    cleanup();
  });

  it('storage:read does NOT allow set()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'read-only-plugin',
      permissions: ['storage:read'],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.set('key', 'val')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('storage:read does NOT allow delete()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'read-only-plugin',
      permissions: ['storage:read'],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.delete('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('no permissions throws PermissionDeniedError on storage.get()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-perm-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.get('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('no permissions throws PermissionDeniedError on storage.list()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-perm-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.storage.list()).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });
});

// ─── Logger ───

describe('PluginAPI.logger', () => {
  it('all logger methods are available with no permissions', () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-perm-plugin',
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

  it('logger methods accept optional data argument', () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    expect(() => api.logger.info('event fired', { userId: '123' })).not.toThrow();
    expect(() => api.logger.error('something broke', new Error('oops'))).not.toThrow();
    cleanup();
  });
});

// ─── Config ───

describe('PluginAPI.config', () => {
  it('config.get() is available with no permissions and returns null (stub)', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-perm-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    expect(await api.config.get('any-key')).toBeNull();
    cleanup();
  });

  it('config.set() refuses loudly when there is nowhere to persist', async () => {
    // It used to resolve and discard the value. A setting that vanishes without
    // a word is worse than one that refuses to save — the first is a bug you
    // find weeks later, the second is a message.
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-perm-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });

    await expect(api.config.set('key', 'value')).rejects.toThrow(/no config writer/);
    cleanup();
  });

  it('returns a declared default when the system config says nothing', async () => {
    // The bug this fixes: get() looked only at the system config, so a
    // manifest's own defaults were dead weight and every plugin carried its own
    // DEFAULTS constant and merge loop to compensate.
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'web',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      configSchema: {
        searxngUrl: {
          type: 'string',
          label: 'SearXNG URL',
          default: 'http://localhost:8888',
        },
      },
    });

    expect(await api.config.get<string>('searxngUrl')).toBe('http://localhost:8888');
    cleanup();
  });

  it('persists a valid write and reads it straight back', async () => {
    const { db, cleanup } = makeTestDb();
    const written: [string, string, unknown][] = [];
    const api = createPluginApi({
      pluginName: 'web',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      configSchema: { maxResults: { type: 'number', label: 'Results', default: 5, max: 20 } },
      persistConfig: async (plugin, key, value) => {
        written.push([plugin, key, value]);
      },
    });

    await api.config.set('maxResults', 8);
    expect(written).toEqual([['web', 'maxResults', 8]]);
    // Visible to the running plugin without a restart.
    expect(await api.config.get<number>('maxResults')).toBe(8);
    cleanup();
  });

  it('rejects a write the schema forbids', async () => {
    const { db, cleanup } = makeTestDb();
    let persisted = false;
    const api = createPluginApi({
      pluginName: 'web',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      configSchema: { maxResults: { type: 'number', label: 'Results', default: 5, max: 20 } },
      persistConfig: async () => {
        persisted = true;
      },
    });

    await expect(api.config.set('maxResults', 500)).rejects.toThrow(/at most 20/);
    expect(persisted).toBe(false);
    cleanup();
  });
});

// ─── Events ───

describe('PluginAPI.events', () => {
  it('events.emit() forwards the event to the event emitter', () => {
    const { db, cleanup } = makeTestDb();
    const received: unknown[] = [];

    const eventEmitter = {
      emit: (_name: string, data?: unknown) => {
        received.push(data);
      },
      on: (_name: string, _handler: (data: unknown) => void) => {},
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

  it('events.on() registers a handler that receives emitted events', () => {
    const { db, cleanup } = makeTestDb();

    // A real in-memory event emitter to test full round-trip
    const handlers = new Map<string, ((data: unknown) => void)[]>();
    const eventEmitter = {
      emit: (name: string, data?: unknown) => {
        (handlers.get(name) ?? []).forEach((h) => h(data));
      },
      on: (name: string, handler: (data: unknown) => void) => {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
    };

    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      eventEmitter,
    });

    const received: unknown[] = [];
    api.events.on('task:completed', (data) => received.push(data));

    api.events.emit('task:completed', { taskId: 'abc', duration: 60 });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ taskId: 'abc', duration: 60 });
    cleanup();
  });

  it('events work without a registered eventEmitter (no-op, no crash)', () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'test-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      // no eventEmitter
    });

    expect(() => api.events.emit('some:event', { x: 1 })).not.toThrow();
    expect(() => api.events.on('some:event', () => {})).not.toThrow();
    cleanup();
  });
});

// ─── Sessions (stub) ───

describe('PluginAPI.sessions: permission enforcement', () => {
  it('sessions.getActive() throws PermissionDeniedError without sessions:read', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-session-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.sessions.getActive()).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.start() throws PermissionDeniedError without sessions:write', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'no-session-plugin',
      permissions: ['sessions:read'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.sessions.start({ taskName: 'test' })).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.stop() throws PermissionDeniedError without sessions:write', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.sessions.stop('id')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.pause() throws PermissionDeniedError without sessions:write', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.sessions.pause('id')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.resume() throws PermissionDeniedError without sessions:write', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.sessions.resume('id')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('sessions.getHistory() throws PermissionDeniedError without sessions:read', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.sessions.getHistory()).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });
});

describe('PluginAPI.sessions: CRUD behaviour', () => {
  it('start() creates an active session and returns it', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'time-tracker',
      permissions: ['sessions:read', 'sessions:write'],
      db,
      config: MOCK_CONFIG,
    });
    const session = await api.sessions.start({ taskName: 'coding' });
    expect(session.taskName).toBe('coding');
    expect(session.status).toBe('active');
    expect(typeof session.id).toBe('string');
    cleanup();
  });

  it('getActive() returns started sessions', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'time-tracker',
      permissions: ['sessions:read', 'sessions:write'],
      db,
      config: MOCK_CONFIG,
    });
    await api.sessions.start({ taskName: 'task-a' });
    const active = await api.sessions.getActive();
    expect(active.length).toBe(1);
    expect(active[0]!.taskName).toBe('task-a');
    cleanup();
  });

  it('stop() marks session completed and returns duration', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'time-tracker',
      permissions: ['sessions:read', 'sessions:write'],
      db,
      config: MOCK_CONFIG,
    });
    const session = await api.sessions.start({ taskName: 'task-b' });
    const stopped = await api.sessions.stop(session.id);
    expect(stopped.status).toBe('completed');
    expect(typeof stopped.duration).toBe('number');
    cleanup();
  });

  it('pause() and resume() cycle works', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'time-tracker',
      permissions: ['sessions:read', 'sessions:write'],
      db,
      config: MOCK_CONFIG,
    });
    const session = await api.sessions.start({ taskName: 'task-c' });
    const paused = await api.sessions.pause(session.id);
    expect(paused.status).toBe('paused');
    const resumed = await api.sessions.resume(session.id);
    expect(resumed.status).toBe('active');
    cleanup();
  });

  it('getHistory() returns completed sessions', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'time-tracker',
      permissions: ['sessions:read', 'sessions:write'],
      db,
      config: MOCK_CONFIG,
    });
    const session = await api.sessions.start({ taskName: 'done-task' });
    await api.sessions.stop(session.id);
    const history = await api.sessions.getHistory();
    expect(history.length).toBe(1);
    expect(history[0]!.status).toBe('completed');
    cleanup();
  });
});

// ─── Memory (stub) ───

describe('PluginAPI.memory: permission enforcement', () => {
  it('memory.get() throws PermissionDeniedError without memory:read', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.memory.get('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('memory.search() throws PermissionDeniedError without memory:read', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.memory.search('query')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('memory.set() throws PermissionDeniedError without memory:write', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.memory.set('key', 'value')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('memory.delete() throws PermissionDeniedError without memory:write', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.memory.delete('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('memory:read allows get() and search() but not set()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'read-memory-plugin',
      permissions: ['memory:read'],
      db,
      config: MOCK_CONFIG,
    });
    // Permission passes; throws "MemoryStore not configured" (not PermissionDeniedError)
    const getErr = await api.memory.get('key').catch((e) => e);
    expect(getErr).not.toBeInstanceOf(PermissionDeniedError);
    expect(getErr.message).toContain('MemoryStore not configured');

    await expect(api.memory.set('key', 'val')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('memory:write allows set() and delete() but not get()', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'write-memory-plugin',
      permissions: ['memory:write'],
      db,
      config: MOCK_CONFIG,
    });
    const setErr = await api.memory.set('key', 'val').catch((e) => e);
    expect(setErr).not.toBeInstanceOf(PermissionDeniedError);
    expect(setErr.message).toContain('MemoryStore not configured');

    await expect(api.memory.get('key')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });
});

// ─── Notifications (stub) ───

describe('PluginAPI.notifications: permission enforcement', () => {
  it('notifications.send() throws PermissionDeniedError without notifications:send', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.notifications.send('hello')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('notifications.send() with notifications:send resolves (logs to console if no sender)', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'p',
      permissions: ['notifications:send'],
      db,
      config: MOCK_CONFIG,
      // No notificationSender — falls back to console.log
    });
    await expect(api.notifications.send('hello')).resolves.toBeUndefined();
    cleanup();
  });

  it('notifications.send() calls provided notificationSender', async () => {
    const { db, cleanup } = makeTestDb();
    const sent: string[] = [];
    const api = createPluginApi({
      pluginName: 'p',
      permissions: ['notifications:send'],
      db,
      config: MOCK_CONFIG,
      notificationSender: async (msg) => { sent.push(msg); },
    });
    await api.notifications.send('test message');
    expect(sent).toEqual(['test message']);
    cleanup();
  });
});

// ─── HTTP ───

describe('PluginAPI.http: permission enforcement', () => {
  it('http.get() throws PermissionDeniedError without http:external', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.http.get('https://example.com')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('http.post() throws PermissionDeniedError without http:external', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.http.post('https://example.com', {})).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('http.put() throws PermissionDeniedError without http:external', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.http.put('https://example.com', {})).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });

  it('http.delete() throws PermissionDeniedError without http:external', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({ pluginName: 'p', permissions: [], db, config: MOCK_CONFIG });
    await expect(api.http.delete('https://example.com')).rejects.toThrow(PermissionDeniedError);
    cleanup();
  });
});

// ─── LLM ───

describe('PluginAPI.llm', () => {
  function fakeProvider(capture?: (p: unknown) => void) {
    return {
      name: 'fake',
      async chat(params: unknown) {
        capture?.(params);
        return { type: 'text' as const, text: 'vision answer' };
      },
      async generate(params: unknown) {
        capture?.(params);
        return 'text answer';
      },
    };
  }

  it('generate() reaches the provider when the plugin holds llm:use', async () => {
    const { db, cleanup } = makeTestDb();
    let seen: unknown;
    const api = createPluginApi({
      pluginName: 'llm-plugin',
      permissions: ['llm:use'],
      db,
      config: MOCK_CONFIG,
      llmProvider: fakeProvider((p) => (seen = p)) as never,
    });
    expect(await api.llm.generate('hello', { systemPrompt: 'be terse' })).toBe('text answer');
    expect(seen).toMatchObject({ systemPrompt: 'be terse', userPrompt: 'hello' });
    cleanup();
  });

  it('generate() is refused without the llm:use permission', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'llm-plugin',
      permissions: [],
      db,
      config: MOCK_CONFIG,
      llmProvider: fakeProvider() as never,
    });
    await expect(api.llm.generate('hello')).rejects.toThrow(/llm:use/);
    cleanup();
  });

  it('explains itself when no provider is configured', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'llm-plugin',
      permissions: ['llm:use'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.llm.generate('hello')).rejects.toThrow('no LLM provider configured');
    cleanup();
  });

  it('analyzeImage() sends exactly one image part alongside the prompt', async () => {
    const { db, cleanup } = makeTestDb();
    let seen: { messages: { content: unknown }[] } | undefined;
    const api = createPluginApi({
      pluginName: 'llm-plugin',
      permissions: ['llm:use'],
      db,
      config: MOCK_CONFIG,
      llmProvider: fakeProvider((p) => (seen = p as typeof seen)) as never,
    });

    const answer = await api.llm.analyzeImage('what is this?', 'data:image/png;base64,AAAA');
    expect(answer).toBe('vision answer');

    const parts = seen!.messages[seen!.messages.length - 1]!.content as { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
    cleanup();
  });

  it('analyzeImage() refuses anything that is not a data URI', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'llm-plugin',
      permissions: ['llm:use'],
      db,
      config: MOCK_CONFIG,
      llmProvider: fakeProvider() as never,
    });
    // Handing the model a URL would make it fetch something itself; TARDIS
    // always inlines the bytes it chose to send.
    await expect(
      api.llm.analyzeImage('what is this?', 'https://example.com/x.png')
    ).rejects.toThrow(/data URI/);
    cleanup();
  });
});

// ─── Plugins (stub) ───

describe('PluginAPI.plugins: stub behaviour', () => {
  it('plugins.list() throws "not yet implemented" with plugins:call permission', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'orchestrator',
      permissions: ['plugins:call'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.plugins.list()).rejects.toThrow('not yet implemented');
    cleanup();
  });

  it('plugins.call() throws "not yet implemented" with plugins:call permission', async () => {
    const { db, cleanup } = makeTestDb();
    const api = createPluginApi({
      pluginName: 'orchestrator',
      permissions: ['plugins:call'],
      db,
      config: MOCK_CONFIG,
    });
    await expect(api.plugins.call('other-plugin', 'some-tool', {})).rejects.toThrow(
      'not yet implemented'
    );
    cleanup();
  });
});
