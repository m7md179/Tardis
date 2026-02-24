import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { randomUUID } from 'crypto';
import { eq, desc, memories, thoughtTraces } from '@tardis/db';
import { ThoughtTracer } from '@tardis/core';
import { MemoryEntrySchema, LLMProviderConfigSchema } from '@tardis/shared';
import type { TardisDB } from '@tardis/db';
import type { SystemConfig } from '@tardis/shared';
import type { PluginManager } from '@tardis/core';

// ─── App dependencies ─────────────────────────────────────────────────────────

export interface AppDeps {
  db: TardisDB;
  config: SystemConfig;
  pluginManager: PluginManager;
  /** Called when PUT /api/config/llm succeeds — persist the change. */
  saveConfig: (updated: SystemConfig) => void;
}

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const tracer = new ThoughtTracer(deps.db);

  // ─── Public routes ────────────────────────────────────────────────────────

  app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

  // ─── JWT-protected routes ─────────────────────────────────────────────────

  // Apply JWT middleware to everything under /api except /api/health
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    return jwt({ secret: deps.config.auth.jwtSecret, alg: 'HS256' })(c, next);
  });

  // ─── Plugins ──────────────────────────────────────────────────────────────

  app.get('/api/plugins', (c) => {
    const manifests = deps.pluginManager.getAllManifests();
    return c.json(
      manifests.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        version: m.version,
        tier: m.tier,
        skillSummary: m.skillSummary,
        toolCount: m.tools.length,
      }))
    );
  });

  // ─── Thought traces ───────────────────────────────────────────────────────

  app.get('/api/traces', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const page = Math.max(parseInt(c.req.query('page') ?? '1', 10), 1);
    const offset = (page - 1) * limit;

    const rows = await deps.db
      .select()
      .from(thoughtTraces)
      .orderBy(desc(thoughtTraces.timestamp))
      .limit(limit)
      .offset(offset);

    const total = (await deps.db.select().from(thoughtTraces)).length;

    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        userMessage: r.userMessage,
        finalResponse: r.finalResponse,
        modelUsed: r.modelUsed,
        totalDurationMs: r.totalDurationMs,
        tokenCount: r.tokenCount,
        timestamp: r.timestamp,
        stepCount: (() => {
          try {
            return (JSON.parse(r.steps) as unknown[]).length;
          } catch {
            return 0;
          }
        })(),
      })),
      total,
      page,
      limit,
    });
  });

  app.get('/api/traces/:id', async (c) => {
    const trace = await tracer.getById(c.req.param('id'));
    if (!trace) return c.json({ error: 'Trace not found' }, 404);
    return c.json(trace);
  });

  // ─── Memory ───────────────────────────────────────────────────────────────

  app.get('/api/memory', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const page = Math.max(parseInt(c.req.query('page') ?? '1', 10), 1);
    const typeFilter = c.req.query('type');
    const offset = (page - 1) * limit;

    let query = deps.db.select().from(memories).orderBy(desc(memories.updatedAt)).$dynamic();

    if (typeFilter) {
      query = query.where(eq(memories.type, typeFilter));
    }

    const rows = await query.limit(limit).offset(offset);
    const total = (await deps.db.select().from(memories)).length;

    return c.json({ data: rows, total, page, limit });
  });

  app.post('/api/memory', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = MemoryEntrySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
    }

    const entry = parsed.data;
    const now = Date.now();

    await deps.db
      .insert(memories)
      .values({
        id: entry.id ?? randomUUID(),
        type: entry.type,
        key: entry.key,
        value: entry.value,
        source: entry.source ?? null,
        createdAt: entry.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: memories.id,
        set: { value: entry.value, key: entry.key, updatedAt: now },
      });

    return c.json({ success: true }, 201);
  });

  app.delete('/api/memory/:id', async (c) => {
    const id = c.req.param('id');
    await deps.db.delete(memories).where(eq(memories.id, id));
    return c.json({ success: true });
  });

  // ─── LLM config ───────────────────────────────────────────────────────────

  app.get('/api/config/llm', (c) => {
    const { apiKey, ...safe } = deps.config.llm;
    return c.json({
      ...safe,
      apiKey: apiKey ? '[redacted]' : undefined,
    });
  });

  app.put('/api/config/llm', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = LLMProviderConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
    }

    const updated: SystemConfig = { ...deps.config, llm: parsed.data };
    deps.saveConfig(updated);
    // Reflect the change in deps so subsequent GET requests see it
    (deps as { config: SystemConfig }).config = updated;

    return c.json({ success: true });
  });

  return app;
}
