import type { LLMMessage } from '../llm/provider.js';

// Rough estimate: ~4 chars per token (same heuristic as memory-retriever)
const CHARS_PER_TOKEN = 4;
// Overhead per message for role/formatting tokens
const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (msg.content === null) {
      // tool_calls array — estimate from serialized tool_calls
      if (msg.tool_calls) {
        content = JSON.stringify(msg.tool_calls);
      }
    }
    total += estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS;
  }
  return total;
}
