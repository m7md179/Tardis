import { describe, it, expect } from 'bun:test';
import { resolvePermissions } from './permissions.js';
import type { Workspace } from './types.js';

const ME = 42;

function ws(my_settings: Workspace['my_settings'], my_role: Workspace['my_role']): Workspace {
  return {
    id: 1,
    name: 'Platform',
    key: 'PLAT',
    description: null,
    status: 'ACTIVE',
    color: null,
    lead_account_id: 7,
    project_id: null,
    my_role,
    my_settings,
  };
}

describe('unrestricted (my_settings null)', () => {
  it('allows every capability for ADMIN', () => {
    const p = resolvePermissions(ws(null, 'ADMIN'), ME);
    expect(p.can('delete_items')).toBe(true);
    expect(p.can('assign')).toBe(true);
  });

  it('allows every transition for LEAD', () => {
    const p = resolvePermissions(ws(null, 'LEAD'), ME);
    expect(p.canTransition('BACKLOG', 'DONE')).toBe(true);
    expect(p.allowedTargets('BACKLOG')).toHaveLength(4);
  });

  it('allows acting on someone else’s item', () => {
    const p = resolvePermissions(ws(null, 'LEAD'), ME);
    expect(p.canActOnItem({ assignees: [{ account_id: 99 }], reporter_account_id: 99 })).toBe(true);
  });
});

describe('VIEWER', () => {
  it('denies every capability and every transition', () => {
    const p = resolvePermissions(
      ws(
        {
          role: 'VIEWER',
          own_items_only: false,
          act_own_only: false,
          hidden_tabs: [],
          revoked_capabilities: [],
          allowed_transitions: [{ from: 'BACKLOG', to: 'TODO' }],
        },
        'VIEWER'
      ),
      ME
    );
    expect(p.can('comment')).toBe(false);
    expect(p.canTransition('BACKLOG', 'TODO')).toBe(false);
    expect(p.allowedTargets('BACKLOG')).toEqual([]);
  });
});

describe('MEMBER with rules (the snake_case wire payload)', () => {
  const settings = {
    role: 'MEMBER' as const,
    own_items_only: false,
    act_own_only: true,
    hidden_tabs: [],
    revoked_capabilities: ['delete_items' as const, 'assign' as const],
    allowed_transitions: [
      { from: 'TODO' as const, to: 'IN_PROGRESS' as const },
      { from: 'IN_PROGRESS' as const, to: 'IN_REVIEW' as const },
    ],
  };

  it('revokes exactly the listed capabilities and no others', () => {
    const p = resolvePermissions(ws(settings, 'MEMBER'), ME);
    expect(p.can('delete_items')).toBe(false);
    expect(p.can('assign')).toBe(false);
    expect(p.can('comment')).toBe(true);
    expect(p.can('edit_items')).toBe(true);
  });

  it('permits only granted transitions', () => {
    const p = resolvePermissions(ws(settings, 'MEMBER'), ME);
    expect(p.canTransition('TODO', 'IN_PROGRESS')).toBe(true);
    expect(p.canTransition('IN_PROGRESS', 'DONE')).toBe(false);
    expect(p.allowedTargets('TODO')).toEqual(['IN_PROGRESS']);
    expect(p.allowedTargets('DONE')).toEqual([]);
  });

  it('blocks acting on an item it is not assigned to when act_own_only', () => {
    const p = resolvePermissions(ws(settings, 'MEMBER'), ME);
    expect(p.canActOnItem({ assignees: [{ account_id: ME }], reporter_account_id: 7 })).toBe(true);
    expect(p.canActOnItem({ assignees: [{ account_id: 99 }], reporter_account_id: 7 })).toBe(false);
  });
});

describe('assignees can be null, not just empty', () => {
  it('does not throw when act_own_only meets a null assignee list', () => {
    const p = resolvePermissions(
      ws(
        {
          role: 'MEMBER',
          own_items_only: false,
          act_own_only: true,
          hidden_tabs: [],
          revoked_capabilities: [],
          allowed_transitions: [],
        },
        'MEMBER'
      ),
      ME
    );
    const item = { assignees: null, reporter_account_id: ME } as unknown as {
      assignees: { account_id: number }[];
      reporter_account_id: number;
    };
    expect(() => p.canActOnItem(item)).not.toThrow();
    expect(p.canActOnItem(item)).toBe(false);
  });
});

describe('fail closed', () => {
  // A camelCase mirror, or a server that drops a field, lands here. The old
  // failure was silent and permissive; this asserts it is now restrictive.
  it('treats a malformed settings object as maximally restricted', () => {
    const malformed = { role: 'MEMBER' } as unknown as Workspace['my_settings'];
    const p = resolvePermissions(ws(malformed, 'MEMBER'), ME);
    expect(p.can('comment')).toBe(false);
    expect(p.canTransition('TODO', 'IN_PROGRESS')).toBe(false);
    expect(p.canActOnItem({ assignees: [{ account_id: ME }], reporter_account_id: ME })).toBe(false);
  });
});
