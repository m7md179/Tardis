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
  get: <T = unknown>(k: string) => Promise<T | null>;
  set: (k: string, v: unknown) => Promise<void>;
  delete: (k: string) => Promise<void>;
  list: () => Promise<string[]>;
} {
  const dump = new Map<string, unknown>();
  return {
    get: async <T = unknown>(k: string): Promise<T | null> => (dump.get(k) as T) ?? null,
    set: async (k: string, v: unknown): Promise<void> => void dump.set(k, v),
    delete: async (k: string): Promise<void> => void dump.delete(k),
    list: async (): Promise<string[]> => [...dump.keys()],
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
    apiKey: 'k-123',
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

// ─── The global API key guard ───
//
// APIKeyGuard is registered as an APP_GUARD in the IO server's app.module, so
// EVERY route — including the public-looking /account/login — 403s without an
// x-api-key header. Only `heartbeat` routes are exempt. Omitting it fails
// everything, uniformly, in a way that looks like bad credentials.

describe('x-api-key', () => {
  it('sends the key on login, which is not exempt from the global guard', async () => {
    const { client, calls } = makeClient(() => jsonResponse(LOGIN_OK));
    await client.login();
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k-123');
  });

  it('sends the key on every authenticated request too', async () => {
    const { client, calls } = makeClient((_c, n) =>
      n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ data: [], status: 200, message: 'ok' })
    );
    await client.request('GET', '/workspaces');
    const headers = calls[1]!.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k-123');
    expect(headers['Authorization']).toBe('Bearer access-1');
  });

  it('refuses to start without a key rather than 403ing on every call', () => {
    expect(
      () =>
        new IoClient({
          baseUrl: 'http://io.test',
          email: 'm@x.com',
          password: 'pw',
          apiKey: '',
          storage: memStorage(),
          logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
          fetchImpl: async () => jsonResponse({}),
        })
    ).toThrow(/apiKey/);
  });
});

describe('login', () => {
  it('posts credentials and stores the access token and account id', async () => {
    const { client, calls, storage } = makeClient(() => jsonResponse(LOGIN_OK));
    const accountId = await client.login();

    expect(accountId).toBe(42);
    expect(calls[0]!.url).toBe('http://io.test/account/login');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(await storage.get<string>('accessToken')).toBe('access-1');
    expect(await storage.get<number>('accountId')).toBe(42);
  });

  it('does not store the refresh token, because nothing can redeem it', async () => {
    const { client, storage } = makeClient(() => jsonResponse(LOGIN_OK));
    await client.login();
    expect(await storage.get<string>('refreshToken')).toBeNull();
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
    expect(await storage.get<string>('accessToken')).toBeNull();
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
      if (n === 3)
        return jsonResponse({
          ...LOGIN_OK,
          data: { ...LOGIN_OK.data, signedAccessToken: 'access-2' },
        });
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

describe('writes', () => {
  const okThen =
    (payload: unknown) =>
    (_c: Call, n: number): Response =>
      n === 1
        ? jsonResponse(LOGIN_OK)
        : jsonResponse({ data: payload, status: 200, message: 'ok' });

  it('POSTs a create to the workspace-scoped route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.createItem(7, { type: 'EPIC', title: 'T' });
    expect(calls[1]!.url).toBe('http://io.test/workspaces/7/work-items');
    expect(calls[1]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ type: 'EPIC', title: 'T' });
  });

  it('PATCHes an update to the flat work-item route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.updateItem(9, { title: 'New' });
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9');
    expect(calls[1]!.init?.method).toBe('PATCH');
  });

  it('PATCHes a move to the move sub-route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.moveItem(9, { status: 'TODO' });
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9/move');
    expect(calls[1]!.init?.method).toBe('PATCH');
  });

  it('assigns by PATCHing assignee_account_ids', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.assign(9, [4, 5]);
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ assignee_account_ids: [4, 5] });
  });

  it('DELETEs a soft-delete', async () => {
    const { client, calls } = makeClient(okThen(true));
    await client.deleteItem(9);
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9');
    expect(calls[1]!.init?.method).toBe('DELETE');
  });

  it('POSTs an archive to its own sub-route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.archiveItem(9);
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9/archive');
    expect(calls[1]!.init?.method).toBe('POST');
  });

  it('posts a comment as { body }, matching CreateCommentDto', async () => {
    const { client, calls } = makeClient(okThen({ id: 1 }));
    await client.addComment(9, 'looks good');
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9/comments');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ body: 'looks good' });
  });

  it('fetches all items of one type for the parent picker', async () => {
    const { client, calls } = makeClient(okThen([]));
    await client.searchItemsByType(7, 'EPIC');
    expect(calls[1]!.url).toContain('/workspaces/7/work-items');
    expect(calls[1]!.url).toContain('type=EPIC');
    expect(calls[1]!.url).toContain('archived=exclude');
  });

  it('surfaces the description gate verbatim rather than paraphrasing it', async () => {
    const { client } = makeClient((_c, n) =>
      n === 1
        ? jsonResponse(LOGIN_OK)
        : jsonResponse(
            {
              message: 'A work item needs a description before it can enter To Do',
              statusCode: 400,
            },
            400
          )
    );
    let caught: unknown;
    try {
      await client.createItem(7, { type: 'EPIC', title: 'T', status: 'TODO' });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('needs a description');
  });
});
