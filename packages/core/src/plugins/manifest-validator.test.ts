import { describe, it, expect } from 'bun:test';
import {
  validateManifest,
  validatePermissions,
  checkDuplicateToolNames,
  ManifestValidationError,
} from './manifest-validator.js';
import type { PluginManifest } from '@tardis/shared';

const VALID_MANIFEST: PluginManifest = {
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  description: 'A test plugin',
  skillSummary: 'Handles testing tasks for the plugin manager.',
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

// ─── validateManifest ───

describe('validateManifest: valid input', () => {
  it('accepts a complete valid manifest', () => {
    const result = validateManifest(VALID_MANIFEST, '/fake/dir');
    expect(result.name).toBe('test-plugin');
    expect(result.version).toBe('1.0.0');
    expect(result.tier).toBe(1);
    expect(result.tools).toHaveLength(1);
  });

  it('accepts valid tier values 1, 2, and 3', () => {
    for (const tier of [1, 2, 3] as const) {
      expect(() => validateManifest({ ...VALID_MANIFEST, tier }, '/fake/dir')).not.toThrow();
    }
  });

  it('accepts manifest with no optional fields', () => {
    const minimal = { ...VALID_MANIFEST };
    delete (minimal as Partial<PluginManifest>).proactive;
    delete (minimal as Partial<PluginManifest>).llm;
    delete (minimal as Partial<PluginManifest>).config;
    expect(() => validateManifest(minimal, '/fake/dir')).not.toThrow();
  });

  it('accepts manifest with empty tools array', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, tools: [] }, '/fake/dir')).not.toThrow();
  });

  it('accepts manifest with empty permissions array', () => {
    expect(() =>
      validateManifest({ ...VALID_MANIFEST, permissions: [] }, '/fake/dir')
    ).not.toThrow();
  });
});

describe('validateManifest: missing required fields', () => {
  it('rejects a completely empty object', () => {
    expect(() => validateManifest({}, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing name', () => {
    const { name: _name, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing version', () => {
    const { version: _v, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing tier', () => {
    const { tier: _t, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing tools', () => {
    const { tools: _tools, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing skillSummary', () => {
    const { skillSummary: _s, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing displayName', () => {
    const { displayName: _d, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects manifest missing main', () => {
    const { main: _m, ...rest } = VALID_MANIFEST;
    expect(() => validateManifest(rest, '/fake/dir')).toThrow(ManifestValidationError);
  });
});

describe('validateManifest: invalid field values', () => {
  it('rejects tier: 0', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, tier: 0 }, '/fake/dir')).toThrow(
      ManifestValidationError
    );
  });

  it('rejects tier: 5 (out of range)', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, tier: 5 }, '/fake/dir')).toThrow(
      ManifestValidationError
    );
  });

  it('rejects non-semver version string', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, version: 'v1.0' }, '/fake/dir')).toThrow(
      ManifestValidationError
    );
  });

  it('rejects plugin name with uppercase letters', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, name: 'MyPlugin' }, '/fake/dir')).toThrow(
      ManifestValidationError
    );
  });

  it('rejects empty skillSummary (required for skill routing)', () => {
    expect(() => validateManifest({ ...VALID_MANIFEST, skillSummary: '' }, '/fake/dir')).toThrow(
      ManifestValidationError
    );
  });

  it('rejects tool name without plugin prefix (e.g. "ping" instead of "plugin.ping")', () => {
    const bad = {
      ...VALID_MANIFEST,
      tools: [{ ...VALID_MANIFEST.tools[0]!, name: 'notvalid' }],
    };
    expect(() => validateManifest(bad, '/fake/dir')).toThrow(ManifestValidationError);
  });

  it('rejects tool missing the parameters field', () => {
    const badTool = {
      name: 'test-plugin.no-params',
      description: 'Missing parameters',
      actionType: 'direct' as const,
      // parameters intentionally omitted
    };
    expect(() => validateManifest({ ...VALID_MANIFEST, tools: [badTool] }, '/fake/dir')).toThrow(
      ManifestValidationError
    );
  });

  it('rejects tool with empty description', () => {
    const bad = {
      ...VALID_MANIFEST,
      tools: [{ ...VALID_MANIFEST.tools[0]!, description: '' }],
    };
    expect(() => validateManifest(bad, '/fake/dir')).toThrow(ManifestValidationError);
  });
});

describe('validateManifest: ManifestValidationError properties', () => {
  it('error has correct code and pluginDir', () => {
    let err: ManifestValidationError | undefined;
    try {
      validateManifest({}, '/my/plugin/dir');
    } catch (e) {
      if (e instanceof ManifestValidationError) err = e;
    }
    expect(err).toBeDefined();
    expect(err!.code).toBe('MANIFEST_VALIDATION_ERROR');
    expect(err!.pluginDir).toBe('/my/plugin/dir');
  });

  it('error message names the invalid plugin directory', () => {
    let err: ManifestValidationError | undefined;
    try {
      validateManifest({ tier: 99 }, '/plugins/bad-plugin');
    } catch (e) {
      if (e instanceof ManifestValidationError) err = e;
    }
    expect(err!.message).toContain('/plugins/bad-plugin');
  });
});

// ─── validatePermissions ───

describe('validatePermissions', () => {
  it('accepts all valid permission strings', () => {
    expect(() => validatePermissions(VALID_MANIFEST)).not.toThrow();
  });

  it('accepts a plugin with empty permissions array', () => {
    expect(() => validatePermissions({ ...VALID_MANIFEST, permissions: [] })).not.toThrow();
  });

  it('rejects a single unknown permission string', () => {
    const bad: PluginManifest = { ...VALID_MANIFEST, permissions: ['fake:permission'] };
    expect(() => validatePermissions(bad)).toThrow(ManifestValidationError);
    expect(() => validatePermissions(bad)).toThrow('fake:permission');
  });

  it('rejects when unknown permission is mixed with valid ones', () => {
    const bad: PluginManifest = {
      ...VALID_MANIFEST,
      permissions: ['storage:read', 'totally:invalid'],
    };
    expect(() => validatePermissions(bad)).toThrow(ManifestValidationError);
    expect(() => validatePermissions(bad)).toThrow('totally:invalid');
  });

  it('accepts all 12 known permission strings', () => {
    const allPerms: PluginManifest = {
      ...VALID_MANIFEST,
      permissions: [
        'sessions:read',
        'sessions:write',
        'storage:read',
        'storage:write',
        'notifications:send',
        'http:external',
        'memory:read',
        'memory:write',
        'llm:use',
        'plugins:call',
        'db:read',
        'db:write',
      ],
    };
    expect(() => validatePermissions(allPerms)).not.toThrow();
  });
});

// ─── checkDuplicateToolNames ───

describe('checkDuplicateToolNames', () => {
  it('passes for an empty plugin list', () => {
    expect(() => checkDuplicateToolNames([])).not.toThrow();
  });

  it('passes for a single plugin', () => {
    expect(() => checkDuplicateToolNames([VALID_MANIFEST])).not.toThrow();
  });

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
      name: 'shared-plugin.tool',
      description: 'tool',
      parameters: {},
      actionType: 'direct' as const,
    };
    const m1: PluginManifest = { ...VALID_MANIFEST, name: 'plugin-a', tools: [shared] };
    const m2: PluginManifest = { ...VALID_MANIFEST, name: 'plugin-b', tools: [shared] };
    expect(() => checkDuplicateToolNames([m1, m2])).toThrow(ManifestValidationError);
    expect(() => checkDuplicateToolNames([m1, m2])).toThrow('shared-plugin.tool');
  });

  it('error message includes the duplicate tool name and both plugin names', () => {
    const tool = {
      name: 'my-plugin.dup-tool',
      description: 'd',
      parameters: {},
      actionType: 'direct' as const,
    };
    const m1: PluginManifest = { ...VALID_MANIFEST, name: 'alpha', tools: [tool] };
    const m2: PluginManifest = { ...VALID_MANIFEST, name: 'beta', tools: [tool] };
    let err: ManifestValidationError | undefined;
    try {
      checkDuplicateToolNames([m1, m2]);
    } catch (e) {
      if (e instanceof ManifestValidationError) err = e;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain('my-plugin.dup-tool');
    expect(err!.message).toContain('alpha');
    expect(err!.message).toContain('beta');
  });

  it('passes when same plugin has multiple unique tools', () => {
    const multiTool: PluginManifest = {
      ...VALID_MANIFEST,
      tools: [
        { name: 'test-plugin.ping', description: 'ping', parameters: {}, actionType: 'direct' },
        { name: 'test-plugin.pong', description: 'pong', parameters: {}, actionType: 'direct' },
      ],
    };
    expect(() => checkDuplicateToolNames([multiTool])).not.toThrow();
  });
});
