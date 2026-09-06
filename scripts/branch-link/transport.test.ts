import { describe, it, expect } from 'bun:test';
import { invokeSkill } from './transport.js';
import type { TransportDeps } from './transport.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const LOGIN_OK = { token: 'tok-1' };

interface Harness {
  deps: TransportDeps;
  calls: { url: string; init?: RequestInit }[];
  queued: { skillId: string; args: unknown }[];
  token: { value: string | null };
}

function harness(handler: (n: number, url: string) => Response | Promise<Response>): Harness {
  const calls: { url: string; init?: RequestInit }[] = [];
  const queued: { skillId: string; args: unknown }[] = [];
  const token = { value: null as string | null };

  return {
    calls,
    queued,
    token,
    deps: {
      baseUrl: 'http://tardis.test',
      password: 'pw',
      fetchImpl: async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return handler(calls.length, url);
      },
      readToken: async () => token.value,
      writeToken: async (t: string) => void (token.value = t),
      enqueue: async (skillId: string, args: unknown) => void queued.push({ skillId, args }),
      log: () => {},
    },
  };
}

describe('invokeSkill', () => {
  it('logs in, then posts the skill with the token it got', async () => {
    const h = harness((n) => (n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ success: true })));

    const out = await invokeSkill(h.deps, 'workspace.branch-draft', { branch: 'feat/x' });

    expect(out.status).toBe('ok');
    expect(h.calls[0]!.url).toBe('http://tardis.test/api/auth/login');
    expect(h.calls[1]!.url).toBe('http://tardis.test/api/skills/workspace.branch-draft/invoke');
    const headers = h.calls[1]!.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-1');
    expect(JSON.parse(String(h.calls[1]!.init?.body))).toEqual({ args: { branch: 'feat/x' } });
  });

  it('reuses a cached token instead of logging in every push', async () => {
    const h = harness(() => jsonResponse({ success: true }));
    h.token.value = 'cached';

    await invokeSkill(h.deps, 'workspace.branch-draft', {});

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toContain('/api/skills/');
  });

  it('re-logs in once when the cached token has expired', async () => {
    const h = harness((n) => {
      if (n === 1) return jsonResponse({ error: 'nope' }, 401);
      if (n === 2) return jsonResponse(LOGIN_OK);
      return jsonResponse({ success: true });
    });
    h.token.value = 'stale';

    const out = await invokeSkill(h.deps, 'workspace.branch-draft', {});

    expect(out.status).toBe('ok');
    expect(h.calls).toHaveLength(3);
    expect(h.queued).toHaveLength(0);
  });

  it('queues rather than throwing when TARDIS is unreachable', async () => {
    // The push has already succeeded by the time this runs. Throwing would
    // surface a stack trace from a backgrounded process and lose the request.
    const h = harness(() => {
      throw new Error('ECONNREFUSED');
    });

    const out = await invokeSkill(h.deps, 'workspace.branch-create', { branch: 'feat/x' });

    expect(out.status).toBe('queued');
    expect(h.queued).toEqual([{ skillId: 'workspace.branch-create', args: { branch: 'feat/x' } }]);
  });

  it('queues on a server error, so the work is not silently dropped', async () => {
    const h = harness((n) => (n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({}, 500)));
    const out = await invokeSkill(h.deps, 'workspace.branch-create', {});
    expect(out.status).toBe('queued');
    expect(h.queued).toHaveLength(1);
  });

  it('does NOT queue when the plugin refuses on purpose', async () => {
    // branch linking switched off, or read-only mode: retrying forever would
    // pile up requests that can never succeed. This is a decision, not an
    // outage.
    const h = harness((n) =>
      n === 1
        ? jsonResponse(LOGIN_OK)
        : jsonResponse({ success: false, error: 'branch linking is off' }, 400)
    );

    const out = await invokeSkill(h.deps, 'workspace.branch-create', {});

    expect(out.status).toBe('refused');
    expect(h.queued).toHaveLength(0);
  });
});
