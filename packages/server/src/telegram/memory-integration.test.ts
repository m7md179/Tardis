import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import {
  MemoryStore,
  MemoryRetriever,
  ConversationStore,
  MEMORY_TOOLS,
  createMemoryExecutor,
} from '@tardis/core';
import type { LLMProvider, ToolRouter } from '@tardis/core';
import type { AgentConfig } from '@tardis/shared';
import { handleUserMessage, createBotState } from './bot.js';
import type { BotDeps } from './bot.js';

// ─── Real-DB integration: the memory save → persist → retrieve cycle ──────────
//
// Regression insurance for the state found on 2026-08-26: the memories table
// had 0 rows in production because the model never called memory.save. The
// root cause (system prompt section ordering) is covered by unit tests in
// agent-loop.test.ts; this file locks in the plumbing around it, against a
// real sqlite database rather than a recording stub.

const CHAT_ID = 123;

const AGENT_CONFIG: AgentConfig = {
  maxSteps: 10,
  conversationHistoryLength: 20,
  memoryTokenBudget: 2000,
  enableFallbackIntent: false,
  actionOverrides: {},
};

describe('memory integration (real sqlite)', () => {
  let path: string;
  let store: MemoryStore;
  let retriever: MemoryRetriever;
  let conversationStore: ConversationStore;
  let deps: BotDeps;

  beforeEach(() => {
    path = `/tmp/tardis-mem-integration-${randomUUID()}.db`;
    migrate(path);
    const db = createDb(path);
    store = new MemoryStore(db);
    retriever = new MemoryRetriever(store, AGENT_CONFIG.memoryTokenBudget);
    conversationStore = new ConversationStore(db);

    // Scripted: save the fact, then answer. Mirrors what the live model does
    // now that the prompt ordering is fixed.
    let call = 0;
    const llmProvider: LLMProvider = {
      name: 'mock',
      async chat() {
        call++;
        if (call === 1) {
          return {
            type: 'tool_call' as const,
            toolName: 'memory.save',
            toolArgs: {
              key: 'dietary_restriction',
              value: 'does not eat pork',
              type: 'user_fact',
            },
            toolCallId: 'call_1',
          };
        }
        return { type: 'text' as const, text: 'Noted.' };
      },
      async generate() {
        return '[]';
      },
    };

    deps = {
      getAllManifests: () => [],
      llmProvider,
      toolRouter: {
        execute: async () => ({ success: true as const, data: { ok: true } }),
        asExecutor: () => async () => ({ ok: true }),
      } as unknown as ToolRouter,
      agentConfig: AGENT_CONFIG,
      allowedChatIds: new Set(),
      memoryRetriever: retriever,
      memoryTools: MEMORY_TOOLS,
      memoryExecutor: createMemoryExecutor(store),
      conversationStore,
    };
  });

  afterEach(() => {
    if (existsSync(path)) unlinkSync(path);
  });

  it('writes a real row to the memories table when the model calls memory.save', async () => {
    await handleUserMessage(CHAT_ID, "I don't eat pork", createBotState(), deps);

    const saved = await store.getByKey('dietary_restriction');
    expect(saved).not.toBeNull();
    expect(saved!.value).toBe('does not eat pork');
    expect(saved!.type).toBe('user_fact');
    // Written by the agent, not a plugin or the user.
    expect(saved!.source).toBe('agent');
  });

  it('persists the memory tool call into conversation history, not just the reply', async () => {
    await handleUserMessage(CHAT_ID, "I don't eat pork", createBotState(), deps);

    const history = await conversationStore.getHistory(String(CHAT_ID), 50);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    // The tool_call turn must carry the call itself. Without this the stored
    // history reads as "user asks → assistant confirms", which is exactly what
    // taught the model it could claim success without acting.
    expect(history[1]!.content).toBeNull();
    expect(history[1]!.tool_calls?.[0]?.name).toBe('memory.save');
    expect(history[1]!.tool_calls?.[0]?.arguments).toMatchObject({
      key: 'dietary_restriction',
      value: 'does not eat pork',
    });
    expect(history[2]!.name).toBe('memory.save');
    expect(history[3]!.content).toBe('Noted.');
  });

  it('retrieves the saved fact on a later message that shares keywords', async () => {
    await handleUserMessage(CHAT_ID, "I don't eat pork", createBotState(), deps);

    // The full cycle: saved in one turn, surfaced in a later one.
    const recalled = await retriever.getRelevant('do I eat pork?');
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.key).toBe('dietary_restriction');
    expect(recalled[0]!.value).toBe('does not eat pork');
  });

  it('does not surface the fact for a paraphrase with no shared keywords', async () => {
    await handleUserMessage(CHAT_ID, "I don't eat pork", createBotState(), deps);

    // Known limitation of the keyword-only retriever, asserted deliberately so
    // it is a documented property rather than a surprise. Confirmed against the
    // live model: "bacon" does not reach "pork".
    const recalled = await retriever.getRelevant('can I have bacon for breakfast?');
    expect(recalled).toEqual([]);
  });

  it('still surfaces a durable fact after the 7-day recency bonus has fully decayed', async () => {
    await handleUserMessage(CHAT_ID, "I don't eat pork", createBotState(), deps);

    const saved = await store.getByKey('dietary_restriction');
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await store.create({
      type: 'user_fact',
      key: 'unrelated_recent',
      value: 'something else entirely',
    });

    // Age the pork fact well past the decay window.
    const db = createDb(path);
    const { memories, eq } = await import('@tardis/db');
    await db
      .update(memories)
      .set({ updatedAt: thirtyDaysAgo, accessedAt: thirtyDaysAgo })
      .where(eq(memories.id, saved!.id));

    // Recency only affects ranking, never inclusion — a keyword hit is required
    // and sufficient, so a stale-but-true fact must still come back.
    const recalled = await retriever.getRelevant('do I eat pork?');
    expect(recalled.map((m) => m.key)).toContain('dietary_restriction');
  });
});
