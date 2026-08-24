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
  const { provider, model, baseUrl, apiKey, temperature } = config.llm;

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

  // 3b. Initialize memory store
  const memoryStore = new MemoryStore(db);

  const pluginManager = new PluginManager(pluginsDir, (manifest) =>
    createPluginApi({
      pluginName: manifest.name,
      permissions: manifest.permissions,
      db,
      config,
      notificationSender: (msg) => notificationSenderRef.send(msg),
      memoryStore,
    })
  );
  await pluginManager.loadAll();

  const loadedPlugins = pluginManager.getAllManifests();
  console.log(
    `[tardis] Loaded ${loadedPlugins.length} plugin(s):`,
    loadedPlugins.map((m) => m.name)
  );

  // 4. Build AI engine
  const llmProvider = buildLLMProvider(config);
  const toolRouter = new ToolRouter(pluginManager);
  const memoryRetriever = new MemoryRetriever(memoryStore, config.agent.memoryTokenBudget);
  const memoryExecutor = createMemoryExecutor(memoryStore);
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
  const app = createApp({
    db,
    config,
    pluginManager,
    saveConfig: makeSaveConfig(dataDir),
    scheduler,
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
