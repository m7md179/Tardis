// TARDIS v2 Core — AI engine, plugin system, memory, events
export { loadConfig, DEFAULT_DATA_DIR } from './config/config.js';
export { ConfigError } from './config/errors.js';
export { EventBus } from './events/event-bus.js';
export { PluginManager, PluginLoadError } from './plugins/plugin-manager.js';
export type { RegisteredSkill } from './plugins/plugin-manager.js';
export {
  ManifestValidationError,
  validateManifest,
  validatePermissions,
  checkDuplicateToolNames,
} from './plugins/manifest-validator.js';
export {
  PermissionGuard,
  PermissionDeniedError,
  ALL_PERMISSIONS,
} from './plugins/permission-guard.js';
export type { Permission } from './plugins/permission-guard.js';
export { createPluginApi } from './plugins/plugin-api.js';
export type {
  PluginAPI,
  StorageAPI,
  LoggerAPI,
  EventsAPI,
  ConfigAPI,
  MemoryAPI,
} from './plugins/plugin-api.js';
export { MemoryStore } from './memory/memory-store.js';
export type { CreateMemoryParams } from './memory/memory-store.js';
export { MemoryRetriever } from './memory/memory-retriever.js';
export { MemoryIndexer } from './memory/memory-indexer.js';
export type { ReindexResult } from './memory/memory-indexer.js';
export { OllamaEmbedder, cosine, embeddableText, vectorToBlob, blobToVector } from './memory/embeddings.js';
export type { Embedder } from './memory/embeddings.js';
export { leadingCluster, VECTOR_MARGIN, MAX_VECTOR_CANDIDATES } from './memory/vector-search.js';
export { MEMORY_TOOLS, createMemoryExecutor } from './memory/memory-tools.js';
export type { MemoryExecutor } from './memory/memory-tools.js';
export { ConversationStore } from './memory/conversation-store.js';
export { fitToContextWindow } from './agent/context-manager.js';
export { estimateTokens, estimateMessagesTokens } from './agent/token-estimator.js';
export { ProactiveScheduler } from './proactive/scheduler.js';
export type { TriggerHandler, TriggerInfo, ProactiveLogEntry } from './proactive/scheduler.js';
export { isTimeToRun, isDuringQuietHours } from './proactive/cron-utils.js';
export { LLMProviderError } from './llm/provider.js';
export type { LLMMessage, LLMToolCall, LLMResponse, LLMProvider } from './llm/provider.js';
export { OpenAIAdapter } from './llm/openai-adapter.js';
export type { OpenAIAdapterConfig } from './llm/openai-adapter.js';
export { OllamaAdapter } from './llm/ollama-adapter.js';
export type { OllamaAdapterConfig } from './llm/ollama-adapter.js';
export { ThoughtTracer } from './agent/thought-tracer.js';
export { selectPlugins } from './agent/plugin-router.js';
export { CLARIFY_TOOL, CLARIFY_TOOL_NAME } from './agent/clarify.js';
export { resolvePermission, baselineFor, matchesGlob } from './agent/permissions.js';
export { runConversationTurn } from './agent/conversation.js';
export type {
  ConversationDeps,
  ConversationTurnInput,
  ConversationTurnResult,
} from './agent/conversation.js';
export type { PluginSelectionResult } from './agent/plugin-router.js';
export { ToolRouter } from './agent/tool-router.js';
export type { ToolResult, ToolResultCode } from './agent/tool-router.js';
export { runAgentLoop } from './agent/agent-loop.js';
export type { AgentLoopInput, AgentLoopOutput, PendingApproval } from './agent/agent-loop.js';
export {
  detectIntent,
  registerIntentPattern,
  unregisterIntentPatterns,
  getRegisteredPatterns,
} from './llm/fallback-intent.js';
export type { IntentPattern, IntentDetectionResult } from './llm/fallback-intent.js';
