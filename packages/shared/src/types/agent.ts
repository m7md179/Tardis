import type { ActionType } from './plugin.js';

export interface AgentStep {
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'approval_request' | 'user_response' | 'error';
  timestamp: number;
  content: string;                   // reasoning text, or tool name, or result summary
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  durationMs?: number;
}

export interface ThoughtTrace {
  id: string;
  userMessage: string;
  steps: AgentStep[];
  finalResponse: string | null;
  totalDurationMs: number;
  modelUsed: string;
  tokenCount?: number;
  timestamp: number;
}

export interface AgentConfig {
  maxSteps: number;                  // default: 10, user-configurable
  conversationHistoryLength: number; // how many recent messages to include
  memoryTokenBudget: number;         // max tokens for memory context
  enableFallbackIntent: boolean;     // intent detection for small models
  actionOverrides: Record<string, ActionType>; // user overrides for action types
}
