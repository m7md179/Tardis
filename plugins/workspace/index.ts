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
  return {
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
      return { id: item.id, text: formatWorkItem(item) };
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
      return { id: item.id, text: formatWorkItem(item) };
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
      return { id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.comment': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      const body = String(args['body'] ?? '').trim();
      if (body === '') throw new Error('Workspace: the comment is empty.');
      await io.addComment(itemId, body);
      return { message: `Commented on #${itemId}.` };
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
      return { id: item.id, text: formatWorkItem(item) };
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
      return { id: item.id, text: formatWorkItem(item) };
    }

    case 'workspace.archive-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      await io.archiveItem(itemId);
      return { message: `Archived #${itemId}.` };
    }

    case 'workspace.delete-item': {
      const io = assertConfigured();
      const itemId = requireItemId(args);
      await io.deleteItem(itemId);
      return { message: `Deleted #${itemId}.` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
