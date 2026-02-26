// TARDIS v2 Core — AI engine, plugin system, memory, events
export { loadConfig, DEFAULT_DATA_DIR } from './config/config.js';
export { ConfigError } from './config/errors.js';
export { EventBus } from './events/event-bus.js';
export { PluginManager, PluginLoadError } from './plugins/plugin-manager.js';
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
export { MEMORY_TOOLS, createMemoryExecutor } from './memory/memory-tools.js';
export type { MemoryExecutor } from './memory/memory-tools.js';
export { LLMProviderError } from './llm/provider.js';
export type { LLMMessage, LLMToolCall, LLMResponse, LLMProvider } from './llm/provider.js';
export { OpenAIAdapter } from './llm/openai-adapter.js';
export type { OpenAIAdapterConfig } from './llm/openai-adapter.js';
export { OllamaAdapter } from './llm/ollama-adapter.js';
export type { OllamaAdapterConfig } from './llm/ollama-adapter.js';
export { ThoughtTracer } from './agent/thought-tracer.js';
export { selectPluginSkills } from './agent/skill-router.js';
export type { SkillSelectionResult } from './agent/skill-router.js';
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
