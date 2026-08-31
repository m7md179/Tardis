import { describe, it, expect } from 'bun:test';
import { resolveWorkspaceId } from './current.js';
import type { Workspace } from './types.js';

function w(id: number, key: string): Workspace {
  return {
    id,
    name: `WS ${key}`,
    key,
    description: null,
    status: 'ACTIVE',
    color: null,
    lead_account_id: null,
    project_id: null,
    my_role: 'MEMBER',
    my_settings: null,
  };
}

const ALL = [w(1, 'PLAT'), w(2, 'OPS')];

describe('resolveWorkspaceId', () => {
  it('prefers an explicit key over everything else', () => {
    const out = resolveWorkspaceId({ explicitKey: 'OPS', stored: 1, defaultKey: 'PLAT', all: ALL });
    expect(out).toEqual({ id: 2, source: 'explicit' });
  });

  it('matches an explicit key case-insensitively', () => {
    expect(
      resolveWorkspaceId({ explicitKey: 'ops', stored: null, defaultKey: '', all: ALL }).id
    ).toBe(2);
  });

  it('falls back to the stored id', () => {
    const out = resolveWorkspaceId({ stored: 2, defaultKey: 'PLAT', all: ALL });
    expect(out).toEqual({ id: 2, source: 'stored' });
  });

  it('ignores a stored id you are no longer a member of', () => {
    const out = resolveWorkspaceId({ stored: 99, defaultKey: 'PLAT', all: ALL });
    expect(out).toEqual({ id: 1, source: 'default' });
  });

  it('falls back to the configured default key', () => {
    const out = resolveWorkspaceId({ stored: null, defaultKey: 'PLAT', all: ALL });
    expect(out).toEqual({ id: 1, source: 'default' });
  });

  it('picks the only workspace when there is exactly one', () => {
    const out = resolveWorkspaceId({ stored: null, defaultKey: '', all: [w(5, 'SOLO')] });
    expect(out).toEqual({ id: 5, source: 'only' });
  });

  it('throws and lists the options when it cannot decide', () => {
    let caught: unknown;
    try {
      resolveWorkspaceId({ stored: null, defaultKey: '', all: ALL });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('PLAT');
    expect((caught as Error).message).toContain('OPS');
  });

  it('throws a distinct message when you are in no workspaces at all', () => {
    let caught: unknown;
    try {
      resolveWorkspaceId({ stored: null, defaultKey: '', all: [] });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('not a member');
  });

  it('rejects an explicit key that does not exist, rather than silently defaulting', () => {
    let caught: unknown;
    try {
      resolveWorkspaceId({ explicitKey: 'NOPE', stored: 1, defaultKey: 'PLAT', all: ALL });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('NOPE');
  });
});
