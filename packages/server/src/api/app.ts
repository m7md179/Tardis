import { Hono } from 'hono';
import { jwt, sign } from 'hono/jwt';
import { randomUUID } from 'crypto';
import { eq, desc, like, or, memories, thoughtTraces } from '@tardis/db';
import { ThoughtTracer, OllamaAdapter, OpenAIAdapter } from '@tardis/core';
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
  /** Proactive scheduler instance (optional, added in Phase 5). */
  scheduler?: import('@tardis/core').ProactiveScheduler;
  /** Password for web UI login (optional — uses jwtSecret if not provided). */
  adminPassword?: string;
  /** Absolute path to the web-ui dist folder for static file serving. */
  webUiDistPath?: string;
}

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const tracer = new ThoughtTracer(deps.db);

  // ─── Public routes ────────────────────────────────────────────────────────

  app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

  // ─── Auth login (public) ────────────────────────────────────────────────

  app.post('/api/auth/login', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { password } = body as { password?: string };
    if (!password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    // Compare against adminPassword if set, otherwise fall back to jwtSecret
    const expected = deps.adminPassword ?? deps.config.auth.jwtSecret;
    if (password !== expected) {
      return c.json({ error: 'Invalid password' }, 401);
    }

    const token = await sign(
      { sub: 'admin', role: 'admin', iat: Math.floor(Date.now() / 1000) },
      deps.config.auth.jwtSecret,
      'HS256'
    );
    return c.json({ token });
  });

  // ─── JWT-protected routes ─────────────────────────────────────────────────

  // Apply JWT middleware to everything under /api except /api/health and /api/auth/login
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health' || c.req.path === '/api/auth/login') return next();
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
    const search = c.req.query('search');
    const offset = (page - 1) * limit;

    let query = deps.db.select().from(memories).orderBy(desc(memories.updatedAt)).$dynamic();

    const conditions = [];
    if (typeFilter) {
      conditions.push(eq(memories.type, typeFilter));
    }
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(like(memories.key, pattern), like(memories.value, pattern))!);
    }
    if (conditions.length === 1) {
      query = query.where(conditions[0]!);
    } else if (conditions.length > 1) {
      // Both type and search: both must match
      query = query.where(conditions[0]!).where(conditions[1]!);
    }

    const rows = await query.limit(limit).offset(offset);
    // Count matching total (not all memories)
    const allMatching = await (() => {
      let countQuery = deps.db.select().from(memories).$dynamic();
      if (conditions.length === 1) {
        countQuery = countQuery.where(conditions[0]!);
      } else if (conditions.length > 1) {
        countQuery = countQuery.where(conditions[0]!).where(conditions[1]!);
      }
      return countQuery;
    })();
    const total = allMatching.length;

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

  app.patch('/api/memory/:id', async (c) => {
    const id = c.req.param('id');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { type, key, value, source } = body as {
      type?: string;
      key?: string;
      value?: string;
      source?: string;
    };

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (type !== undefined) updates['type'] = type;
    if (key !== undefined) updates['key'] = key;
    if (value !== undefined) updates['value'] = value;
    if (source !== undefined) updates['source'] = source;

    await deps.db.update(memories).set(updates).where(eq(memories.id, id));
    return c.json({ success: true });
  });

  app.get('/api/memory/export', async (c) => {
    const rows = await deps.db
      .select()
      .from(memories)
      .orderBy(desc(memories.updatedAt));

    const lines: string[] = ['# TARDIS Memories Export', ''];
    for (const m of rows) {
      lines.push(`## [${m.type}] ${m.key}`);
      lines.push('');
      lines.push(m.value);
      lines.push('');
      if (m.source) lines.push(`*Source: ${m.source}*`);
      lines.push(`*Updated: ${new Date(m.updatedAt).toISOString()}*`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return c.json({ markdown: lines.join('\n') });
  });

  // ─── LLM config ───────────────────────────────────────────────────────────

  app.get('/api/config/llm', (c) => {
    const { apiKey, ...safe } = deps.config.llm;
    return c.json({
      ...safe,
      apiKey: apiKey ? '[redacted]' : undefined,
    });
  });

  // ─── Proactive triggers ──────────────────────────────────────────────────

  app.get('/api/proactive/triggers', async (c) => {
    if (!deps.scheduler) return c.json({ error: 'Scheduler not configured' }, 503);
    const triggers = await deps.scheduler.listTriggers();
    return c.json({ data: triggers });
  });

  app.put('/api/proactive/triggers/toggle', async (c) => {
    if (!deps.scheduler) return c.json({ error: 'Scheduler not configured' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { pluginName, triggerName, enabled } = body as {
      pluginName?: string;
      triggerName?: string;
      enabled?: boolean;
    };
    if (!pluginName || !triggerName || typeof enabled !== 'boolean') {
      return c.json({ error: 'pluginName, triggerName, and enabled (boolean) are required' }, 400);
    }
    const found = await deps.scheduler.toggleTrigger(pluginName, triggerName, enabled);
    if (!found) return c.json({ error: 'Trigger not found' }, 404);
    return c.json({ success: true });
  });

  app.put('/api/proactive/triggers/schedule', async (c) => {
    if (!deps.scheduler) return c.json({ error: 'Scheduler not configured' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { pluginName, triggerName, schedule } = body as {
      pluginName?: string;
      triggerName?: string;
      schedule?: string;
    };
    if (!pluginName || !triggerName || !schedule) {
      return c.json({ error: 'pluginName, triggerName, and schedule are required' }, 400);
    }
    const found = await deps.scheduler.updateSchedule(pluginName, triggerName, schedule);
    if (!found) return c.json({ error: 'Trigger not found' }, 404);
    return c.json({ success: true });
  });

  app.put('/api/proactive/triggers/quiet-hours', async (c) => {
    if (!deps.scheduler) return c.json({ error: 'Scheduler not configured' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { pluginName, triggerName, start, end } = body as {
      pluginName?: string;
      triggerName?: string;
      start?: string | null;
      end?: string | null;
    };
    if (!pluginName || !triggerName) {
      return c.json({ error: 'pluginName and triggerName are required' }, 400);
    }
    const found = await deps.scheduler.setQuietHours(
      pluginName,
      triggerName,
      start ?? null,
      end ?? null
    );
    if (!found) return c.json({ error: 'Trigger not found' }, 404);
    return c.json({ success: true });
  });

  // ─── LLM config ───────────────────────────────────────────────────────────

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

  // ─── LLM connection test ────────────────────────────────────────────────

  app.post('/api/config/llm/test', async (c) => {
    const { provider, model, baseUrl, apiKey, temperature } = deps.config.llm;

    try {
      const adapter =
        provider === 'ollama'
          ? new OllamaAdapter({
              model,
              ...(baseUrl !== undefined ? { baseUrl } : {}),
              ...(temperature !== undefined ? { temperature } : {}),
            })
          : new OpenAIAdapter({
              model,
              apiKey: apiKey ?? '',
              ...(baseUrl !== undefined ? { baseUrl } : {}),
              ...(temperature !== undefined ? { temperature } : {}),
            });

      const response = await adapter.chat({
        messages: [
          { role: 'user', content: 'Say "Hello from TARDIS" in one short sentence.' },
        ],
      });

      if (response.type === 'text' && response.text) {
        return c.json({ success: true, response: response.text });
      }

      return c.json({ success: true, response: 'LLM responded (non-text)' });
    } catch (e) {
      return c.json({
        success: false,
        error: e instanceof Error ? e.message : 'Connection failed',
      });
    }
  });

  return app;
}
