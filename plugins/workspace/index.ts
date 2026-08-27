import type { PluginAPI } from '@tardis/core';
import { IoClient } from './io-client.js';
import { resolvePermissions } from './permissions.js';
import { formatWorkspaceSummary } from './format.js';
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

  if (baseUrl === '' || email === '' || password === '') {
    api.logger.warn(
      'Workspace plugin activated without credentials — set baseUrl, email, password'
    );
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

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
