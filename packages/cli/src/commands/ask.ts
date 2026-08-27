import {
  loadConfig,
  OllamaAdapter,
  OpenAIAdapter,
  PluginManager,
  ToolRouter,
  selectPlugins,
  runAgentLoop,
  createPluginApi,
} from '@tardis/core';
import { createDb, migrate } from '@tardis/db';
import { join } from 'path';

/**
 * Run a single user message through the full agent pipeline and print
 * the response. Used by `tardis ask "..."`.
 */
export async function runAsk(userMessage: string, dataDir: string): Promise<void> {
  const config = loadConfig(dataDir);

  // ─── Database ───────────────────────────────────────────────────────────
  const dbPath = join(dataDir, 'tardis.db');
  migrate(dbPath);
  const db = createDb(dbPath);
  void db; // available for future thought trace saving

  // ─── LLM provider ───────────────────────────────────────────────────────
  const llm = buildLLMProvider(config);

  // ─── Plugins ────────────────────────────────────────────────────────────
  const pluginsDir = join(dataDir, 'plugins');
  const pluginManager = new PluginManager(pluginsDir, (manifest) =>
    createPluginApi({ pluginName: manifest.name, permissions: manifest.permissions, db, config })
  );
  await pluginManager.loadAll();

  const toolRouter = new ToolRouter(pluginManager);

  // ─── Skill router → agent loop ──────────────────────────────────────────
  const allManifests = pluginManager.getAllManifests();
  const { tools, selectedPlugins } = await selectPlugins(userMessage, allManifests, llm);

  const result = await runAgentLoop({
    userMessage,
    conversationHistory: [],
    memories: [],
    availableTools: tools,
    selectedPlugins,
    config: config.agent,
    llmProvider: llm,
    executeTool: toolRouter.asExecutor(),
  });

  if (result.pendingApproval) {
    console.log(result.response);
    console.log('\nThis action requires approval. Run with --approve to confirm.');
  } else {
    console.log(result.response);
  }
}

function buildLLMProvider(config: ReturnType<typeof loadConfig>): OllamaAdapter | OpenAIAdapter {
  const { provider, model, baseUrl, apiKey, temperature } = config.llm;

  if (provider === 'ollama') {
    return new OllamaAdapter({
      baseUrl: baseUrl ?? 'http://localhost:11434',
      model,
      ...(temperature !== undefined ? { temperature } : {}),
    });
  }

  // openai / groq / together / anthropic-compatible — all use OpenAI wire format
  return new OpenAIAdapter({
    baseUrl: baseUrl ?? 'https://api.openai.com/v1',
    apiKey: apiKey ?? '',
    model,
    ...(temperature !== undefined ? { temperature } : {}),
  });
}
