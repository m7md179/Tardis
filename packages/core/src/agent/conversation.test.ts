import { describe, it, expect } from 'bun:test';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { runConversationTurn, summariseForHistory } from './conversation.js';
import type { ConversationDeps } from './conversation.js';
import type { LLMProvider, LLMResponse } from '../llm/provider.js';
import { ConversationStore } from '../memory/conversation-store.js';
import { PluginManager } from '../plugins/plugin-manager.js';
import type { TurnFilter } from './turn-filters.js';
import type { AgentConfig, PluginManifest } from '@tardis/shared';
import { PluginManifestSchema } from '@tardis/shared';

const CONFIG: AgentConfig = {
  maxSteps: 5,
  conversationHistoryLength: 10,
  memoryTokenBudget: 2000,
  enableFallbackIntent: false,
  actionOverrides: {},
  readOnly: false,
};

function makeTestDb() {
  const path = `/tmp/tardis-conversation-test-${randomUUID()}.db`;
  migrate(path);
  return {
    db: createDb(path),
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

/** Answers with fixed text and records every prompt it was given. */
function echoLLM(reply: string) {
  const seen: string[] = [];
  const provider: LLMProvider = {
    name: 'mock',
    async chat({ messages }): Promise<LLMResponse> {
      const last = messages[messages.length - 1];
      seen.push(typeof last?.content === 'string' ? last.content : '');
      return { type: 'text', text: reply };
    },
    // Plugin selection asks generate(); an empty answer means "no plugins",
    // which keeps this test about filters rather than about routing.
    async generate() {
      return '';
    },
  };
  return { provider, seen };
}

function makeDeps(llm: LLMProvider, extra: Partial<ConversationDeps> = {}): ConversationDeps {
  return {
    llmProvider: llm,
    toolRouter: { asExecutor: () => async () => ({}) } as unknown as ConversationDeps['toolRouter'],
    agentConfig: CONFIG,
    getAllManifests: () => [],
    ...extra,
  };
}

describe('runConversationTurn: turn filters', () => {
  it('runs without filters exactly as before', async () => {
    const { provider } = echoLLM('an answer');
    const result = await runConversationTurn(
      { chatId: 'app', message: 'hello' },
      makeDeps(provider)
    );
    expect(result.response).toBe('an answer');
  });

  it('gives the rewritten message to the model', async () => {
    const { provider, seen } = echoLLM('ok');
    const filter: TurnFilter = {
      plugin: 'expander',
      onTurnStart: async ({ userMessage }) => ({ userMessage: `${userMessage} (expanded)` }),
    };

    await runConversationTurn(
      { chatId: 'app', message: 'wfh today' },
      makeDeps(provider, { turnFilters: [filter] })
    );

    expect(seen.some((m) => m.includes('wfh today (expanded)'))).toBe(true);
  });

  it('records the rewritten message in history, not the original', async () => {
    // The rewrite is total on purpose. Model sees one thing and history records
    // another means the next turn replays a conversation that never happened.
    const { db, cleanup } = makeTestDb();
    const store = new ConversationStore(db);
    const { provider } = echoLLM('ok');
    const filter: TurnFilter = {
      plugin: 'redactor',
      onTurnStart: async () => ({ userMessage: 'my card is [redacted]' }),
    };

    try {
      await runConversationTurn(
        { chatId: 'app', message: 'my card is 4111 1111 1111 1111' },
        makeDeps(provider, { turnFilters: [filter], conversationStore: store })
      );

      const [turn] = await store.getTurns('app', 10);
      expect(turn!.question).toBe('my card is [redacted]');
      expect(turn!.question).not.toContain('4111');
    } finally {
      cleanup();
    }
  });

  it('returns the filtered response to the caller', async () => {
    const { provider } = echoLLM('plain answer');
    const filter: TurnFilter = {
      plugin: 'signer',
      onTurnEnd: async ({ response }) => ({ response: `${response} — TARDIS` }),
    };

    const result = await runConversationTurn(
      { chatId: 'app', message: 'hi' },
      makeDeps(provider, { turnFilters: [filter] })
    );
    expect(result.response).toBe('plain answer — TARDIS');
  });

  it('stores and traces the response as delivered', async () => {
    // Otherwise the transcript and the trace disagree with what the user read,
    // which makes both useless for working out what went wrong.
    const { db, cleanup } = makeTestDb();
    const store = new ConversationStore(db);
    const { provider } = echoLLM('plain answer');
    const filter: TurnFilter = {
      plugin: 'signer',
      onTurnEnd: async ({ response }) => ({ response: `${response} — TARDIS` }),
    };

    try {
      const result = await runConversationTurn(
        { chatId: 'app', message: 'hi' },
        makeDeps(provider, { turnFilters: [filter], conversationStore: store })
      );

      expect(result.trace.finalResponse).toBe('plain answer — TARDIS');
      const [turn] = await store.getTurns('app', 10);
      expect(turn!.answer).toBe('plain answer — TARDIS');
    } finally {
      cleanup();
    }
  });

  it('delivers the turn even when every filter throws', async () => {
    // A filter that can rewrite a turn can break every turn.
    const { provider } = echoLLM('an answer');
    const boom = (plugin: string): TurnFilter => ({
      plugin,
      onTurnStart: async () => {
        throw new Error('start exploded');
      },
      onTurnEnd: async () => {
        throw new Error('end exploded');
      },
    });

    const result = await runConversationTurn(
      { chatId: 'app', message: 'hello' },
      makeDeps(provider, { turnFilters: [boom('a'), boom('b')] })
    );
    expect(result.response).toBe('an answer');
  });

  it('gives onTurnEnd the message the loop actually ran on', async () => {
    let seenByEnd = '';
    const { provider } = echoLLM('ok');
    const filters: TurnFilter[] = [
      { plugin: 'rewriter', onTurnStart: async () => ({ userMessage: 'rewritten' }) },
      {
        plugin: 'auditor',
        onTurnEnd: async (ctx) => {
          seenByEnd = ctx.userMessage;
        },
      },
    ];

    await runConversationTurn(
      { chatId: 'app', message: 'original' },
      makeDeps(provider, { turnFilters: filters })
    );
    expect(seenByEnd).toBe('rewritten');
  });
});

// ─── The seam ────────────────────────────────────────────────────────────────
//
// getTurnFilters() and runConversationTurn() are each covered above. This runs
// them together, from a plugin on disk through a real turn, because the wiring
// between them is the part no unit test sees.

describe('a plugin on disk filtering a real turn', () => {
  it('loads onTurnStart/onTurnEnd and applies both', async () => {
    const dir = `/tmp/tardis-filter-plugin-${randomUUID()}`;
    const pluginDir = join(dir, 'shouty');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'manifest.json'),
      JSON.stringify({
        name: 'shouty',
        version: '1.0.0',
        displayName: 'Shouty',
        description: 'Rewrites turns',
        summary: 'Rewrites turns for testing.',
        tier: 1,
        main: 'index.ts',
        permissions: [],
        tools: [
          {
            name: 'shouty.noop',
            description: 'Does nothing',
            parameters: { type: 'object', properties: {} },
            actionType: 'direct',
          },
        ],
      })
    );
    writeFileSync(
      join(pluginDir, 'index.ts'),
      `export const onActivate = async () => {};
       export const executeTool = async () => ({});
       export const onTurnStart = async ({ userMessage }) => ({ userMessage: userMessage.toUpperCase() });
       export const onTurnEnd = async ({ response }) => ({ response: response + ' [checked]' });`
    );

    const manager = new PluginManager(dir, () => ({}) as never);
    await manager.loadAll();

    try {
      const filters = manager.getTurnFilters();
      expect(filters).toHaveLength(1);

      const { provider, seen } = echoLLM('an answer');
      const result = await runConversationTurn(
        { chatId: 'app', message: 'quiet please' },
        makeDeps(provider, { turnFilters: filters })
      );

      expect(seen.some((m) => m.includes('QUIET PLEASE'))).toBe(true);
      expect(result.response).toBe('an answer [checked]');
    } finally {
      await manager.unloadAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Unconfigured plugins ────────────────────────────────────────────────────
//
// Live: "what do i have in to do" routed to Todoist, which has never had an API
// token, and answered with a configuration error — while 135 real work items sat
// in a plugin that *is* configured. A capability that always fails is not one.

describe('runConversationTurn: plugins that cannot work', () => {
  function manifest(name: string, summary: string): PluginManifest {
    return PluginManifestSchema.parse({
      name,
      version: '1.0.0',
      displayName: name,
      description: `${name} plugin`,
      summary,
      tier: 1,
      main: 'index.ts',
      permissions: [],
      skills: [
        {
          id: `${name}.list`,
          description: `List ${name} things`,
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
  }

  const MANIFESTS = [
    manifest('todoist', 'Manage tasks and to-dos in Todoist.'),
    manifest('workspace', 'Work items, boards and backlogs.'),
  ];

  /** The tool names the model was actually offered. */
  function toolCaptor() {
    const seen: string[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      async chat({ tools }) {
        for (const t of tools ?? []) seen.push(t.name);
        return { type: 'text', text: 'ok' };
      },
      async generate() {
        return '';
      },
    };
    return { provider, seen };
  }

  it('keeps an unconfigured plugin out of the router', async () => {
    // Asserted on the tools the model receives, not on the router's own
    // prompt: with a small plugin set the router takes a fallback path and
    // never asks the model at all, so instrumenting that would prove nothing.
    const { provider, seen } = toolCaptor();

    await runConversationTurn(
      { chatId: 'app', message: 'what do i have in to do' },
      makeDeps(provider, {
        getAllManifests: () => MANIFESTS,
        isPluginConfigured: (n) => n !== 'todoist',
      })
    );

    expect(seen).toContain('workspace.list');
    expect(seen).not.toContain('todoist.list');
  });

  it('offers every plugin when nothing reports its configuration', async () => {
    // The old behaviour, kept for any caller that does not supply the check.
    const { provider, seen } = toolCaptor();

    await runConversationTurn(
      { chatId: 'app', message: 'what do i have in to do' },
      makeDeps(provider, { getAllManifests: () => MANIFESTS })
    );

    expect(seen).toContain('workspace.list');
    expect(seen).toContain('todoist.list');
  });

  it('still names it when asked what TARDIS can do, marked as needing setup', async () => {
    // Hidden from the router is not hidden from the user — otherwise a plugin
    // they installed becomes invisible with no way to find out why.
    const { provider } = echoLLM('unused');
    const result = await runConversationTurn(
      { chatId: 'app', message: 'what can you do' },
      makeDeps(provider, {
        getAllManifests: () => MANIFESTS,
        isPluginConfigured: (n) => n !== 'todoist',
      })
    );

    expect(result.response).toContain('todoist');
    expect(result.response).toMatch(/todoist.*needs setup/i);
    expect(result.response).toContain('workspace');
    expect(result.response).not.toMatch(/workspace.*needs setup/i);
  });
});

// ─── What gets written to history ────────────────────────────────────────────
//
// One workspace.my-items call over 135 items stored a single 9,598-token
// message. Every later question in that thread re-sent it: "hi" cost 62 seconds
// on that thread against 4 on a fresh one.

describe('summariseForHistory', () => {
  it('leaves a small result exactly as it was', () => {
    const small = { success: true, message: 'Done.' };
    expect(JSON.parse(summariseForHistory(small))).toEqual(small);
  });

  it('keeps the scalars, which is where the answer usually is', () => {
    const big = {
      count: 135,
      success: true,
      message: '135 items',
      items: Array.from({ length: 135 }, (_, i) => ({ id: i, title: 'x'.repeat(80) })),
    };
    const out = JSON.parse(summariseForHistory(big)) as Record<string, unknown>;
    expect(out['count']).toBe(135);
    expect(out['success']).toBe(true);
    expect(out['message']).toBe('135 items');
  });

  it('replaces a long array with an honest note about what was there', () => {
    const big = { count: 135, items: Array.from({ length: 135 }, (_, i) => ({ id: i, t: 'x'.repeat(80) })) };
    const out = JSON.parse(summariseForHistory(big)) as Record<string, unknown>;
    expect(out['items']).toBe('[135 items, not kept in history]');
    expect(out['truncated']).toBe(true);
  });

  it('shrinks the stored message by an order of magnitude', () => {
    const big = { count: 135, items: Array.from({ length: 135 }, (_, i) => ({ id: i, t: 'x'.repeat(80) })) };
    const before = JSON.stringify(big).length;
    const after = summariseForHistory(big).length;
    expect(before).toBeGreaterThan(10_000);
    expect(after).toBeLessThan(before / 10);
  });

  it('truncates a long bare string without pretending it is complete', () => {
    const out = JSON.parse(summariseForHistory('y'.repeat(9000))) as Record<string, unknown>;
    expect(out['truncated']).toBe(true);
    // The length reported is of the JSON encoding, so it is 9002 with the
    // quotes — assert the shape rather than an off-by-two.
    expect(String(out['note'])).toMatch(/Result of 90\d\d characters/);
  });

  it('handles null and undefined without throwing', () => {
    expect(summariseForHistory(null)).toBe('null');
    expect(summariseForHistory(undefined)).toBe('null');
  });
});
