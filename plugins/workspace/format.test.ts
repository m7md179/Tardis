import { describe, it, expect } from 'bun:test';
import { displayName, formatWorkItem, formatBoard, formatWorkspaceSummary } from './format.js';
import type { Board, WorkItem, Workspace } from './types.js';

describe('displayName', () => {
  it('joins first and last name', () => {
    expect(displayName({ first_name: 'Mohammad', last_name: 'Taha', email: 'm@x.com' })).toBe(
      'Mohammad Taha'
    );
  });

  it('uses whichever name is present', () => {
    expect(displayName({ first_name: 'Mohammad', last_name: null, email: 'm@x.com' })).toBe(
      'Mohammad'
    );
    expect(displayName({ first_name: null, last_name: 'Taha', email: 'm@x.com' })).toBe('Taha');
  });

  it('falls back to the email when both names are missing', () => {
    expect(displayName({ first_name: null, last_name: null, email: 'm@x.com' })).toBe('m@x.com');
  });

  it('treats a blank name as missing rather than rendering a stray space', () => {
    expect(displayName({ first_name: '  ', last_name: 'Taha', email: 'm@x.com' })).toBe('Taha');
  });
});

const ITEM: WorkItem = {
  id: 114,
  workspace_id: 1,
  type: 'SUB_TASK',
  title: 'Rate-limit the login endpoint',
  description: null,
  status: 'TODO',
  priority: 'HIGH',
  story_points: 3,
  estimate_hours: 4,
  start_date: null,
  due_date: '2026-09-04T00:00:00.000Z',
  parent_id: 88,
  sprint_id: null,
  reporter_account_id: 42,
  assignees: [{ account_id: 42, first_name: 'Mohammad', last_name: 'Taha', email: 'm@x.com' }],
  archived_at: null,
};

describe('formatWorkItem', () => {
  it('leads with the id and title', () => {
    expect(formatWorkItem(ITEM)).toStartWith('#114 Rate-limit the login endpoint');
  });

  it('includes points, estimate, priority and due date', () => {
    const out = formatWorkItem(ITEM);
    expect(out).toContain('3 pts');
    expect(out).toContain('4h');
    expect(out).toContain('HIGH');
    expect(out).toContain('2026-09-04');
  });

  it('names the assignees', () => {
    expect(formatWorkItem(ITEM)).toContain('Mohammad Taha');
  });

  it('omits fields that are not set rather than printing null', () => {
    const bare: WorkItem = {
      ...ITEM,
      story_points: null,
      estimate_hours: null,
      due_date: null,
      assignees: [],
    };
    const out = formatWorkItem(bare);
    expect(out).not.toContain('null');
    expect(out).not.toContain('pts');
    expect(out).not.toContain('undefined');
  });
});

describe('assignees can be null, not just empty', () => {
  // Board and list endpoints return assignees: []. Create and update return
  // assignees: null. Verified against a real server; the asymmetry is real and
  // an unguarded .length here is a crash on the happy path of Plan 2.
  it('treats a null assignee list as nobody, rather than throwing', () => {
    const nulled = { ...ITEM, assignees: null } as unknown as WorkItem;
    expect(() => formatWorkItem(nulled)).not.toThrow();
    expect(formatWorkItem(nulled)).toContain('#114');
  });
});

describe('formatBoard', () => {
  it('renders every column, including empty ones', () => {
    const board: Board = {
      BACKLOG: [],
      TODO: [ITEM],
      IN_PROGRESS: [],
      IN_REVIEW: [],
      DONE: [],
    };
    const out = formatBoard(board);
    expect(out).toContain('BACKLOG');
    expect(out).toContain('TODO');
    expect(out).toContain('DONE');
    expect(out).toContain('#114');
  });
});

describe('formatWorkspaceSummary', () => {
  it('shows the key and the role', () => {
    const w = {
      id: 1,
      name: 'Platform',
      key: 'PLAT',
      description: null,
      status: 'ACTIVE',
      color: null,
      lead_account_id: 7,
      project_id: null,
      my_role: 'LEAD',
      my_settings: null,
    } as Workspace;
    const out = formatWorkspaceSummary(w);
    expect(out).toContain('PLAT');
    expect(out).toContain('LEAD');
  });
});
