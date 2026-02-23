import type { ToolDefinition } from '@tardis/shared';

/**
 * A message in the LLM conversation history.
 * Follows the OpenAI chat message format, which most providers support.
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string; // for tool messages: the tool name
  tool_calls?: LLMToolCall[]; // for assistant messages that call tools
}

/**
 * A tool call made by the LLM inside an assistant message.
 */
export interface LLMToolCall {
  id: string; // unique call id, used to match tool results
  name: string; // tool name, e.g. "time-tracker.start"
  arguments: Record<string, unknown>;
}

/**
 * Normalized response from an LLM provider.
 * Either a text response (done) or a tool call (act).
 */
export interface LLMResponse {
  type: 'text' | 'tool_call';
  // Present when type === 'text'
  text?: string;
  // Present when type === 'tool_call'
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string; // used to send the result back as a tool message
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Unified interface all LLM adapters must implement.
 *
 * Two methods:
 * - chat()     — Full agentic chat with tool calling support (used by the agent loop)
 * - generate() — Simple prompt → text, no tools (used by plugins and skill router)
 */
export interface LLMProvider {
  /** Human-readable name, e.g. "ollama", "openai" */
  readonly name: string;

  /**
   * Send a multi-turn conversation to the LLM with optional tool schemas.
   * Returns either a text response (conversation done) or a single tool call.
   */
  chat(params: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse>;

  /**
   * Simple text generation — no tool calling, no history.
   * Used by the skill router and Tier 2/3 plugin LLMs.
   */
  generate(params: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
}

/**
 * Error thrown by LLM adapters for connection / API failures.
 */
export class LLMProviderError extends Error {
  readonly code: string;
  readonly providerName: string;

  constructor(providerName: string, code: string, message: string) {
    super(message);
    this.name = 'LLMProviderError';
    this.code = code;
    this.providerName = providerName;
  }
}
