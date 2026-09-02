// TARDIS v2 Server — entrypoint
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { serveStatic } from 'hono/bun';
import {
  loadConfig,
  DEFAULT_DATA_DIR,
  PluginManager,
  createPluginApi,
  OllamaAdapter,
  OpenAIAdapter,
  ToolRouter,
  MemoryStore,
  MemoryRetriever,
  MemoryIndexer,
  OllamaEmbedder,
  createPendingApprovalStore,
  resolvePluginConfig,
  MEMORY_TOOLS,
  createMemoryExecutor,
  ProactiveScheduler,
  ConversationStore,
  ThoughtTracer,
} from '@tardis/core';
import { createDb, migrate } from '@tardis/db';
import type { SystemConfig } from '@tardis/shared';
import { createApp } from './api/app.js';
import { TelegramBot } from './telegram/bot.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLLMProvider(config: SystemConfig) {
  const { provider, model, baseUrl, apiKey, temperature, reasoningEffort } = config.llm;

  if (provider === 'ollama') {
    return new OllamaAdapter({
      model,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    });
  }

  return new OpenAIAdapter({
    model,
    apiKey: apiKey ?? '',
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  });
}

function makeSaveConfig(dataDir: string): (updated: SystemConfig) => void {
  return (updated) => {
    const configPath = join(dataDir, 'config.json');
    writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dataDir = process.env['TARDIS_DATA_DIR'] ?? DEFAULT_DATA_DIR;

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // 1. Load config
  const config = loadConfig(dataDir);

  // 2. Initialize DB
  const dbPath = join(dataDir, 'tardis.db');
  migrate(dbPath);
  const db = createDb(dbPath);

  // 3. Load plugins
  const pluginsDir = join(dataDir, 'plugins');
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  // Notification sender is wired after the Telegram bot starts.
  // Using a ref so plugins created before the bot can still send later.
  const notificationSenderRef = {
    send: async (message: string): Promise<void> => {
      console.log(`[tardis] NOTIFICATION (no sender configured): ${message}`);
    },
  };

  // 3b. Initialize memory store, and the vector index if one is configured.
  //
  // Optional by design: with no embedder, memory search is keyword-only —
  // exactly the behaviour that shipped before vectors existed. An embedding
  // service that is down or was never set up must degrade TARDIS, not break it.
  const memoryStore = new MemoryStore(db);
  const memoryIndexer = config.memory.embedder
    ? new MemoryIndexer(memoryStore, new OllamaEmbedder(config.memory.embedder))
    : undefined;
  console.log(
    memoryIndexer
      ? `[tardis] Memory search: hybrid (keyword + ${memoryIndexer.model})`
      : '[tardis] Memory search: keyword only (no embedder configured)'
  );

  // The LLM provider must exist BEFORE plugins load: the PluginAPI factory below
  // closes over it, and loadAll() runs it. Declaring it later put it in the
  // temporal dead zone and every plugin would fail to activate with a
  // ReferenceError — invisible to tsc, since the capture is inside a closure.
  const llmProvider = buildLLMProvider(config);

  const saveConfig = makeSaveConfig(dataDir);

  /**
   * Writes one plugin setting back to config.json.
   *
   * Mutates the in-memory `config` too, so a running plugin that reads through
   * `api.config.get` sees its own write without a restart.
   */
  const persistConfig = async (plugin: string, key: string, value: unknown): Promise<void> => {
    const plugins = { ...(config.plugins ?? {}) };
    plugins[plugin] = { ...(plugins[plugin] ?? {}), [key]: value };
    config.plugins = plugins;
    saveConfig(config);
  };

  const pluginManager = new PluginManager(pluginsDir, (manifest) =>
    createPluginApi({
      pluginName: manifest.name,
      permissions: manifest.permissions,
      db,
      config,
      llmProvider,
      notificationSender: (msg) => notificationSenderRef.send(msg),
      memoryStore,
      memoryIndexer,
      configSchema: manifest.configSchema,
      persistConfig,
    })
  );
  await pluginManager.loadAll();

  const loadedPlugins = pluginManager.getAllManifests();
  console.log(
    `[tardis] Loaded ${loadedPlugins.length} plugin(s):`,
    loadedPlugins.map((m) => m.name)
  );

  // Settings problems surface here rather than at first use — a plugin that
  // loads fine and then fails on its first call because a required token is
  // missing is a much harder thing to diagnose.
  for (const manifest of loadedPlugins) {
    const { issues } = resolvePluginConfig(
      manifest.configSchema,
      config.plugins?.[manifest.name] ?? {}
    );
    for (const issue of issues) {
      console.warn(`[tardis] Config problem in "${manifest.name}": ${issue.message}`);
    }
  }

  // Turn filters come from module exports, not the manifest, so they are
  // invisible in `tardis plugins`. Announcing them at load is the only place a
  // plugin quietly rewriting every turn becomes apparent.
  const turnFilters = pluginManager.getTurnFilters();
  if (turnFilters.length > 0) {
    console.log(
      '[tardis] Turn filters:',
      turnFilters
        .map(
          (f) =>
            `${f.plugin} (${[f.onTurnStart && 'start', f.onTurnEnd && 'end']
              .filter(Boolean)
              .join('+')})`
        )
        .join(', ')
    );
  }

  // 4. Build AI engine
  const toolRouter = new ToolRouter(pluginManager);
  const pendingApprovals = createPendingApprovalStore();
  const memoryRetriever = new MemoryRetriever(
    memoryStore,
    config.agent.memoryTokenBudget,
    memoryIndexer
  );
  const memoryExecutor = createMemoryExecutor(memoryStore, memoryIndexer);
  const conversationStore = new ConversationStore(db);
  const thoughtTracer = new ThoughtTracer(db);

  // 5. Initialize proactive scheduler
  const scheduler = new ProactiveScheduler(db);

  // Register proactive triggers from all loaded plugins
  for (const manifest of loadedPlugins) {
    if (manifest.proactive && manifest.proactive.length > 0) {
      const handlers = pluginManager.getProactiveHandlers(manifest.name);
      await scheduler.registerPlugin(manifest.name, manifest.proactive, handlers);
    }
  }

  // 6. Start Hono HTTP server (Bun native)
  // Shared with the Telegram bot: one pipeline, every surface.
  const conversationDeps = {
    llmProvider,
    toolRouter,
    agentConfig: config.agent,
    getAllManifests: () => pluginManager.getAllManifests(),
    memoryRetriever,
    memoryTools: MEMORY_TOOLS,
    memoryExecutor,
    conversationStore,
    thoughtTracer,
    turnFilters,
    // Shared by every surface, so a workflow skill can be confirmed from the
    // web app and the terminal, not only from Telegram.
    pendingApprovals,
    // Computed per call rather than captured once, so saving a credential
    // through the settings endpoint takes effect without a restart.
    isPluginConfigured: (name: string): boolean => {
      const manifest = pluginManager.getAllManifests().find((m) => m.name === name);
      if (!manifest) return false;
      return (
        resolvePluginConfig(manifest.configSchema, config.plugins?.[name] ?? {}).issues.length === 0
      );
    },
    ...(config.llm.contextWindowSize !== undefined
      ? { contextWindowSize: config.llm.contextWindowSize }
      : {}),
    maxResponseTokens: config.llm.maxResponseTokens,
  };

  const app = createApp({
    toolRouter,
    conversation: conversationDeps,
    db,
    config,
    pluginManager,
    saveConfig,
    persistConfig,
    // Advertised in the published OpenAPI document so a generated client has a
    // base URL. Absent is fine — a generator then asks for one.
    ...(process.env['TARDIS_PUBLIC_URL']
      ? { publicUrl: process.env['TARDIS_PUBLIC_URL'] }
      : {}),
    scheduler,
    memoryStore,
    ...(memoryIndexer ? { memoryIndexer } : {}),
    ...(config.auth.adminPassword !== undefined ? { adminPassword: config.auth.adminPassword } : {}),
  });

  // Serve web-ui static files (built assets from packages/web-ui/dist)
  const webUiDist = resolve(import.meta.dir, '../../web-ui/dist');
  if (existsSync(webUiDist)) {
    app.use('/*', serveStatic({ root: webUiDist }));

    // SPA fallback: serve index.html for non-API, non-file routes
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api')) {
        return c.json({ error: 'Not found' }, 404);
      }
      const html = readFileSync(join(webUiDist, 'index.html'), 'utf-8');
      return c.html(html);
    });

    console.log(`[tardis] Web UI served from ${webUiDist}`);
  } else {
    console.log('[tardis] Web UI not built — skipping static file serving');
  }

  const bunServer = Bun.serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
    // Bun closes an idle connection after 10s by default, and a chat turn spends
    // far longer than that inside a single model call. The SSE stream sends a
    // keep-alive comment to hold the socket open, but a 10s heartbeat against a
    // 10s timeout is a dead heat — curl survived it, Bun's fetch did not, and
    // the turn died at 40s with "socket connection closed unexpectedly".
    // Give the heartbeat room to win rather than tie.
    idleTimeout: 120,
  });

  console.log(`[tardis] HTTP server listening on http://${bunServer.hostname}:${bunServer.port}`);

  // 6. Start Telegram bot (if configured)
  let telegramBot: TelegramBot | null = null;

  if (config.telegram) {
    const { botToken, allowedChatIds } = config.telegram;
    telegramBot = new TelegramBot(botToken, {
      getAllManifests: () => pluginManager.getAllManifests(),
      llmProvider,
      toolRouter,
      agentConfig: config.agent,
      allowedChatIds: new Set(allowedChatIds),
      memoryRetriever,
      memoryTools: MEMORY_TOOLS,
      memoryExecutor,
      conversationStore,
      thoughtTracer,
      contextWindowSize: config.llm.contextWindowSize ?? 4096,
    });

    // Wire plugin notifications → Telegram
    notificationSenderRef.send = (msg) => telegramBot!.notify(msg);

    try {
      await telegramBot.start();
      console.log('[tardis] Telegram bot started');
    } catch (err) {
      console.error('[tardis] Telegram bot failed to start:', err instanceof Error ? err.message : String(err));
      console.error('[tardis] HTTP server still running — Telegram disabled');
      telegramBot = null;
    }
  } else {
    console.log('[tardis] Telegram not configured — skipping bot');
  }

  // 8. Start proactive scheduler
  if (config.proactive.enabled) {
    scheduler.start();
    console.log('[tardis] Proactive scheduler started (60s tick interval)');
  } else {
    console.log('[tardis] Proactive scheduler disabled in config');
  }

  // ─── Graceful shutdown ──────────────────────────────────────────────────────

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[tardis] Received ${signal} — shutting down gracefully…`);

    scheduler.stop();

    if (telegramBot) {
      telegramBot.stop(signal);
    }

    bunServer.stop(true);
    await pluginManager.unloadAll();

    console.log('[tardis] Shutdown complete');
    process.exit(0);
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[tardis] Fatal error during startup:', err);
  process.exit(1);
});
