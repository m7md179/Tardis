import { eq, and, lt, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { conversations } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { LLMMessage } from '../llm/provider.js';

/**
 * DB-backed per-chat conversation history store.
 * Replaces the in-memory Map in BotState for persistent cross-restart history.
 */
/**
 * A turn as a transcript shows it: what was asked, what ran, what came back.
 */
export interface ChatTurn {
  id: string;
  at: number;
  question: string;
  steps: {
    type: 'tool_call' | 'tool_result';
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
  }[];
  answer: string | null;
}

/**
 * A turn is one user row plus however many tool rows plus an answer. Four is a
 * generous middle — over-fetching costs a cheap indexed read, under-fetching
 * would silently return fewer turns than asked for.
 */
const ROWS_PER_TURN_ESTIMATE = 6;

type ConversationRow = {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: string | null;
  timestamp: number;
};

/**
 * Splits a chronological row list on each user message.
 *
 * An assistant row carrying `tool_calls` is a call; a `tool` row is its result;
 * an assistant row with plain content is the answer. A turn that ended on an
 * approval pause has a call with no result, which is kept as-is — showing the
 * request that stopped is more honest than hiding it.
 */
export function groupIntoTurns(rows: ConversationRow[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;

  for (const row of rows) {
    if (row.role === 'user') {
      current = { id: row.id, at: row.timestamp, question: row.content, steps: [], answer: null };
      turns.push(current);
      continue;
    }
    // Rows before the first user message belong to a turn that was paginated
    // away. Dropping them beats attaching them to the wrong question.
    if (!current) continue;

    if (row.role === 'assistant' && row.toolCalls) {
      try {
        const calls = JSON.parse(row.toolCalls) as { name: string; arguments: Record<string, unknown> }[];
        for (const call of calls) {
          current.steps.push({ type: 'tool_call', toolName: call.name, toolArgs: call.arguments });
        }
      } catch {
        // malformed row — skip the call rather than fail the whole transcript
      }
      continue;
    }

    if (row.role === 'tool') {
      let parsed: unknown = row.content;
      try {
        parsed = JSON.parse(row.content);
      } catch {
        // a tool that returned a bare string is fine as-is
      }
      current.steps.push({
        type: 'tool_result',
        toolName: row.toolName ?? '',
        toolResult: parsed,
      });
      continue;
    }

    if (row.role === 'assistant') current.answer = row.content;
  }

  return turns;
}

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

    const messages = rows.reverse().map((r): LLMMessage => {
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

    // Never start history mid-turn. The row limit can slice a turn apart and
    // leave a leading `tool` message, or an assistant message whose tool_calls
    // lost their matching result — both are invalid message sequences that
    // providers reject. Drop everything before the first user message.
    const firstUser = messages.findIndex((m) => m.role === 'user');
    return firstUser === -1 ? [] : messages.slice(firstUser);
  }

  /**
   * History grouped into turns, for showing on a screen.
   *
   * Deliberately separate from `getHistory`, which serves the *model* and is
   * capped by token budget. This serves a transcript and is capped by how much
   * someone wants to scroll — conflating the two makes one of them wrong.
   *
   * Grouping happens here rather than in each client because there are three of
   * them. Ask three clients to reassemble tool calls out of a flat message list
   * and two will get it subtly wrong; the web app and the terminal would then
   * disagree about what you said, which is worse than not showing it at all.
   */
  async getTurns(chatId: string, limit = 20, before?: number): Promise<ChatTurn[]> {
    // Walk backwards from `before` so pagination is stable while new turns land
    // at the other end. Rows are over-fetched because one turn is several rows
    // and the ratio is not fixed.
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        before === undefined
          ? eq(conversations.chatId, chatId)
          : and(eq(conversations.chatId, chatId), lt(conversations.timestamp, before))
      )
      .orderBy(desc(conversations.timestamp))
      .limit(limit * ROWS_PER_TURN_ESTIMATE);

    return groupIntoTurns(rows.reverse()).slice(-limit);
  }

  /** Delete all conversation history for a chat. */
  async clearHistory(chatId: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.chatId, chatId));
  }
}
