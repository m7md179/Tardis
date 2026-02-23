import { describe, it, expect } from 'bun:test';
import { PermissionGuard, PermissionDeniedError, ALL_PERMISSIONS } from './permission-guard.js';
import type { Permission } from './permission-guard.js';

describe('PermissionGuard', () => {
  // ─── Basic allow / deny ───

  it('allows access when permission is granted', () => {
    const guard = new PermissionGuard('my-plugin', ['storage:read', 'storage:write']);
    expect(() => guard.assert('storage:read')).not.toThrow();
    expect(() => guard.assert('storage:write')).not.toThrow();
  });

  it('throws PermissionDeniedError when permission is not granted', () => {
    const guard = new PermissionGuard('my-plugin', ['storage:read']);
    expect(() => guard.assert('storage:write')).toThrow(PermissionDeniedError);
  });

  it('plugin with no permissions is blocked from everything', () => {
    const guard = new PermissionGuard('bare-plugin', []);
    for (const perm of ALL_PERMISSIONS) {
      expect(() => guard.assert(perm as Permission)).toThrow(PermissionDeniedError);
    }
  });

  // ─── PermissionDeniedError properties ───

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

  // ─── has() ───

  it('has() returns true only for granted permissions', () => {
    const guard = new PermissionGuard('my-plugin', ['http:external', 'memory:read']);
    expect(guard.has('http:external')).toBe(true);
    expect(guard.has('memory:read')).toBe(true);
    expect(guard.has('memory:write')).toBe(false);
    expect(guard.has('sessions:read')).toBe(false);
  });

  it('has() returns false for all permissions when none are granted', () => {
    const guard = new PermissionGuard('bare-plugin', []);
    expect(guard.has('storage:read')).toBe(false);
    expect(guard.has('llm:use')).toBe(false);
  });

  // ─── All 12 permissions covered ───

  it('covers all 12 permission types', () => {
    expect(ALL_PERMISSIONS).toHaveLength(12);
    const guard = new PermissionGuard('full-plugin', [...ALL_PERMISSIONS]);
    for (const perm of ALL_PERMISSIONS) {
      expect(() => guard.assert(perm as Permission)).not.toThrow();
    }
  });

  // Each read/write permission pair: read-only can read but not write, write-only can write but not read
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

  // Singular permissions (no read/write split)
  const singularPermissions: Permission[] = [
    'notifications:send',
    'http:external',
    'llm:use',
    'plugins:call',
  ];

  for (const perm of singularPermissions) {
    it(`blocks "${perm}" without permission`, () => {
      const guard = new PermissionGuard('blocked-plugin', []);
      expect(() => guard.assert(perm)).toThrow(PermissionDeniedError);
    });

    it(`allows "${perm}" with permission`, () => {
      const guard = new PermissionGuard('allowed-plugin', [perm]);
      expect(() => guard.assert(perm)).not.toThrow();
    });
  }

  // ─── Explicit sessions:write test (used by plugin-api sessions.start()) ───

  it('plugin with sessions:write passes guard for sessions:write', () => {
    const guard = new PermissionGuard('time-tracker', ['sessions:write']);
    expect(() => guard.assert('sessions:write')).not.toThrow();
    expect(() => guard.assert('sessions:read')).toThrow(PermissionDeniedError);
  });

  it('plugin without sessions:write fails guard for sessions:write', () => {
    const guard = new PermissionGuard('read-only-session-plugin', ['sessions:read']);
    let err: unknown;
    try {
      guard.assert('sessions:write');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as PermissionDeniedError).pluginName).toBe('read-only-session-plugin');
    expect((err as PermissionDeniedError).permission).toBe('sessions:write');
  });
});
