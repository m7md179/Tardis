import { describe, it, expect } from 'bun:test';
import { runAgentLoop } from './agent-loop.js';
import type { AgentLoopInput } from './agent-loop.js';
import type { LLMProvider, LLMResponse } from '../llm/provider.js';
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
          return { sessionId: 'sess_abc', taskName: 'coding', status: 'active' };
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
        executeTool: async () => ({ ok: true }),
      })
    );

    const types = result.trace.steps.map((s) => s.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('reasoning');
  });

  it('includes tool result in tool_result step', async () => {
    const toolReturn = { sessionId: 'sess_1', taskName: 'coding' };
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
          return { ok: true };
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
            : { taskId: 'task_123' },
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
    const llm = makeScriptedLLM(
      Array(20).fill(toolCallResponse('time-tracker.start', { taskName: 'loop' }))
    );

    const result = await runAgentLoop(
      makeInput({
        llmProvider: llm,
        availableTools: [DIRECT_TOOL],
        config: { ...DEFAULT_CONFIG, maxSteps: 3 },
        executeTool: async () => ({ ok: true }),
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
      Array(10)
        .fill(null)
        .map(() => toolCallResponse('time-tracker.start', { taskName: 'work' }))
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
    const llm = makeScriptedLLM(Array(5).fill({ type: 'tool_call' as const, toolArgs: {} }));

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
        sentMessages.push(...messages.map((m) => ({ role: m.role, content: m.content })));
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
    expect(roles[0]).toBe('system');
    expect(roles[1]).toBe('user'); // history
    expect(roles[2]).toBe('assistant'); // history
    expect(roles[3]).toBe('user'); // current message
    expect(sentMessages[3]?.content).toBe('And now?');
  });
});

// ─── Memory in system prompt ──────────────────────────────────────────────────

describe('runAgentLoop: memories', () => {
  it('includes memories in the system prompt', async () => {
    let sentSystemPrompt = '';

    const llm: LLMProvider = {
      name: 'mock',
      async chat({ messages }) {
        sentSystemPrompt = messages[0]?.content ?? '';
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

    expect(sentSystemPrompt).toContain('Mohammad');
    expect(sentSystemPrompt).toContain('name');
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
