import { Hono } from 'hono';
import { jwt, sign } from 'hono/jwt';
import { randomUUID } from 'crypto';
import { eq, desc, like, or, memories, thoughtTraces } from '@tardis/db';
import { ThoughtTracer, OllamaAdapter, OpenAIAdapter } from '@tardis/core';
import { MemoryEntrySchema, LLMProviderConfigSchema } from '@tardis/shared';
import type { TardisDB } from '@tardis/db';
import type { LLMProviderConfig, SystemConfig } from '@tardis/shared';
import type { PluginManager } from '@tardis/core';
import { runConversationTurn } from '@tardis/core';
import { createRateLimiters, rateLimitMiddleware, safeEqual } from './rate-limit.js';

// ─── App dependencies ─────────────────────────────────────────────────────────

export interface AppDeps {
  db: TardisDB;
  config: SystemConfig;
  pluginManager: PluginManager;
  /** Routes direct (non-LLM) skill invocations. Same validation path the agent loop uses. */
  toolRouter?: import('@tardis/core').ToolRouter;
  /**
   * Everything needed to run a conversation turn. Without this the agent is
   * reachable only from Telegram, which is how TARDIS shipped until now.
   */
  conversation?: import('@tardis/core').ConversationDeps;
  /**
   * Gap between SSE keep-alive comments, in ms. Overridable so a test does not
   * have to wait ten seconds to prove the heartbeat exists.
   */
  streamHeartbeatMs?: number;
  /** Called when PUT /api/config/llm succeeds — persist the change. */
  saveConfig: (updated: SystemConfig) => void;
  /** Proactive scheduler instance (optional, added in Phase 5). */
  scheduler?: import('@tardis/core').ProactiveScheduler;
  /** Password for web UI login (optional — uses jwtSecret if not provided). */
  adminPassword?: string;
  /** Absolute path to the web-ui dist folder for static file serving. */
  webUiDistPath?: string;
  /**
   * Vector index over memories. Absent means no embedder is configured and
   * memory search is keyword-only.
   */
  memoryIndexer?: import('@tardis/core').MemoryIndexer;
  /** Backs the reindex endpoint and embedding upkeep on memory writes. */
  memoryStore?: import('@tardis/core').MemoryStore;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>;
}

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/**
 * Strips the stored vector from a row before it goes over the wire.
 *
 * It is several KB of binary per memory and no client has any use for it —
 * returning it would turn a list of 50 memories into a 150 KB response.
 */
function withoutVector<T extends { embedding?: unknown; embeddingModel?: unknown }>(
  row: T
): Omit<T, 'embedding'> {
  const { embedding: _dropped, ...rest } = row;
  return rest;
}

/**
 * Re-embed one memory after its text changed, if there is an index.
 *
 * Failures are deliberately silent: the write already succeeded, the row is the
 * truth, and the vector will be rebuilt by the next reindex. Failing the
 * request here would mean a memory the user can see but the API says it
 * refused to save.
 */
async function reindexOne(
  deps: AppDeps,
  id: string | null,
  key: string,
  value: string
): Promise<void> {
  if (!deps.memoryIndexer || !id) return;
  await deps.memoryIndexer.indexOne({ id, key, value });
}

function resolveProviderBaseUrl(provider: string, baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  if (provider === 'ollama') return 'http://localhost:11434';
  return (OPENAI_COMPATIBLE_BASE_URLS[provider] ?? 'https://api.openai.com/v1').replace(/\/$/, '');
}

function mergeLlmConfig(
  current: LLMProviderConfig,
  overrides: Partial<LLMProviderConfig>
): LLMProviderConfig {
  const provider = overrides.provider?.trim() || current.provider;
  const model = overrides.model?.trim() || current.model;
  const merged: LLMProviderConfig = { provider, model };

  const baseUrl = overrides.baseUrl?.trim() || current.baseUrl;
  if (baseUrl) merged.baseUrl = baseUrl;

  const apiKey = overrides.apiKey?.trim() || current.apiKey;
  if (apiKey) merged.apiKey = apiKey;

  const temperature = overrides.temperature ?? current.temperature;
  if (temperature !== undefined) merged.temperature = temperature;

  return merged;
}

async function fetchAvailableModels(config: LLMProviderConfig): Promise<string[]> {
  const provider = config.provider.trim().toLowerCase();
  const baseUrl = resolveProviderBaseUrl(provider, config.baseUrl);

  if (provider === 'ollama') {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Provider returned ${response.status} while loading models`);
    }
    const body = (await response.json()) as OllamaTagsResponse;
    return (body.models ?? [])
      .map((model) => model.name?.trim() ?? '')
      .filter((name): name is string => name.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status} while loading models`);
  }
  const body = (await response.json()) as OpenAIModelsResponse;
  return (body.data ?? [])
    .map((model) => model.id?.trim() ?? '')
    .filter((id): id is string => id.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const tracer = new ThoughtTracer(deps.db);

  // ─── Rate limiting ────────────────────────────────────────────────────────
  //
  // Applied before everything, including the public routes, because the login
  // endpoint is exactly what needs protecting: one shared password guards every
  // skill, and the API is internet-reachable through the tunnel.
  const limiters = createRateLimiters(deps.config.rateLimit);
  app.use('/api/*', rateLimitMiddleware(deps.config.rateLimit, limiters));

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

    // Compare against adminPassword if set, otherwise fall back to jwtSecret.
    // Constant-time: a plain !== short-circuits at the first differing byte,
    // which leaks the prefix given enough samples.
    const expected = deps.adminPassword ?? deps.config.auth.jwtSecret;
    if (!safeEqual(password, expected)) {
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
        summary: m.summary,
        toolCount: m.tools.length,
      }))
    );
  });

  // ─── Chat ─────────────────────────────────────────────────────────────────
  //
  // The agent loop over HTTP. Same pipeline Telegram uses — plugin selection,
  // memory retrieval, tools, trace and history persistence — via the shared
  // conversation service.

  app.post('/api/chat', async (c) => {
    if (!deps.conversation) {
      return c.json({ error: 'Chat is not configured', code: 'NOT_CONFIGURED' }, 503);
    }
    let body: { message?: string; chatId?: string; images?: string[] };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const message = (body.message ?? '').trim();
    if (!message) return c.json({ error: 'message is required' }, 400);

    const result = await runConversationTurn(
      {
        chatId: body.chatId ?? 'web',
        message,
        ...(body.images?.length ? { images: body.images } : {}),
      },
      deps.conversation
    );

    return c.json({
      response: result.response,
      selectedPlugins: result.selectedPlugins,
      traceId: result.trace.id,
      steps: result.trace.steps,
      ...(result.pendingApproval ? { pendingApproval: result.pendingApproval } : {}),
    });
  });

  app.post('/api/chat/stream', async (c) => {
    if (!deps.conversation) {
      return c.json({ error: 'Chat is not configured', code: 'NOT_CONFIGURED' }, 503);
    }
    let body: { message?: string; chatId?: string; images?: string[] };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const message = (body.message ?? '').trim();
    if (!message) return c.json({ error: 'message is required' }, 400);

    const conversation = deps.conversation;
    const encoder = new TextEncoder();

    // A turn takes seconds. Emitting plugin selection and each step as they
    // happen is the difference between "working" and "looks frozen".
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;

        // Enqueueing into a stream whose reader has gone away throws. Letting
        // that propagate would abort the turn mid-flight and lose work that has
        // already happened, so a vanished client is ignored and the turn runs to
        // completion — its trace and history are persisted either way.
        const write = (chunk: string): void => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        const send = (event: string, data: unknown): void => {
          write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        // A turn can spend 20+ seconds inside one model call with nothing to
        // report, and a socket with no traffic gets closed — observed live as
        // "socket connection closed unexpectedly" between a tool result and the
        // answer, identically on the LAN and through the tunnel, so this was
        // never Cloudflare. An SSE comment is ignored by every parser but is
        // still traffic.
        //
        // 5s against the server's 120s idle timeout. The first attempt used 10s
        // against Bun's 10s default, which is a tie the socket sometimes wins.
        const heartbeat = setInterval(() => write(': ping\n\n'), deps.streamHeartbeatMs ?? 5_000);

        try {
          const result = await runConversationTurn(
            {
              chatId: body.chatId ?? 'web',
              message,
              ...(body.images?.length ? { images: body.images } : {}),
              onPluginsSelected: (plugins) => send('plugins', { plugins }),
              onStep: (step) => send('step', step),
            },
            conversation
          );
          send('done', {
            response: result.response,
            traceId: result.trace.id,
            selectedPlugins: result.selectedPlugins,
            ...(result.pendingApproval ? { pendingApproval: result.pendingApproval } : {}),
          });
        } catch (err) {
          send('error', { error: err instanceof Error ? err.message : String(err) });
        } finally {
          clearInterval(heartbeat);
          if (!closed) {
            try {
              controller.close();
            } catch {
              // Already closed by the reader going away.
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        // Cloudflare buffers responses it thinks are compressible; this keeps
        // events flowing through the tunnel instead of arriving all at once.
        'X-Accel-Buffering': 'no',
      },
    });
  });

  // ─── Conversation history ─────────────────────────────────────────────────
  //
  // The server has always stored every message and tool call; nothing exposed
  // them, so refreshing the web app lost the whole conversation. Turns are
  // grouped server-side because three clients render them and two would
  // reassemble tool calls slightly differently.

  app.get('/api/chat/history', async (c) => {
    const store = deps.conversation?.conversationStore;
    if (!store) {
      return c.json({ error: 'History is not configured', code: 'NOT_CONFIGURED' }, 503);
    }

    const chatId = c.req.query('chatId') ?? 'app';
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20', 10) || 20, 1), 100);
    const beforeRaw = c.req.query('before');
    const before = beforeRaw ? Number(beforeRaw) : undefined;

    const turns = await store.getTurns(
      chatId,
      limit,
      before !== undefined && Number.isFinite(before) ? before : undefined
    );

    // One extra turn is fetched to answer "is there more" without a count query.
    const oldest = turns[0]?.at;
    const hasMore =
      oldest !== undefined && (await store.getTurns(chatId, 1, oldest)).length > 0;

    return c.json({ chatId, turns, hasMore });
  });

  app.delete('/api/chat/history', async (c) => {
    const store = deps.conversation?.conversationStore;
    if (!store) {
      return c.json({ error: 'History is not configured', code: 'NOT_CONFIGURED' }, 503);
    }
    const chatId = c.req.query('chatId') ?? 'app';
    await store.clearHistory(chatId);
    return c.json({ success: true, chatId });
  });

  // ─── Skills ───────────────────────────────────────────────────────────────
  //
  // The generic contract every client renders from. Clients never hardcode
  // per-plugin knowledge — they read this and render the uiDescriptor.

  app.get('/api/skills', (c) => {
    const pluginFilter = c.req.query('plugin');
    const aiFilter = c.req.query('aiInvocable');

    let skills = deps.pluginManager.getAllSkills();
    if (pluginFilter) skills = skills.filter((s) => s.plugin === pluginFilter);
    if (aiFilter === 'true') skills = skills.filter((s) => s.aiInvocable);
    if (aiFilter === 'false') skills = skills.filter((s) => !s.aiInvocable);

    return c.json({
      skills: skills.map((s) => ({
        id: s.id,
        plugin: s.plugin,
        pluginDisplayName: s.pluginDisplayName,
        description: s.description,
        aiInvocable: s.aiInvocable,
        actionType: s.actionType,
        mutates: s.mutates,
        parameters: s.parameters,
        ui: s.ui ?? null,
      })),
    });
  });

  app.post('/api/skills/:id/invoke', async (c) => {
    const id = c.req.param('id');
    const skill = deps.pluginManager.getSkill(id);
    if (!skill) {
      return c.json({ success: false, error: `Skill "${id}" not found`, code: 'SKILL_NOT_FOUND' }, 404);
    }
    if (!deps.toolRouter) {
      return c.json(
        { success: false, error: 'Skill invocation is not configured', code: 'NOT_CONFIGURED' },
        503
      );
    }

    let args: Record<string, unknown> = {};
    try {
      const body = (await c.req.json()) as { args?: Record<string, unknown> };
      args = body.args ?? {};
    } catch {
      // No body is fine for zero-argument skills.
    }

    // Read-only mode is a property of the installation, not of the agent loop.
    // A skill reached over HTTP is the same skill; a switch the UI can step
    // around is not a switch.
    if (deps.config.agent.readOnly && skill.mutates !== false) {
      return c.json(
        {
          success: false,
          code: 'READ_ONLY',
          error: `Skill "${id}" changes state, and TARDIS is in read-only mode`,
        },
        403
      );
    }

    // A workflow skill must not execute just because it was reached over HTTP
    // instead of through the agent loop. Direct invocation is a different door,
    // not a weaker one.
    if (skill.actionType === 'workflow') {
      return c.json(
        {
          success: false,
          code: 'APPROVAL_REQUIRED',
          error: `Skill "${id}" requires approval before it runs`,
          preview: { skill: id, args },
        },
        409
      );
    }

    const result = await deps.toolRouter.execute(id, args);
    if (!result.success) {
      const status =
        result.code === 'VALIDATION_ERROR' ? 400 : result.code === 'TOOL_NOT_FOUND' ? 404 : 500;
      return c.json({ success: false, error: result.error, code: result.code }, status);
    }
    return c.json({ success: true, data: result.data });
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

    const rows = (await query.limit(limit).offset(offset)).map(withoutVector);
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
        set: {
          value: entry.value,
          key: entry.key,
          updatedAt: now,
          // The old vector described the old text. See reindexOne.
          embedding: null,
          embeddingModel: null,
        },
      });

    await reindexOne(deps, entry.id ?? null, entry.key, entry.value);
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

    // Editing the text invalidates the vector. Leaving it would make the memory
    // findable by what it used to say, which is worse than not being findable.
    const textChanged = key !== undefined || value !== undefined;
    if (textChanged) {
      updates['embedding'] = null;
      updates['embeddingModel'] = null;
    }

    await deps.db.update(memories).set(updates).where(eq(memories.id, id));

    if (textChanged) {
      const [row] = await deps.db.select().from(memories).where(eq(memories.id, id)).limit(1);
      if (row) await reindexOne(deps, row.id, row.key, row.value);
    }
    return c.json({ success: true });
  });

  /**
   * Rebuild every memory's vector from its row.
   *
   * The row is the truth and the embedding is derived, so this can always be
   * run and can never lose anything — the worst case is the time it takes
   * (measured at ~63 ms per memory against a local nomic-embed-text).
   *
   * `?full=true` drops existing vectors first, for when the model changed
   * behind an unchanged name. Without it this only fills gaps, which makes it
   * the right thing to run after an embedder outage.
   */
  app.post('/api/memory/reindex', async (c) => {
    if (!deps.memoryIndexer) {
      return c.json(
        { success: false, code: 'NO_EMBEDDER', error: 'No embedder is configured' },
        503
      );
    }
    const full = c.req.query('full') === 'true';
    const result = await deps.memoryIndexer.reindexAll(full);
    return c.json({ success: true, ...result });
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

  app.get('/api/proactive/logs', async (c) => {
    if (!deps.scheduler) return c.json({ error: 'Scheduler not configured' }, 503);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const page = Math.max(parseInt(c.req.query('page') ?? '1', 10), 1);
    const pluginName = c.req.query('pluginName');
    const triggerName = c.req.query('triggerName');
    const logs = await deps.scheduler.listLogs(limit, page, pluginName, triggerName);
    return c.json({ data: logs, page, limit });
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

  app.post('/api/config/llm/models', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const overrides: Partial<LLMProviderConfig> = {};
    if (typeof raw['provider'] === 'string' && raw['provider'].trim()) {
      overrides.provider = raw['provider'].trim();
    }
    if (typeof raw['model'] === 'string' && raw['model'].trim()) {
      overrides.model = raw['model'].trim();
    }
    if (typeof raw['baseUrl'] === 'string' && raw['baseUrl'].trim()) {
      overrides.baseUrl = raw['baseUrl'].trim();
    }
    if (typeof raw['apiKey'] === 'string' && raw['apiKey'].trim()) {
      overrides.apiKey = raw['apiKey'].trim();
    }
    if (typeof raw['temperature'] === 'number') {
      overrides.temperature = raw['temperature'];
    }

    const merged = mergeLlmConfig(deps.config.llm, overrides);
    const baseUrl = resolveProviderBaseUrl(merged.provider.trim().toLowerCase(), merged.baseUrl);

    try {
      const models = await fetchAvailableModels(merged);
      return c.json({
        success: true,
        provider: merged.provider,
        baseUrl,
        models,
      });
    } catch (e) {
      return c.json(
        {
          success: false,
          provider: merged.provider,
          baseUrl,
          error: e instanceof Error ? e.message : 'Failed to load models',
        },
        502
      );
    }
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
