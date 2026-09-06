/**
 * transport.ts — talk to TARDIS from a git hook.
 *
 * See docs/specs/2026-09-06-branch-linked-work-items-design.md §8.
 *
 * This runs detached, after the git command it was triggered by has already
 * returned, with nobody watching stdout. So it never throws: the only two
 * outcomes are "TARDIS acted" and "it is written down to try later".
 *
 * The distinction that matters is between an OUTAGE and a DECISION. TARDIS
 * being unreachable, or answering 500, is an outage — the request is queued
 * and retried. TARDIS answering "branch linking is off" (or 403 read-only, or
 * 409 approval-required) is a decision, and queueing it would pile up requests
 * that can never succeed, forever.
 */

export interface TransportDeps {
  baseUrl: string;
  password: string;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  readToken: () => Promise<string | null>;
  writeToken: (token: string) => Promise<void>;
  enqueue: (skillId: string, args: unknown) => Promise<void>;
  log: (message: string) => void;
}

export type InvokeStatus = 'ok' | 'queued' | 'refused';

export interface InvokeResult {
  status: InvokeStatus;
  detail?: string;
}

async function login(deps: TransportDeps): Promise<string | null> {
  const res = await deps.fetchImpl(`${deps.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: deps.password }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || body.token === '') return null;

  await deps.writeToken(body.token);
  return body.token;
}

async function post(
  deps: TransportDeps,
  token: string,
  skillId: string,
  args: unknown
): Promise<Response> {
  return deps.fetchImpl(`${deps.baseUrl}/api/skills/${skillId}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ args }),
  });
}

export async function invokeSkill(
  deps: TransportDeps,
  skillId: string,
  args: unknown
): Promise<InvokeResult> {
  try {
    let token = await deps.readToken();
    if (token === null || token === '') {
      token = await login(deps);
      if (token === null) {
        await deps.enqueue(skillId, args);
        return { status: 'queued', detail: 'login failed' };
      }
    }

    let res = await post(deps, token, skillId, args);

    // A cached token outliving its expiry is ordinary, not an error.
    if (res.status === 401) {
      const fresh = await login(deps);
      if (fresh === null) {
        await deps.enqueue(skillId, args);
        return { status: 'queued', detail: 'login failed after 401' };
      }
      res = await post(deps, fresh, skillId, args);
    }

    if (res.ok) return { status: 'ok' };

    if (res.status >= 500) {
      await deps.enqueue(skillId, args);
      return { status: 'queued', detail: `server error ${res.status}` };
    }

    // Any other 4xx is TARDIS declining on purpose. Record it and stop.
    const detail = await res.text().catch(() => '');
    deps.log(`${skillId} refused (${res.status}): ${detail.slice(0, 300)}`);
    return { status: 'refused', detail };
  } catch (err) {
    await deps.enqueue(skillId, args);
    deps.log(`${skillId} queued — ${String(err)}`);
    return { status: 'queued', detail: String(err) };
  }
}
