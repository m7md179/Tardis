import type { PluginAPI } from '@tardis/core';
import { IoClient } from './io-client.js';
import { resolvePermissions } from './permissions.js';
import { displayName, formatBoard, formatWorkItem, formatWorkspaceSummary } from './format.js';
import { WORK_ITEM_STATUSES } from './types.js';
import type { Assignee, WorkItem } from './types.js';
import { resolveWorkspaceId } from './current.js';

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

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
