import { describe, it, expect } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { createApp } from './app.js';
import type { AppDeps } from './app.js';
import type { PluginManager } from '@tardis/core';
import type { SystemConfig } from '@tardis/shared';
import { buildOpenApiDocument } from './openapi.js';

const CONFIG: SystemConfig = {
  server: { host: '0.0.0.0', port: 3000, dataDir: '/tmp' },
  auth: { jwtSecret: 'test-secret-that-is-long-enough-for-hs256', jwtExpiry: '30d' },
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

function makeApp() {
  const path = `/tmp/tardis-openapi-test-${randomUUID()}.db`;
  migrate(path);
  const app = createApp({
    db: createDb(path),
    config: CONFIG,
    pluginManager: {
      getAllManifests: () => [],
      getAllSkills: () => [],
      getSkill: () => null,
    } as unknown as PluginManager,
    saveConfig: () => {},
  } as AppDeps);
  return {
    app,
    cleanup: () => {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

/** `/api/skills/:id/invoke` in Hono is `/api/skills/{id}/invoke` in OpenAPI. */
function toOpenApiPath(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, unknown> };
  info: { version: string };
  servers?: { url: string }[];
}

const DOC = buildOpenApiDocument({ version: '2.0.0' }) as unknown as OpenApiDoc;

describe('the published document', () => {
  it('is OpenAPI 3.1 with a title and version', () => {
    const doc = DOC as unknown as Record<string, unknown>;
    expect(doc['openapi']).toBe('3.1.0');
    expect((doc['info'] as { title: string }).title).toBe('TARDIS');
    expect(DOC.info.version).toBe('2.0.0');
  });

  it('declares bearer auth, and exempts only the two public endpoints', () => {
    expect(DOC.components.securitySchemes['bearerAuth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    const publicOnes: string[] = [];
    for (const [route, methods] of Object.entries(DOC.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const security = (op as { security?: unknown[] }).security;
        if (Array.isArray(security) && security.length === 0) {
          publicOnes.push(`${method.toUpperCase()} ${route}`);
        }
      }
    }
    // These two are exactly what the JWT middleware skips.
    expect(publicOnes.sort()).toEqual(['GET /api/health', 'POST /api/auth/login']);
  });

  it('includes a server URL only when one was supplied', () => {
    expect(DOC.servers).toBeUndefined();
    const withUrl = buildOpenApiDocument({
      version: '2.0.0',
      serverUrl: 'https://tardis.example',
    }) as unknown as OpenApiDoc;
    expect(withUrl.servers).toEqual([{ url: 'https://tardis.example' }]);
  });

  it('gives every operation a unique, readable operationId', () => {
    // A generator turns these straight into method names, so this is the
    // difference between `invokeSkill()` and `postSkillsIdInvoke()`.
    const ids: string[] = [];
    for (const [route, methods] of Object.entries(DOC.paths)) {
      for (const [method, raw] of Object.entries(methods)) {
        const id = (raw as { operationId?: string }).operationId;
        expect({ route, method, id }).toMatchObject({ id: expect.any(String) });
        ids.push(id!);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every $ref against a component that exists', () => {
    // A dangling $ref makes a generator fail outright, and it is the easiest
    // thing in the world to leave behind after a rename.
    const defined = new Set(
      Object.keys((DOC as unknown as { components: { schemas: Record<string, unknown> } }).components.schemas)
    );
    const refs = [...JSON.stringify(DOC).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map(
      (m) => m[1]!
    );
    expect(refs.length).toBeGreaterThan(0);
    expect([...new Set(refs)].filter((r) => !defined.has(r))).toEqual([]);
  });

  it('documents a 401 on everything that needs a token', () => {
    for (const [route, methods] of Object.entries(DOC.paths)) {
      for (const [method, raw] of Object.entries(methods)) {
        const op = raw as { security?: unknown[]; responses?: Record<string, unknown> };
        if (Array.isArray(op.security) && op.security.length === 0) continue;
        expect({ route, method, has401: '401' in (op.responses ?? {}) }).toMatchObject({
          has401: true,
        });
      }
    }
  });

  it('gives every operation a summary and at least one response', () => {
    for (const [route, methods] of Object.entries(DOC.paths)) {
      for (const [method, raw] of Object.entries(methods)) {
        const op = raw as { summary?: string; responses?: Record<string, unknown> };
        expect({ route, method, hasSummary: Boolean(op.summary) }).toMatchObject({
          hasSummary: true,
        });
        expect({ route, method, responses: Object.keys(op.responses ?? {}).length > 0 }).toMatchObject(
          { responses: true }
        );
      }
    }
  });
});

// ─── The guarantee that replaces a generator ─────────────────────────────────
//
// A hand-written document rots. Hono exposes its route table, so the two can be
// compared directly: a route added without a description fails here, which is
// the property `@hono/zod-openapi` would have provided without rewriting all 28
// routes through createRoute().

describe('the document matches the routes actually registered', () => {
  const { app, cleanup } = makeApp();

  // Middleware (`ALL`) and the SPA catch-all are not API endpoints.
  const registered = new Set(
    app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api'))
      .map((r) => `${r.method} ${toOpenApiPath(r.path)}`)
  );

  const documented = new Set(
    Object.entries(DOC.paths).flatMap(([route, methods]) =>
      Object.keys(methods).map((m) => `${m.toUpperCase()} ${route}`)
    )
  );

  it('documents every route the app registers', () => {
    const undocumented = [...registered].filter((r) => !documented.has(r)).sort();
    expect(undocumented).toEqual([]);
  });

  it('does not describe a route that does not exist', () => {
    // The other half: a rename leaves a stale entry behind, and a generated
    // client would then produce a method that 404s.
    const phantom = [...documented].filter((r) => !registered.has(r)).sort();
    expect(phantom).toEqual([]);
  });

  it('covers a meaningful number of endpoints, so an empty set cannot pass', () => {
    // Both assertions above are vacuously true if the route table came back
    // empty — which is exactly what a change to Hono's internals would do.
    expect(registered.size).toBeGreaterThan(20);
  });

  cleanup();
});

describe('GET /doc', () => {
  it('is served without a token, because a client needs it before it has one', async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await app.request('/doc');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OpenApiDoc;
      expect(Object.keys(body.paths).length).toBeGreaterThan(20);
    } finally {
      cleanup();
    }
  });

  it('describes the surface without exposing it', async () => {
    // The document being public must not make the endpoints public.
    const { app, cleanup } = makeApp();
    try {
      const res = await app.request('/api/plugins');
      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });
});
