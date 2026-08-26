import { describe, it, expect } from 'bun:test';
import { runAgentLoop, buildSystemPrompt } from './agent-loop.js';
import type { AgentLoopInput } from './agent-loop.js';
import type { LLMProvider, LLMResponse } from '../llm/provider.js';
import { contentToText } from '../llm/provider.js';
import type { AgentConfig, ToolDefinition } from '@tardis/shared';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: AgentConfig = {
  maxSteps: 10,
  conversationHistoryLength: 10,
  memoryTokenBudget: 2000,
  enableFallbackIntent: false,
  actionOverrides: {},
};

const DIRECT_TOOL: ToolDefinition = {
  name: 'time-tracker.start',
  description: 'Start a timer',
  parameters: {
    type: 'object',
    properties: { taskName: { type: 'string' } },
    required: ['taskName'],
  },
  actionType: 'direct',
};

const WORKFLOW_TOOL: ToolDefinition = {
  name: 'todoist.delete-task',
  description: 'Delete a task permanently',
  parameters: {
    type: 'object',
    properties: { taskName: { type: 'string' } },
    required: ['taskName'],
  },
  actionType: 'workflow',
};

// ─── Mock LLM builder ─────────────────────────────────────────────────────────

/**
 * Creates a mock LLMProvider that returns responses from a scripted queue.
 * Each call to chat() pops the next response from the queue.
 */
function makeScriptedLLM(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    async chat() {
      const response = responses[callIndex++];
      if (!response)
        throw new Error(`Mock LLM has no more scripted responses (call #${callIndex})`);
      return response;
    },
    async generate() {
      return '';
    },
  };
}

function textResponse(text: string): LLMResponse {
  return { type: 'text', text };
}

function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  callId = 'call_001'
): LLMResponse {
  return { type: 'tool_call', toolName, toolArgs: args, toolCallId: callId };
}

function makeInput(
  overrides: Partial<AgentLoopInput> & { llmProvider: LLMProvider }
): AgentLoopInput {
  return {
    userMessage: 'Hello',
    conversationHistory: [],
    memories: [],
    availableTools: [],
    selectedPlugins: [],
    config: DEFAULT_CONFIG,
    executeTool: async () => ({ success: true }),
    ...overrides,
  };
}

// ─── Basic text response ───────────────────────────────────────────────────────

describe('runAgentLoop: text response', () => {
  it('returns the LLM text response directly', async () => {
    const llm = makeScriptedLLM([textResponse('Hi there!')]);
    const result = await runAgentLoop(makeInput({ llmProvider: llm, userMessage: 'Hi' }));

    expect(result.response).toBe('Hi there!');
    expect(result.pendingApproval).toBeUndefined();
  });

  it('builds a ThoughtTrace with correct fields', async () => {
    const llm = makeScriptedLLM([textResponse('Done.')]);
    const result = await runAgentLoop(
      makeInput({ llmProvider: llm, userMessage: 'What time is it?' })
    );

    expect(result.trace.userMessage).toBe('What time is it?');
    expect(result.trace.finalResponse).toBe('Done.');
    expect(result.trace.modelUsed).toBe('mock');
    expect(typeof result.trace.id).toBe('string');
    expect(result.trace.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result.trace.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0]?.type).toBe('reasoning');
  });

  it('records a reasoning step with content and timing', async () => {
    const llm = makeScriptedLLM([textResponse('Hello!')]);
    const result = await runAgentLoop(makeInput({ llmProvider: llm }));

    const step = result.trace.steps[0];
    expect(step?.type).toBe('reasoning');
    expect(step?.content).toBe('Hello!');
    expect(typeof step?.timestamp).toBe('number');
    expect(typeof step?.durationMs).toBe('number');
  });
});

// ─── Single tool call → text ──────────────────────────────────────────────────

describe('runAgentLoop: tool call → text', () => {
  it('calls the tool and feeds result back to the LLM', async () => {
    const toolResults: Array<{ name: string; args: Record<string, unknown> }> = [];

    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'coding' }),
      textResponse('Timer started for "coding".'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'Start a timer',
        availableTools: [DIRECT_TOOL],
        executeTool: async (name, args) => {
          toolResults.push({ name, args });
          return { success: true, sessionId: 'sess_abc', taskName: 'coding', status: 'active' };
        },
      })
    );

    expect(result.response).toBe('Timer started for "coding".');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]?.name).toBe('time-tracker.start');
    expect(toolResults[0]?.args).toEqual({ taskName: 'coding' });
  });

  it('records tool_call and tool_result steps', async () => {
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'coding' }),
      textResponse('Done.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        executeTool: async () => ({ success: true }),
      })
    );

    const types = result.trace.steps.map((s) => s.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('reasoning');
  });

  it('includes tool result in tool_result step', async () => {
    const toolReturn = { success: true, sessionId: 'sess_1', taskName: 'coding' };
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'coding' }),
      textResponse('Done.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        executeTool: async () => toolReturn,
      })
    );

    const resultStep = result.trace.steps.find((s) => s.type === 'tool_result');
    expect(resultStep?.toolResult).toEqual(toolReturn);
  });
});

// ─── Tool error handling ──────────────────────────────────────────────────────

describe('runAgentLoop: tool execution errors', () => {
  it('captures tool errors as error result and continues the loop', async () => {
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'coding' }),
      textResponse('Something went wrong, but I handled it.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        executeTool: async () => {
          throw new Error('DB connection failed');
        },
      })
    );

    // Loop should not crash — should return LLM's next text response
    expect(result.response).toBe('Something went wrong, but I handled it.');

    const errorStep = result.trace.steps.find((s) => s.type === 'tool_result');
    expect((errorStep?.toolResult as { error: boolean })?.error).toBe(true);
    expect((errorStep?.toolResult as { message: string })?.message).toContain(
      'DB connection failed'
    );
  });
});

// ─── Multi-step tool chain ────────────────────────────────────────────────────

describe('runAgentLoop: multi-step', () => {
  it('handles two consecutive tool calls before responding', async () => {
    const toolCalled: string[] = [];
    const notesTool: ToolDefinition = {
      name: 'notes.save',
      description: 'Save a note',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      actionType: 'direct',
    };

    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'research' }, 'call_1'),
      toolCallResponse('notes.save', { content: 'Started research session' }, 'call_2'),
      textResponse('I started the timer and saved a note.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL, notesTool],
        executeTool: async (name) => {
          toolCalled.push(name);
          return { success: true };
        },
      })
    );

    expect(toolCalled).toEqual(['time-tracker.start', 'notes.save']);
    expect(result.response).toBe('I started the timer and saved a note.');
    const toolCallSteps = result.trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolCallSteps).toHaveLength(2);
  });

  it('trace has exactly 5 steps for a 2-tool chain: tool_call, tool_result, tool_call, tool_result, reasoning', async () => {
    const calendarTool: ToolDefinition = {
      name: 'google-calendar.list-events',
      description: 'List calendar events',
      parameters: { type: 'object', properties: { date: { type: 'string' } } },
      actionType: 'direct',
    };
    const todoistTool: ToolDefinition = {
      name: 'todoist.add-task',
      description: 'Add a task',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      actionType: 'direct',
    };

    const llm = makeScriptedLLM([
      toolCallResponse('google-calendar.list-events', { date: '2026-02-24' }, 'call_1'),
      toolCallResponse('todoist.add-task', { content: 'Prepare for meeting' }, 'call_2'),
      textResponse('You have a meeting at 2pm. I added a task to prepare for it.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'Prepare me for tomorrow',
        availableTools: [calendarTool, todoistTool],
        executeTool: async (name) =>
          name === 'google-calendar.list-events'
            ? [{ title: 'Team meeting', time: '2pm' }]
            : { success: true, taskId: 'task_123' },
      })
    );

    expect(result.trace.steps).toHaveLength(5);
    expect(result.trace.steps.map((s) => s.type)).toEqual([
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'reasoning',
    ]);
    expect(result.response).toContain('meeting at 2pm');
  });
});

// ─── Workflow (pending approval) ──────────────────────────────────────────────

describe('runAgentLoop: workflow actions', () => {
  it('pauses and returns pendingApproval for workflow tools', async () => {
    const llm = makeScriptedLLM([
      toolCallResponse('todoist.delete-task', { taskName: 'Buy milk' }),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [WORKFLOW_TOOL],
        executeTool: async () => {
          throw new Error('Should not be called for workflow actions');
        },
      })
    );

    expect(result.pendingApproval).toBeDefined();
    expect(result.pendingApproval?.toolName).toBe('todoist.delete-task');
    expect(result.pendingApproval?.args).toEqual({ taskName: 'Buy milk' });
    expect(result.pendingApproval?.preview).toContain('todoist.delete-task');
  });

  it('does NOT execute the tool for workflow actions', async () => {
    let toolExecuted = false;
    const llm = makeScriptedLLM([toolCallResponse('todoist.delete-task', { taskName: 'test' })]);

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [WORKFLOW_TOOL],
        executeTool: async () => {
          toolExecuted = true;
          return {};
        },
      })
    );

    expect(toolExecuted).toBe(false);
  });

  it('actionOverrides can promote a direct tool to workflow', async () => {
    let toolExecuted = false;
    const llm = makeScriptedLLM([toolCallResponse('time-tracker.start', { taskName: 'coding' })]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: {
          ...DEFAULT_CONFIG,
          actionOverrides: { 'time-tracker.start': 'workflow' },
        },
        executeTool: async () => {
          toolExecuted = true;
          return {};
        },
      })
    );

    expect(result.pendingApproval).toBeDefined();
    expect(toolExecuted).toBe(false);
  });

  it('preview message describes the pending action', async () => {
    const llm = makeScriptedLLM([
      toolCallResponse('todoist.delete-task', { taskName: 'Buy milk' }),
    ]);

    const result = await runAgentLoop(
      makeInput({ llmProvider: llm, availableTools: [WORKFLOW_TOOL] })
    );

    expect(result.pendingApproval?.preview).toContain('todoist.delete-task');
    expect(result.pendingApproval?.preview).toContain('Buy milk');
  });
});

// ─── Max steps ────────────────────────────────────────────────────────────────

describe('runAgentLoop: maxSteps limit', () => {
  it('stops after maxSteps and returns a limit-reached response', async () => {
    // LLM keeps calling tools forever
    // Args vary per call so the repeat guard doesn't fire — this test is about
    // the maxSteps bound, which is a separate mechanism.
    const llm = makeScriptedLLM(
      Array.from({ length: 20 }, (_, i) =>
        toolCallResponse('time-tracker.start', { taskName: `loop-${i}` })
      )
    );

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 3 },
        executeTool: async () => ({ success: true }),
      })
    );

    expect(result.pendingApproval).toBeUndefined();
    // Should not be a clean response — maxSteps message
    expect(result.trace.steps.filter((s) => s.type === 'tool_call')).toHaveLength(3);
  });

  it('maxSteps of 1 stops after the first tool call + result', async () => {
    let toolCallCount = 0;
    const llm = makeScriptedLLM(
      Array(10).fill(toolCallResponse('time-tracker.start', { taskName: 'test' }))
    );

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 1 },
        executeTool: async () => {
          toolCallCount++;
          return {};
        },
      })
    );

    expect(toolCallCount).toBe(1);
  });

  it('response names the completed tool when maxSteps is hit mid-chain', async () => {
    const llm = makeScriptedLLM(
      Array.from({ length: 10 }, (_, i) =>
        toolCallResponse('time-tracker.start', { taskName: `work-${i}` })
      )
    );

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 2 },
        executeTool: async () => ({}),
      })
    );

    expect(result.response).toContain('time-tracker.start');
    expect(result.response).toContain('thinking limit');
  });

  it('response says "without completing any actions" when all tool calls had empty toolName', async () => {
    // Malformed tool calls (empty toolName) are falsy and excluded from completedTools
    const llm = makeScriptedLLM(
      Array.from({ length: 5 }, (_, i) => ({
        type: 'tool_call' as const,
        toolArgs: { attempt: i },
      }))
    );

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        config: { ...DEFAULT_CONFIG, maxSteps: 2 },
        executeTool: async () => {
          throw new Error('bad');
        },
      })
    );

    expect(result.response).toContain('thinking limit');
    expect(result.response).toContain('without completing');
  });
});

// ─── Malformed tool call ──────────────────────────────────────────────────────

describe('runAgentLoop: malformed tool call', () => {
  it('does not crash when LLM returns tool_call with no toolName', async () => {
    const llm = makeScriptedLLM([
      { type: 'tool_call' as const, toolArgs: {} }, // toolName omitted
      textResponse('Recovered from the bad response.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        executeTool: async () => {
          throw new Error('unknown tool');
        },
      })
    );

    expect(result.response).toBe('Recovered from the bad response.');
    expect(result.pendingApproval).toBeUndefined();
  });

  it('records tool_call and error tool_result steps for the malformed call', async () => {
    const llm = makeScriptedLLM([
      { type: 'tool_call' as const, toolArgs: {} },
      textResponse('Done.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        executeTool: async () => {
          throw new Error('bad tool');
        },
      })
    );

    const types = result.trace.steps.map((s) => s.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    const resultStep = result.trace.steps.find((s) => s.type === 'tool_result');
    expect((resultStep?.toolResult as { error: boolean })?.error).toBe(true);
  });
});

// ─── Conversation history ─────────────────────────────────────────────────────

describe('runAgentLoop: conversation history', () => {
  it('includes conversation history in the messages sent to LLM', async () => {
    const sentMessages: Array<{ role: string; content: string | null }> = [];

    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        sentMessages.push(...messages.map((m) => ({ role: m.role, content: contentToText(m.content) })));
        return textResponse('Hi');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'And now?',
        conversationHistory: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
        ],
      })
    );

    const roles = sentMessages.map((m) => m.role);
    expect(roles[0]).toBe('system'); // stable prompt — cacheable prefix
    expect(roles[1]).toBe('user'); // history
    expect(roles[2]).toBe('assistant'); // history
    expect(roles[3]).toBe('system'); // volatile context, after history on purpose
    expect(roles[4]).toBe('user'); // current message
    expect(sentMessages[4]?.content).toBe('And now?');
  });
});

// ─── Memory in the volatile context block ─────────────────────────────────────

describe('runAgentLoop: memories', () => {
  it('includes memories in the volatile context block, not the stable prompt', async () => {
    let sentSystemPrompt = '';
    let sentContextBlock = '';

    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        sentSystemPrompt = contentToText(messages[0]?.content ?? '');
        // The volatile block is the message immediately before the user message.
        sentContextBlock = contentToText(messages[messages.length - 2]?.content ?? '');
        return textResponse('ok');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        memories: [
          {
            id: 'mem_1',
            type: 'user_fact',
            key: 'name',
            value: 'Mohammad',
            source: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      })
    );

    expect(sentContextBlock).toContain('Mohammad');
    expect(sentContextBlock).toContain('name');
    // The stable prompt must stay free of per-turn content so the cached
    // prefix (prompt + tool schemas) survives between turns.
    expect(sentSystemPrompt).not.toContain('Mohammad');
  });
});

// ─── Usage token tracking ─────────────────────────────────────────────────────

describe('runAgentLoop: token tracking', () => {
  it('accumulates token usage across multiple LLM calls', async () => {
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        return {
          type: 'text' as const,
          text: 'Done.',
          usage: { promptTokens: 100, completionTokens: 20 },
        };
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(makeInput({ llmProvider: llm }));
    expect(result.trace.tokenCount).toBe(120);
  });

  it('does not set tokenCount when LLM returns no usage', async () => {
    const llm = makeScriptedLLM([textResponse('Hi')]);
    const result = await runAgentLoop(makeInput({ llmProvider: llm }));
    expect(result.trace.tokenCount).toBeUndefined();
  });
});

// ─── Trace completeness ───────────────────────────────────────────────────────

describe('runAgentLoop: trace', () => {
  it('trace has valid UUID for id', async () => {
    const llm = makeScriptedLLM([textResponse('ok')]);
    const result = await runAgentLoop(makeInput({ llmProvider: llm }));
    expect(result.trace.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('trace.finalResponse is null when pendingApproval is set', async () => {
    const llm = makeScriptedLLM([toolCallResponse('todoist.delete-task', { taskName: 'test' })]);

    const result = await runAgentLoop(
      makeInput({ llmProvider: llm, availableTools: [WORKFLOW_TOOL] })
    );

    expect(result.trace.finalResponse).toBeNull();
  });

  it('trace timestamp is close to now', async () => {
    const before = Date.now();
    const llm = makeScriptedLLM([textResponse('ok')]);
    const result = await runAgentLoop(makeInput({ llmProvider: llm }));
    const after = Date.now();
    expect(result.trace.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.trace.timestamp).toBeLessThanOrEqual(after);
  });

  it('each trace has a unique id', async () => {
    const llm1 = makeScriptedLLM([textResponse('a')]);
    const llm2 = makeScriptedLLM([textResponse('b')]);
    const [r1, r2] = await Promise.all([
      runAgentLoop(makeInput({ llmProvider: llm1 })),
      runAgentLoop(makeInput({ llmProvider: llm2 })),
    ]);
    expect(r1.trace.id).not.toBe(r2.trace.id);
  });
});

// ─── Repeat guard (identical tool call twice in a row) ────────────────────────

describe('runAgentLoop: repeat guard', () => {
  it('breaks immediately when the same tool+args+result repeats, instead of burning the step budget', async () => {
    let execCount = 0;
    const llm = makeScriptedLLM(
      Array(10).fill(toolCallResponse('time-tracker.start', { taskName: 'stuck' }))
    );

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 10 },
        executeTool: async () => {
          execCount++;
          return { success: true };
        },
      })
    );

    // Stopped on the second identical call — not after all 10 steps.
    expect(execCount).toBe(2);
    expect(result.trace.steps.filter((s) => s.type === 'tool_call')).toHaveLength(2);
    expect(result.response).toContain('repeating the same action');
    const errorStep = result.trace.steps.find((s) => s.type === 'error');
    expect(errorStep?.content).toContain('Repeated the identical call');
  });

  it('ignores argument key order when comparing calls', async () => {
    let execCount = 0;
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'x', project: 'y' }),
      // Same call, keys serialised in the other order.
      toolCallResponse('time-tracker.start', { project: 'y', taskName: 'x' }),
      ...Array(5).fill(toolCallResponse('time-tracker.start', { taskName: 'x', project: 'y' })),
    ]);

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 10 },
        executeTool: async () => {
          execCount++;
          return { success: true };
        },
      })
    );

    expect(execCount).toBe(2);
  });

  it('does NOT break when the same tool is called with different arguments', async () => {
    let execCount = 0;
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'a' }),
      toolCallResponse('time-tracker.start', { taskName: 'b' }),
      toolCallResponse('time-tracker.start', { taskName: 'c' }),
      textResponse('All three started.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 10 },
        executeTool: async () => {
          execCount++;
          return { success: true };
        },
      })
    );

    expect(execCount).toBe(3);
    expect(result.response).toBe('All three started.');
  });

  it('does NOT break when the same call returns a different result', async () => {
    let n = 0;
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'poll' }),
      toolCallResponse('time-tracker.start', { taskName: 'poll' }),
      textResponse('Polled twice.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 10 },
        executeTool: async () => ({ tick: n++ }),
      })
    );

    expect(result.response).toBe('Polled twice.');
  });
});

// ─── Claim-vs-reality guard ───────────────────────────────────────────────────

describe('runAgentLoop: claim-vs-reality guard', () => {
  it('retries once when the model claims completion with no tool call', async () => {
    const llm = makeScriptedLLM([
      textResponse('Reminder set to go on a walk in 5 minutes.'), // the lie
      toolCallResponse('time-tracker.start', { taskName: 'walk' }), // after the nudge
      textResponse('Done — reminder is set.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        userMessage: 'Remind me to go on a walk in 5 minutes',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(result.trace.steps.some((s) => s.type === 'tool_call')).toBe(true);
    const errStep = result.trace.steps.find((s) => s.type === 'error');
    expect(errStep?.content).toContain('no tool reported carrying it out');
    expect(result.response).toBe('Done — reminder is set.');
  });

  it('sends an explicit correction telling the model nothing happened', async () => {
    const seen: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        seen.push(...messages.map((m) => contentToText(m.content)));
        call++;
        return call === 1
          ? textResponse('Reminder set.')
          : toolCallResponse('time-tracker.start', { taskName: 'walk' });
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        executeTool: async () => ({ success: true }),
      })
    );

    expect(seen.some((c) => c.includes('You did not call any tool'))).toBe(true);
    // The correction must restate the original request — a purely meta-worded
    // nudge makes small models reply conversationally instead of acting.
    expect(seen.some((c) => c.includes('Call the tool that performs this request now'))).toBe(
      true
    );
  });

  it('surfaces the response as-is when the retry also produces no tool call', async () => {
    const llm = makeScriptedLLM([
      textResponse('Reminder set.'),
      textResponse('Reminder set.'), // still no tool call
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        executeTool: async () => ({}),
      })
    );

    // Retried exactly once, then gave up and returned the text.
    expect(result.response).toBe('Reminder set.');
    expect(result.trace.steps.filter((s) => s.type === 'error')).toHaveLength(1);
  });

  it('does NOT retry an ordinary answer that claims nothing', async () => {
    let calls = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        calls++;
        return textResponse('You have three tasks due today.');
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({ llmProvider: llm, availableTools: [DIRECT_TOOL], executeTool: async () => ({}) })
    );

    expect(calls).toBe(1);
    expect(result.response).toBe('You have three tasks due today.');
  });

  it('does NOT retry when the claim follows a real tool call', async () => {
    let calls = 0;
    const llm = makeScriptedLLM([
      toolCallResponse('time-tracker.start', { taskName: 'walk' }),
      textResponse('Reminder set.'),
    ]);
    const counting: LLMProvider = {
      name: 'mock',
      async chat(p) {
        calls++;
        return llm.chat(p);
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({
        llmProvider: counting,
        availableTools: [DIRECT_TOOL],
        executeTool: async () => ({ success: true }),
      })
    );

    expect(calls).toBe(2);
    expect(result.response).toBe('Reminder set.');
    expect(result.trace.steps.some((s) => s.type === 'error')).toBe(false);
  });

  it('does not retry when no tools are available at all', async () => {
    let calls = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        calls++;
        return textResponse('Reminder set.');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(makeInput({ llmProvider: llm, availableTools: [] }));
    expect(calls).toBe(1);
  });
});

// ─── Regression: the 2026-08-24 "walk in 5 minutes" false confirmation ────────
//
// Real failure captured in thought_traces row 8fd2fa62-8a67-4c48-b348-afa9ce2ab086:
// the model replied "Reminder set to go on a walk in 5 minutes." with ZERO
// tool_call steps, because the conversation history had been contaminated with
// earlier assistant turns that confirmed actions without any recorded tool call.
// PR #42 fixed the contamination at the source; this locks in the structural
// guard so the failure class cannot silently return.

describe('regression: false "reminder set" with contaminated history', () => {
  const CONTAMINATED_HISTORY = [
    { role: 'user' as const, content: 'Remind me to go on a walk in 5 minutes' },
    // Pre-#42 shape: a confirmation with no tool_calls recorded alongside it.
    { role: 'assistant' as const, content: 'Reminder set to go on a walk in 5 minutes.' },
    { role: 'user' as const, content: 'Give me a reminder in 5 minutes' },
    { role: 'assistant' as const, content: 'Reminder set to give you a reminder in 5 minutes.' },
  ];

  const REMINDER_TOOL: ToolDefinition = {
    name: 'reminders.set-reminder',
    description: 'Set a reminder to be delivered after a delay',
    parameters: {
      type: 'object',
      properties: {
        delayMinutes: { type: 'number' },
        message: { type: 'string' },
      },
      required: ['delayMinutes', 'message'],
    },
    actionType: 'direct',
  };

  it('produces a real tool_call step even when the model first mimics the bad history', async () => {
    const llm = makeScriptedLLM([
      // The model copies the contaminated pattern and just asserts success.
      textResponse('Reminder set to go on a walk in 5 minutes.'),
      // After the correction it actually acts.
      toolCallResponse('reminders.set-reminder', {
        delayMinutes: 5,
        message: 'Go on a walk',
      }),
      textResponse('Reminder set for 5 minutes from now.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'Remind me to go on a walk in 5 minutes',
        conversationHistory: CONTAMINATED_HISTORY,
        availableTools: [REMINDER_TOOL],
        selectedPlugins: ['reminders'],
        executeTool: async () => ({
          success: true,
          message: 'Reminder set for 5m from now.',
        }),
      })
    );

    // The core assertion: the turn contains a REAL tool call, not just a claim.
    const toolCalls = result.trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.toolName).toBe('reminders.set-reminder');
    expect(toolCalls[0]?.toolArgs).toEqual({ delayMinutes: 5, message: 'Go on a walk' });

    // And a tool_result proving it actually ran.
    expect(result.trace.steps.some((s) => s.type === 'tool_result')).toBe(true);
  });
});

// ─── Malformed arguments: validation error is fed back as an observation ──────

describe('runAgentLoop: malformed tool arguments recovery', () => {
  it('feeds a validation error back to the model and lets it retry', async () => {
    const observations: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        for (const m of messages) {
          if (m.role === 'tool') observations.push(contentToText(m.content));
        }
        call++;
        if (call === 1) {
          // Missing the required taskName.
          return toolCallResponse('time-tracker.start', {});
        }
        if (call === 2) {
          return toolCallResponse('time-tracker.start', { taskName: 'fixed' });
        }
        return textResponse('Started.');
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        executeTool: async (_name, args) => {
          if (!('taskName' in args)) {
            // Mirrors ToolRouter.asExecutor() throwing on VALIDATION_ERROR.
            throw new Error(
              '[VALIDATION_ERROR] Tool "time-tracker.start" missing required argument(s): taskName'
            );
          }
          return { success: true };
        },
      })
    );

    // The validation failure reached the model as a tool observation…
    expect(observations.some((o) => o.includes('VALIDATION_ERROR'))).toBe(true);
    expect(observations.some((o) => o.includes('missing required argument'))).toBe(true);
    // …and the turn recovered rather than failing outright.
    expect(result.response).toBe('Started.');
  });
});

// ─── Prompt caching: stable prefix must not contain per-turn content ──────────

describe('runAgentLoop: prompt cache friendliness', () => {
  it('keeps volatile content out of the stable system prompt', async () => {
    let stable = '';
    let volatileBlock = '';
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        stable = contentToText(messages[0]?.content ?? '');
        volatileBlock = contentToText(messages[messages.length - 2]?.content ?? '');
        return textResponse('ok');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        selectedPlugins: ['time-tracker'],
      })
    );

    // No clock, no date, no per-turn plugin list in the cached prefix.
    expect(stable).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(stable).not.toContain('Current local time');
    expect(stable).not.toContain('Active plugins');

    // They live in the volatile block instead.
    expect(volatileBlock).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(volatileBlock).toContain('Active plugins');
  });

  it('produces a byte-identical stable prompt across separate turns', async () => {
    const prompts: string[] = [];
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        prompts.push(contentToText(messages[0]?.content ?? ''));
        return textResponse('ok');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(makeInput({ llmProvider: llm, availableTools: [DIRECT_TOOL] }));
    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        userMessage: 'a different message',
        conversationHistory: [{ role: 'user', content: 'earlier' }],
        selectedPlugins: ['time-tracker'],
      })
    );

    expect(prompts[0]).toBe(prompts[1]);
  });

  it('omits seconds from the clock so the prompt is stable within a minute', async () => {
    let volatileBlock = '';
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        volatileBlock = contentToText(messages[messages.length - 2]?.content ?? '');
        return textResponse('ok');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(makeInput({ llmProvider: llm }));

    const timeLine = volatileBlock.split('\n')[0] ?? '';
    // "7:45 PM" is fine; "7:45:53 PM" is not.
    expect(timeLine).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

// ─── Prompt section ordering (measured, not cosmetic) ─────────────────────────
//
// With "## Response style" ahead of "## Memory", gemma-4-E2B saved a fact in
// only 2/15 trials against the live model — it replied "Memory saved." without
// ever calling the tool. Reordering took it to 15/15, 0/10 spurious saves.

describe('buildSystemPrompt: instruction ordering', () => {
  const MEMORY_SAVE: ToolDefinition = {
    name: 'memory.save',
    description: 'Save a fact',
    parameters: { type: 'object', properties: {}, required: [] },
    actionType: 'direct',
  };

  function promptWith(tools: ToolDefinition[]): string {
    return buildSystemPrompt({
      userMessage: 'x',
      conversationHistory: [],
      memories: [],
      availableTools: tools,
      selectedPlugins: [],
      config: DEFAULT_CONFIG,
      llmProvider: { name: 'mock' } as LLMProvider,
      executeTool: async () => ({}),
    });
  }

  it('puts behavioural instructions (## Memory) BEFORE ## Response style', () => {
    const p = promptWith([MEMORY_SAVE]);
    expect(p).toContain('## Memory');
    expect(p).toContain('## Response style');
    expect(p.indexOf('## Memory')).toBeLessThan(p.indexOf('## Response style'));
  });

  it('scopes the style rules to wording so they cannot suppress tool calls', () => {
    expect(promptWith([MEMORY_SAVE])).toContain('never decide whether to call a tool');
  });

  it('no longer contains the "Match the user\'s energy" line that measured 0/9', () => {
    expect(promptWith([MEMORY_SAVE])).not.toContain("Match the user's energy");
    expect(promptWith([])).not.toContain("Match the user's energy");
  });

  it('still ends with the style block when no memory tools are present', () => {
    const p = promptWith([]);
    expect(p).not.toContain('## Memory');
    expect(p).toContain('## Response style');
  });
});

// ─── Claim guard must cover memory claims, not just reminders ────────────────

describe('claim-vs-reality guard: memory claims', () => {
  const MEMORY_SAVE: ToolDefinition = {
    name: 'memory.save',
    description: 'Save a fact',
    parameters: { type: 'object', properties: {}, required: [] },
    actionType: 'direct',
  };

  it('retries on a bare "Memory saved." with no tool call', async () => {
    const llm = makeScriptedLLM([
      textResponse('Memory saved.'), // the exact real-world false claim
      toolCallResponse('memory.save', { key: 'user_name', value: 'Mohammad' }),
      textResponse('Got it.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'my name is Mohammad',
        availableTools: [MEMORY_SAVE],
        executeTool: async () => ({ success: true }),
      })
    );

    const toolCalls = result.trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.toolName).toBe('memory.save');
    expect(result.response).toBe('Got it.');
  });
});

// ─── Completion guard for multi-part requests ────────────────────────────────
//
// "I ate two sandwiches, they cost 2 JOD and were 700 calories" is two records.
// The model logged the meal, said "Done." and silently dropped the spending.
// Measured 3/12 complete on real multi-part messages before this guard.

describe('runAgentLoop: completion guard', () => {
  const HEALTH: ToolDefinition = {
    name: 'health.log-meal',
    description: 'Log a meal',
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };
  const BUDGET: ToolDefinition = {
    name: 'budget.log-spend',
    description: 'Log spending',
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };

  it('nudges when a deliberately selected plugin went unused', async () => {
    const llm = makeScriptedLLM([
      toolCallResponse('health.log-meal', { description: '2 sandwiches' }),
      textResponse('Done.'), // drops the spending
      toolCallResponse('budget.log-spend', { text: '2 jod' }),
      textResponse('Logged both.'),
    ]);

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'i ate 2 sandwiches, cost 2 jod, 700 calories',
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    const used = result.trace.steps
      .filter((s) => s.type === 'tool_call')
      .map((s) => s.toolName);
    expect(used).toEqual(['health.log-meal', 'budget.log-spend']);
    expect(result.response).toBe('Logged both.');
  });

  it('names the unused plugin in the nudge', async () => {
    const seen: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        seen.push(...messages.map((m) => contentToText(m.content)));
        call++;
        if (call === 1) return toolCallResponse('health.log-meal', {});
        return textResponse('Done.');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(seen.some((c) => c.includes('budget'))).toBe(true);
    expect(seen.some((c) => c.includes('have not recorded anything with'))).toBe(true);
  });

  it('does NOT nudge when the router fell back to every plugin', async () => {
    // A fallback selects everything, so "picked 8, used 1" means nothing and
    // would fire on almost every turn.
    let calls = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        calls++;
        return calls === 1 ? toolCallResponse('health.log-meal', {}) : textResponse('Done.');
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'fallback',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(calls).toBe(2);
    expect(result.response).toBe('Done.');
  });

  it('does not nudge when every selected plugin was used', async () => {
    let calls = 0;
    const llm = makeScriptedLLM([
      toolCallResponse('health.log-meal', {}),
      toolCallResponse('budget.log-spend', {}),
      textResponse('Both logged.'),
    ]);
    const counting: LLMProvider = {
      name: 'mock',
      async chat(p) {
        calls++;
        return llm.chat(p);
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({
        llmProvider: counting,
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(calls).toBe(3);
    expect(result.response).toBe('Both logged.');
  });

  it('nudges at most once', async () => {
    let calls = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        calls++;
        return calls === 1 ? toolCallResponse('health.log-meal', {}) : textResponse('Nothing else.');
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    // tool call, "Done", nudge, "Nothing else" — then it stops arguing.
    expect(calls).toBe(3);
    expect(result.response).toBe('Nothing else.');
  });

  it('does not nudge a single-plugin turn', async () => {
    let calls = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        calls++;
        return calls === 1 ? toolCallResponse('health.log-meal', {}) : textResponse('Logged.');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [HEALTH],
        selectedPlugins: ['health'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(calls).toBe(2);
  });
});

// ─── Unrecorded-amount nudge ─────────────────────────────────────────────────
//
// Measured against the live model: "I ate 2 sandwiches today, they cost me 2 JOD
// and had 700 calories" logged the meal and dropped the spend 3/3, and the
// generic nudge ("you have not recorded anything with: budget") made it argue
// the point rather than act — "the cost of 2 JOD is not a spending record".
//
// Naming a plugin invites a judgement about that plugin's relevance, which the
// model is happy to decline. Naming the amount states a fact it cannot argue
// with: the number is in the message and no tool call used it.

describe('runAgentLoop: unrecorded-amount nudge', () => {
  const HEALTH: ToolDefinition = {
    name: 'health.log-meal',
    description: 'Log a meal',
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };
  const BUDGET: ToolDefinition = {
    name: 'budget.log-spend',
    description: 'Log spending',
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };

  function nudgeTextFor(userMessage: string, firstCallArgs: Record<string, unknown>) {
    const seen: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        seen.push(...messages.map((m) => contentToText(m.content)));
        call++;
        if (call === 1) return toolCallResponse('health.log-meal', firstCallArgs);
        return textResponse('Done.');
      },
      async generate() {
        return '';
      },
    };
    return { seen, llm, userMessage };
  }

  it('quotes the unrecorded money instead of naming the plugin', async () => {
    const { seen, llm } = nudgeTextFor('i ate 2 sandwiches, they cost me 2 JOD and had 700 calories', {
      calories: 700,
      description: '2 sandwiches',
    });

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'i ate 2 sandwiches, they cost me 2 JOD and had 700 calories',
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(seen.some((c) => c.includes('2 JOD is still unrecorded'))).toBe(true);
    // and it must not fall back to the plugin-relevance wording the model argues with
    expect(seen.some((c) => c.includes('have not recorded anything with'))).toBe(false);
  });

  it('does not claim money is unrecorded when a tool call already used that amount', async () => {
    // The meal call carried the cost, so the only thing left is the generic
    // "plugin went unused" case — it must not assert the amount is missing.
    const { seen, llm } = nudgeTextFor('i ate 2 sandwiches, they cost me 2 JOD and had 700 calories', {
      calories: 700,
      cost: 2,
    });

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'i ate 2 sandwiches, they cost me 2 JOD and had 700 calories',
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(seen.some((c) => c.includes('still unrecorded'))).toBe(false);
    expect(seen.some((c) => c.includes('have not recorded anything with'))).toBe(true);
  });

  it('ignores bare numbers with no currency attached', async () => {
    // "700 calories" and "2 sandwiches" are not money and must never be
    // reported as unrecorded spending.
    const { seen, llm } = nudgeTextFor('i walked 700 steps and did 2 sets', { steps: 0 });

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'i walked 700 steps and did 2 sets',
        availableTools: [HEALTH, BUDGET],
        selectedPlugins: ['health', 'budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true }),
      })
    );

    expect(seen.some((c) => c.includes('still unrecorded'))).toBe(false);
  });
});

// ─── Claim guard vs. read-only tool calls ────────────────────────────────────
//
// Live, 1 run in 3: "Delete my most recent budget entry." made the model call
// budget.this-month, delete nothing, and answer "I have deleted the most recent
// budget entry." The claim guard missed it because it only fired when the turn
// called *no* tool at all — and this turn called one, just a read.
//
// Plugins follow the Result pattern the project mandates: mutating skills return
// `success`, queries return plain data. Verified across all 8 plugins — every
// write returns a Result, every list/summary does not. So "did anything actually
// happen" is answerable without new metadata.

describe('runAgentLoop: claim guard after a read-only call', () => {
  const READ: ToolDefinition = {
    name: 'budget.this-month',
    description: 'List this month spending',
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };
  const WRITE: ToolDefinition = {
    name: 'budget.delete-entry',
    description: 'Delete an entry',
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };

  it('fires when the only tool call returned plain data, not a Result', async () => {
    const seen: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        seen.push(...messages.map((m) => contentToText(m.content)));
        call++;
        if (call === 1) return toolCallResponse('budget.this-month', {});
        if (call === 2) return textResponse('I have deleted the most recent budget entry.');
        return textResponse('I could not find an entry to delete.');
      },
      async generate() {
        return '';
      },
    };

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'Delete my most recent budget entry.',
        availableTools: [READ, WRITE],
        selectedPlugins: ['budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ entries: [], total: 0 }),
      })
    );

    expect(seen.some((c) => c.includes('nothing actually happened yet'))).toBe(true);
    expect(result.response).toBe('I could not find an entry to delete.');
  });

  it('stays quiet when a tool actually reported success', async () => {
    const seen: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        seen.push(...messages.map((m) => contentToText(m.content)));
        call++;
        if (call === 1) return toolCallResponse('budget.delete-entry', { id: 'x' });
        return textResponse('I have deleted the most recent budget entry.');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'Delete my most recent budget entry.',
        availableTools: [READ, WRITE],
        selectedPlugins: ['budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: true, message: 'Deleted 2.00 JOD.' }),
      })
    );

    expect(seen.some((c) => c.includes('nothing actually happened yet'))).toBe(false);
  });

  it('treats a failed Result as nothing having happened', async () => {
    const seen: string[] = [];
    let call = 0;
    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        seen.push(...messages.map((m) => contentToText(m.content)));
        call++;
        if (call === 1) return toolCallResponse('budget.delete-entry', { id: 'x' });
        if (call === 2) return textResponse('Done.');
        return textResponse('That entry does not exist.');
      },
      async generate() {
        return '';
      },
    };

    await runAgentLoop(
      makeInput({
        llmProvider: llm,
        userMessage: 'Delete my most recent budget entry.',
        availableTools: [READ, WRITE],
        selectedPlugins: ['budget'],
        pluginSelectionMethod: 'llm',
        executeTool: async () => ({ success: false, message: 'No entry with id "x".' }),
      })
    );

    expect(seen.some((c) => c.includes('nothing actually happened yet'))).toBe(true);
  });
});
