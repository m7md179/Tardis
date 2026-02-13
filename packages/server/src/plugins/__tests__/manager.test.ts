import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PluginManager } from '../manager';
import type { SessionManager } from '../../core/session-manager';
import type { TodoistClient } from '../../integrations/todoist/client';
import type { NotificationService } from '../../integrations/notifications/service';

const TEST_DIR = join(import.meta.dir, '__test-manager-plugins__');

// Minimal mock services
function createMockServices() {
  return {
    sessionManager: {
      getActiveSessions: async () => [],
      getSessionById: async () => null,
      startSession: async (opts: any) => ({ id: '1', ...opts, status: 'ACTIVE' }),
      stopSession: async () => ({ id: '1', status: 'COMPLETED' }),
      pauseSession: async () => ({ id: '1', status: 'PAUSED' }),
      resumeSession: async () => ({ id: '1', status: 'ACTIVE' }),
    } as unknown as SessionManager,
    todoistClient: {
      getTasks: async () => [],
      completeTask: async () => {},
    } as unknown as TodoistClient,
    notificationService: {
      send: async () => {},
    } as unknown as NotificationService,
  };
}

function writePlugin(name: string, manifest: object, code: string) {
  const dir = join(TEST_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'index.ts'), code);
}

describe('PluginManager', () => {
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

  test('discover finds plugins with valid manifests', async () => {
    writePlugin('test-plugin', {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "test-plugin", version: "1.0.0" };');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    const manifests = await manager.discover();
    expect(manifests.length).toBe(1);
    expect(manifests[0]!.name).toBe('test-plugin');
  });

  test('discover skips directories without plugin.json', async () => {
    mkdirSync(join(TEST_DIR, 'not-a-plugin'), { recursive: true });

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    const manifests = await manager.discover();
    expect(manifests.length).toBe(0);
  });

  test('discover skips invalid manifests', async () => {
    const dir = join(TEST_DIR, 'bad-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), '{ invalid json');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    const manifests = await manager.discover();
    expect(manifests.length).toBe(0);
  });

  test('discover returns empty array when plugins dir does not exist', async () => {
    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: '/nonexistent/path', ...mocks });

    const manifests = await manager.discover();
    expect(manifests.length).toBe(0);
  });

  test('loadPlugin loads and activates a plugin', async () => {
    writePlugin('test-plugin', {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
      permissions: ['sessions:read'],
    }, `
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        activated: false,
        async onActivate(api) {
          this.activated = true;
        },
      };
      export default plugin;
    `);

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadPlugin('test-plugin');
    const loaded = manager.getPlugin('test-plugin');

    expect(loaded).toBeDefined();
    expect(loaded!.manifest.name).toBe('test-plugin');
    expect((loaded!.instance as any).activated).toBe(true);
  });

  test('loadPlugin throws for missing plugin', async () => {
    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    expect(manager.loadPlugin('nonexistent')).rejects.toThrow();
  });

  test('unloadPlugin removes plugin and cleans up', async () => {
    writePlugin('unload-plugin', {
      name: 'unload-plugin',
      version: '1.0.0',
      displayName: 'Unload Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "unload-plugin", version: "1.0.0" };');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadPlugin('unload-plugin');
    expect(manager.getPlugin('unload-plugin')).toBeDefined();

    await manager.unloadPlugin('unload-plugin');
    expect(manager.getPlugin('unload-plugin')).toBeUndefined();
  });

  test('unloadPlugin throws for unloaded plugin', async () => {
    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    expect(manager.unloadPlugin('nonexistent')).rejects.toThrow('Plugin not loaded');
  });

  test('loadAll skips disabled plugins', async () => {
    writePlugin('enabled-plugin', {
      name: 'enabled-plugin',
      version: '1.0.0',
      displayName: 'Enabled',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
      config: { enabled: true },
    }, 'export default { name: "enabled-plugin", version: "1.0.0" };');

    writePlugin('disabled-plugin', {
      name: 'disabled-plugin',
      version: '1.0.0',
      displayName: 'Disabled',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
      config: { enabled: false },
    }, 'export default { name: "disabled-plugin", version: "1.0.0" };');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadAll();

    expect(manager.getPlugin('enabled-plugin')).toBeDefined();
    expect(manager.getPlugin('disabled-plugin')).toBeUndefined();
  });

  test('emitEvent triggers plugin hooks', async () => {
    writePlugin('hook-plugin', {
      name: 'hook-plugin',
      version: '1.0.0',
      displayName: 'Hook Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
      hooks: ['session:start'],
      permissions: ['sessions:read'],
    }, `
      const plugin = {
        name: 'hook-plugin',
        version: '1.0.0',
        lastSession: null,
        async onSessionStart(session, api) {
          this.lastSession = session;
        },
      };
      export default plugin;
    `);

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadPlugin('hook-plugin');
    await manager.emitEvent('session:start', { taskName: 'Test Task' });

    const instance = manager.getPlugin('hook-plugin')!.instance as any;
    expect(instance.lastSession).toEqual({ taskName: 'Test Task' });
  });

  test('runCommand executes plugin command', async () => {
    writePlugin('cmd-plugin', {
      name: 'cmd-plugin',
      version: '1.0.0',
      displayName: 'Cmd Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
      commands: [{ name: 'greet' }],
    }, `
      const plugin = {
        name: 'cmd-plugin',
        version: '1.0.0',
        lastArgs: null,
        commands: {
          async greet(args, api) {
            plugin.lastArgs = args;
          },
        },
      };
      export default plugin;
    `);

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadPlugin('cmd-plugin');
    await manager.runCommand('cmd-plugin', 'greet', ['world']);

    const instance = manager.getPlugin('cmd-plugin')!.instance as any;
    expect(instance.lastArgs).toEqual(['world']);
  });

  test('runCommand throws for unknown command', async () => {
    writePlugin('cmd-plugin', {
      name: 'cmd-plugin',
      version: '1.0.0',
      displayName: 'Cmd Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "cmd-plugin", version: "1.0.0" };');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadPlugin('cmd-plugin');
    expect(manager.runCommand('cmd-plugin', 'nonexistent')).rejects.toThrow('Command not found');
  });

  test('getAllPlugins returns all loaded plugins', async () => {
    writePlugin('plugin-a', {
      name: 'plugin-a',
      version: '1.0.0',
      displayName: 'Plugin A',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "plugin-a", version: "1.0.0" };');

    writePlugin('plugin-b', {
      name: 'plugin-b',
      version: '1.0.0',
      displayName: 'Plugin B',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "plugin-b", version: "1.0.0" };');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadAll();

    const all = manager.getAllPlugins();
    expect(all.length).toBe(2);
  });

  test('loadAll continues loading after one plugin fails', async () => {
    writePlugin('good-plugin', {
      name: 'good-plugin',
      version: '1.0.0',
      displayName: 'Good Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "good-plugin", version: "1.0.0" };');

    writePlugin('bad-plugin', {
      name: 'bad-plugin',
      version: '1.0.0',
      displayName: 'Bad Plugin',
      tardisVersion: '>=2.0.0',
      main: 'index.ts',
    }, 'export default { name: "bad-plugin", version: "1.0.0", async onActivate() { throw new Error("boom"); } };');

    const mocks = createMockServices();
    const manager = new PluginManager({ pluginsDir: TEST_DIR, ...mocks });

    await manager.loadAll();

    // bad-plugin should have failed but good-plugin should still be loaded
    expect(manager.getPlugin('bad-plugin')).toBeUndefined();
    expect(manager.getPlugin('good-plugin')).toBeDefined();
  });
});
