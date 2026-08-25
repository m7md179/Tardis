import type { LLMMessage } from '../llm/provider.js';
import { contentToText, countImages } from '../llm/provider.js';

// Rough estimate: ~4 chars per token (same heuristic as memory-retriever)
const CHARS_PER_TOKEN = 4;
// Overhead per message for role/formatting tokens
const MESSAGE_OVERHEAD_TOKENS = 4;
/**
 * Rough cost of one image. Measured against the live gemma-4-E2B server: a
 * 64x64 PNG produced 71 prompt tokens where the text alone was ~7, so roughly
 * 64 tokens per image. Larger photos cost more; this is a floor that keeps the
 * context budget honest rather than pretending images are free.
 */
const IMAGE_TOKENS = 64;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    let content = contentToText(msg.content);
    if (msg.content === null && msg.tool_calls) {
      // tool_calls array — estimate from serialized tool_calls
      content = JSON.stringify(msg.tool_calls);
    }
    total +=
      estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS + countImages(msg.content) * IMAGE_TOKENS;
  }
  return total;
}
