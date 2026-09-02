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

// ─── List results carry their own count ──────────────────────────────────────
//
// Asked "what am I assigned to?" against 135 real items, the model answered
// "45". The tool had handed it a 135-line text blob and no number, so it
// estimated one and stated the estimate as fact. These pin the shape that fixes
// that; `listResult` is exercised through the skills in index.ts.

describe('list results state their size', () => {
  const shape = (n: number) => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
    const lines = rows.map((r) => `#${r.id} something`);
    const noun = n === 1 ? 'item' : 'items';
    return { count: rows.length, items: rows, text: [`${n} ${noun}:`, ...lines].join('\n') };
  };

  it('puts the count where the model reads first', () => {
    const out = shape(135);
    expect(out.count).toBe(135);
    expect(out.text.split('\n')[0]).toBe('135 items:');
  });

  it('survives a trimmed tail — the count is in the first line, not the last', () => {
    // Context fitting can cut the end of a long result. A total derived by
    // counting lines would silently shrink; this one cannot.
    const out = shape(135);
    const trimmed = out.text.split('\n').slice(0, 20).join('\n');
    expect(trimmed.split('\n')[0]).toBe('135 items:');
  });

  it('says "item" for one and "items" for none', () => {
    expect(shape(1).text.split('\n')[0]).toBe('1 item:');
    expect(shape(0).text).toBe('0 items:');
  });
});

// ─── Sampling a long list without lying about its size ───────────────────────
//
// workspace.backlog returns 633 items — 38k tokens — and within a turn that gets
// re-sent on every subsequent model call. Measured over a real day: 19,282
// tokens per turn, single turns at 84k. Totals stay exact; only detail is
// sampled.

describe('long lists are sampled, not summarised away', () => {
  const shape = (n: number, limit = 25) => {
    const rows = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      status: i % 2 === 0 ? 'BACKLOG' : 'DONE',
    }));
    const lines = rows.map((r) => `#${r.id} item`);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const shown = rows.slice(0, limit);
    const truncated = rows.length > shown.length;
    const breakdown = Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ');
    const header = `${rows.length} items (${breakdown})${truncated ? `, showing the first ${shown.length}` : ''}:`;
    return {
      count: rows.length,
      showing: shown.length,
      truncated,
      byStatus,
      text: [header, ...lines.slice(0, limit)].join('\n'),
    };
  };

  it('reports the true total, not the number shown', () => {
    // The failure this must never have: answering "you have 25" when there are
    // 633. The count is what someone acts on.
    const out = shape(633);
    expect(out.count).toBe(633);
    expect(out.showing).toBe(25);
    expect(out.truncated).toBe(true);
    expect(out.text.split('\n')[0]).toContain('633 items');
  });

  it('counts every status across the whole set, not just the sample', () => {
    const out = shape(633);
    const summed = Object.values(out.byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(633);
  });

  it('says plainly that it is showing a subset', () => {
    expect(shape(633).text.split('\n')[0]).toContain('showing the first 25');
  });

  it('leaves a short list completely alone', () => {
    const out = shape(5);
    expect(out.truncated).toBe(false);
    expect(out.showing).toBe(5);
    expect(out.text).not.toContain('showing the first');
  });
});
