import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PluginManager, PluginLoadError } from './plugin-manager.js';
import { PluginManifestSchema } from '@tardis/shared';
import type { PluginManifest } from '@tardis/shared';

// ─── Helpers ───

/** Create a uniquely-named temp dir to avoid Bun module caching across tests. */
function makeTempDir(): string {
  const dir = `/tmp/tardis-plugins-test-${randomUUID()}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a plugin directory with manifest.json and optional index.ts. */
function createPlugin(dir: string, manifest: unknown, indexContent?: string): void {
  const pluginDir = join(dir, (manifest as { name?: string })?.name ?? 'plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest));
  if (indexContent !== undefined) {
    writeFileSync(join(pluginDir, 'index.ts'), indexContent);
  }
}

const VALID_MANIFEST: PluginManifest = PluginManifestSchema.parse({
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  description: 'A test plugin',
  summary: 'Used for testing the plugin manager.',
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
});

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

// ─── Discovery ───

describe('PluginManager: discovery', () => {
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

  it('skips subdirectories without manifest.json', async () => {
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

  it('discovers plugins in the plugins directory', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      expect(manager.getAllManifests()).toHaveLength(1);
      expect(manager.getAllManifests()[0]?.name).toBe('test-plugin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discovers multiple plugins in the same directory', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      const manifestA = { ...VALID_MANIFEST, name: 'plugin-a' };
      const manifestB = { ...VALID_MANIFEST, name: 'plugin-b' };
      // fix tool names to match plugin name
      manifestA.tools = [{ ...VALID_MANIFEST.tools[0]!, name: 'plugin-a.ping' }];
      manifestB.tools = [{ ...VALID_MANIFEST.tools[0]!, name: 'plugin-b.ping' }];
      createPlugin(dir, manifestA, content);
      createPlugin(dir, manifestB, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const names = manager.getAllManifests().map((m) => m.name);
      expect(names).toContain('plugin-a');
      expect(names).toContain('plugin-b');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Activation ───

describe('PluginManager: activation', () => {
  it('loads a valid plugin and marks it as loaded', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      expect(manager.isLoaded('test-plugin')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls onActivate with the plugin API object', async () => {
    const dir = makeTempDir();
    const flagFile = `/tmp/tardis-activated-${randomUUID()}`;
    try {
      // The plugin writes a file when onActivate is called, proving it was invoked
      const content = `import { writeFileSync } from 'fs';
export const onActivate = async (api) => {
  if (!api || typeof api.logger?.info !== 'function') throw new Error('API not provided');
  writeFileSync('${flagFile}', 'activated');
};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      expect(existsSync(flagFile)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(flagFile)) unlinkSync(flagFile);
    }
  });

  it('skips plugin with invalid manifest and does not crash', async () => {
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

  it('skips plugin with missing entry point and does not crash', async () => {
    const dir = makeTempDir();
    try {
      // Manifest says main: 'index.ts' but we don't write index.ts
      createPlugin(dir, VALID_MANIFEST); // no indexContent
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      // Plugin is not loaded since entry point is missing
      expect(manager.isLoaded('test-plugin')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads valid plugins even when one is broken', async () => {
    const dir = makeTempDir();
    try {
      // Bad plugin — no entry point
      createPlugin(dir, VALID_MANIFEST);

      // Good plugin
      const goodManifest = {
        ...VALID_MANIFEST,
        name: 'good-plugin',
        tools: [{ ...VALID_MANIFEST.tools[0]!, name: 'good-plugin.ping' }],
      };
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, goodManifest, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      expect(manager.isLoaded('good-plugin')).toBe(true);
      expect(manager.isLoaded('test-plugin')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Skill summaries and tool definitions ───

describe('PluginManager: skill summaries and tools', () => {
  it('returns summary cards for all loaded plugins', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const summaries = manager.getPluginSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.name).toBe('test-plugin');
      expect(summaries[0]?.summary).toBe(VALID_MANIFEST.summary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns full tool definitions for a specific plugin by name', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const tools = manager.getToolsForPlugins(['test-plugin']);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('test-plugin.ping');
      expect(tools[0]?.actionType).toBe('direct');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array for tools when plugin name is not loaded', async () => {
    const dir = makeTempDir();
    try {
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.getToolsForPlugins(['nonexistent-plugin'])).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Tool execution ───

describe('PluginManager: tool execution', () => {
  it('executes a tool on the correct plugin', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async (toolName) => {
  if (toolName === 'test-plugin.ping') return { pong: true };
  throw new Error('Unknown tool: ' + toolName);
};`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      const result = await manager.executeTool('test-plugin.ping', {});
      expect(result).toEqual({ pong: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws PluginLoadError when plugin is not loaded', async () => {
    const dir = makeTempDir();
    try {
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      await expect(manager.executeTool('missing-plugin.tool', {})).rejects.toThrow(PluginLoadError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws PluginLoadError for malformed tool name (no dot)', async () => {
    const dir = makeTempDir();
    try {
      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      await expect(manager.executeTool('badtoolname', {})).rejects.toThrow(PluginLoadError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Shutdown / deactivation ───

describe('PluginManager: shutdown', () => {
  it('calls onDeactivate on all plugins during unloadAll()', async () => {
    const dir = makeTempDir();
    const flagFile = `/tmp/tardis-deactivated-${randomUUID()}`;
    try {
      // Plugin writes a file on deactivation, proving onDeactivate was called
      const content = `import { writeFileSync } from 'fs';
export const onActivate = async () => {};
export const onDeactivate = async () => {
  writeFileSync('${flagFile}', 'deactivated');
};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.isLoaded('test-plugin')).toBe(true);

      await manager.unloadAll();

      expect(existsSync(flagFile)).toBe(true);
      expect(manager.isLoaded('test-plugin')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(flagFile)) unlinkSync(flagFile);
    }
  });

  it('unloadAll() does not throw for plugins without onDeactivate', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});
// intentionally no onDeactivate`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();

      await expect(manager.unloadAll()).resolves.toBeUndefined();
      expect(manager.isLoaded('test-plugin')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getAllManifests() returns empty array after unloadAll()', async () => {
    const dir = makeTempDir();
    try {
      const content = `export const onActivate = async () => {};
export const executeTool = async () => ({});`;
      createPlugin(dir, VALID_MANIFEST, content);

      const manager = new PluginManager(dir, mockApi);
      await manager.loadAll();
      expect(manager.getAllManifests()).toHaveLength(1);

      await manager.unloadAll();
      expect(manager.getAllManifests()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Turn filters ────────────────────────────────────────────────────────────
//
// Discovered from module exports rather than declared in the manifest, the same
// way proactive handlers are. Nothing in `tardis plugins` reveals them, which is
// why the server announces them at load.

describe('PluginManager: turn filters', () => {
  const manifestFor = (name: string) =>
    PluginManifestSchema.parse({
      ...VALID_MANIFEST,
      name,
      tools: [
        {
          name: `${name}.ping`,
          description: 'Pings the plugin',
          parameters: { type: 'object', properties: {} },
          actionType: 'direct',
        },
      ],
    });

  it('finds a plugin that exports both hooks', async () => {
    const dir = makeTempDir();
    createPlugin(
      dir,
      manifestFor('filtered'),
      `export const onActivate = async () => {};
       export const executeTool = async () => ({});
       export const onTurnStart = async ({ userMessage }) => ({ userMessage: userMessage + '!' });
       export const onTurnEnd = async ({ response }) => ({ response: response + '?' });`
    );

    const manager = new PluginManager(dir, mockApi);
    await manager.loadAll();
    try {
      const filters = manager.getTurnFilters();
      expect(filters).toHaveLength(1);
      expect(filters[0]!.plugin).toBe('filtered');
      expect(typeof filters[0]!.onTurnStart).toBe('function');
      expect(typeof filters[0]!.onTurnEnd).toBe('function');
    } finally {
      await manager.unloadAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a plugin that exports only one hook', async () => {
    const dir = makeTempDir();
    createPlugin(
      dir,
      manifestFor('half'),
      `export const onActivate = async () => {};
       export const executeTool = async () => ({});
       export const onTurnEnd = async ({ response }) => ({ response });`
    );

    const manager = new PluginManager(dir, mockApi);
    await manager.loadAll();
    try {
      const [filter] = manager.getTurnFilters();
      expect(filter!.onTurnStart).toBeUndefined();
      expect(typeof filter!.onTurnEnd).toBe('function');
    } finally {
      await manager.unloadAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a plugin that exports neither', async () => {
    const dir = makeTempDir();
    createPlugin(
      dir,
      manifestFor('plain'),
      `export const onActivate = async () => {};
       export const executeTool = async () => ({});`
    );

    const manager = new PluginManager(dir, mockApi);
    await manager.loadAll();
    try {
      expect(manager.getTurnFilters()).toEqual([]);
    } finally {
      await manager.unloadAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores an export that is not a function', async () => {
    // A plugin exporting `onTurnStart = true` would otherwise be registered and
    // then throw on every single turn.
    const dir = makeTempDir();
    createPlugin(
      dir,
      manifestFor('wrong-type'),
      `export const onActivate = async () => {};
       export const executeTool = async () => ({});
       export const onTurnStart = 'not a function';`
    );

    const manager = new PluginManager(dir, mockApi);
    await manager.loadAll();
    try {
      expect(manager.getTurnFilters()).toEqual([]);
    } finally {
      await manager.unloadAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
