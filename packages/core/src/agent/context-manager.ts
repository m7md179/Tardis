import type { ToolDefinition } from '@tardis/shared';
import type { LLMMessage } from '../llm/provider.js';
import { estimateTokens, estimateMessagesTokens } from './token-estimator.js';

export interface FitToContextWindowOptions {
  systemPrompt: string;
  conversationHistory: LLMMessage[];
  userMessage: string;
  tools?: ToolDefinition[];
  contextWindowSize: number;
}

/**
 * Trims conversation history to fit within the model's context window.
 *
 * Budget allocation:
 *   - System prompt + user message + tool schemas = reserved (non-negotiable)
 *   - Remaining budget → conversation history (oldest messages trimmed first)
 *
 * Returns the trimmed history that fits within budget. If even the reserved
 * content exceeds the budget, returns an empty array so the LLM at least
 * gets the current turn.
 */
export function fitToContextWindow(opts: FitToContextWindowOptions): LLMMessage[] {
  const { systemPrompt, conversationHistory, userMessage, tools, contextWindowSize } = opts;

  // Leave a safety margin (10% or 200 tokens) for completion
  const safetyMargin = Math.max(200, Math.floor(contextWindowSize * 0.1));
  const budget = contextWindowSize - safetyMargin;

  // Calculate reserved tokens
  const systemTokens = estimateTokens(systemPrompt) + 4; // 4 overhead for system role
  const userTokens = estimateTokens(userMessage) + 4;
  const toolsTokens = tools && tools.length > 0
    ? estimateTokens(JSON.stringify(tools)) + 4
    : 0;

  const reservedTokens = systemTokens + userTokens + toolsTokens;

  if (reservedTokens >= budget) {
    // Can't fit even the current turn — return empty history
    return [];
  }

  const historyBudget = budget - reservedTokens;
  const historyTokens = estimateMessagesTokens(conversationHistory);

  if (historyTokens <= historyBudget) {
    // All history fits — no trimming needed
    return conversationHistory;
  }

  // Trim oldest messages first until it fits
  let trimmed = [...conversationHistory];
  while (trimmed.length > 0 && estimateMessagesTokens(trimmed) > historyBudget) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}
