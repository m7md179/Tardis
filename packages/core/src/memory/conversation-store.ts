import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { conversations } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { LLMMessage } from '../llm/provider.js';

/**
 * DB-backed per-chat conversation history store.
 * Replaces the in-memory Map in BotState for persistent cross-restart history.
 */
export class ConversationStore {
  constructor(private readonly db: TardisDB) {}

  /** Append a single message to a chat's history. */
  async appendMessage(chatId: string, message: LLMMessage): Promise<void> {
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content === null
          ? ''
          : String(message.content);

    await this.db.insert(conversations).values({
      id: randomUUID(),
      chatId,
      role: message.role,
      content,
      toolName: message.name ?? null,
      toolCalls:
        message.tool_calls && message.tool_calls.length > 0
          ? JSON.stringify(message.tool_calls)
          : null,
      timestamp: Date.now(),
    });
  }

  /**
   * Fetch the last `limit` messages for a chat, in chronological order.
   * Returns messages in LLMMessage format ready for the agent loop.
   */
  async getHistory(chatId: string, limit: number): Promise<LLMMessage[]> {
    // Fetch most recent `limit` rows descending, then reverse for chronological order
    const rows = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.chatId, chatId))
      .orderBy(desc(conversations.timestamp))
      .limit(limit);

    return rows.reverse().map((r): LLMMessage => {
      const base: LLMMessage = { role: r.role as LLMMessage['role'], content: r.content };

      if (r.toolName) {
        base.name = r.toolName;
      }

      if (r.role === 'assistant' && r.toolCalls) {
        try {
          const parsed = JSON.parse(r.toolCalls) as LLMMessage['tool_calls'];
          if (parsed && parsed.length > 0) {
            base.tool_calls = parsed;
            base.content = null; // assistant tool_calls have null content
          }
        } catch {
          // malformed — leave content as-is
        }
      }

      return base;
    });
  }

  /** Delete all conversation history for a chat. */
  async clearHistory(chatId: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.chatId, chatId));
  }
}
