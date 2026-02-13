import { describe, test, expect } from 'bun:test';
import { createPluginAPI } from '../api';
import { EventBus } from '../event-bus';
import { PluginStorage } from '../storage';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { PluginManifest } from '@tardis/shared';
import type { SessionManager } from '../../core/session-manager';
import type { TodoistClient } from '../../integrations/todoist/client';
import type { NotificationService } from '../../integrations/notifications/service';

const TEST_DIR = join(import.meta.dir, '__test-api-plugins__');

function setup(permissions: string[] = []) {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });

  const manifest = {
    name: 'test-plugin',
    version: '1.0.0',
    displayName: 'Test Plugin',
    tardisVersion: '>=2.0.0',
    main: 'index.ts',
    permissions,
    hooks: [],
    commands: [],
    config: { enabled: true },
  } as PluginManifest;

  const sessionManager = {
    getActiveSessions: async () => [{ id: '1', taskName: 'Test', status: 'ACTIVE' }],
    getSessionById: async (id: string) => ({ id, taskName: 'Test', status: 'ACTIVE' }),
    startSession: async (opts: any) => ({ id: '1', ...opts, status: 'ACTIVE' }),
    stopSession: async (id: string) => ({ id, status: 'COMPLETED' }),
    pauseSession: async (id: string) => ({ id, status: 'PAUSED' }),
    resumeSession: async (id: string) => ({ id, status: 'ACTIVE' }),
  } as unknown as SessionManager;

  const todoistClient = {
    getTasks: async () => [{ id: 't1', content: 'Task 1' }],
    completeTask: async () => {},
  } as unknown as TodoistClient;

  const notificationService = {
    send: async () => {},
  } as unknown as NotificationService;

  const eventBus = new EventBus();
  const storage = new PluginStorage(TEST_DIR, 'test-plugin');

  const api = createPluginAPI({
    pluginName: 'test-plugin',
    manifest,
    sessionManager,
    todoistClient,
    notificationService,
    storage,
    eventBus,
  });

  return { api, eventBus, storage };
}

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe('Plugin API - Permissions', () => {
  test('sessions.getActive throws without sessions:read', async () => {
    const { api } = setup([]);
    expect(api.sessions.getActive()).rejects.toThrow('lacks permission: sessions:read');
    cleanup();
  });

  test('sessions.getActive works with sessions:read', async () => {
    const { api } = setup(['sessions:read']);
    const sessions = await api.sessions.getActive();
    expect(sessions.length).toBe(1);
    cleanup();
  });

  test('sessions.start throws without sessions:write', async () => {
    const { api } = setup(['sessions:read']);
    expect(api.sessions.start({ taskName: 'Test' })).rejects.toThrow('lacks permission: sessions:write');
    cleanup();
  });

  test('sessions.start works with sessions:write', async () => {
    const { api } = setup(['sessions:write']);
    const session = await api.sessions.start({ taskName: 'Test' });
    expect(session.taskName).toBe('Test');
    cleanup();
  });

  test('tasks.getAll throws without tasks:read', async () => {
    const { api } = setup([]);
    expect(api.tasks.getAll()).rejects.toThrow('lacks permission: tasks:read');
    cleanup();
  });

  test('tasks.getAll works with tasks:read', async () => {
    const { api } = setup(['tasks:read']);
    const tasks = await api.tasks.getAll();
    expect(tasks.length).toBe(1);
    cleanup();
  });

  test('tasks.complete throws without tasks:write', async () => {
    const { api } = setup(['tasks:read']);
    expect(api.tasks.complete('t1')).rejects.toThrow('lacks permission: tasks:write');
    cleanup();
  });

  test('storage.get throws without storage:read', async () => {
    const { api } = setup([]);
    expect(api.storage.get('key')).rejects.toThrow('lacks permission: storage:read');
    cleanup();
  });

  test('storage.set throws without storage:write', async () => {
    const { api } = setup(['storage:read']);
    expect(api.storage.set('key', 'val')).rejects.toThrow('lacks permission: storage:write');
    cleanup();
  });

  test('storage works with correct permissions', async () => {
    const { api } = setup(['storage:read', 'storage:write']);
    await api.storage.set('key', 'value');
    const result = await api.storage.get('key');
    expect(result).toBe('value');
    cleanup();
  });

  test('http.get throws without http:external', async () => {
    const { api } = setup([]);
    expect(api.http.get('https://example.com')).rejects.toThrow('lacks permission: http:external');
    cleanup();
  });

  test('notifications.send throws without notifications:send', async () => {
    const { api } = setup([]);
    expect(api.notifications.send('hello')).rejects.toThrow('lacks permission: notifications:send');
    cleanup();
  });
});

describe('Plugin API - Config', () => {
  test('config.get reads from manifest config', () => {
    const { api } = setup([]);
    expect(api.config.get('enabled')).toBe(true);
    cleanup();
  });

  test('config.getAll returns all config', () => {
    const { api } = setup([]);
    const all = api.config.getAll();
    expect(all.enabled).toBe(true);
    cleanup();
  });

  test('config.set updates config value', async () => {
    const { api } = setup(['storage:write']);
    await api.config.set('customKey', 42);
    expect(api.config.get('customKey')).toBe(42);
    cleanup();
  });
});

describe('Plugin API - Logger', () => {
  test('logger methods do not throw', () => {
    const { api } = setup([]);
    // Just verify they don't throw
    api.logger.info('test info');
    api.logger.warn('test warn');
    api.logger.error('test error');
    api.logger.debug('test debug');
    cleanup();
  });
});

describe('Plugin API - Events', () => {
  test('events.emit and events.on work together', async () => {
    const { api, eventBus } = setup([]);
    let received: unknown = null;

    api.events.on('custom-event', (data) => {
      received = data;
    });

    // Emit through the event bus directly (simulating another part of the system)
    await eventBus.emit('plugin:test-plugin:custom-event', { msg: 'hello' });

    expect(received).toEqual({ msg: 'hello' });
    cleanup();
  });
});
