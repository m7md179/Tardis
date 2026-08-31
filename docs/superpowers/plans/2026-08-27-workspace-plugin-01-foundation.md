# Workspace Plugin — Plan 1: Foundation & Reads

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TARDIS plugin that authenticates as your internal-operation account and answers "what's on my board?" — from chat, the TUI, and the web app.

**Architecture:** A multi-file plugin under `plugins/workspace/`. Pure logic (`permissions.ts`, `format.ts`) is separated from I/O (`io-client.ts`) so the parts worth testing need neither a network nor a model. `index.ts` is a thin dispatch. Authentication is email+password login with a re-login-on-401 retry; there is no refresh endpoint on the server.

**Tech Stack:** Bun 1.3.8, TypeScript 5.7, `bun:test`, Zod (via `@tardis/shared`), the existing `PluginAPI` (`http`, `storage`, `config`, `logger`).

**Spec:** `docs/specs/2026-08-27-workspace-plugin-design.md`

**Branch:** `feat/workspace-plugin`

## Global Constraints

- **The IO wire format is snake_case.** `my_settings`, `own_items_only`, `act_own_only`, `hidden_tabs`, `revoked_capabilities`, `allowed_transitions`, `account_id`, `first_name`, `story_points`, `estimate_hours`, `due_date`, `assignee_account_ids`. There is no camelCase interceptor on the server. A camelCase mirror compiles and silently reads `undefined`. (Spec §18.4)
- **Every IO response is wrapped**: `{ data, status, message }`. Always unwrap `.data`.
- **There is no refresh endpoint.** `401 → login() → retry once`. Never more than one retry. (Spec §5)
- **Permission checks fail closed.** A present-but-malformed `my_settings` means maximally restricted, never unrestricted.
- `my_settings: null` means **unrestricted** (ADMIN *or* LEAD), not "not a member".
- Do not modify `internal-operation-server` or `internal-operation-website`. (Spec §1, success criterion 4)
- Bun pins to `1.3.8` (`.bun-version`, `packageManager`).
- Tests co-locate as `*.test.ts` beside the source, using `bun:test` (`describe` / `it` / `expect`).
- Avoid temp SQLite files in tests — the suite has 146 pre-existing Windows-only `EBUSY` failures from DB handles not releasing, and new tests should stay runnable on the workstation.
- ESLint enforces `@typescript-eslint/explicit-function-return-type`. Every exported function needs an explicit return type.

## Out of scope for this plan

Drafts, ranking, writes, the `remote-select` field type, and the web board. Those are Plans 2 and 3. This plan ends when reads work end to end.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/workspace/package.json` | Workspace member declaration |
| `plugins/workspace/manifest.json` | Skills, UI descriptors, permissions, config keys |
| `plugins/workspace/types.ts` | Wire types, snake_case, hand-mirrored. No logic. |
| `plugins/workspace/permissions.ts` | `my_settings` → capability/transition predicates. Pure. |
| `plugins/workspace/format.ts` | Payloads → human-readable text. Pure. |
| `plugins/workspace/io-client.ts` | Auth lifecycle + typed API calls. The only file that does I/O. |
| `plugins/workspace/index.ts` | Lifecycle hooks + `executeTool` dispatch. Thin. |

`permissions.ts` and `format.ts` are split from `io-client.ts` specifically so they can be tested without a fetch stub. That split is the plan's main structural decision.

---

## Task 1: Plugin scaffold that loads

**Files:**
- Create: `plugins/workspace/package.json`
- Create: `plugins/workspace/manifest.json`
- Create: `plugins/workspace/index.ts`
- Test: `packages/core/src/plugins/manifest-conformance.test.ts` (existing — must keep passing)

**Interfaces:**
- Consumes: nothing
- Produces: a loadable plugin named `workspace` exporting `onActivate(api: PluginAPI): Promise<void>`, `onDeactivate(): Promise<void>`, `executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown>`

- [ ] **Step 1: Run the existing conformance test to see it green before you touch anything**

Run: `bun test packages/core/src/plugins/manifest-conformance.test.ts`
Expected: PASS. This test auto-discovers every directory under `plugins/` with a `manifest.json`, so the moment Task 1 adds one, it starts validating it. Knowing it was green first tells you any later failure is yours.

- [ ] **Step 2: Create `plugins/workspace/package.json`**

```json
{
  "name": "@tardis-plugin/workspace",
  "version": "1.0.0",
  "description": "Workspace plugin for TARDIS — internal-operation agile PM",
  "type": "module",
  "private": true,
  "devDependencies": {
    "@tardis/core": "workspace:*",
    "@tardis/shared": "workspace:*"
  }
}
```

- [ ] **Step 3: Create `plugins/workspace/manifest.json` with one skill**

Tier 3 — it talks to an external service. One skill for now; the rest arrive in Task 7.

```json
{
  "name": "workspace",
  "version": "1.0.0",
  "displayName": "Workspace",
  "description": "Read and manage work items in the internal-operation Workspaces module.",
  "summary": "Agile project management: workspaces, boards, backlogs, sprints and work items from the internal-operation system. Use for anything about epics, stories, sub-tasks, sprints or what is assigned to me.",
  "tier": 3,
  "main": "index.ts",
  "permissions": ["http:external", "storage:read", "storage:write", "llm:use"],
  "skills": [
    {
      "id": "workspace.list-workspaces",
      "description": "List the internal-operation workspaces you are a member of, with your role in each.",
      "aiInvocable": true,
      "actionType": "direct",
      "parameters": { "type": "object", "properties": {} },
      "ui": {
        "block": "list",
        "label": "Workspaces",
        "icon": "folder",
        "resultPath": "workspaces",
        "emptyText": "You are not a member of any workspace.",
        "item": { "id": "id", "title": "name", "subtitle": "summary" }
      }
    }
  ],
  "config": {
    "baseUrl": "",
    "email": "",
    "password": "",
    "defaultWorkspaceKey": ""
  }
}
```

- [ ] **Step 4: Create `plugins/workspace/index.ts` as a stub that returns a fixed value**

Deliberately hardcoded. Task 5 replaces the body; right now the only question is "does the plugin load and dispatch?".

```ts
import type { PluginAPI } from '@tardis/core';

let api: PluginAPI;

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  api.logger.info('Workspace plugin activated');
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Workspace plugin deactivated');
};

export const executeTool = async (
  toolName: string,
  _args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'workspace.list-workspaces':
      return { workspaces: [] };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
```

- [ ] **Step 5: Run the conformance test again**

Run: `bun test packages/core/src/plugins/manifest-conformance.test.ts`
Expected: PASS, and the output now contains a `workspace` describe block. If the manifest is malformed this fails rather than erroring silently — the test file's own comment explains why it parses lazily inside each `it`.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/workspace
git commit -m "feat(workspace): plugin scaffold that loads and dispatches"
```

---

## Task 2: Wire types and fail-closed permissions

This is the task that prevents the spec's highest-severity risk. Read §18.4 before starting.

**Files:**
- Create: `plugins/workspace/types.ts`
- Create: `plugins/workspace/permissions.ts`
- Test: `plugins/workspace/permissions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `types.ts`: `WorkItemStatus`, `WorkItemType`, `WorkItemPriority`, `WorkspaceRole`, `CapabilityKey`, `TransitionEdge`, `MemberSettings`, `Assignee`, `Workspace`, `WorkItem`, `Board`, `IoEnvelope<T>`
  - `permissions.ts`: `resolvePermissions(workspace: Workspace, myAccountId: number): Permissions` and the `Permissions` interface with `can`, `canTransition`, `allowedTargets`, `canActOnItem`

- [ ] **Step 1: Create `plugins/workspace/types.ts`**

No logic — this file only mirrors the wire. Every property name here was read off the server source; do not "tidy" any of them into camelCase.

```ts
/**
 * The internal-operation wire format, mirrored by hand.
 *
 * snake_case throughout, because the server has no camelCase interceptor —
 * `workspace.service.ts` builds `my_settings` literally. The website's
 * camelCase types are its own client-side mapping, not the wire.
 *
 * Renaming anything here to camelCase compiles fine and reads `undefined` at
 * runtime, which `permissions.ts` would otherwise interpret as "no rules".
 */

export type WorkItemStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type WorkItemType = 'EPIC' | 'STORY' | 'SUB_TASK';
export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type WorkspaceRole = 'VIEWER' | 'MEMBER' | 'LEAD';

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
];

export type CapabilityKey =
  | 'create_items'
  | 'edit_items'
  | 'assign'
  | 'apply_labels'
  | 'manage_sprint_items'
  | 'comment'
  | 'log_time'
  | 'manage_checklist'
  | 'manage_attachments'
  | 'delete_items';

export interface TransitionEdge {
  from: WorkItemStatus;
  to: WorkItemStatus;
}

/** null on the workspace payload means ADMIN or LEAD — unrestricted. */
export interface MemberSettings {
  role: WorkspaceRole;
  own_items_only: boolean;
  act_own_only: boolean;
  hidden_tabs: string[];
  revoked_capabilities: CapabilityKey[];
  allowed_transitions: TransitionEdge[];
}

export interface Assignee {
  account_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

export interface Workspace {
  id: number;
  name: string;
  key: string;
  description: string | null;
  status: string;
  color: string | null;
  lead_account_id: number | null;
  project_id: number | null;
  my_role: 'ADMIN' | WorkspaceRole | null;
  my_settings: MemberSettings | null;
}

export interface WorkItem {
  id: number;
  workspace_id: number;
  type: WorkItemType;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  story_points: number | null;
  estimate_hours: number | null;
  start_date: string | null;
  due_date: string | null;
  parent_id: number | null;
  sprint_id: number | null;
  reporter_account_id: number;
  assignees: Assignee[];
  archived_at: string | null;
}

/** GET /workspaces/:id/board — the five fixed columns. */
export type Board = Record<WorkItemStatus, WorkItem[]>;

/** Every internal-operation response is wrapped like this. */
export interface IoEnvelope<T> {
  data: T;
  status: number;
  message: string;
}
```

- [ ] **Step 2: Write the failing tests for `permissions.ts`**

Create `plugins/workspace/permissions.test.ts`. The first test is the §18.4 guard: it feeds a payload shaped exactly like the wire and asserts the restrictions actually bite.

```ts
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

  it('allows acting on someone else\u2019s item', () => {
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test plugins/workspace/permissions.test.ts`
Expected: FAIL — `Cannot find module './permissions.js'`.

- [ ] **Step 4: Implement `plugins/workspace/permissions.ts`**

```ts
/**
 * What the current user is allowed to do in one workspace.
 *
 * Mirrors the server's own rules (`workspace-membership.service.ts`) so the
 * plugin never offers an action that is about to 403. This is a UX layer, not
 * a security boundary — the server enforces regardless.
 *
 * Fails CLOSED. A settings object missing its arrays is treated as maximally
 * restricted rather than unrestricted, because the realistic way that happens
 * is a client type drifting to camelCase against a snake_case wire, and
 * "silently allow everything" is the wrong direction to be wrong in.
 */

import type {
  CapabilityKey,
  MemberSettings,
  TransitionEdge,
  WorkItemStatus,
  Workspace,
} from './types.js';
import { WORK_ITEM_STATUSES } from './types.js';

export interface Permissions {
  can(cap: CapabilityKey): boolean;
  canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean;
  allowedTargets(from: WorkItemStatus): WorkItemStatus[];
  canActOnItem(item: { assignees: { account_id: number }[]; reporter_account_id: number }): boolean;
}

const UNRESTRICTED: Permissions = {
  can: () => true,
  canTransition: (from, to) => from !== to,
  allowedTargets: (from) => WORK_ITEM_STATUSES.filter((s) => s !== from),
  canActOnItem: () => true,
};

const DENY_ALL: Permissions = {
  can: () => false,
  canTransition: () => false,
  allowedTargets: () => [],
  canActOnItem: () => false,
};

/** A settings object we can actually reason about, or null if it is malformed. */
function validated(s: MemberSettings): MemberSettings | null {
  if (
    !Array.isArray(s.revoked_capabilities) ||
    !Array.isArray(s.allowed_transitions) ||
    typeof s.act_own_only !== 'boolean'
  ) {
    return null;
  }
  return s;
}

export function resolvePermissions(workspace: Workspace, myAccountId: number): Permissions {
  const raw = workspace.my_settings;

  // null = ADMIN or LEAD. Not "not a member".
  if (raw === null || raw === undefined) return UNRESTRICTED;

  const s = validated(raw);
  if (s === null) return DENY_ALL;
  if (s.role === 'VIEWER') return DENY_ALL;

  const revoked = new Set<CapabilityKey>(s.revoked_capabilities);
  const edges: TransitionEdge[] = s.allowed_transitions;

  return {
    can: (cap) => !revoked.has(cap),
    canTransition: (from, to) => edges.some((e) => e.from === from && e.to === to),
    allowedTargets: (from) => edges.filter((e) => e.from === from).map((e) => e.to),
    canActOnItem: (item) =>
      !s.act_own_only || item.assignees.some((a) => a.account_id === myAccountId),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test plugins/workspace/permissions.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: typecheck PASS. Lint must not add new errors — the repo has 2 pre-existing errors in `packages/server`; anything in `plugins/workspace` is yours.

- [ ] **Step 7: Commit**

```bash
git add plugins/workspace/types.ts plugins/workspace/permissions.ts plugins/workspace/permissions.test.ts
git commit -m "feat(workspace): wire types and fail-closed permission resolution"
```

---

## Task 3: Formatting

**Files:**
- Create: `plugins/workspace/format.ts`
- Test: `plugins/workspace/format.test.ts`

**Interfaces:**
- Consumes: `types.ts` from Task 2
- Produces: `displayName(p: { first_name: string | null; last_name: string | null; email: string }): string`, `formatWorkItem(item: WorkItem): string`, `formatBoard(board: Board): string`, `formatWorkspaceSummary(w: Workspace): string`

`displayName` exists because the members and assignees payloads carry `first_name` and
`last_name` separately, and the UI contract's rule 1 forbids string templating in a
descriptor. Composition belongs here. (Spec §18.3)

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/format.test.ts`.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test plugins/workspace/format.test.ts`
Expected: FAIL — `Cannot find module './format.js'`.

- [ ] **Step 3: Implement `plugins/workspace/format.ts`**

```ts
/**
 * Payloads to text.
 *
 * Chat surfaces get a string; structured surfaces get the raw object and bind
 * through the UI descriptor. Keeping composition here rather than in a
 * descriptor is what lets UI-CONTRACT.md keep its "no expressions" rule.
 */

import type { Board, WorkItem, Workspace } from './types.js';
import { WORK_ITEM_STATUSES } from './types.js';

function present(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

export function displayName(p: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}): string {
  const parts = [present(p.first_name), present(p.last_name)].filter(
    (x): x is string => x !== null
  );
  return parts.length > 0 ? parts.join(' ') : p.email;
}

/** ISO timestamp to a bare date. Times on due dates are noise. */
function asDate(iso: string | null): string | null {
  if (iso === null) return null;
  return iso.slice(0, 10);
}

export function formatWorkItem(item: WorkItem): string {
  const bits: string[] = [item.priority, item.status];
  if (item.story_points !== null) bits.push(`${item.story_points} pts`);
  if (item.estimate_hours !== null) bits.push(`${item.estimate_hours}h`);
  const due = asDate(item.due_date);
  if (due !== null) bits.push(`due ${due}`);
  if (item.assignees.length > 0) bits.push(item.assignees.map(displayName).join(', '));

  return `#${item.id} ${item.title}\n  ${bits.join(' · ')}`;
}

export function formatBoard(board: Board): string {
  return WORK_ITEM_STATUSES.map((status) => {
    const items = board[status] ?? [];
    const body =
      items.length === 0
        ? '  (empty)'
        : items.map((i) => `  #${i.id} ${i.title}`).join('\n');
    return `${status} (${items.length})\n${body}`;
  }).join('\n\n');
}

export function formatWorkspaceSummary(w: Workspace): string {
  const role = w.my_role ?? 'MEMBER';
  return `${w.key} — ${w.name} (${role})`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test plugins/workspace/format.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/workspace/format.ts plugins/workspace/format.test.ts
git commit -m "feat(workspace): format work items, boards and workspaces as text"
```

---

## Task 4: The IO client and its auth lifecycle

**Files:**
- Create: `plugins/workspace/io-client.ts`
- Test: `plugins/workspace/io-client.test.ts`

**Interfaces:**
- Consumes: `types.ts` from Task 2
- Produces:
  - `class IoError extends Error` with `readonly status: number`
  - `class IoClient` constructed from `IoClientDeps`, exposing `login(): Promise<number>`, `request<T>(method: string, path: string, body?: unknown): Promise<T>`, `listWorkspaces(): Promise<Workspace[]>`, `getBoard(workspaceId: number): Promise<Board>`, `getBacklog(workspaceId: number): Promise<WorkItem[]>`, `getMyItems(status?: string): Promise<WorkItem[]>`, `searchItems(workspaceId: number, q: string): Promise<WorkItem[]>`, `getItem(itemId: number): Promise<WorkItem>`, `getSprints(workspaceId: number): Promise<unknown[]>`, `getMembers(workspaceId: number): Promise<unknown[]>`
  - `interface IoClientDeps { baseUrl, email, password, storage, logger, fetchImpl }`

`fetchImpl` is injected so tests never touch a network. In production `index.ts` passes a
function that delegates to `api.http`, keeping the `http:external` permission check in the
path.

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/io-client.test.ts`.

```ts
import { describe, it, expect } from 'bun:test';
import { IoClient, IoError } from './io-client.js';

// ─── Helpers ───

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const LOGIN_OK = {
  data: {
    signedAccessToken: 'access-1',
    signedRefreshToken: 'refresh-1',
    account: { id: 42, email: 'm@x.com' },
  },
  status: 200,
  message: 'Logged in',
};

/** In-memory StorageAPI stand-in — no SQLite, so this runs on Windows. */
function memStorage(): {
  get: (k: string) => Promise<unknown>;
  set: (k: string, v: unknown) => Promise<void>;
  delete: (k: string) => Promise<void>;
  list: () => Promise<string[]>;
  dump: Map<string, unknown>;
} {
  const dump = new Map<string, unknown>();
  return {
    get: async (k) => dump.get(k) ?? null,
    set: async (k, v) => void dump.set(k, v),
    delete: async (k) => void dump.delete(k),
    list: async () => [...dump.keys()],
    dump,
  };
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function makeClient(handler: (call: Call, n: number) => Response): {
  client: IoClient;
  calls: Call[];
  storage: ReturnType<typeof memStorage>;
} {
  const calls: Call[] = [];
  const storage = memStorage();
  const client = new IoClient({
    baseUrl: 'http://io.test',
    email: 'm@x.com',
    password: 'pw',
    storage,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    fetchImpl: async (url: string, init?: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return handler(call, calls.length);
    },
  });
  return { client, calls, storage };
}

// ─── Login ───

describe('login', () => {
  it('posts credentials and stores the access token and account id', async () => {
    const { client, calls, storage } = makeClient(() => jsonResponse(LOGIN_OK));
    const accountId = await client.login();

    expect(accountId).toBe(42);
    expect(calls[0]!.url).toBe('http://io.test/account/login');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(await storage.get('accessToken')).toBe('access-1');
    expect(await storage.get('accountId')).toBe(42);
  });

  it('does not store the refresh token, because nothing can redeem it', async () => {
    const { client, storage } = makeClient(() => jsonResponse(LOGIN_OK));
    await client.login();
    expect(await storage.get('refreshToken')).toBeNull();
  });

  it('throws an actionable error naming the config key on bad credentials', async () => {
    const { client } = makeClient(() =>
      jsonResponse({ message: 'Invalid credentials', statusCode: 400 }, 400)
    );
    let caught: unknown;
    try {
      await client.login();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IoError);
    expect((caught as Error).message).toContain('email');
    expect((caught as Error).message).toContain('password');
  });

  it('clears any stale token when login fails', async () => {
    const { client, storage } = makeClient(() => jsonResponse({ message: 'nope' }, 400));
    await storage.set('accessToken', 'stale');
    await client.login().catch(() => {});
    expect(await storage.get('accessToken')).toBeNull();
  });
});

// ─── request ───

describe('request', () => {
  it('logs in first when there is no token', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ data: [], status: 200, message: 'ok' })
    );
    await client.request('GET', '/workspaces');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/account/login');
    expect(calls[1]!.url).toBe('http://io.test/workspaces');
  });

  it('sends the bearer token', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ data: [], status: 200, message: 'ok' })
    );
    await client.request('GET', '/workspaces');
    const headers = calls[1]!.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer access-1');
  });

  it('unwraps the { data, status, message } envelope', async () => {
    const { client } = makeClient((_c, n) =>
      n === 1
        ? jsonResponse(LOGIN_OK)
        : jsonResponse({ data: [{ id: 1 }], status: 200, message: 'ok' })
    );
    const out = await client.request<{ id: number }[]>('GET', '/workspaces');
    expect(out).toEqual([{ id: 1 }]);
  });

  it('re-logs in and retries exactly once on 401', async () => {
    const { client, calls } = makeClient((_c, n) => {
      if (n === 1) return jsonResponse(LOGIN_OK);
      if (n === 2) return jsonResponse({ message: 'Unauthorized' }, 401);
      if (n === 3) return jsonResponse({ ...LOGIN_OK, data: { ...LOGIN_OK.data, signedAccessToken: 'access-2' } });
      return jsonResponse({ data: 'fresh', status: 200, message: 'ok' });
    });

    const out = await client.request<string>('GET', '/workspaces');

    expect(out).toBe('fresh');
    expect(calls).toHaveLength(4);
    expect(calls[2]!.url).toContain('/account/login');
    expect((calls[3]!.init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer access-2'
    );
  });

  it('gives up after one retry rather than looping on a persistent 401', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1 || n === 3 ? jsonResponse(LOGIN_OK) : jsonResponse({ message: 'Unauthorized' }, 401)
    );

    await expect(client.request('GET', '/workspaces')).rejects.toBeInstanceOf(IoError);
    expect(calls).toHaveLength(4);
  });

  it('surfaces the server message on a 403 and does not retry', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1
        ? jsonResponse(LOGIN_OK)
        : jsonResponse({ message: 'Transition not allowed', statusCode: 403 }, 403)
    );

    let caught: unknown;
    try {
      await client.request('PATCH', '/workspaces/work-items/1/move', { status: 'DONE' });
    } catch (e) {
      caught = e;
    }
    expect((caught as IoError).status).toBe(403);
    expect((caught as Error).message).toContain('Transition not allowed');
    expect(calls).toHaveLength(2);
  });

  it('reports an unreachable server distinguishably from a rejected one', async () => {
    const { client } = makeClient(() => {
      throw new TypeError('fetch failed');
    });
    let caught: unknown;
    try {
      await client.request('GET', '/workspaces');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('http://io.test');
    expect((caught as Error).message).toContain('unreachable');
  });
});

// ─── Typed reads ───

describe('typed reads', () => {
  it('builds the search query with q and archived', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ data: [], status: 200, message: 'ok' })
    );
    await client.searchItems(7, 'login');
    expect(calls[1]!.url).toContain('/workspaces/7/work-items');
    expect(calls[1]!.url).toContain('q=login');
    expect(calls[1]!.url).toContain('archived=exclude');
  });

  it('encodes a query containing spaces and symbols', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ data: [], status: 200, message: 'ok' })
    );
    await client.searchItems(7, 'rate limit & auth');
    expect(calls[1]!.url).toContain('q=rate%20limit%20%26%20auth');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test plugins/workspace/io-client.test.ts`
Expected: FAIL — `Cannot find module './io-client.js'`.

- [ ] **Step 3: Implement `plugins/workspace/io-client.ts`**

```ts
/**
 * The only file here that talks to the network.
 *
 * Auth is login-only: the server has no refresh route (TokenService.refreshToken
 * exists but no controller exposes it), so a 401 means log in again. Because the
 * password is in config, that always works, and the retry path is the same code
 * as a cold start rather than a rarely-run branch.
 */

import type { Board, IoEnvelope, WorkItem, Workspace } from './types.js';

export class IoError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'IoError';
    this.status = status;
  }
}

interface StorageLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface LoggerLike {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

export interface IoClientDeps {
  baseUrl: string;
  email: string;
  password: string;
  storage: StorageLike;
  logger: LoggerLike;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
}

interface LoginData {
  signedAccessToken: string;
  signedRefreshToken: string;
  account: { id: number; email: string };
}

export class IoClient {
  private readonly deps: IoClientDeps;

  constructor(deps: IoClientDeps) {
    this.deps = deps;
  }

  private url(path: string): string {
    return `${this.deps.baseUrl.replace(/\/$/, '')}${path}`;
  }

  /** Reads a server error body without assuming it is JSON. */
  private static async errorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === 'string') return body.message;
      if (Array.isArray(body.message)) return body.message.join('; ');
    } catch {
      /* not JSON — fall through */
    }
    return res.statusText || `HTTP ${res.status}`;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.deps.fetchImpl(url, init);
    } catch (err) {
      throw new IoError(
        `Workspace: ${this.deps.baseUrl} is unreachable (${
          err instanceof Error ? err.message : String(err)
        }). Check the plugin's baseUrl config and that the server is running.`,
        0
      );
    }
  }

  /** Authenticate and store the access token. Returns the account id. */
  async login(): Promise<number> {
    const res = await this.send(this.url('/account/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.deps.email, password: this.deps.password }),
    });

    if (!res.ok) {
      await this.deps.storage.delete('accessToken');
      const detail = await IoClient.errorMessage(res);
      throw new IoError(
        `Workspace: login failed (${detail}). Check the plugin's email and password config.`,
        res.status
      );
    }

    const body = (await res.json()) as IoEnvelope<LoginData>;
    await this.deps.storage.set('accessToken', body.data.signedAccessToken);
    await this.deps.storage.set('accountId', body.data.account.id);
    // signedRefreshToken is deliberately dropped — no route can redeem it.
    this.deps.logger.info('Workspace: authenticated');
    return body.data.account.id;
  }

  private async token(): Promise<string> {
    const existing = await this.deps.storage.get<string>('accessToken');
    if (existing !== null && existing !== '') return existing;
    await this.login();
    return (await this.deps.storage.get<string>('accessToken')) ?? '';
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const attempt = async (token: string): Promise<Response> =>
      this.send(this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    let res = await attempt(await this.token());

    // One retry, and only for 401. A persistent 401 must not loop.
    if (res.status === 401) {
      this.deps.logger.debug('Workspace: token rejected, logging in again');
      await this.login();
      res = await attempt((await this.deps.storage.get<string>('accessToken')) ?? '');
    }

    if (!res.ok) {
      throw new IoError(`Workspace: ${await IoClient.errorMessage(res)}`, res.status);
    }

    const envelope = (await res.json()) as IoEnvelope<T>;
    return envelope.data;
  }

  // ─── Typed reads ───

  async listWorkspaces(): Promise<Workspace[]> {
    return this.request<Workspace[]>('GET', '/workspaces');
  }

  async getBoard(workspaceId: number): Promise<Board> {
    return this.request<Board>('GET', `/workspaces/${workspaceId}/board`);
  }

  async getBacklog(workspaceId: number): Promise<WorkItem[]> {
    return this.request<WorkItem[]>('GET', `/workspaces/${workspaceId}/backlog`);
  }

  async getMyItems(status?: string): Promise<WorkItem[]> {
    const q = status === undefined ? '' : `?status=${encodeURIComponent(status)}`;
    return this.request<WorkItem[]>('GET', `/workspaces/my-items${q}`);
  }

  async searchItems(workspaceId: number, q: string): Promise<WorkItem[]> {
    const query = `?q=${encodeURIComponent(q)}&archived=exclude`;
    return this.request<WorkItem[]>('GET', `/workspaces/${workspaceId}/work-items${query}`);
  }

  async getItem(itemId: number): Promise<WorkItem> {
    return this.request<WorkItem>('GET', `/workspaces/work-items/${itemId}`);
  }

  async getSprints(workspaceId: number): Promise<unknown[]> {
    return this.request<unknown[]>('GET', `/workspaces/${workspaceId}/sprints`);
  }

  async getMembers(workspaceId: number): Promise<unknown[]> {
    return this.request<unknown[]>('GET', `/workspaces/${workspaceId}/members`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test plugins/workspace/io-client.test.ts`
Expected: PASS, 13 tests.

Note `encodeURIComponent` renders a space as `%20`, which is what the "encodes a query
containing spaces" test asserts. If you reach for `URLSearchParams` instead it produces
`+` and that test fails — either is valid HTTP, so change the assertion if you change the
implementation, but do not leave them disagreeing.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS, no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add plugins/workspace/io-client.ts plugins/workspace/io-client.test.ts
git commit -m "feat(workspace): IO client with login-only auth and single-retry on 401"
```

---

## Task 5: Wire the client into the plugin

**Files:**
- Modify: `plugins/workspace/index.ts` (replace the Task 1 stub entirely)

**Interfaces:**
- Consumes: `IoClient` and `IoClientDeps` from Task 4; `resolvePermissions` from Task 2; `formatWorkspaceSummary` from Task 3
- Produces: a working `workspace.list-workspaces` returning `{ workspaces: Array<{ id, key, name, role, summary }> }`

The `resultPath` in the Task 1 manifest is `workspaces`, and `item.subtitle` is `summary`,
so the returned objects must carry exactly those keys.

- [ ] **Step 1: Replace `plugins/workspace/index.ts`**

```ts
import type { PluginAPI } from '@tardis/core';
import { IoClient } from './io-client.js';
import { resolvePermissions } from './permissions.js';
import { formatWorkspaceSummary } from './format.js';

let api: PluginAPI;
let client: IoClient | null = null;

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  const baseUrl = (await api.config.get<string>('baseUrl')) ?? '';
  const email = (await api.config.get<string>('email')) ?? '';
  const password = (await api.config.get<string>('password')) ?? '';

  if (baseUrl === '' || email === '' || password === '') {
    api.logger.warn('Workspace plugin activated without credentials — set baseUrl, email, password');
    return;
  }

  client = new IoClient({
    baseUrl,
    email,
    password,
    storage: api.storage,
    logger: api.logger,
    fetchImpl: httpAdapter,
  });

  api.logger.info('Workspace plugin activated');
};

/**
 * Route IoClient's fetch-shaped calls through PluginAPI.http, so the
 * `http:external` permission is actually checked.
 *
 * This cannot be `api.http.get` alone: that method hardcodes
 * `fetch(url, { ...options, method: 'GET' })`, so a POST handed to it is
 * silently downgraded to a GET and the login request quietly does nothing.
 * Dispatching on the method is mandatory, not stylistic.
 *
 * PluginAPI.http.post stringifies a non-string body and sets
 * `x-www-form-urlencoded` for a string one — but it spreads caller headers
 * last, and IoClient always sends an explicit `Content-Type: application/json`
 * alongside a body, so ours wins.
 */
const httpAdapter = async (url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = init?.headers as Record<string, string> | undefined;
  const body = typeof init?.body === 'string' ? init.body : '';
  const opts = headers === undefined ? undefined : { headers };

  switch (method) {
    case 'GET':
      return api.http.get(url, opts) as unknown as Promise<Response>;
    case 'POST':
      return api.http.post(url, body, opts) as unknown as Promise<Response>;
    case 'PATCH':
      return api.http.patch(url, body, opts) as unknown as Promise<Response>;
    case 'PUT':
      return api.http.put(url, body, opts) as unknown as Promise<Response>;
    case 'DELETE':
      return api.http.delete(url, opts) as unknown as Promise<Response>;
    default:
      throw new Error(`Workspace: unsupported HTTP method ${method}`);
  }
};

export const onDeactivate = async (): Promise<void> => {
  client = null;
  api.logger.info('Workspace plugin deactivated');
};

// ─── Helpers ───

function assertConfigured(): IoClient {
  if (client === null) {
    throw new Error(
      'Workspace plugin is not configured. Set baseUrl, email and password in its config.'
    );
  }
  return client;
}

// ─── Tool execution ───

export const executeTool = async (
  toolName: string,
  _args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'workspace.list-workspaces': {
      const io = assertConfigured();
      const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
      const workspaces = await io.listWorkspaces();

      return {
        workspaces: workspaces.map((w) => {
          const perms = resolvePermissions(w, myAccountId);
          return {
            id: w.id,
            key: w.key,
            name: w.name,
            role: w.my_role ?? 'MEMBER',
            canCreate: perms.can('create_items'),
            summary: formatWorkspaceSummary(w),
          };
        }),
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
```

- [ ] **Step 2: Confirm the method-override behaviour for yourself**

Run: `grep -n "async get" -A 3 packages/core/src/plugins/plugin-api.ts`
Expected: `return fetch(url, { ...options, method: 'GET' })`.

That trailing `method: 'GET'` is why `httpAdapter` dispatches. Read it once so you do not
"simplify" the adapter back into a single `api.http.get` call later. Plan 2 adds writes and
depends on this dispatch already being correct.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS. `api.http.get` is typed `Promise<never>`, hence the
`as unknown as Promise<Response>` cast — that cast is expected, not a smell to remove.

- [ ] **Step 4: Run the full plugin test suite**

Run: `bun test plugins/workspace/`
Expected: PASS, 31 tests across three files (permissions 8, format 10, io-client 13).

- [ ] **Step 5: Commit**

```bash
git add plugins/workspace/index.ts
git commit -m "feat(workspace): wire the IO client into list-workspaces"
```

---

## Task 6: Current workspace

**Files:**
- Modify: `plugins/workspace/manifest.json` (add one skill)
- Modify: `plugins/workspace/index.ts` (add the case and a resolver)
- Create: `plugins/workspace/current.ts`
- Test: `plugins/workspace/current.test.ts`

**Interfaces:**
- Consumes: `Workspace` from Task 2
- Produces: `resolveWorkspaceId(opts: { explicitKey?: string; stored: number | null; defaultKey: string; all: Workspace[] }): { id: number; source: 'explicit' | 'stored' | 'default' | 'only' }` — throws a listing error when it cannot decide

Splitting this into its own file keeps a fiddly precedence rule testable without a client.

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/current.test.ts`.

```ts
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
    expect(resolveWorkspaceId({ explicitKey: 'ops', stored: null, defaultKey: '', all: ALL }).id).toBe(2);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test plugins/workspace/current.test.ts`
Expected: FAIL — `Cannot find module './current.js'`.

- [ ] **Step 3: Implement `plugins/workspace/current.ts`**

```ts
/**
 * Which workspace a skill operates on.
 *
 * Precedence: what you just said > what you were last using > what you
 * configured > the only one there is. Ambiguity is an error that lists the
 * options, never a silent guess — picking the wrong workspace writes a work
 * item somewhere nobody will look for it.
 */

import type { Workspace } from './types.js';

export interface ResolveOptions {
  explicitKey?: string;
  stored: number | null;
  defaultKey: string;
  all: Workspace[];
}

export interface Resolved {
  id: number;
  source: 'explicit' | 'stored' | 'default' | 'only';
}

function byKey(all: Workspace[], key: string): Workspace | undefined {
  const needle = key.trim().toLowerCase();
  return all.find((w) => w.key.toLowerCase() === needle);
}

export function resolveWorkspaceId(opts: ResolveOptions): Resolved {
  const { explicitKey, stored, defaultKey, all } = opts;

  if (all.length === 0) {
    throw new Error('Workspace: you are not a member of any workspace.');
  }

  if (explicitKey !== undefined && explicitKey.trim() !== '') {
    const hit = byKey(all, explicitKey);
    if (hit === undefined) {
      throw new Error(
        `Workspace: no workspace with key "${explicitKey}". You are in: ${all
          .map((w) => w.key)
          .join(', ')}.`
      );
    }
    return { id: hit.id, source: 'explicit' };
  }

  if (stored !== null && all.some((w) => w.id === stored)) {
    return { id: stored, source: 'stored' };
  }

  if (defaultKey.trim() !== '') {
    const hit = byKey(all, defaultKey);
    if (hit !== undefined) return { id: hit.id, source: 'default' };
  }

  if (all.length === 1) return { id: all[0]!.id, source: 'only' };

  throw new Error(
    `Workspace: which workspace? You are in: ${all.map((w) => w.key).join(', ')}. ` +
      `Say "use <KEY>" or set defaultWorkspaceKey in config.`
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test plugins/workspace/current.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the `workspace.use` skill to `manifest.json`**

Insert into the `skills` array, after `workspace.list-workspaces`:

```json
{
  "id": "workspace.use",
  "description": "Switch the workspace that other workspace skills operate on. Takes the short workspace key, for example PLAT.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "key": { "type": "string", "description": "The short workspace key, e.g. PLAT" }
    },
    "required": ["key"]
  },
  "ui": {
    "block": "form",
    "label": "Switch workspace",
    "icon": "folder",
    "submitLabel": "Use",
    "fields": [{ "name": "key", "type": "text", "label": "Workspace key", "required": true }]
  }
}
```

- [ ] **Step 6: Add the case and a shared resolver to `index.ts`**

Add these imports and helper alongside the existing ones:

```ts
import { resolveWorkspaceId } from './current.js';
```

```ts
/** Resolve the workspace for this call and remember it. */
async function currentWorkspaceId(io: IoClient, explicitKey?: string): Promise<number> {
  const all = await io.listWorkspaces();
  const stored = await api.storage.get<number>('currentWorkspaceId');
  const defaultKey = (await api.config.get<string>('defaultWorkspaceKey')) ?? '';
  const { id } = resolveWorkspaceId({ explicitKey, stored, defaultKey, all });
  await api.storage.set('currentWorkspaceId', id);
  return id;
}
```

Add the case to the `switch` in `executeTool`:

```ts
case 'workspace.use': {
  const io = assertConfigured();
  const key = typeof _args['key'] === 'string' ? _args['key'] : '';
  const all = await io.listWorkspaces();
  const { id } = resolveWorkspaceId({ explicitKey: key, stored: null, defaultKey: '', all });
  await api.storage.set('currentWorkspaceId', id);
  const chosen = all.find((w) => w.id === id)!;
  return { message: `Now using ${chosen.key} — ${chosen.name}.`, id, key: chosen.key };
}
```

Rename the `_args` parameter to `args` in the `executeTool` signature now that it is used,
and update the `workspace.list-workspaces` case accordingly.

- [ ] **Step 7: Run the whole plugin suite and the conformance test**

Run: `bun test plugins/workspace/ packages/core/src/plugins/manifest-conformance.test.ts`
Expected: PASS, 40 tests.

- [ ] **Step 8: Commit**

```bash
git add plugins/workspace
git commit -m "feat(workspace): current-workspace resolution with explicit precedence"
```

---

## Task 7: The remaining read skills

**Files:**
- Modify: `plugins/workspace/manifest.json`
- Modify: `plugins/workspace/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6
- Produces: `workspace.board`, `workspace.backlog`, `workspace.my-items`, `workspace.search-items`, `workspace.get-item`, `workspace.sprints`, `workspace.members`

`workspace.members` is `aiInvocable: false` — it exists to feed a picker, the agent
resolves people through other skills, and every AI-visible skill costs prompt tokens.
(Spec §9)

- [ ] **Step 1: Add the seven skills to `manifest.json`**

Append to the `skills` array:

```json
{
  "id": "workspace.board",
  "description": "Show the Kanban board for the current workspace: every work item grouped into BACKLOG, TODO, IN_PROGRESS, IN_REVIEW and DONE.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "workspaceKey": { "type": "string", "description": "Optional workspace key; defaults to the current one." }
    }
  },
  "ui": {
    "block": "list",
    "label": "Board",
    "icon": "columns",
    "resultPath": "items",
    "emptyText": "The board is empty.",
    "item": { "id": "id", "title": "title", "subtitle": "subtitle" }
  }
},
{
  "id": "workspace.backlog",
  "description": "Show the product backlog for the current workspace, in backlog order.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "workspaceKey": { "type": "string", "description": "Optional workspace key; defaults to the current one." }
    }
  },
  "ui": {
    "block": "list",
    "label": "Backlog",
    "icon": "list",
    "resultPath": "items",
    "emptyText": "The backlog is empty.",
    "item": { "id": "id", "title": "title", "subtitle": "subtitle" }
  }
},
{
  "id": "workspace.my-items",
  "description": "List work items assigned to me across every workspace, soonest due first.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "status": { "type": "string", "description": "Optional status filter: BACKLOG, TODO, IN_PROGRESS, IN_REVIEW or DONE." }
    }
  },
  "ui": {
    "block": "list",
    "label": "My items",
    "icon": "check-square",
    "resultPath": "items",
    "emptyText": "Nothing is assigned to you.",
    "item": { "id": "id", "title": "title", "subtitle": "subtitle" }
  }
},
{
  "id": "workspace.search-items",
  "description": "Search work items in the current workspace by title.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "q": { "type": "string", "description": "Text to match against work item titles." },
      "workspaceKey": { "type": "string", "description": "Optional workspace key; defaults to the current one." }
    },
    "required": ["q"]
  },
  "ui": {
    "block": "list",
    "label": "Search items",
    "icon": "search",
    "resultPath": "items",
    "emptyText": "No matching work items.",
    "item": { "id": "id", "title": "title", "subtitle": "subtitle" }
  }
},
{
  "id": "workspace.get-item",
  "description": "Show one work item in full, by its numeric id.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "itemId": { "type": "number", "description": "The work item's numeric id." }
    },
    "required": ["itemId"]
  },
  "ui": {
    "block": "detail",
    "label": "Work item",
    "icon": "file",
    "item": { "title": "title", "body": "body", "meta": ["status", "priority", "due"] }
  }
},
{
  "id": "workspace.sprints",
  "description": "List the sprints in the current workspace.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "workspaceKey": { "type": "string", "description": "Optional workspace key; defaults to the current one." }
    }
  },
  "ui": {
    "block": "list",
    "label": "Sprints",
    "icon": "calendar",
    "resultPath": "sprints",
    "emptyText": "No sprints.",
    "item": { "id": "id", "title": "name", "subtitle": "status" }
  }
},
{
  "id": "workspace.members",
  "description": "List the members of the current workspace. Used to populate assignee pickers.",
  "aiInvocable": false,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "workspaceKey": { "type": "string", "description": "Optional workspace key; defaults to the current one." }
    }
  },
  "ui": {
    "block": "list",
    "label": "Members",
    "icon": "users",
    "resultPath": "members",
    "emptyText": "No members.",
    "item": { "id": "account_id", "title": "displayName", "subtitle": "role" }
  }
}
```

- [ ] **Step 2: Add the cases to `index.ts`**

Add these imports:

```ts
import { displayName, formatBoard, formatWorkItem } from './format.js';
import { WORK_ITEM_STATUSES } from './types.js';
import type { Assignee, WorkItem } from './types.js';
```

Add a shared row-shaper above `executeTool`:

```ts
/** One work item, flattened to the keys the list descriptors bind to. */
function toRow(item: WorkItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    subtitle: formatWorkItem(item).split('\n')[1]?.trim() ?? item.status,
    status: item.status,
    priority: item.priority,
    type: item.type,
  };
}

function optionalKey(args: Record<string, unknown>): string | undefined {
  const k = args['workspaceKey'];
  return typeof k === 'string' && k.trim() !== '' ? k : undefined;
}
```

Add the cases to the `switch`:

```ts
case 'workspace.board': {
  const io = assertConfigured();
  const id = await currentWorkspaceId(io, optionalKey(args));
  const board = await io.getBoard(id);
  const items = WORK_ITEM_STATUSES.flatMap((s) => (board[s] ?? []).map(toRow));
  return { items, text: formatBoard(board) };
}

case 'workspace.backlog': {
  const io = assertConfigured();
  const id = await currentWorkspaceId(io, optionalKey(args));
  const backlog = await io.getBacklog(id);
  return { items: backlog.map(toRow), text: backlog.map(formatWorkItem).join('\n') };
}

case 'workspace.my-items': {
  const io = assertConfigured();
  const status = typeof args['status'] === 'string' ? args['status'] : undefined;
  const items = await io.getMyItems(status);
  return { items: items.map(toRow), text: items.map(formatWorkItem).join('\n') };
}

case 'workspace.search-items': {
  const io = assertConfigured();
  const id = await currentWorkspaceId(io, optionalKey(args));
  const q = typeof args['q'] === 'string' ? args['q'] : '';
  const items = await io.searchItems(id, q);
  return { items: items.map(toRow), text: items.map(formatWorkItem).join('\n') };
}

case 'workspace.get-item': {
  const io = assertConfigured();
  const itemId = Number(args['itemId']);
  if (!Number.isInteger(itemId)) throw new Error('Workspace: itemId must be a whole number.');
  const item = await io.getItem(itemId);
  return {
    title: `#${item.id} ${item.title}`,
    body: item.description ?? '(no description)',
    status: item.status,
    priority: item.priority,
    due: item.due_date === null ? 'no due date' : item.due_date.slice(0, 10),
    text: formatWorkItem(item),
  };
}

case 'workspace.sprints': {
  const io = assertConfigured();
  const id = await currentWorkspaceId(io, optionalKey(args));
  return { sprints: await io.getSprints(id) };
}

case 'workspace.members': {
  const io = assertConfigured();
  const id = await currentWorkspaceId(io, optionalKey(args));
  const raw = (await io.getMembers(id)) as Array<{ account_id: number; role: string; account: Assignee & { id: number } }>;
  return {
    members: raw.map((m) => ({
      account_id: m.account_id,
      role: m.role,
      displayName: displayName({
        first_name: m.account.first_name,
        last_name: m.account.last_name,
        email: m.account.email,
      }),
    })),
  };
}
```

- [ ] **Step 3: Run the conformance test — this is the real check on nine hand-written descriptors**

Run: `bun test packages/core/src/plugins/manifest-conformance.test.ts`
Expected: PASS. If a descriptor is malformed this is where it surfaces. Common causes: a
`list` block missing `item`, or a trailing comma in the JSON.

- [ ] **Step 4: Typecheck and run everything**

Run: `bun run typecheck && bun test plugins/workspace/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/workspace
git commit -m "feat(workspace): board, backlog, my-items, search, detail, sprints, members"
```

---

## Task 8: Prove it against a real server

Everything so far ran against stubs. This task is the one that finds out whether the wire
types are actually right. (Spec §15, Phase 0)

**Files:**
- Create: `docs/workspace-plugin-setup.md`

- [ ] **Step 1: Start a local internal-operation-server**

From `C:\projects\internal-operation-server`, follow the repo's own dev instructions.
Confirm it responds:

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/workspaces`
Expected: `401` — unauthenticated, which proves the route exists and the guard is on.

- [ ] **Step 2: Seed a throwaway workspace**

Through the website UI against your local server, create a workspace with key `TARDIS`,
one EPIC, one STORY under it, and one SUB_TASK under that. Do not use a real workspace;
D6 exists for a reason.

- [ ] **Step 3: Configure the plugin**

Set the plugin config: `baseUrl=http://localhost:3000`, your local `email` and `password`,
`defaultWorkspaceKey=TARDIS`.

Then restrict the data directory, because it now holds a password:

```bash
chmod 600 <tardis-data-dir>/tardis.db
```

- [ ] **Step 4: Invoke the skills with no LLM in the path**

```bash
curl -s -X POST localhost:3000/api/skills/workspace.list-workspaces/invoke \
  -H 'Content-Type: application/json' -d '{"args":{}}'
```

Expected: `{"success":true,"data":{"workspaces":[{"key":"TARDIS",...}]}}`

Repeat for `workspace.board` and `workspace.my-items`. Use the TARDIS server's own port —
this is `POST /api/skills/:id/invoke` on TARDIS, not on the IO server.

- [ ] **Step 5: Verify each of the four constraints that stubs could not**

Confirm and note the result of each:

1. `my_settings` arrives as `my_settings`, not `mySettings`. Log one raw workspace payload
   and read it. If this is wrong, `permissions.ts` returns `DENY_ALL` and everything looks
   broken in a confusing way — Task 2's fail-closed choice makes this loud rather than
   silent, which is the point.
2. `assignees` entries carry `account_id`, `first_name`, `last_name`, `email`.
3. The envelope is `{ data, status, message }` and `request()` unwraps correctly.
4. The board response has all five status keys even when columns are empty.

- [ ] **Step 6: Verify the 401 path against the real server**

Corrupt the stored token and confirm the next call recovers on its own:

Run a skill invoke, then set `accessToken` to `"bogus"` in plugin storage, then invoke
again.
Expected: the second invoke succeeds. The logs show `token rejected, logging in again`.

This is the only place the re-login path gets exercised end to end, and per §18.2 it will
otherwise only run once a day in production.

- [ ] **Step 7: Ask the agent, in words**

From the TUI or Telegram: *"what's on my board?"*
Expected: the agent selects the `workspace` plugin and calls `workspace.board`.

If it does not, the manifest `summary` is the lever — `PluginRouter` selects on that
string alone, not on the skill descriptions.

- [ ] **Step 8: Write `docs/workspace-plugin-setup.md`**

Record what you actually did: config keys and example values, the `chmod`, the curl
commands, the four verified constraints from Step 5 with their real observed values, and
anything that differed from this plan. Someone setting this up on a second machine reads
this file, not the plan.

- [ ] **Step 9: Commit**

```bash
git add docs/workspace-plugin-setup.md
git commit -m "docs(workspace): local setup and verification against a real IO server"
```

---

## Definition of done

- [ ] `bun test plugins/workspace/` passes — 40 tests across four files (permissions 8, format 10, io-client 13, current 9)
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` adds no new errors beyond the 2 pre-existing in `packages/server`
- [ ] `bun test packages/core/src/plugins/manifest-conformance.test.ts` passes with a `workspace` block
- [ ] All nine skills return real data from a local IO server via `POST /api/skills/:id/invoke`
- [ ] "what's on my board?" works in the TUI
- [ ] The four wire-format constraints in Task 8 Step 5 are confirmed and written down
- [ ] The data directory holding the password is `chmod 600`

## What Plan 2 picks up

`draft.ts`, `ranking.ts`, the write skills and the ownership guards — building directly on
`IoClient`, `resolvePermissions` and `formatWorkItem` from this plan. Plan 3 adds the
`remote-select` field type across both repos and the web board.
