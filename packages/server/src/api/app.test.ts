import { describe, it, expect, mock } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { sign } from 'hono/jwt';
import { createApp } from './app.js';
import type { AppDeps } from './app.js';
import { createDb, migrate, memories, eq } from '@tardis/db';
import type { PluginManager } from '@tardis/core';
import { PluginManifestSchema } from '@tardis/shared';
import type { PluginManifest, SystemConfig } from '@tardis/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';

const BASE_CONFIG: SystemConfig = {
  server: { host: '0.0.0.0', port: 3000, dataDir: '/tmp' },
  auth: { jwtSecret: JWT_SECRET, jwtExpiry: '30d' },
  llm: { provider: 'ollama', model: 'qwen3:4b' },
  agent: {
    maxSteps: 10,
    conversationHistoryLength: 10,
    memoryTokenBudget: 2000,
    enableFallbackIntent: false,
    actionOverrides: {},
    readOnly: false,
  },
  proactive: { enabled: false },
  memory: {},
  rateLimit: { enabled: false, windowMs: 60000, maxRequests: 120, maxLoginAttempts: 5 },
};

function makeManifest(name: string): PluginManifest {
  return PluginManifestSchema.parse({
    name,
    version: '1.0.0',
    displayName: name,
    description: `${name} plugin`,
    tier: 1,
    main: 'index.ts',
    summary: `${name} skill`,
    permissions: [],
    tools: [
      {
        name: `${name}.tool`,
        description: 'A tool',
        parameters: { type: 'object', properties: {} },
        actionType: 'direct',
      },
    ],
  });
}

function makeMockPluginManager(manifests: PluginManifest[] = []): PluginManager {
  return {
    getAllManifests: () => manifests,
    getPlugin: () => undefined,
    executeTool: async () => ({}),
    getPluginSummaries: () => [],
    getAllSkills: () =>
      manifests.flatMap((m) =>
        m.skills.map((sk) => ({ ...sk, plugin: m.name, pluginDisplayName: m.displayName }))
      ),
    getSkill: (id: string) =>
      manifests
        .flatMap((m) =>
          m.skills.map((sk) => ({ ...sk, plugin: m.name, pluginDisplayName: m.displayName }))
        )
        .find((sk) => sk.id === id) ?? null,
    getToolsForPlugins: () => [],
    isLoaded: () => false,
    loadAll: async () => {},
    unloadAll: async () => {},
  } as unknown as PluginManager;
}

function makeTestDb() {
  const path = `/tmp/tardis-api-app-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup: () => {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

async function makeApp(overrides: Partial<AppDeps> = {}) {
  const { db, cleanup } = makeTestDb();
  const saveConfig = (_: SystemConfig) => {};
  const deps: AppDeps = {
    db,
    config: BASE_CONFIG,
    pluginManager: makeMockPluginManager(),
    saveConfig,
    ...overrides,
  };
  return { app: createApp(deps), cleanup, deps };
}

async function makeToken(secret = JWT_SECRET): Promise<string> {
  return sign({ sub: 'test', role: 'admin' }, secret, 'HS256');
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ─── Health check (public) ────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with status ok (no auth required)', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['status']).toBe('ok');
      expect(typeof body['timestamp']).toBe('number');
    } finally {
      cleanup();
    }
  });
});

// ─── JWT auth ─────────────────────────────────────────────────────────────────

describe('JWT authentication', () => {
  it('returns 401 when no token provided', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.request('/api/plugins');
      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('returns 401 when token is invalid', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.request('/api/plugins', {
        headers: { Authorization: 'Bearer not.a.valid.token' },
      });
      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('returns 200 when valid token provided', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/plugins', { headers: authHeaders(token) });
      expect(res.status).toBe(200);
    } finally {
      cleanup();
    }
  });
});

// ─── GET /api/plugins ─────────────────────────────────────────────────────────

describe('GET /api/plugins', () => {
  it('returns empty array when no plugins loaded', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/plugins', { headers: authHeaders(token) });
      expect(await res.json()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('returns plugin list with name, tier, summary, toolCount', async () => {
    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([makeManifest('time-tracker'), makeManifest('todoist')]),
    });
    try {
      const token = await makeToken();
      const res = await app.request('/api/plugins', { headers: authHeaders(token) });
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      expect(body[0]?.['name']).toBe('time-tracker');
      expect(body[0]?.['toolCount']).toBe(1);
      expect(body[1]?.['name']).toBe('todoist');
    } finally {
      cleanup();
    }
  });
});

// ─── GET /api/traces ─────────────────────────────────────────────────────────

describe('GET /api/traces', () => {
  it('returns empty data when no traces saved', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/traces', { headers: authHeaders(token) });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['data']).toEqual([]);
      expect(body['total']).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('returns saved traces with stepCount', async () => {
    const { app, cleanup, deps } = await makeApp();
    try {
      // Insert a trace directly into the DB
      const { schema } = await import('@tardis/db');
      await deps.db.insert(schema.thoughtTraces).values({
        id: randomUUID(),
        userMessage: 'hello',
        steps: JSON.stringify([{ type: 'reasoning', content: 'thinking' }]),
        finalResponse: 'hi',
        timestamp: Date.now(),
        totalDurationMs: 100,
        modelUsed: 'mock',
      });

      const token = await makeToken();
      const res = await app.request('/api/traces', { headers: authHeaders(token) });
      const body = (await res.json()) as Record<string, unknown>;
      expect((body['data'] as unknown[]).length).toBe(1);
      expect(body['total']).toBe(1);
      const trace = (body['data'] as Array<Record<string, unknown>>)[0];
      expect(trace?.['stepCount']).toBe(1);
      expect(trace?.['userMessage']).toBe('hello');
    } finally {
      cleanup();
    }
  });

  it('respects limit and page query params', async () => {
    const { app, cleanup, deps } = await makeApp();
    try {
      const { schema } = await import('@tardis/db');
      for (let i = 0; i < 5; i++) {
        await deps.db.insert(schema.thoughtTraces).values({
          id: randomUUID(),
          userMessage: `msg ${i}`,
          steps: '[]',
          timestamp: Date.now() + i,
          totalDurationMs: 10,
          modelUsed: 'mock',
        });
      }

      const token = await makeToken();
      const res = await app.request('/api/traces?limit=2&page=1', { headers: authHeaders(token) });
      const body = (await res.json()) as Record<string, unknown>;
      expect((body['data'] as unknown[]).length).toBe(2);
      expect(body['total']).toBe(5);
    } finally {
      cleanup();
    }
  });
});

// ─── GET /api/traces/:id ──────────────────────────────────────────────────────

describe('GET /api/traces/:id', () => {
  it('returns 404 for unknown id', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/traces/nonexistent-id', { headers: authHeaders(token) });
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});

// ─── Memory CRUD ─────────────────────────────────────────────────────────────

describe('Memory CRUD', () => {
  it('GET /api/memory returns empty list initially', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/memory', { headers: authHeaders(token) });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['data']).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('POST /api/memory creates a memory entry', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const entry = {
        id: randomUUID(),
        type: 'user_fact',
        key: 'name',
        value: 'Mohammad',
        source: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const postRes = await app.request('/api/memory', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      expect(postRes.status).toBe(201);

      const getRes = await app.request('/api/memory', { headers: authHeaders(token) });
      const body = (await getRes.json()) as Record<string, unknown>;
      expect((body['data'] as unknown[]).length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('POST /api/memory returns 400 for invalid body', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/memory', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: true }),
      });
      expect(res.status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it('DELETE /api/memory/:id removes the entry', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const id = randomUUID();
      const entry = {
        id,
        type: 'user_fact',
        key: 'name',
        value: 'Test',
        source: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await app.request('/api/memory', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });

      const delRes = await app.request(`/api/memory/${id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      expect(delRes.status).toBe(200);

      const getRes = await app.request('/api/memory', { headers: authHeaders(token) });
      const body = (await getRes.json()) as Record<string, unknown>;
      expect((body['data'] as unknown[]).length).toBe(0);
    } finally {
      cleanup();
    }
  });
});

// ─── LLM config ───────────────────────────────────────────────────────────────

describe('LLM config', () => {
  it('GET /api/config/llm returns provider and model with redacted apiKey', async () => {
    const { app, cleanup } = await makeApp({
      config: {
        ...BASE_CONFIG,
        llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-secret' },
      },
    });
    try {
      const token = await makeToken();
      const res = await app.request('/api/config/llm', { headers: authHeaders(token) });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['provider']).toBe('openai');
      expect(body['model']).toBe('gpt-4o');
      expect(body['apiKey']).toBe('[redacted]');
    } finally {
      cleanup();
    }
  });

  it('PUT /api/config/llm updates and calls saveConfig', async () => {
    let saved: SystemConfig | null = null;
    const { app, cleanup } = await makeApp({
      saveConfig: (c) => {
        saved = c;
      },
    });
    try {
      const token = await makeToken();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama', model: 'llama3:8b' }),
      });
      expect(res.status).toBe(200);
      expect(saved).not.toBeNull();
      expect((saved as unknown as SystemConfig).llm.model).toBe('llama3:8b');
    } finally {
      cleanup();
    }
  });

  it('PUT /api/config/llm returns 400 for invalid body', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      });
      expect(res.status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it('POST /api/config/llm/models returns Ollama models', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://localhost:11434/api/tags');
      return new Response(
        JSON.stringify({ models: [{ name: 'llama3:8b' }, { name: 'qwen3:4b' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch;

    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/config/llm/models', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['success']).toBe(true);
      expect(body['baseUrl']).toBe('http://localhost:11434');
      expect(body['models']).toEqual(['llama3:8b', 'qwen3:4b']);
    } finally {
      globalThis.fetch = originalFetch;
      cleanup();
    }
  });

  it('POST /api/config/llm/models uses unsaved overrides for OpenAI-compatible providers', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.groq.com/openai/v1/models');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer gsk-test');
      return new Response(
        JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant' }, { id: 'mixtral-8x7b' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch;

    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const res = await app.request('/api/config/llm/models', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'groq', apiKey: 'gsk-test' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['success']).toBe(true);
      expect(body['baseUrl']).toBe('https://api.groq.com/openai/v1');
      expect(body['models']).toEqual(['llama-3.1-8b-instant', 'mixtral-8x7b']);
    } finally {
      globalThis.fetch = originalFetch;
      cleanup();
    }
  });
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns token with correct password (defaults to jwtSecret)', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: JWT_SECRET }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token?: string };
      expect(typeof body.token).toBe('string');
    } finally {
      cleanup();
    }
  });

  it('returns token with correct adminPassword when set', async () => {
    const { app, cleanup } = await makeApp({ adminPassword: 'my-admin-pass' });
    try {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'my-admin-pass' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token?: string };
      expect(typeof body.token).toBe('string');
    } finally {
      cleanup();
    }
  });

  it('returns 401 with wrong password', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      });
      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('returned token can be used for authenticated requests', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const loginRes = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: JWT_SECRET }),
      });
      const { token } = (await loginRes.json()) as { token: string };

      const pluginsRes = await app.request('/api/plugins', {
        headers: authHeaders(token),
      });
      expect(pluginsRes.status).toBe(200);
    } finally {
      cleanup();
    }
  });
});

// ─── PATCH /api/memory/:id ───────────────────────────────────────────────────

describe('PATCH /api/memory/:id', () => {
  it('updates an existing memory', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();
      const id = randomUUID();

      await app.request('/api/memory', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          type: 'user_fact',
          key: 'name',
          value: 'Alice',
          source: 'user',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      });

      const patchRes = await app.request(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'Bob', key: 'full_name' }),
      });
      expect(patchRes.status).toBe(200);

      const getRes = await app.request('/api/memory', { headers: authHeaders(token) });
      const body = (await getRes.json()) as { data: Array<{ key: string; value: string }> };
      expect(body.data[0]?.value).toBe('Bob');
      expect(body.data[0]?.key).toBe('full_name');
    } finally {
      cleanup();
    }
  });
});

// ─── GET /api/memory/export ──────────────────────────────────────────────────

describe('GET /api/memory/export', () => {
  it('returns markdown with all memories', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();

      await app.request('/api/memory', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          type: 'user_fact',
          key: 'name',
          value: 'Mohammad',
          source: 'test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      });

      const res = await app.request('/api/memory/export', { headers: authHeaders(token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { markdown: string };
      expect(body.markdown).toContain('# TARDIS Memories Export');
      expect(body.markdown).toContain('Mohammad');
    } finally {
      cleanup();
    }
  });
});

// ─── GET /api/memory?search= ────────────────────────────────────────────────

describe('Memory search', () => {
  it('filters memories by search query', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const token = await makeToken();

      for (const entry of [
        { id: randomUUID(), type: 'user_fact', key: 'name', value: 'Alice', source: 'test', createdAt: Date.now(), updatedAt: Date.now() },
        { id: randomUUID(), type: 'preference', key: 'theme', value: 'dark mode', source: 'test', createdAt: Date.now(), updatedAt: Date.now() },
      ]) {
        await app.request('/api/memory', {
          method: 'POST',
          headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
      }

      const res = await app.request('/api/memory?search=Alice', { headers: authHeaders(token) });
      const body = (await res.json()) as { data: unknown[]; total: number };
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    } finally {
      cleanup();
    }
  });
});

// ─── Skills contract (Phase B) ────────────────────────────────────────────────
//
// GET /api/skills is what every client — mobile, web, TUI — renders from, so
// its shape is a contract, not an implementation detail.

describe('GET /api/skills', () => {
  it('returns every skill with the fields clients render from', async () => {
    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([makeManifest('reminders')]),
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills', { headers: authHeaders(token) });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { skills: Record<string, unknown>[] };
      expect(body.skills).toHaveLength(1);
      const skill = body.skills[0]!;
      expect(skill.id).toBe('reminders.tool');
      expect(skill.plugin).toBe('reminders');
      expect(skill.description).toBe('A tool');
      expect(skill.aiInvocable).toBe(true);
      expect(skill.actionType).toBe('direct');
      expect(skill.parameters).toEqual({ type: 'object', properties: {} });
      // Always present, even before Phase C fills it in — clients can rely on the key.
      expect(skill).toHaveProperty('ui');
    } finally {
      cleanup();
    }
  });

  it('filters by plugin', async () => {
    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([makeManifest('reminders'), makeManifest('todoist')]),
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills?plugin=todoist', { headers: authHeaders(token) });
      const body = (await res.json()) as { skills: { plugin: string }[] };
      expect(body.skills).toHaveLength(1);
      expect(body.skills[0]!.plugin).toBe('todoist');
    } finally {
      cleanup();
    }
  });

  it('requires auth', async () => {
    const { app, cleanup } = await makeApp();
    try {
      expect((await app.request('/api/skills')).status).toBe(401);
    } finally {
      cleanup();
    }
  });
});

describe('POST /api/skills/:id/invoke', () => {
  it('executes a direct skill and returns the handler result', async () => {
    let received: unknown = null;
    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([makeManifest('reminders')]),
      toolRouter: {
        execute: async (id: string, args: Record<string, unknown>) => {
          received = { id, args };
          return { success: true as const, data: { created: true } };
        },
      } as unknown as AppDeps['toolRouter'],
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills/reminders.tool/invoke', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: { message: 'walk' } }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { created: true } });
      // Direct invocation goes through the same ToolRouter the agent loop uses.
      expect(received).toEqual({ id: 'reminders.tool', args: { message: 'walk' } });
    } finally {
      cleanup();
    }
  });

  it('returns 404 for an unknown skill', async () => {
    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([makeManifest('reminders')]),
      toolRouter: {
        execute: async () => ({ success: true as const, data: {} }),
      } as unknown as AppDeps['toolRouter'],
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills/nope.missing/invoke', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: {} }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'SKILL_NOT_FOUND' });
    } finally {
      cleanup();
    }
  });

  it('surfaces validation errors as 400 with the router error code', async () => {
    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([makeManifest('reminders')]),
      toolRouter: {
        execute: async () => ({
          success: false as const,
          error: 'missing required argument(s): message',
          code: 'VALIDATION_ERROR' as const,
        }),
      } as unknown as AppDeps['toolRouter'],
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills/reminders.tool/invoke', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: {} }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      cleanup();
    }
  });

  it('refuses to run a workflow skill without approval', async () => {
    let called = false;
    const workflowManifest = PluginManifestSchema.parse({
      name: 'todoist',
      version: '1.0.0',
      displayName: 'todoist',
      description: 'todoist plugin',
      tier: 1,
      main: 'index.ts',
      summary: 'todoist skill',
      permissions: [],
      skills: [
        {
          id: 'todoist.delete-task',
          description: 'Delete a task permanently',
          actionType: 'workflow',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    const { app, cleanup } = await makeApp({
      pluginManager: makeMockPluginManager([workflowManifest]),
      toolRouter: {
        execute: async () => {
          called = true;
          return { success: true as const, data: {} };
        },
      } as unknown as AppDeps['toolRouter'],
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills/todoist.delete-task/invoke', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: { taskName: 'x' } }),
      });

      // Reaching a workflow skill over HTTP must not bypass approval.
      expect(res.status).toBe(409);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'APPROVAL_REQUIRED' });
      expect(called).toBe(false);
    } finally {
      cleanup();
    }
  });

  // ─── Read-only mode ─────────────────────────────────────────────────────
  //
  // Read-only is a property of the installation, not of the agent loop. A
  // skill reached over HTTP is the same skill; a switch the UI can step
  // around is not a switch.

  const READ_ONLY_CONFIG: SystemConfig = {
    ...BASE_CONFIG,
    agent: { ...BASE_CONFIG.agent, readOnly: true },
  };

  function budgetManifest(): PluginManifest {
    return PluginManifestSchema.parse({
      name: 'budget',
      version: '1.0.0',
      displayName: 'budget',
      description: 'budget plugin',
      tier: 1,
      main: 'index.ts',
      summary: 'budget skills',
      permissions: [],
      skills: [
        {
          id: 'budget.this-month',
          description: "List this month's spending",
          parameters: { type: 'object', properties: {} },
        },
        {
          id: 'budget.add-entry',
          description: 'Record a spend',
          mutates: true,
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
  }

  async function readOnlyApp(onExecute: () => void) {
    return makeApp({
      config: READ_ONLY_CONFIG,
      pluginManager: makeMockPluginManager([budgetManifest()]),
      toolRouter: {
        execute: async () => {
          onExecute();
          return { success: true as const, data: { ok: true } };
        },
      } as unknown as AppDeps['toolRouter'],
    });
  }

  it('refuses a skill that changes state', async () => {
    let called = false;
    const { app, cleanup } = await readOnlyApp(() => {
      called = true;
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills/budget.add-entry/invoke', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: {} }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'READ_ONLY' });
      expect(called).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('still runs a skill that only reads — the whole point of the second axis', async () => {
    let called = false;
    const { app, cleanup } = await readOnlyApp(() => {
      called = true;
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/skills/budget.this-month/invoke', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: {} }),
      });
      expect(res.status).toBe(200);
      expect(called).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ─── Memory: vectors are derived, never authoritative ────────────────────────
//
// Every write path through HTTP has to keep that true. A vector that outlives
// the text it described makes a memory findable by what it used to say, which
// is worse than not being findable at all.

describe('memory vectors over HTTP', () => {
  function fakeIndexer() {
    const indexed: string[] = [];
    return {
      indexed,
      indexer: {
        model: 'fake-embed-v1',
        indexOne: async (m: { id: string }) => {
          indexed.push(m.id);
          return true;
        },
        reindexAll: async (full?: boolean) => ({
          indexed: full === true ? 7 : 3,
          failed: 0,
          model: 'fake-embed-v1',
        }),
        similar: async () => [],
      } as unknown as AppDeps['memoryIndexer'],
    };
  }

  it('does not ship the stored vector to clients', async () => {
    // Several KB of binary per memory that no client has any use for.
    const { app, cleanup, deps } = await makeApp();
    const token = await makeToken();
    try {
      const id = randomUUID();
      await deps.db.insert(memories).values({
        id,
        type: 'user_fact',
        key: 'k',
        value: 'v',
        embedding: Buffer.from(new Float32Array([1, 2, 3]).buffer),
        embeddingModel: 'fake-embed-v1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const res = await app.request('/api/memory', { headers: authHeaders(token) });
      const body = (await res.json()) as { data: Record<string, unknown>[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).not.toHaveProperty('embedding');
      expect(body.data[0]!['key']).toBe('k');
    } finally {
      cleanup();
    }
  });

  it('re-embeds a memory whose text was edited', async () => {
    const { indexed, indexer } = fakeIndexer();
    const { app, cleanup, deps } = await makeApp({ memoryIndexer: indexer });
    const token = await makeToken();
    try {
      const id = randomUUID();
      await deps.db.insert(memories).values({
        id,
        type: 'user_fact',
        key: 'k',
        value: 'old text',
        embedding: Buffer.from(new Float32Array([1, 2, 3]).buffer),
        embeddingModel: 'fake-embed-v1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const res = await app.request(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'completely new text' }),
      });
      expect(res.status).toBe(200);
      expect(indexed).toEqual([id]);
    } finally {
      cleanup();
    }
  });

  it('leaves the vector alone when only the type changed', async () => {
    // Re-embedding on every field would burn the embedder for no gain — the
    // text the vector describes has not moved.
    const { indexed, indexer } = fakeIndexer();
    const { app, cleanup, deps } = await makeApp({ memoryIndexer: indexer });
    const token = await makeToken();
    try {
      const id = randomUUID();
      await deps.db.insert(memories).values({
        id,
        type: 'user_fact',
        key: 'k',
        value: 'v',
        embedding: Buffer.from(new Float32Array([1, 2, 3]).buffer),
        embeddingModel: 'fake-embed-v1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await app.request(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'preference' }),
      });
      expect(indexed).toEqual([]);

      const [row] = await deps.db.select().from(memories).where(eq(memories.id, id)).limit(1);
      expect(row!.embedding).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('drops a stale vector even when there is no indexer to replace it', async () => {
    // Wrong is worse than missing: with no embedder configured the row simply
    // stops participating in vector search until someone reindexes.
    const { app, cleanup, deps } = await makeApp();
    const token = await makeToken();
    try {
      const id = randomUUID();
      await deps.db.insert(memories).values({
        id,
        type: 'user_fact',
        key: 'k',
        value: 'old text',
        embedding: Buffer.from(new Float32Array([1, 2, 3]).buffer),
        embeddingModel: 'fake-embed-v1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await app.request(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'new text' }),
      });

      const [row] = await deps.db.select().from(memories).where(eq(memories.id, id)).limit(1);
      expect(row!.embedding).toBeNull();
      expect(row!.embeddingModel).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('POST /api/memory/reindex', () => {
  it('rebuilds the index and reports what it did', async () => {
    const { app, cleanup } = await makeApp({
      memoryIndexer: {
        reindexAll: async (full?: boolean) => ({
          indexed: full === true ? 7 : 3,
          failed: 0,
          model: 'fake-embed-v1',
        }),
      } as unknown as AppDeps['memoryIndexer'],
    });
    const token = await makeToken();
    try {
      const res = await app.request('/api/memory/reindex', {
        method: 'POST',
        headers: authHeaders(token),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ indexed: 3, failed: 0, model: 'fake-embed-v1' });

      const full = await app.request('/api/memory/reindex?full=true', {
        method: 'POST',
        headers: authHeaders(token),
      });
      expect(await full.json()).toMatchObject({ indexed: 7 });
    } finally {
      cleanup();
    }
  });

  it('says so plainly when no embedder is configured', async () => {
    const { app, cleanup } = await makeApp();
    const token = await makeToken();
    try {
      const res = await app.request('/api/memory/reindex', {
        method: 'POST',
        headers: authHeaders(token),
      });
      expect(res.status).toBe(503);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'NO_EMBEDDER' });
    } finally {
      cleanup();
    }
  });
});

// ─── Plugin settings ─────────────────────────────────────────────────────────
//
// Descriptor-driven, like skills: the client renders a form from the schema and
// never hardcodes per-plugin knowledge.

describe('plugin settings', () => {
  function webManifest(): PluginManifest {
    return PluginManifestSchema.parse({
      name: 'web',
      version: '1.0.0',
      displayName: 'Web',
      description: 'web plugin',
      tier: 2,
      main: 'index.ts',
      summary: 'Searches the web.',
      permissions: [],
      config: {
        searxngUrl: {
          type: 'string',
          label: 'SearXNG URL',
          default: 'http://localhost:8888',
          required: true,
        },
        maxResults: { type: 'number', label: 'Results', default: 5, min: 1, max: 20 },
        apiToken: { type: 'string', label: 'Token', default: '', secret: true },
      },
      skills: [
        {
          id: 'web.search',
          description: 'Search the web',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
  }

  async function settingsApp(
    stored: Record<string, unknown> = {},
    writable = true
  ) {
    const written: [string, string, unknown][] = [];
    const app = await makeApp({
      config: { ...BASE_CONFIG, plugins: { web: stored } },
      pluginManager: makeMockPluginManager([webManifest()]),
      ...(writable
        ? {
            persistConfig: async (plugin: string, key: string, value: unknown) => {
              written.push([plugin, key, value]);
            },
          }
        : {}),
    });
    return { ...app, written };
  }

  it('serves the schema and the resolved values', async () => {
    const { app, cleanup } = await settingsApp();
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/web/config', { headers: authHeaders(token) });
      const body = (await res.json()) as {
        schema: Record<string, { label: string }>;
        values: Record<string, unknown>;
        writable: boolean;
      };
      expect(body.schema['searxngUrl']!.label).toBe('SearXNG URL');
      expect(body.values['searxngUrl']).toBe('http://localhost:8888');
      expect(body.writable).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('masks a secret it has, and does not mask one it does not', async () => {
    const { app, cleanup } = await settingsApp({ apiToken: 'real-token' });
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/web/config', { headers: authHeaders(token) });
      const body = (await res.json()) as { values: Record<string, unknown> };
      expect(body.values['apiToken']).not.toBe('real-token');
      expect(body.values['apiToken']).toBe('••••••••');
    } finally {
      cleanup();
    }
  });

  it('reports a stored value the schema forbids', async () => {
    const { app, cleanup } = await settingsApp({ maxResults: 500 });
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/web/config', { headers: authHeaders(token) });
      const body = (await res.json()) as { issues: { key: string }[] };
      expect(body.issues.map((i) => i.key)).toEqual(['maxResults']);
    } finally {
      cleanup();
    }
  });

  it('404s for a plugin that is not loaded', async () => {
    const { app, cleanup } = await settingsApp();
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/nope/config', { headers: authHeaders(token) });
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it('saves a valid change', async () => {
    const { app, cleanup, written } = await settingsApp();
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/web/config', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { maxResults: 8 } }),
      });
      expect(res.status).toBe(200);
      expect(written).toEqual([['web', 'maxResults', 8]]);
    } finally {
      cleanup();
    }
  });

  it('rejects an invalid change without writing anything', async () => {
    const { app, cleanup, written } = await settingsApp();
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/web/config', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { maxResults: 500 } }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'INVALID_CONFIG' });
      expect(written).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('treats a resubmitted mask as "unchanged", not as the new value', async () => {
    // Without this, opening the settings form and pressing save would overwrite
    // every secret with the bullet characters it was displayed as.
    const { app, cleanup, written } = await settingsApp({ apiToken: 'real-token' });
    const token = await makeToken();
    try {
      await app.request('/api/plugins/web/config', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { apiToken: '••••••••' } }),
      });
      expect(written).toEqual([['web', 'apiToken', 'real-token']]);
    } finally {
      cleanup();
    }
  });

  it('still accepts a genuine new secret', async () => {
    const { app, cleanup, written } = await settingsApp({ apiToken: 'old-token' });
    const token = await makeToken();
    try {
      await app.request('/api/plugins/web/config', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { apiToken: 'new-token' } }),
      });
      expect(written).toEqual([['web', 'apiToken', 'new-token']]);
    } finally {
      cleanup();
    }
  });

  it('says so plainly when there is nowhere to write', async () => {
    const { app, cleanup } = await settingsApp({}, false);
    const token = await makeToken();
    try {
      const res = await app.request('/api/plugins/web/config', {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { maxResults: 8 } }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'NOT_CONFIGURED' });
    } finally {
      cleanup();
    }
  });
});

// ─── Rate limiting through the real app ──────────────────────────────────────

describe('login rate limiting', () => {
  const LIMITED_CONFIG: SystemConfig = {
    ...BASE_CONFIG,
    rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 120, maxLoginAttempts: 3 },
  };

  function withIp(ip: string): HeadersInit {
    // Cloudflare sets this; the limiter keys on it so one abusive client
    // cannot throttle everyone behind the tunnel.
    return { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  }

  it('blocks brute-force login attempts with 429 and Retry-After', async () => {
    const { app, cleanup } = await makeApp({ config: LIMITED_CONFIG, adminPassword: 'correct' });
    try {
      const attempt = () =>
        app.request('/api/auth/login', {
          method: 'POST',
          headers: withIp('203.0.113.9'),
          body: JSON.stringify({ password: 'wrong' }),
        });

      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);

      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBeTruthy();
      expect((await blocked.json()) as { code: string }).toMatchObject({ code: 'RATE_LIMITED' });
    } finally {
      cleanup();
    }
  });

  it('blocks the correct password too once the budget is spent', async () => {
    // Otherwise an attacker learns they found it by the response changing.
    const { app, cleanup } = await makeApp({ config: LIMITED_CONFIG, adminPassword: 'correct' });
    try {
      for (let i = 0; i < 3; i++) {
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: withIp('203.0.113.10'),
          body: JSON.stringify({ password: 'wrong' }),
        });
      }
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: withIp('203.0.113.10'),
        body: JSON.stringify({ password: 'correct' }),
      });
      expect(res.status).toBe(429);
    } finally {
      cleanup();
    }
  });

  it('does not punish a different client', async () => {
    const { app, cleanup } = await makeApp({ config: LIMITED_CONFIG, adminPassword: 'correct' });
    try {
      for (let i = 0; i < 4; i++) {
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: withIp('203.0.113.11'),
          body: JSON.stringify({ password: 'wrong' }),
        });
      }
      const other = await app.request('/api/auth/login', {
        method: 'POST',
        headers: withIp('203.0.113.12'),
        body: JSON.stringify({ password: 'correct' }),
      });
      expect(other.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('leaves /api/health reachable so monitoring still works', async () => {
    const { app, cleanup } = await makeApp({ config: LIMITED_CONFIG, adminPassword: 'correct' });
    try {
      for (let i = 0; i < 10; i++) {
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: withIp('203.0.113.13'),
          body: JSON.stringify({ password: 'wrong' }),
        });
      }
      const health = await app.request('/api/health', { headers: withIp('203.0.113.13') });
      expect(health.status).toBe(200);
    } finally {
      cleanup();
    }
  });
});

// ─── SSE keep-alive ──────────────────────────────────────────────────────────
//
// Observed live from the TUI, through the Cloudflare tunnel: a turn that used
// two plugins died with "The socket connection was closed unexpectedly" in the
// gap between a tool result and the answer. A model call can hold the turn for
// 20+ seconds with nothing to report, no bytes flow, and the tunnel drops an
// idle connection.

describe('POST /api/chat/stream: keep-alive', () => {
  /** A turn that takes long enough for the heartbeat to matter. */
  function slowConversation(delayMs: number) {
    return {
      llmProvider: {
        name: 'mock',
        async chat() {
          await new Promise((r) => setTimeout(r, delayMs));
          return { type: 'text' as const, text: 'Took a while.' };
        },
        async generate() {
          return '[]';
        },
      },
      toolRouter: { asExecutor: () => async () => ({}) },
      agentConfig: {
        maxSteps: 5,
        conversationHistoryLength: 10,
        actionOverrides: {},
      },
      getAllManifests: () => [],
    } as unknown as AppDeps['conversation'];
  }

  it('emits comments while a slow turn produces nothing', async () => {
    const { app, cleanup } = await makeApp({
      conversation: slowConversation(120),
      streamHeartbeatMs: 15,
    });
    const token = await makeToken();

    const res = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'take your time', chatId: 'hb' }),
    });

    const body = await res.text();
    expect(body).toContain(': ping');
    // and the turn still finishes normally
    expect(body).toContain('event: done');
    cleanup();
  });

  it('a comment carries no data, so a parser ignores it', () => {
    // The client splits on a blank line and only acts on chunks with `data:`.
    const chunk = ': ping';
    const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:'));
    expect(dataLines).toHaveLength(0);
  });
});

// ─── Conversation history ────────────────────────────────────────────────────
//
// Refreshing the web app lost everything. The rows were always there — nothing
// served them.

describe('GET /api/chat/history', () => {
  function storeWith(turns: unknown[]) {
    return {
      conversation: {
        conversationStore: {
          getTurns: async (_chatId: string, limit: number, before?: number) => {
            const all = turns as { at: number }[];
            const window = before === undefined ? all : all.filter((t) => t.at < before);
            return window.slice(-limit);
          },
          clearHistory: async () => {},
        },
      },
    } as unknown as Partial<AppDeps>;
  }

  it('returns grouped turns for a chat', async () => {
    const { app, cleanup } = await makeApp(
      storeWith([{ id: 't1', at: 100, question: 'hi', steps: [], answer: 'hello' }])
    );
    const token = await makeToken();

    const res = await app.request('/api/chat/history?chatId=app', { headers: authHeaders(token) });
    const body = (await res.json()) as { chatId: string; turns: unknown[]; hasMore: boolean };

    expect(res.status).toBe(200);
    expect(body.chatId).toBe('app');
    expect(body.turns).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    cleanup();
  });

  it('reports more when older turns exist', async () => {
    const { app, cleanup } = await makeApp(
      storeWith([
        { id: 't1', at: 100, question: 'old', steps: [], answer: 'a' },
        { id: 't2', at: 200, question: 'new', steps: [], answer: 'b' },
      ])
    );
    const token = await makeToken();

    const res = await app.request('/api/chat/history?chatId=app&limit=1', {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { turns: { question: string }[]; hasMore: boolean };

    expect(body.turns.map((t) => t.question)).toEqual(['new']);
    expect(body.hasMore).toBe(true);
    cleanup();
  });

  it('caps limit so one request cannot ask for everything', async () => {
    const seen: number[] = [];
    const deps = {
      conversation: {
        conversationStore: {
          getTurns: async (_c: string, limit: number) => {
            seen.push(limit);
            return [];
          },
          clearHistory: async () => {},
        },
      },
    } as unknown as Partial<AppDeps>;
    const { app, cleanup } = await makeApp(deps);
    const token = await makeToken();

    await app.request('/api/chat/history?limit=99999', { headers: authHeaders(token) });
    expect(seen[0]).toBeLessThanOrEqual(100);
    cleanup();
  });

  it('503s rather than pretending when no store is configured', async () => {
    const { app, cleanup } = await makeApp({});
    const token = await makeToken();
    const res = await app.request('/api/chat/history', { headers: authHeaders(token) });
    expect(res.status).toBe(503);
    cleanup();
  });

  it('requires auth — history is the whole conversation', async () => {
    const { app, cleanup } = await makeApp(storeWith([]));
    const res = await app.request('/api/chat/history');
    expect(res.status).toBe(401);
    cleanup();
  });
});

describe('DELETE /api/chat/history', () => {
  it('clears only the named chat', async () => {
    const cleared: string[] = [];
    const deps = {
      conversation: {
        conversationStore: {
          getTurns: async () => [],
          clearHistory: async (chatId: string) => {
            cleared.push(chatId);
          },
        },
      },
    } as unknown as Partial<AppDeps>;
    const { app, cleanup } = await makeApp(deps);
    const token = await makeToken();

    const res = await app.request('/api/chat/history?chatId=app', {
      method: 'DELETE',
      headers: authHeaders(token),
    });

    expect(res.status).toBe(200);
    expect(cleared).toEqual(['app']);
    cleanup();
  });
});
