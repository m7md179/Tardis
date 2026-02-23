import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PluginManager } from './plugin-manager.js';
import {
  validateManifest,
  validatePermissions,
  checkDuplicateToolNames,
  ManifestValidationError,
} from './manifest-validator.js';
import type { PluginManifest } from '@tardis/shared';

// Each test gets its own uniquely-named plugins dir to avoid Bun module caching
function makeTempDir(): string {
  const dir = `/tmp/tardis-plugins-test-${randomUUID()}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createPlugin(dir: string, manifest: unknown, indexContent?: string): void {
  const pluginDir = join(dir, (manifest as { name?: string })?.name ?? 'plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest));
  if (indexContent !== undefined) {
    writeFileSync(join(pluginDir, 'index.ts'), indexContent);
  }
}

const VALID_MANIFEST: PluginManifest = {
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  description: 'A test plugin',
  skillSummary: 'Used for testing the plugin manager.',
  tier: 1,
  main: 'index.ts',
  permissions: ['storage:read', 'storage:write'],
  tools: [
    {
      name: 'test-plugin.ping',
      description: 'Pings the plugin',
      parameters: { type: 'object', properties: {} },
      actionType: 'direct',
    },
  ],
};

const mockApi = () => ({
  storage: {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  },
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  events: { emit: () => {}, on: () => {} },
  config: { get: async () => null, set: async () => {} },
});

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(VALID_MANIFEST, '/fake/dir');
    expect(result.name).toBe('test-plugin');
  });

  it('rejects a manifest with missing required fields', () => {
    expect(() => validateManifest({}, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects a manifest with invalid tool name format', () => {
    const bad = { ...VALID_MANIFEST, tools: [{ ...VALID_MANIFEST.tools[0], name: 'notvalid' }] };
    expect(() => validateManifest(bad, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects a manifest with invalid tier', () => {
    const bad = { ...VALID_MANIFEST, tier: 5 };
    expect(() => validateManifest(bad, '/fake/dir')).toThrow(ManifestValidationError);
  });
});

describe('validatePermissions', () => {
  it('accepts valid permissions', () => {
    expect(() => validatePermissions(VALID_MANIFEST)).not.toThrow();
  });

  it('rejects unknown permissions', () => {
    const bad: PluginManifest = {
      ...VALID_MANIFEST,
      permissions: ['storage:read', 'fake:permission'],
    };
    expect(() => validatePermissions(bad)).toThrow(ManifestValidationError);
    expect(() => validatePermissions(bad)).toThrow('fake:permission');
  });
});

describe('checkDuplicateToolNames', () => {
  it('passes when tool names are unique across plugins', () => {
    const m1: PluginManifest = {
      ...VALID_MANIFEST,
      name: 'plugin-a',
      tools: [{ name: 'plugin-a.ping', description: 'ping', parameters: {}, actionType: 'direct' }],
    };
    const m2: PluginManifest = {
      ...VALID_MANIFEST,
      name: 'plugin-b',
      tools: [{ name: 'plugin-b.ping', description: 'ping', parameters: {}, actionType: 'direct' }],
    };
    expect(() => checkDuplicateToolNames([m1, m2])).not.toThrow();
  });

  it('throws when two plugins declare the same tool name', () => {
    const shared = {
      name: 'shared.tool',
      description: 'tool',
      parameters: {},
      actionType: 'direct' as const,
    };
    const m1: PluginManifest = { ...VALID_MANIFEST, name: 'plugin-a', tools: [shared] };
    const m2: PluginManifest = { ...VALID_MANIFEST, name: 'plugin-b', tools: [shared] };
    expect(() => checkDuplicateToolNames([m1, m2])).toThrow(ManifestValidationError);
  });
});

describe('PluginManager', () => {
  it('loads no plugins when directory is empty', async () => {
    const dir = makeTempDir();
    try {
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.getAllManifests()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips directories without manifest.json', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'no-manifest'), { recursive: true });
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.getAllManifests()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips plugins with invalid manifests', async () => {
    const dir = makeTempDir();
    try {
      createPlugin(dir, { name: 'bad-plugin' }); // missing required fields
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.getAllManifests()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads a valid plugin and activates it', async () => {
    const dir = makeTempDir();
    try {
      const indexContent = `export const onActivate = async (api) => { api.logger.info('activated'); };
export const executeTool = async () => ({ ok: true });`;
      createPlugin(dir, VALID_MANIFEST, indexContent);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      expect(manager.isLoaded('test-plugin')).toBe(true);
      expect(manager.getAllManifests()).toHaveLength(1);
      expect(manager.getAllManifests()[0]?.name).toBe('test-plugin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns skill summaries for loaded plugins', async () => {
    const dir = makeTempDir();
    try {
      const indexContent = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, indexContent);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const summaries = manager.getSkillSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.name).toBe('test-plugin');
      expect(summaries[0]?.skillSummary).toBe(VALID_MANIFEST.skillSummary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns tools for selected plugins', async () => {
    const dir = makeTempDir();
    try {
      const indexContent = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, indexContent);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const tools = manager.getToolsForPlugins(['test-plugin']);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('test-plugin.ping');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('executes a tool on a loaded plugin', async () => {
    const dir = makeTempDir();
    try {
      const indexContent = `export const onActivate = async () => {};
export const executeTool = async (toolName) => {
  if (toolName === 'test-plugin.ping') return { pong: true };
  throw new Error('Unknown tool: ' + toolName);
};`;
      createPlugin(dir, VALID_MANIFEST, indexContent);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const result = await manager.executeTool('test-plugin.ping', {});
      expect(result).toEqual({ pong: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deactivates all plugins on unloadAll()', async () => {
    const dir = makeTempDir();
    try {
      const indexContent = `export const onActivate = async () => {};
export const onDeactivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, indexContent);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.isLoaded('test-plugin')).toBe(true);

      await manager.unloadAll();
      expect(manager.isLoaded('test-plugin')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
