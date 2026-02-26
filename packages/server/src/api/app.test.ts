import { describe, it, expect } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { sign } from 'hono/jwt';
import { createApp } from './app.js';
import type { AppDeps } from './app.js';
import { createDb, migrate } from '@tardis/db';
import type { PluginManager } from '@tardis/core';
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
  },
  proactive: { enabled: false },
};

function makeManifest(name: string): PluginManifest {
  return {
    name,
    version: '1.0.0',
    displayName: name,
    description: `${name} plugin`,
    tier: 1,
    main: 'index.ts',
    skillSummary: `${name} skill`,
    permissions: [],
    tools: [
      {
        name: `${name}.tool`,
        description: 'A tool',
        parameters: { type: 'object', properties: {} },
        actionType: 'direct',
      },
    ],
  };
}

function makeMockPluginManager(manifests: PluginManifest[] = []): PluginManager {
  return {
    getAllManifests: () => manifests,
    getPlugin: () => undefined,
    executeTool: async () => ({}),
    getSkillSummaries: () => [],
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

  it('returns plugin list with name, tier, skillSummary, toolCount', async () => {
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
