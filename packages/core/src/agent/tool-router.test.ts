import { describe, it, expect } from 'bun:test';
import { ToolRouter } from './tool-router.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import type { PluginManifest } from '@tardis/shared';

// ─── Mock PluginManager ───────────────────────────────────────────────────────

interface MockPlugin {
  manifest: PluginManifest;
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}

function makeMockManager(plugins: MockPlugin[]): PluginManager {
  const map = new Map(plugins.map((p) => [p.manifest.name, p]));

  return {
    getPlugin(name: string) {
      const p = map.get(name);
      if (!p) return undefined;
      return { manifest: p.manifest, instance: p as unknown as never };
    },
    async executeTool(toolName: string, args: Record<string, unknown>) {
      const pluginName = toolName.split('.')[0] ?? '';
      const plugin = map.get(pluginName);
      if (!plugin) throw new Error(`Plugin "${pluginName}" is not loaded`);
      return plugin.executeTool(toolName, args);
    },
    // Unused in these tests
    getAllManifests: () => [],
    getSkillSummaries: () => [],
    getToolsForPlugins: () => [],
    isLoaded: () => false,
    async loadAll() {},
    async unloadAll() {},
  } as unknown as PluginManager;
}

function makeManifest(pluginName: string, tools: PluginManifest['tools']): PluginManifest {
  return {
    name: pluginName,
    version: '1.0.0',
    displayName: pluginName,
    description: 'test plugin',
    tier: 1,
    main: 'index.ts',
    skillSummary: 'Test plugin for unit tests.',
    permissions: [],
    tools,
  };
}

// ─── TOOL_NOT_FOUND ───────────────────────────────────────────────────────────

describe('ToolRouter: TOOL_NOT_FOUND', () => {
  it('returns TOOL_NOT_FOUND when plugin is not loaded', async () => {
    const router = new ToolRouter(makeMockManager([]));
    const result = await router.execute('time-tracker.start', { taskName: 'coding' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TOOL_NOT_FOUND');
      expect(result.error).toContain('time-tracker');
    }
  });

  it('returns TOOL_NOT_FOUND when tool name is not in the plugin manifest', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.start',
        description: 'Start timer',
        parameters: { type: 'object', properties: {} },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([{ manifest, executeTool: async () => ({}) }])
    );

    const result = await router.execute('time-tracker.nonexistent', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TOOL_NOT_FOUND');
      expect(result.error).toContain('time-tracker.nonexistent');
    }
  });

  it('returns TOOL_NOT_FOUND for malformed tool name without a dot', async () => {
    const router = new ToolRouter(makeMockManager([]));
    const result = await router.execute('notavalidtoolname', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TOOL_NOT_FOUND');
      expect(result.error).toContain('notavalidtoolname');
    }
  });
});

// ─── VALIDATION_ERROR ─────────────────────────────────────────────────────────

describe('ToolRouter: VALIDATION_ERROR', () => {
  const timerManifest = makeManifest('time-tracker', [
    {
      name: 'time-tracker.start',
      description: 'Start a timer',
      parameters: {
        type: 'object',
        properties: { taskName: { type: 'string' }, priority: { type: 'number' } },
        required: ['taskName'],
      },
      actionType: 'direct',
    },
  ]);

  it('returns VALIDATION_ERROR when a required field is missing', async () => {
    const router = new ToolRouter(
      makeMockManager([{ manifest: timerManifest, executeTool: async () => ({}) }])
    );

    const result = await router.execute('time-tracker.start', {}); // taskName missing
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('taskName');
    }
  });

  it('returns VALIDATION_ERROR when multiple required fields are missing', async () => {
    const manifest = makeManifest('notes', [
      {
        name: 'notes.save',
        description: 'Save a note',
        parameters: {
          type: 'object',
          properties: { key: { type: 'string' }, content: { type: 'string' } },
          required: ['key', 'content'],
        },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([{ manifest, executeTool: async () => ({}) }])
    );

    const result = await router.execute('notes.save', {}); // both missing
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('key');
      expect(result.error).toContain('content');
    }
  });

  it('passes when all required fields are present (optional fields may be absent)', async () => {
    let called = false;
    const router = new ToolRouter(
      makeMockManager([
        {
          manifest: timerManifest,
          executeTool: async () => {
            called = true;
            return { sessionId: '123' };
          },
        },
      ])
    );

    const result = await router.execute('time-tracker.start', { taskName: 'coding' });
    expect(result.success).toBe(true);
    expect(called).toBe(true);
  });

  it('passes when tool has no required fields and empty args are given', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.status',
        description: 'Check status',
        parameters: { type: 'object', properties: {} }, // no required
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([{ manifest, executeTool: async () => ({ active: false }) }])
    );

    const result = await router.execute('time-tracker.status', {});
    expect(result.success).toBe(true);
  });
});

// ─── Successful execution ─────────────────────────────────────────────────────

describe('ToolRouter: successful execution', () => {
  it('returns success with tool result data', async () => {
    const returnValue = { sessionId: 'sess_001', taskName: 'coding', status: 'active' };
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.start',
        description: 'Start timer',
        parameters: {
          type: 'object',
          properties: { taskName: { type: 'string' } },
          required: ['taskName'],
        },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([{ manifest, executeTool: async () => returnValue }])
    );

    const result = await router.execute('time-tracker.start', { taskName: 'coding' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(returnValue);
    }
  });

  it('passes args through to the plugin executeTool', async () => {
    const receivedArgs: Record<string, unknown>[] = [];
    const manifest = makeManifest('notes', [
      {
        name: 'notes.save',
        description: 'Save note',
        parameters: {
          type: 'object',
          properties: { key: { type: 'string' }, content: { type: 'string' } },
          required: ['key', 'content'],
        },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([
        {
          manifest,
          executeTool: async (_name, args) => {
            receivedArgs.push(args);
            return { saved: true };
          },
        },
      ])
    );

    await router.execute('notes.save', { key: 'reminder', content: 'Buy milk' });
    expect(receivedArgs[0]).toEqual({ key: 'reminder', content: 'Buy milk' });
  });
});

// ─── EXECUTION_ERROR ──────────────────────────────────────────────────────────

describe('ToolRouter: EXECUTION_ERROR', () => {
  it('returns EXECUTION_ERROR when plugin throws', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.start',
        description: 'Start timer',
        parameters: {
          type: 'object',
          properties: { taskName: { type: 'string' } },
          required: ['taskName'],
        },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([
        {
          manifest,
          executeTool: async () => {
            throw new Error('Database connection failed');
          },
        },
      ])
    );

    const result = await router.execute('time-tracker.start', { taskName: 'coding' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('EXECUTION_ERROR');
      expect(result.error).toContain('Database connection failed');
    }
  });

  it('does not propagate the exception — always returns a ToolResult', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.start',
        description: 'Start timer',
        parameters: { type: 'object', properties: {}, required: [] },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([
        {
          manifest,
          executeTool: async () => {
            throw new Error('Unexpected crash');
          },
        },
      ])
    );

    // Should not throw
    const result = await router.execute('time-tracker.start', {});
    expect(result.success).toBe(false);
  });
});

// ─── asExecutor() ─────────────────────────────────────────────────────────────

describe('ToolRouter.asExecutor()', () => {
  it('returns a function that resolves with data on success', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.status',
        description: 'Check status',
        parameters: { type: 'object', properties: {} },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([{ manifest, executeTool: async () => ({ active: true }) }])
    );

    const executor = router.asExecutor();
    const result = await executor('time-tracker.status', {});
    expect(result).toEqual({ active: true });
  });

  it('throws when the tool is not found', async () => {
    const router = new ToolRouter(makeMockManager([]));
    const executor = router.asExecutor();

    let err: unknown;
    try {
      await executor('missing.tool', {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('TOOL_NOT_FOUND');
  });

  it('throws with VALIDATION_ERROR when required args are missing', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.start',
        description: 'Start timer',
        parameters: {
          type: 'object',
          properties: { taskName: { type: 'string' } },
          required: ['taskName'],
        },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([{ manifest, executeTool: async () => ({}) }])
    );

    const executor = router.asExecutor();
    let err: unknown;
    try {
      await executor('time-tracker.start', {}); // missing taskName
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toContain('VALIDATION_ERROR');
  });

  it('throws with EXECUTION_ERROR when plugin throws', async () => {
    const manifest = makeManifest('time-tracker', [
      {
        name: 'time-tracker.start',
        description: 'Start timer',
        parameters: { type: 'object', properties: {}, required: [] },
        actionType: 'direct',
      },
    ]);
    const router = new ToolRouter(
      makeMockManager([
        {
          manifest,
          executeTool: async () => {
            throw new Error('crash');
          },
        },
      ])
    );

    const executor = router.asExecutor();
    let err: unknown;
    try {
      await executor('time-tracker.start', {});
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toContain('EXECUTION_ERROR');
  });
});
