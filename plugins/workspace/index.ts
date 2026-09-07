import type { PluginAPI } from '@tardis/core';
import { IoClient } from './io-client.js';
import { isMine, resolvePermissions } from './permissions.js';
import { displayName, formatBoard, formatWorkItem, formatWorkspaceSummary } from './format.js';
import { WORK_ITEM_STATUSES } from './types.js';
import type {
  Assignee,
  WorkItem,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
} from './types.js';
import { resolveWorkspaceId } from './current.js';
import {
  blockingSlots,
  createDraft,
  optionalSlots,
  setSlots,
  toCreatePayload,
  validateForCommit,
} from './draft.js';
import type { Draft, SlotPatch } from './draft.js';
import { describeDraft, nextQuestion } from './questions.js';
import { rankCandidates } from './ranking.js';
import type { Candidate } from './ranking.js';
import {
  BRANCH_KEY_PREFIX,
  branchKey,
  branchUrl,
  newRecord,
  partitionRecords,
} from './branch.js';
import type { BranchRecord } from './branch.js';
import { createFromBranch } from './branch-create.js';
import type { BranchLinkConfig } from './branch-create.js';
import { compose } from './compose.js';
import type { Commit } from './compose.js';

let api: PluginAPI;
let client: IoClient | null = null;

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

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  const baseUrl = (await api.config.get<string>('baseUrl')) ?? '';
  const email = (await api.config.get<string>('email')) ?? '';
  const password = (await api.config.get<string>('password')) ?? '';
  // Required: APIKeyGuard is a global APP_GUARD on the IO server, so every
  // route 403s without it — including /account/login.
  const apiKey = (await api.config.get<string>('apiKey')) ?? '';

  if (baseUrl === '' || email === '' || password === '' || apiKey === '') {
    api.logger.warn(
      'Workspace plugin activated without credentials — set baseUrl, email, password, apiKey'
    );
    return;
  }

  client = new IoClient({
    baseUrl,
    email,
    password,
    apiKey,
    storage: api.storage,
    logger: api.logger,
    fetchImpl: httpAdapter,
  });

  api.logger.info('Workspace plugin activated');
};

export const onDeactivate = async (): Promise<void> => {
  client = null;
  api.logger.info('Workspace plugin deactivated');
};

// ─── Helpers ───

function assertConfigured(): IoClient {
  if (client === null) {
    throw new Error(
      'Workspace plugin is not configured. Set baseUrl, email, password and apiKey in its config.'
    );
  }
  return client;
}

/** Resolve the workspace for this call and remember it. */
async function currentWorkspaceId(io: IoClient, explicitKey?: string): Promise<number> {
  const all = await io.listWorkspaces();
  const stored = await api.storage.get<number>('currentWorkspaceId');
  const defaultKey = (await api.config.get<string>('defaultWorkspaceKey')) ?? '';
  const { id } = resolveWorkspaceId(
    explicitKey === undefined
      ? { stored, defaultKey, all }
      : { explicitKey, stored, defaultKey, all }
  );
  await api.storage.set('currentWorkspaceId', id);
  return id;
}

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

function requireItemId(args: Record<string, unknown>): number {
  const id = Number(args['itemId']);
  if (!Number.isInteger(id)) throw new Error('Workspace: itemId must be a whole number.');
  return id;
}

// ─── Branch linking ───

function requireBranchArgs(args: Record<string, unknown>): {
  repoFullName: string;
  branch: string;
} {
  const repoFullName = typeof args['repoFullName'] === 'string' ? args['repoFullName'].trim() : '';
  const branch = typeof args['branch'] === 'string' ? args['branch'].trim() : '';
  if (repoFullName === '' || branch === '') {
    throw new Error('Workspace: branch linking needs both repoFullName and branch.');
  }
  return { repoFullName, branch };
}

/**
 * A hook installed in a repo can call these the moment it lands, so the switch
 * is here rather than in the installer: turning the plugin setting off must
 * stop items being created, even with hooks still in place.
 */
async function requireBranchLinkEnabled(): Promise<void> {
  const on = (await api.config.get<boolean>('branchLinkEnabled')) ?? false;
  if (on !== true) {
    throw new Error(
      'Workspace: branch linking is off. Turn on "Link git branches to work items" in the ' +
        'workspace plugin settings to let pushed branches create work items.'
    );
  }
}

async function branchLinkConfig(): Promise<Omit<BranchLinkConfig, 'workspaceId'>> {
  const epic = Number((await api.config.get<number>('branchLinkDefaultEpicId')) ?? 0);
  const offset = Number((await api.config.get<number>('branchLinkDueDateOffsetDays')) ?? 7);
  const ttl = Number((await api.config.get<number>('branchLinkDraftTtlDays')) ?? 14);
  const priority = (await api.config.get<string>('branchLinkDefaultPriority')) ?? 'MEDIUM';

  return {
    // 0 is the manifest's default and means "unset" — passing it through would
    // parent every unmatched branch to whatever item happens to have id 0.
    defaultEpicId: Number.isInteger(epic) && epic > 0 ? epic : null,
    dueDateOffsetDays: Number.isFinite(offset) ? offset : 7,
    draftTtlDays: Number.isFinite(ttl) ? ttl : 14,
    defaultPriority: (['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).includes(
      priority as WorkItemPriority
    )
      ? (priority as WorkItemPriority)
      : 'MEDIUM',
  };
}

/** Commits arrive over HTTP from a git hook, so nothing about them is trusted. */
function parseCommits(raw: unknown): Commit[] {
  if (!Array.isArray(raw)) return [];
  const out: Commit[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const subject = typeof record['subject'] === 'string' ? record['subject'].trim() : '';
    if (subject === '') continue;
    out.push({
      subject,
      body: typeof record['body'] === 'string' ? record['body'] : '',
      sha: typeof record['sha'] === 'string' ? record['sha'] : '',
    });
  }
  return out;
}

function describeBranchRecord(r: BranchRecord): string {
  switch (r.state) {
    case 'drafting':
      return 'waiting for a push';
    case 'created':
      return `created #${String(r.itemId)}`;
    case 'adopted':
      return `linked to #${String(r.itemId)}`;
    case 'failed':
      return `failed — ${r.error ?? 'no reason recorded'}`;
  }
}

/**
 * The direct/approval split cannot be configuration: actionType is static and
 * resolvePermission grades by tool name, so "ask only when the item is someone
 * else's" has to be a skill boundary. These refuse and name the workflow twin.
 */
function assertMine(item: WorkItem, myAccountId: number, itemId: number): void {
  if (isMine(item, myAccountId)) return;
  throw new Error(
    `Workspace: #${itemId} is not yours — you neither reported it nor are assigned to it. ` +
      `Use workspace.edit-any-item if you mean to change someone else's work.`
  );
}

function buildPatchFromArgs(args: Record<string, unknown>): SlotPatch {
  const patch: SlotPatch = {};
  if (typeof args['type'] === 'string') patch.type = args['type'] as WorkItemType;
  if (typeof args['title'] === 'string') patch.title = args['title'];
  if (typeof args['description'] === 'string') patch.description = args['description'];
  if (typeof args['priority'] === 'string') patch.priority = args['priority'] as WorkItemPriority;
  if (typeof args['status'] === 'string') patch.status = args['status'] as WorkItemStatus;
  if (typeof args['due_date'] === 'string') patch.due_date = args['due_date'];
  if (typeof args['parent_id'] === 'number') patch.parent_id = args['parent_id'];
  if (typeof args['story_points'] === 'number') patch.story_points = args['story_points'];
  if (typeof args['estimate_hours'] === 'number') patch.estimate_hours = args['estimate_hours'];
  if (Array.isArray(args['assignee_account_ids'])) {
    patch.assignee_account_ids = (args['assignee_account_ids'] as unknown[]).filter(
      (v): v is number => typeof v === 'number'
    );
  }
  return patch;
}

const DRAFT_KEY = 'draft:active';

async function loadDraft(): Promise<Draft> {
  const d = await api.storage.get<Draft>(DRAFT_KEY);
  if (d === null || d.status !== 'OPEN') {
    throw new Error('Workspace: no draft in progress. Start one by describing the work.');
  }
  return d;
}

/** Parent candidates for the draft's current type, or [] when none apply. */
async function parentCandidates(io: IoClient, draft: Draft): Promise<Candidate[]> {
  const type = draft.slots.type.value;
  if (type === null || type === 'EPIC') return [];
  const parentType = type === 'STORY' ? 'EPIC' : 'STORY';

  const all = await io.searchItemsByType(draft.workspaceId, parentType);
  return rankCandidates(
    { generate: (prompt) => api.llm.generate(prompt), logger: api.logger },
    draft.sourceText,
    all
  );
}

/** The one shape every draft skill returns, so every surface renders it alike. */
async function draftEnvelope(io: IoClient, draft: Draft): Promise<Record<string, unknown>> {
  const blocking = blockingSlots(draft);
  const candidates = blocking[0] === 'parent_id' ? await parentCandidates(io, draft) : [];
  const ready = blocking.length === 0;
  return {
    // Stated first and in plain words, because the model will otherwise say the
    // work item exists. Live, after draft-set it answered "The sub-task … has
    // been created in the 'R&D Team' workspace" and listed its fields — and the
    // user went looking for a task that was never created. Nothing here writes
    // to the tracker; only workspace.draft-commit does.
    created: false,
    itemExists: false,
    note: ready
      ? 'This is still only a draft. Nothing has been created yet — call workspace.draft-commit to create the real work item.'
      : 'This is still only a draft. Nothing has been created yet, and it is not ready to create.',
    draft,
    title: draft.slots.title.value ?? '(untitled draft)',
    summary: describeDraft(draft),
    blocking,
    optional: optionalSlots(draft),
    stillNeeded: blocking.length > 0 ? blocking.join(', ') : 'nothing — ready to create',
    candidates,
    nextQuestion: nextQuestion(draft, candidates),
  };
}

// ─── Tool execution ───

/**
 * The shape every list skill returns.
 *
 * `count` exists because the model was asked "what am I assigned to?", got a
 * 135-line text blob, and answered "45". It had no number to read, so it
 * estimated one — and stated the estimate as fact. The count leads the text as
 * well as sitting in the payload, so it survives even if context fitting trims
 * the tail of a long list.
 */
/**
 * How many items of a list actually go to the model.
 *
 * `workspace.backlog` returns 633 items — 38k tokens — and within a turn that
 * result is re-sent on every subsequent model call. Measured over a real day:
 * 19,282 tokens per turn on average, with single turns reaching 84k, almost all
 * of it list payloads being carried along.
 *
 * `count` and `byStatus` are computed over the *whole* set, so totals stay
 * exact; only the detail is sampled. Anyone who needs a specific item searches
 * for it, which is what workspace.search-items is for.
 */
const DEFAULT_LIST_LIMIT = 25;

/**
 * Which work a person means when they ask what they have.
 *
 * The sample used to be the first 25 in whatever order the API returned, which
 * for 147 items was mostly DONE. The model then made two further calls to dig
 * out IN_PROGRESS and TODO — one question, three round trips, 37 seconds.
 * Showing the active work first answers it in one.
 */
const STATUS_RANK: Record<string, number> = {
  IN_PROGRESS: 0,
  TODO: 1,
  IN_REVIEW: 2,
  BACKLOG: 3,
  DONE: 4,
};

function listResult<T extends { status?: string }>(
  rows: T[],
  lines: string[],
  limit = DEFAULT_LIST_LIMIT,
  activeFirst = false
): {
  count: number;
  showing: number;
  truncated: boolean;
  byStatus: Record<string, number>;
  items: T[];
  text: string;
} {
  const noun = rows.length === 1 ? 'item' : 'items';

  // Counted here rather than left to the model. Asked "what tasks do i have"
  // over 135 items it produced a breakdown of its own — In Review 11, Done 55,
  // To Do 1, Backlog 58 — which sums to 125, not 135, and put To Do at 1 when
  // the real answer was 5. Same lesson as `count`: give it the number.
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    const status = r.status ?? 'UNKNOWN';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  const breakdown = Object.entries(byStatus)
    .map(([status, n]) => `${status} ${n}`)
    .join(', ');

  // Paired so a line never drifts from its row.
  const paired = rows.map((row, i) => ({ row, line: lines[i] ?? '' }));
  if (activeFirst) {
    paired.sort(
      (a, b) =>
        (STATUS_RANK[a.row.status ?? ''] ?? 9) - (STATUS_RANK[b.row.status ?? ''] ?? 9)
    );
  }
  const shownPairs = paired.slice(0, limit);
  const shown = shownPairs.map((p) => p.row);
  const truncated = rows.length > shown.length;
  const header = `${rows.length} ${noun}${breakdown ? ` (${breakdown})` : ''}${
    truncated ? `, showing ${shown.length}${activeFirst ? ' (most active first)' : ''}` : ''
  }:`;
  const footer = truncated
    ? [`… and ${rows.length - shown.length} more. Counts above cover all of them; search for a specific item by name.`]
    : [];

  return {
    count: rows.length,
    showing: shown.length,
    truncated,
    byStatus,
    items: shown,
    text: [header, ...shownPairs.map((p) => p.line), ...footer].join('\n'),
  };
}

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
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

    case 'workspace.use': {
      const io = assertConfigured();
      const key = typeof args['key'] === 'string' ? args['key'] : '';
      const all = await io.listWorkspaces();
      const { id } = resolveWorkspaceId({ explicitKey: key, stored: null, defaultKey: '', all });
      await api.storage.set('currentWorkspaceId', id);
      const chosen = all.find((w) => w.id === id);
      return {
        message: `Now using ${chosen?.key ?? id} — ${chosen?.name ?? ''}.`.trim(),
        id,
        key: chosen?.key ?? '',
      };
    }

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
      return listResult(backlog.map(toRow), backlog.map(formatWorkItem));
    }

    case 'workspace.my-items': {
      const io = assertConfigured();
      const status = typeof args['status'] === 'string' ? args['status'] : undefined;
      const items = await io.getMyItems(status);
      return listResult(items.map(toRow), items.map(formatWorkItem), DEFAULT_LIST_LIMIT, true);
    }

    case 'workspace.search-items': {
      const io = assertConfigured();
      const id = await currentWorkspaceId(io, optionalKey(args));
      const q = typeof args['q'] === 'string' ? args['q'] : '';
      const items = await io.searchItems(id, q);
      return listResult(items.map(toRow), items.map(formatWorkItem));
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
      const raw = (await io.getMembers(id)) as Array<{
        account_id: number;
        role: string;
        account: Assignee & { id: number };
      }>;
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

    // ─── Draft ───

    case 'workspace.draft-start': {
      const io = assertConfigured();
      const workspaceId = await currentWorkspaceId(io, optionalKey(args));
      const text = typeof args['text'] === 'string' ? args['text'] : '';
      if (text.trim() === '') throw new Error('Workspace: describe the work you want captured.');

      const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
      const now = new Date().toISOString();
      const draft = createDraft({ id: `d_${now}`, workspaceId, sourceText: text, myAccountId, now });
      await api.storage.set(DRAFT_KEY, draft);
      return draftEnvelope(io, draft);
    }

    case 'workspace.draft-set': {
      const io = assertConfigured();
      const draft = await loadDraft();
      const updated = setSlots(draft, buildPatchFromArgs(args), 'user', new Date().toISOString());
      await api.storage.set(DRAFT_KEY, updated);
      return draftEnvelope(io, updated);
    }

    case 'workspace.draft-show': {
      const io = assertConfigured();
      return draftEnvelope(io, await loadDraft());
    }

    case 'workspace.draft-commit': {
      const io = assertConfigured();
      const draft = await loadDraft();
      const errors = validateForCommit(draft);
      if (errors.length > 0) {
        return {
          // A draft that will not validate created nothing, and the claim
          // guard must not be able to read this as a success.
          success: false,
          created: false,
          errors,
          summary: describeDraft(draft),
          nextQuestion: nextQuestion(draft),
        };
      }

      const item = await io.createItem(draft.workspaceId, toCreatePayload(draft));
      await api.storage.set(DRAFT_KEY, { ...draft, status: 'COMMITTED' });

      const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
      const others = (draft.slots.assignee_account_ids.value ?? []).filter(
        (id) => id !== myAccountId
      );

      return {
        success: true,
        created: true,
        id: item.id,
        text: formatWorkItem(item),
        // Commit is `direct`, so it must not be the thing that lands work in
        // someone else's queue. workspace.assign is `workflow` and asks first.
        followUp:
          others.length > 0
            ? `The draft named other assignees (${others.join(', ')}). Call workspace.assign to put it on them.`
            : null,
      };
    }

    case 'workspace.draft-cancel': {
      const draft = await api.storage.get<Draft>(DRAFT_KEY);
      await api.storage.delete(DRAFT_KEY);
      return { cancelled: draft !== null, message: 'Draft discarded.' };
    }

    case 'workspace.list-parent-candidates': {
      const io = assertConfigured();
      // Prefer the live draft's wording; fall back to the type the form passed.
      const draft = await api.storage.get<Draft>(DRAFT_KEY);
      const childType =
        typeof args['type'] === 'string' ? args['type'] : (draft?.slots.type.value ?? null);
      if (childType === null || childType === 'EPIC') return { candidates: [] };

      const workspaceId = draft?.workspaceId ?? (await currentWorkspaceId(io));
      const parentType = childType === 'STORY' ? 'EPIC' : 'STORY';
      const all = await io.searchItemsByType(workspaceId, parentType);

      const candidates = await rankCandidates(
        { generate: (prompt) => api.llm.generate(prompt), logger: api.logger },
        draft?.sourceText ?? '',
        all
      );
      return { candidates };
    }

    // ─── Direct writes ───

    case 'workspace.create-item': {
      const io = assertConfigured();
      const workspaceId = await currentWorkspaceId(io, optionalKey(args));
      const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
      const now = new Date().toISOString();

      // Routed through the Draft so create-item and the conversational path
      // share one set of rules. Two copies of the hierarchy and description
      // gates would drift.
      let draft = createDraft({
        id: `d_${now}`,
        workspaceId,
        sourceText: String(args['title'] ?? ''),
        myAccountId,
        now,
      });
      draft = setSlots(draft, buildPatchFromArgs(args), 'user', now);

      const errors = validateForCommit(draft);
      if (errors.length > 0) throw new Error(`Workspace: ${errors.join(' ')}`);

      const item = await io.createItem(workspaceId, toCreatePayload(draft));
      return { success: true, id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.edit-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
      assertMine(await io.getItem(itemId), myAccountId, itemId);

      const patch: Record<string, unknown> = {};
      for (const k of ['title', 'description', 'priority', 'due_date'] as const) {
        if (typeof args[k] === 'string' && args[k] !== '') patch[k] = args[k];
      }
      for (const k of ['story_points', 'estimate_hours'] as const) {
        if (typeof args[k] === 'number') patch[k] = args[k];
      }
      if (Object.keys(patch).length === 0) throw new Error('Workspace: nothing to change.');

      const item = await io.updateItem(itemId, patch);
      return { success: true, id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.move-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      const status = String(args['status'] ?? '').toUpperCase() as WorkItemStatus;
      const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;

      const existing = await io.getItem(itemId);
      assertMine(existing, myAccountId, itemId);

      const ws = (await io.listWorkspaces()).find((w) => w.id === existing.workspace_id);
      if (ws !== undefined) {
        const perms = resolvePermissions(ws, myAccountId);
        if (!perms.canTransition(existing.status, status)) {
          const legal = perms.allowedTargets(existing.status);
          throw new Error(
            `Workspace: you cannot move #${itemId} from ${existing.status} to ${status}. ` +
              (legal.length > 0
                ? `You can move it to: ${legal.join(', ')}.`
                : 'You have no transitions from this column.')
          );
        }
      }

      const item = await io.moveItem(itemId, { status });
      return { success: true, id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.comment': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      const body = String(args['body'] ?? '').trim();
      if (body === '') throw new Error('Workspace: the comment is empty.');
      await io.addComment(itemId, body);
      return { success: true, message: `Commented on #${itemId}.` };
    }

    // ─── Approval-gated ───

    case 'workspace.edit-any-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      const patch: Record<string, unknown> = {};
      for (const k of ['title', 'description', 'priority', 'status', 'due_date'] as const) {
        if (typeof args[k] === 'string' && args[k] !== '') patch[k] = args[k];
      }
      if (Object.keys(patch).length === 0) throw new Error('Workspace: nothing to change.');
      const item = await io.updateItem(itemId, patch);
      return { success: true, id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.assign': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      const ids = Array.isArray(args['accountIds'])
        ? (args['accountIds'] as unknown[]).filter((v): v is number => typeof v === 'number')
        : [];
      if (ids.length === 0) throw new Error('Workspace: name at least one account id to assign.');
      // The server rejects admin accounts as assignees with a clear 400; let it,
      // rather than duplicating a rule here that would drift.
      const item = await io.assign(itemId, ids);
      return { success: true, id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.archive-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      await io.archiveItem(itemId);
      return { success: true, message: `Archived #${itemId}.` };
    }

    case 'workspace.delete-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      await io.deleteItem(itemId);
      return { success: true, message: `Deleted #${itemId}.` };
    }

    // ─── Branch-linked work items ───
    //
    // These four are reached over HTTP by git hooks as well as by the model,
    // so none of them is `actionType: 'workflow'` — POST /api/skills/:id/invoke
    // answers 409 for a workflow skill, which would make an installed hook
    // permanently inert. See the design spec, D7.

    case 'workspace.branch-draft': {
      await requireBranchLinkEnabled();
      const { repoFullName, branch } = requireBranchArgs(args);
      const key = branchKey(repoFullName, branch);
      const existing = await api.storage.get<BranchRecord>(key);
      if (existing !== null) {
        return { recorded: true, state: existing.state, note: 'Already known.' };
      }
      const base = typeof args['baseBranch'] === 'string' ? args['baseBranch'] : null;
      await api.storage.set(key, newRecord(repoFullName, branch, base, new Date().toISOString()));
      return {
        recorded: true,
        state: 'drafting',
        note: 'Nothing has been created. Pushing this branch is what makes the work item.',
      };
    }

    case 'workspace.branch-create': {
      await requireBranchLinkEnabled();
      const io = assertConfigured();
      const { repoFullName, branch } = requireBranchArgs(args);
      const workspaceId = await currentWorkspaceId(io);

      const result = await createFromBranch(
        {
          storage: {
            get: <T,>(k: string) => api.storage.get<T>(k),
            set: (k, v) => api.storage.set(k, v),
          },
          client: {
            createItem: (wid, payload) => io.createItem(wid, payload),
            registerGitLink: (itemId, url) => io.registerGitLink(itemId, url),
          },
          listStories: () => io.searchItemsByType(workspaceId, 'STORY'),
          compose: (b, commits) =>
            compose({ generate: (p) => api.llm.generate(p), logger: api.logger }, b, commits),
          rank: (query, items) =>
            rankCandidates(
              { generate: (p) => api.llm.generate(p), logger: api.logger },
              query,
              items
            ),
          notify: (message) => void api.notifications.send(message),
          logger: api.logger,
          now: new Date().toISOString(),
          config: { ...(await branchLinkConfig()), workspaceId },
        },
        {
          repoFullName,
          branch,
          commits: parseCommits(args['commits']),
          baseBranch: typeof args['baseBranch'] === 'string' ? args['baseBranch'] : null,
        }
      );
      return { ...result };
    }

    case 'workspace.branch-status': {
      const cfg = await branchLinkConfig();
      const now = new Date().toISOString();
      const keys = await api.storage.list(BRANCH_KEY_PREFIX);

      const entries: [string, BranchRecord][] = [];
      for (const key of keys) {
        const record = await api.storage.get<BranchRecord>(key);
        if (record !== null) entries.push([key, record]);
      }

      const { keep, expire } = partitionRecords(entries, cfg.draftTtlDays, now);
      for (const key of expire) await api.storage.delete(key);

      const wanted = typeof args['state'] === 'string' ? args['state'] : null;
      const branches = keep
        .map(([, r]) => r)
        .filter((r) => wanted === null || r.state === wanted)
        .map((r) => ({
          branch: r.branch,
          repo: r.repoFullName,
          state: r.state,
          itemId: r.itemId ?? null,
          summary: describeBranchRecord(r),
        }));

      return { count: branches.length, swept: expire.length, branches };
    }

    case 'workspace.branch-adopt': {
      const io = assertConfigured();
      const { repoFullName, branch } = requireBranchArgs(args);
      const itemId = requireItemId(args);

      // The link is the point of adopting, so unlike branch-create — where the
      // item already exists and matters more — a failure here is reported.
      const link = await io.registerGitLink(itemId, branchUrl(repoFullName, branch));

      const key = branchKey(repoFullName, branch);
      const existing = await api.storage.get<BranchRecord>(key);
      const now = new Date().toISOString();
      const base = existing ?? newRecord(repoFullName, branch, null, now);
      await api.storage.set(key, {
        ...base,
        state: 'adopted',
        itemId,
        gitLinkId: link.id,
        updatedAt: now,
      } satisfies BranchRecord);

      return { success: true, itemId, branch, message: `Linked ${branch} to #${itemId}.` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
