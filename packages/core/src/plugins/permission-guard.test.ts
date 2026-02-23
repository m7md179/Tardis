import { describe, it, expect } from 'bun:test';
import { PermissionGuard, PermissionDeniedError, ALL_PERMISSIONS } from './permission-guard.js';
import type { Permission } from './permission-guard.js';

describe('PermissionGuard', () => {
  it('allows access when permission is granted', () => {
    const guard = new PermissionGuard('my-plugin', ['storage:read', 'storage:write']);
    expect(() => guard.assert('storage:read')).not.toThrow();
    expect(() => guard.assert('storage:write')).not.toThrow();
  });

  it('throws PermissionDeniedError when permission is not granted', () => {
    const guard = new PermissionGuard('my-plugin', ['storage:read']);
    expect(() => guard.assert('storage:write')).toThrow(PermissionDeniedError);
  });

  it('PermissionDeniedError has correct .code, .permission, .pluginName', () => {
    const guard = new PermissionGuard('my-plugin', []);
    let err: PermissionDeniedError | undefined;
    try {
      guard.assert('sessions:write');
    } catch (e) {
      if (e instanceof PermissionDeniedError) err = e;
    }
    expect(err).toBeDefined();
    expect(err!.code).toBe('PERMISSION_DENIED');
    expect(err!.permission).toBe('sessions:write');
    expect(err!.pluginName).toBe('my-plugin');
    expect(err!.message).toContain('my-plugin');
    expect(err!.message).toContain('sessions:write');
  });

  it('has() returns true only for granted permissions', () => {
    const guard = new PermissionGuard('my-plugin', ['http:external', 'memory:read']);
    expect(guard.has('http:external')).toBe(true);
    expect(guard.has('memory:read')).toBe(true);
    expect(guard.has('memory:write')).toBe(false);
    expect(guard.has('sessions:read')).toBe(false);
  });

  it('allows a plugin with no permissions', () => {
    const guard = new PermissionGuard('bare-plugin', []);
    expect(guard.has('storage:read')).toBe(false);
    expect(() => guard.assert('storage:read')).toThrow(PermissionDeniedError);
  });

  it('covers all 12 permission types', () => {
    const guard = new PermissionGuard('full-plugin', [...ALL_PERMISSIONS]);
    for (const perm of ALL_PERMISSIONS) {
      expect(() => guard.assert(perm as Permission)).not.toThrow();
    }
    expect(ALL_PERMISSIONS).toHaveLength(12);
  });

  // Test each permission individually: granted = pass, not-granted = throw
  const permissionPairs: [Permission, Permission][] = [
    ['sessions:read', 'sessions:write'],
    ['storage:read', 'storage:write'],
    ['memory:read', 'memory:write'],
    ['db:read', 'db:write'],
  ];

  for (const [read, write] of permissionPairs) {
    it(`read-only plugin can "${read}" but not "${write}"`, () => {
      const guard = new PermissionGuard('read-only-plugin', [read]);
      expect(() => guard.assert(read)).not.toThrow();
      expect(() => guard.assert(write)).toThrow(PermissionDeniedError);
    });

    it(`write-only plugin can "${write}" but not "${read}"`, () => {
      const guard = new PermissionGuard('write-only-plugin', [write]);
      expect(() => guard.assert(write)).not.toThrow();
      expect(() => guard.assert(read)).toThrow(PermissionDeniedError);
    });
  }

  it('blocks notifications:send without permission', () => {
    const guard = new PermissionGuard('silent-plugin', []);
    expect(() => guard.assert('notifications:send')).toThrow(PermissionDeniedError);
  });

  it('allows notifications:send with permission', () => {
    const guard = new PermissionGuard('notify-plugin', ['notifications:send']);
    expect(() => guard.assert('notifications:send')).not.toThrow();
  });

  it('blocks http:external without permission', () => {
    const guard = new PermissionGuard('offline-plugin', []);
    expect(() => guard.assert('http:external')).toThrow(PermissionDeniedError);
  });

  it('allows http:external with permission', () => {
    const guard = new PermissionGuard('http-plugin', ['http:external']);
    expect(() => guard.assert('http:external')).not.toThrow();
  });

  it('blocks llm:use without permission', () => {
    const guard = new PermissionGuard('dumb-plugin', []);
    expect(() => guard.assert('llm:use')).toThrow(PermissionDeniedError);
  });

  it('allows llm:use with permission', () => {
    const guard = new PermissionGuard('smart-plugin', ['llm:use']);
    expect(() => guard.assert('llm:use')).not.toThrow();
  });

  it('blocks plugins:call without permission', () => {
    const guard = new PermissionGuard('isolated-plugin', []);
    expect(() => guard.assert('plugins:call')).toThrow(PermissionDeniedError);
  });

  it('allows plugins:call with permission', () => {
    const guard = new PermissionGuard('orchestrator-plugin', ['plugins:call']);
    expect(() => guard.assert('plugins:call')).not.toThrow();
  });
});
