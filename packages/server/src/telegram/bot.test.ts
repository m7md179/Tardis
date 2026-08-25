import { describe, it, expect, beforeEach } from 'bun:test';
import {
  handleUserMessage,
  handleNewCommand,
  handlePluginsCommand,
  handleStatusCommand,
  createBotState,
  isApprovalText,
} from './bot.js';
import type { BotDeps, BotState } from './bot.js';
import type {
  ToolRouter,
  LLMProvider,
  ThoughtTracer,
  ConversationStore,
  LLMMessage,
} from '@tardis/core';
import type { AgentConfig, PluginManifest, ThoughtTrace, ToolDefinition } from '@tardis/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxSteps: 10,
  conversationHistoryLength: 5,
  memoryTokenBudget: 2000,
  enableFallbackIntent: false,
  actionOverrides: {},
};

function makeTool(name: string, actionType: 'direct' | 'workflow' = 'direct'): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    actionType,
  };
}

function makeManifest(name: string, tools: ToolDefinition[] = []): PluginManifest {
  return {
    name,
    version: '1.0.0',
    displayName: name,
    description: `${name} plugin`,
    tier: 1,
    main: 'index.ts',
    summary: `${name} skill summary`,
    permissions: [],
    tools,
  };
}

/** Build a minimal BotDeps with sensible defaults — override what you need. */
function makeDeps(overrides: Partial<BotDeps> = {}): BotDeps {
  return {
    getAllManifests: () => [],
    llmProvider: {
      name: 'mock',
      async chat() {
        return { type: 'text' as const, text: 'Hello from TARDIS!' };
      },
      async generate() {
        return '[]';
      },
    } satisfies LLMProvider,
    toolRouter: {
      execute: async () => ({ success: true as const, data: { ok: true } }),
      asExecutor: () => async () => ({ ok: true }),
    } as unknown as ToolRouter,
    agentConfig: DEFAULT_AGENT_CONFIG,
    allowedChatIds: new Set(),
    ...overrides,
  };
}

// ─── isApprovalText ───────────────────────────────────────────────────────────

describe('isApprovalText', () => {
  it('returns true for "yes"', () => expect(isApprovalText('yes')).toBe(true));
  it('returns true for "y"', () => expect(isApprovalText('y')).toBe(true));
  it('returns true for "ok"', () => expect(isApprovalText('ok')).toBe(true));
  it('returns true for "YES" (case-insensitive)', () => expect(isApprovalText('YES')).toBe(true));
  it('returns false for "no"', () => expect(isApprovalText('no')).toBe(false));
  it('returns false for "cancel"', () => expect(isApprovalText('cancel')).toBe(false));
  it('returns false for arbitrary text', () => expect(isApprovalText('hello')).toBe(false));
});

// ─── Authorization ────────────────────────────────────────────────────────────

describe('handleUserMessage: authorization', () => {
  it('returns Unauthorized when chatId is not in allowedChatIds', async () => {
    const state = createBotState();
    const deps = makeDeps({ allowedChatIds: new Set(['999']) });

    const response = await handleUserMessage(123, 'hello', state, deps);
    expect(response.text).toBe('Unauthorized.');
  });

  it('allows the message when chatId is in allowedChatIds', async () => {
    const state = createBotState();
    const deps = makeDeps({ allowedChatIds: new Set(['123']) });

    const response = await handleUserMessage(123, 'hello', state, deps);
    expect(response.text).not.toBe('Unauthorized.');
  });

  it('allows all chats when allowedChatIds is empty', async () => {
    const state = createBotState();
    const deps = makeDeps({ allowedChatIds: new Set() });

    const response = await handleUserMessage(9999, 'hello', state, deps);
    expect(response.text).not.toBe('Unauthorized.');
  });
});

// ─── Normal message flow ──────────────────────────────────────────────────────

describe('handleUserMessage: normal flow', () => {
  it('returns the LLM text response', async () => {
    const state = createBotState();
    const deps = makeDeps({
      llmProvider: {
        name: 'mock',
        async chat() {
          return { type: 'text' as const, text: 'Sure, I can help!' };
        },
        async generate() {
          return '[]';
        },
      },
    });

    const response = await handleUserMessage(1, 'hello', state, deps);
    expect(response.text).toBe('Sure, I can help!');
  });

  it('passes conversation history to the agent loop on subsequent messages', async () => {
    const state = createBotState();
    let capturedHistoryLength = 0;

    const deps = makeDeps({
      llmProvider: {
        name: 'mock',
        async chat({ messages }) {
          capturedHistoryLength = messages.length;
          return { type: 'text' as const, text: 'Reply' };
        },
        async generate() {
          return '[]';
        },
      },
    });

    // First message — history is empty so messages = [system, user]
    await handleUserMessage(1, 'First message', state, deps);
    const firstLen = capturedHistoryLength;

    // Second message — history now has 2 entries so messages = [system, user, assistant, user]
    await handleUserMessage(1, 'Second message', state, deps);

    expect(capturedHistoryLength).toBeGreaterThan(firstLen);
  });

  it('caps conversation history at conversationHistoryLength * 2', async () => {
    const state = createBotState();
    const deps = makeDeps({
      agentConfig: { ...DEFAULT_AGENT_CONFIG, conversationHistoryLength: 2 },
      llmProvider: {
        name: 'mock',
        async chat() {
          return { type: 'text' as const, text: 'ok' };
        },
        async generate() {
          return '[]';
        },
      },
    });

    // Send 5 messages — history should cap at 2 * 2 = 4 LLMMessages
    for (let i = 0; i < 5; i++) {
      await handleUserMessage(1, `msg ${i}`, state, deps);
    }

    const history = state.conversationHistory.get(1) ?? [];
    expect(history.length).toBeLessThanOrEqual(4);
  });

  it('returns friendly error message when agent throws', async () => {
    const state = createBotState();
    const deps = makeDeps({
      llmProvider: {
        name: 'mock',
        async chat() {
          throw new Error('LLM connection refused');
        },
        async generate() {
          return '[]';
        },
      },
    });

    const response = await handleUserMessage(1, 'hello', state, deps);
    expect(response.text).toContain('Something went wrong');
    expect(response.text).toContain('LLM connection refused');
  });
});

// ─── Pending approval flow ────────────────────────────────────────────────────

describe('handleUserMessage: workflow approval', () => {
  let state: BotState;
  let deps: BotDeps;
  const CHAT_ID = 42;
  const WORKFLOW_TOOL = makeTool('todoist.delete-task', 'workflow');

  beforeEach(() => {
    state = createBotState();
    deps = makeDeps({
      getAllManifests: () => [makeManifest('todoist', [WORKFLOW_TOOL])],
      llmProvider: {
        name: 'mock',
        async chat() {
          return {
            type: 'tool_call' as const,
            toolName: 'todoist.delete-task',
            toolArgs: { taskId: 'task_1' },
            toolCallId: 'call_1',
          };
        },
        // generate() selects the todoist plugin so its workflow tool is loaded
        async generate() {
          return '["todoist"]';
        },
      },
    });
  });

  it('first message triggers pendingApproval and appends "Approve? (yes/no)"', async () => {
    const response = await handleUserMessage(CHAT_ID, 'delete that task', state, deps);

    expect(state.pendingApprovals.has(CHAT_ID)).toBe(true);
    expect(response.text).toContain('Approve? (yes/no)');
  });

  it('"yes" executes the pending tool and clears the approval', async () => {
    // Trigger approval
    await handleUserMessage(CHAT_ID, 'delete that task', state, deps);
    expect(state.pendingApprovals.has(CHAT_ID)).toBe(true);

    // Approve
    const response = await handleUserMessage(CHAT_ID, 'yes', state, deps);
    expect(state.pendingApprovals.has(CHAT_ID)).toBe(false);
    expect(response.text).toContain('Done.');
  });

  it('"no" cancels without executing the tool', async () => {
    let toolExecuted = false;
    deps = makeDeps({
      ...deps,
      toolRouter: {
        execute: async () => {
          toolExecuted = true;
          return { success: true as const, data: {} };
        },
        asExecutor: () => async () => {
          throw new Error('should not be called');
        },
      } as unknown as ToolRouter,
    });

    // Trigger approval
    await handleUserMessage(CHAT_ID, 'delete that task', state, deps);

    // Reject
    const response = await handleUserMessage(CHAT_ID, 'no', state, deps);
    expect(response.text).toBe('Cancelled.');
    expect(toolExecuted).toBe(false);
    expect(state.pendingApprovals.has(CHAT_ID)).toBe(false);
  });

  it('approval cleared after "yes" — next message goes through agent normally', async () => {
    const normalDeps = makeDeps({
      llmProvider: {
        name: 'mock',
        async chat() {
          return { type: 'text' as const, text: 'Normal reply' };
        },
        async generate() {
          return '[]';
        },
      },
    });

    // Seed a pending approval manually
    state.pendingApprovals.set(CHAT_ID, {
      toolName: 'todoist.delete-task',
      args: { taskId: 'task_1' },
      preview: 'Delete task_1',
    });

    await handleUserMessage(CHAT_ID, 'yes', state, normalDeps);
    expect(state.pendingApprovals.has(CHAT_ID)).toBe(false);

    // Next message should go through agent
    const response = await handleUserMessage(CHAT_ID, 'hello', state, normalDeps);
    expect(response.text).toBe('Normal reply');
  });

  it('tool execution failure returns error message', async () => {
    deps = makeDeps({
      ...deps,
      toolRouter: {
        execute: async () => ({
          success: false as const,
          error: 'Task not found',
          code: 'EXECUTION_ERROR' as const,
        }),
        asExecutor: () => async () => ({}),
      } as unknown as ToolRouter,
    });

    // Trigger approval
    await handleUserMessage(CHAT_ID, 'delete task', state, deps);

    // Approve — but execution fails
    const response = await handleUserMessage(CHAT_ID, 'yes', state, deps);
    expect(response.text).toContain('Failed');
    expect(response.text).toContain('Task not found');
  });
});

// ─── /new command ─────────────────────────────────────────────────────────────

describe('handleNewCommand', () => {
  it('clears conversation history for the chat', async () => {
    const state = createBotState();
    state.conversationHistory.set(1, [{ role: 'user', content: 'hello' }]);

    await handleNewCommand(1, state);
    expect(state.conversationHistory.has(1)).toBe(false);
  });

  it('clears pending approvals for the chat', async () => {
    const state = createBotState();
    state.pendingApprovals.set(1, { toolName: 'x', args: {}, preview: 'x' });

    await handleNewCommand(1, state);
    expect(state.pendingApprovals.has(1)).toBe(false);
  });

  it('returns a confirmation message', async () => {
    const response = await handleNewCommand(1, createBotState());
    expect(response.text).toContain('cleared');
  });

  it('does not affect other chats', async () => {
    const state = createBotState();
    state.conversationHistory.set(2, [{ role: 'user', content: 'other' }]);

    await handleNewCommand(1, state);
    expect(state.conversationHistory.has(2)).toBe(true);
  });
});

// ─── /plugins command ─────────────────────────────────────────────────────────

describe('handlePluginsCommand', () => {
  it('returns "No plugins loaded" when list is empty', () => {
    const deps = makeDeps({ getAllManifests: () => [] });
    expect(handlePluginsCommand(deps).text).toContain('No plugins loaded');
  });

  it('lists plugin names and tiers', () => {
    const deps = makeDeps({
      getAllManifests: () => [makeManifest('time-tracker'), makeManifest('todoist')],
    });
    const { text } = handlePluginsCommand(deps);
    expect(text).toContain('time-tracker');
    expect(text).toContain('todoist');
    expect(text).toContain('Tier 1');
  });
});

// ─── /status command ──────────────────────────────────────────────────────────

describe('handleStatusCommand', () => {
  it('reports 0 exchanges when history is empty', () => {
    const { text } = handleStatusCommand(1, createBotState());
    expect(text).toContain('0 exchange');
  });

  it('counts exchanges correctly from history length', () => {
    const state = createBotState();
    // 4 messages = 2 exchanges
    state.conversationHistory.set(1, [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]);
    const { text } = handleStatusCommand(1, state);
    expect(text).toContain('2 exchange');
  });

  it('shows pending approval indicator when approval is waiting', () => {
    const state = createBotState();
    state.pendingApprovals.set(1, { toolName: 'x', args: {}, preview: 'x' });
    const { text } = handleStatusCommand(1, state);
    expect(text).toContain('approval');
  });

  it('does not show pending indicator when no approval is waiting', () => {
    const { text } = handleStatusCommand(1, createBotState());
    expect(text).not.toContain('approval');
  });
});

// ─── Thought trace persistence ────────────────────────────────────────────────

describe('handleUserMessage: thought trace persistence', () => {
  const CHAT_ID = 99;

  it('saves the thought trace after the agent loop completes', async () => {
    const saved: ThoughtTrace[] = [];
    const deps = makeDeps({
      thoughtTracer: {
        save: async (trace: ThoughtTrace) => {
          saved.push(trace);
        },
      } as unknown as ThoughtTracer,
    });

    const response = await handleUserMessage(CHAT_ID, 'hello there', createBotState(), deps);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.userMessage).toBe('hello there');
    expect(saved[0]?.finalResponse).toBe('Hello from TARDIS!');
    expect(saved[0]?.steps.length).toBeGreaterThan(0);
    expect(response.text).toBe('Hello from TARDIS!');
  });

  it('still replies normally when saving the trace fails', async () => {
    const deps = makeDeps({
      thoughtTracer: {
        save: async () => {
          throw new Error('database is locked');
        },
      } as unknown as ThoughtTracer,
    });

    const response = await handleUserMessage(CHAT_ID, 'hello there', createBotState(), deps);

    // A tracing failure must not surface as an error to the user.
    expect(response.text).toBe('Hello from TARDIS!');
    expect(response.text).not.toContain('Something went wrong');
  });

  it('works fine when no tracer is configured', async () => {
    const response = await handleUserMessage(CHAT_ID, 'hello there', createBotState(), makeDeps());
    expect(response.text).toBe('Hello from TARDIS!');
  });
});

// ─── Tool calls in persisted conversation history ─────────────────────────────

describe('handleUserMessage: tool calls persisted to history', () => {
  const CHAT_ID = 77;
  const DIRECT_TOOL = makeTool('reminders.set-reminder', 'direct');
  const WORKFLOW_TOOL = makeTool('todoist.delete-task', 'workflow');

  /** Recording conversation store — captures what the bot writes. */
  function makeRecordingStore(): { written: LLMMessage[]; store: ConversationStore } {
    const written: LLMMessage[] = [];
    const store = {
      appendMessage: async (_chatId: string, message: LLMMessage) => {
        written.push(message);
      },
      getHistory: async () => [],
      clearHistory: async () => {},
    } as unknown as ConversationStore;
    return { written, store };
  }

  /** LLM that calls a tool once, then replies with text on the next turn. */
  function toolThenTextProvider(toolName: string): LLMProvider {
    let called = false;
    return {
      name: 'mock',
      async chat() {
        if (!called) {
          called = true;
          return {
            type: 'tool_call' as const,
            toolName,
            toolArgs: { message: 'walk', delayMinutes: 5 },
            toolCallId: 'call_1',
          };
        }
        return { type: 'text' as const, text: 'Reminder set.' };
      },
      async generate() {
        return '["reminders"]';
      },
    } satisfies LLMProvider;
  }

  it('writes the assistant tool_call and the tool result, not just the final text', async () => {
    const { written, store } = makeRecordingStore();
    const deps = makeDeps({
      getAllManifests: () => [makeManifest('reminders', [DIRECT_TOOL])],
      llmProvider: toolThenTextProvider('reminders.set-reminder'),
      conversationStore: store,
    });

    await handleUserMessage(CHAT_ID, 'remind me to walk in 5 minutes', createBotState(), deps);

    expect(written.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    // The assistant tool_call turn carries the call, with null content.
    const toolCallMsg = written[1]!;
    expect(toolCallMsg.content).toBeNull();
    expect(toolCallMsg.tool_calls?.[0]?.name).toBe('reminders.set-reminder');
    expect(toolCallMsg.tool_calls?.[0]?.arguments).toEqual({ message: 'walk', delayMinutes: 5 });

    // The tool result is linked by name, which the adapter maps to tool_call_id.
    expect(written[2]!.name).toBe('reminders.set-reminder');
    expect(written[2]!.content).toBe(JSON.stringify({ ok: true }));

    // Final assistant text still recorded last.
    expect(written[3]!.content).toBe('Reminder set.');
  });

  it('does not persist a dangling tool_call when awaiting approval', async () => {
    const { written, store } = makeRecordingStore();
    const deps = makeDeps({
      getAllManifests: () => [makeManifest('todoist', [WORKFLOW_TOOL])],
      llmProvider: {
        name: 'mock',
        async chat() {
          return {
            type: 'tool_call' as const,
            toolName: 'todoist.delete-task',
            toolArgs: { taskId: 'task_1' },
            toolCallId: 'call_1',
          };
        },
        async generate() {
          return '["todoist"]';
        },
      } satisfies LLMProvider,
      conversationStore: store,
    });

    await handleUserMessage(CHAT_ID, 'delete that task', createBotState(), deps);

    // A workflow pause produces a tool_call with no tool_result. Writing it
    // would leave an unanswered tool_call at the head of the next request.
    expect(written.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(written.some((m) => m.tool_calls)).toBe(false);
  });

  it('records only the user and assistant turns when no tool is called', async () => {
    const { written, store } = makeRecordingStore();
    const deps = makeDeps({ conversationStore: store });

    await handleUserMessage(CHAT_ID, 'hello there', createBotState(), deps);

    expect(written.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
