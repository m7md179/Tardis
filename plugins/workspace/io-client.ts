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
    return res.statusText !== '' ? res.statusText : `HTTP ${res.status}`;
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
