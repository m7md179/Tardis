import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { ThoughtTracer } from './thought-tracer.js';
import { runAgentLoop } from './agent-loop.js';
import { createDb, migrate } from '@tardis/db';
import type { ThoughtTrace, AgentStep, AgentConfig, ToolDefinition } from '@tardis/shared';
import type { LLMProvider, LLMResponse } from '../llm/provider.js';

// ─── Test DB helpers ──────────────────────────────────────────────────────────

function makeTestDb() {
  const path = `/tmp/tardis-tracer-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeStep(type: AgentStep['type'], content = 'test', extra: Partial<AgentStep> = {}): AgentStep {
  return { type, content, timestamp: Date.now(), durationMs: 10, ...extra };
}

function makeTrace(overrides: Partial<ThoughtTrace> = {}): ThoughtTrace {
  return {
    id: randomUUID(),
    userMessage: 'Start a timer',
    steps: [makeStep('reasoning', 'I should start a timer.')],
    finalResponse: 'Timer started!',
    totalDurationMs: 250,
    modelUsed: 'ollama',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── save() ───────────────────────────────────────────────────────────────────

describe('ThoughtTracer.save()', () => {
  let cleanup: () => void;
  let tracer: ThoughtTracer;

  beforeEach(() => {
    const { db, cleanup: c } = makeTestDb();
    cleanup = c;
    tracer = new ThoughtTracer(db);
  });

  afterEach(() => cleanup());

  it('saves a trace without throwing', async () => {
    const trace = makeTrace();
    await expect(tracer.save(trace)).resolves.toBeUndefined();
  });

  it('saved trace can be retrieved by ID', async () => {
    const trace = makeTrace();
    await tracer.save(trace);
    const loaded = await tracer.getById(trace.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(trace.id);
    expect(loaded?.userMessage).toBe(trace.userMessage);
  });

  it('saves all ThoughtTrace fields correctly', async () => {
    const trace = makeTrace({
      userMessage: 'What time is it?',
      finalResponse: 'It is 3pm.',
      totalDurationMs: 500,
      modelUsed: 'qwen3:4b',
      tokenCount: 150,
    });
    await tracer.save(trace);

    const loaded = await tracer.getById(trace.id);
    expect(loaded?.userMessage).toBe('What time is it?');
    expect(loaded?.finalResponse).toBe('It is 3pm.');
    expect(loaded?.totalDurationMs).toBe(500);
    expect(loaded?.modelUsed).toBe('qwen3:4b');
    expect(loaded?.tokenCount).toBe(150);
  });

  it('saves trace with null finalResponse (pending approval)', async () => {
    const trace = makeTrace({ finalResponse: null });
    await tracer.save(trace);

    const loaded = await tracer.getById(trace.id);
    expect(loaded?.finalResponse).toBeNull();
  });

  it('saves trace without tokenCount (optional field)', async () => {
    const { tokenCount: _, ...traceWithoutTokens } = makeTrace();
    const trace: ThoughtTrace = traceWithoutTokens;
    await tracer.save(trace);

    const loaded = await tracer.getById(trace.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.tokenCount).toBeUndefined();
  });

  it('saves and restores all AgentStep types', async () => {
    const steps: AgentStep[] = [
      makeStep('reasoning', 'Thinking...'),
      makeStep('tool_call', 'time-tracker.start', {
        toolName: 'time-tracker.start',
        toolArgs: { taskName: 'coding' },
      }),
      makeStep('tool_result', 'time-tracker.start', {
        toolName: 'time-tracker.start',
        toolResult: { sessionId: 'sess_1', status: 'active' },
      }),
    ];
    const trace = makeTrace({ steps });
    await tracer.save(trace);

    const loaded = await tracer.getById(trace.id);
    expect(loaded?.steps).toHaveLength(3);
    expect(loaded?.steps[0]?.type).toBe('reasoning');
    expect(loaded?.steps[1]?.type).toBe('tool_call');
    expect(loaded?.steps[1]?.toolName).toBe('time-tracker.start');
    expect(loaded?.steps[2]?.type).toBe('tool_result');
    expect(loaded?.steps[2]?.toolResult).toEqual({ sessionId: 'sess_1', status: 'active' });
  });

  it('is idempotent — saving same trace ID twice does not throw', async () => {
    const trace = makeTrace();
    await tracer.save(trace);
    await expect(tracer.save(trace)).resolves.toBeUndefined();

    // Still only one record
    expect(await tracer.count()).toBe(1);
  });
});

// ─── getById() ────────────────────────────────────────────────────────────────

describe('ThoughtTracer.getById()', () => {
  let cleanup: () => void;
  let tracer: ThoughtTracer;

  beforeEach(() => {
    const { db, cleanup: c } = makeTestDb();
    cleanup = c;
    tracer = new ThoughtTracer(db);
  });

  afterEach(() => cleanup());

  it('returns null for a non-existent ID', async () => {
    const result = await tracer.getById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('returns the correct trace when multiple traces exist', async () => {
    const trace1 = makeTrace({ userMessage: 'first' });
    const trace2 = makeTrace({ userMessage: 'second' });
    await tracer.save(trace1);
    await tracer.save(trace2);

    const loaded = await tracer.getById(trace2.id);
    expect(loaded?.userMessage).toBe('second');
    expect(loaded?.id).toBe(trace2.id);
  });
});

// ─── getRecent() ──────────────────────────────────────────────────────────────

describe('ThoughtTracer.getRecent()', () => {
  let cleanup: () => void;
  let tracer: ThoughtTracer;

  beforeEach(() => {
    const { db, cleanup: c } = makeTestDb();
    cleanup = c;
    tracer = new ThoughtTracer(db);
  });

  afterEach(() => cleanup());

  it('returns empty array when no traces exist', async () => {
    const result = await tracer.getRecent();
    expect(result).toEqual([]);
  });

  it('returns traces in reverse chronological order (newest first)', async () => {
    const now = Date.now();
    const older = makeTrace({ userMessage: 'older', timestamp: now - 1000 });
    const newer = makeTrace({ userMessage: 'newer', timestamp: now });
    await tracer.save(older);
    await tracer.save(newer);

    const result = await tracer.getRecent();
    expect(result[0]?.userMessage).toBe('newer');
    expect(result[1]?.userMessage).toBe('older');
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await tracer.save(makeTrace({ userMessage: `trace ${i}` }));
    }

    const result = await tracer.getRecent(3);
    expect(result).toHaveLength(3);
  });

  it('defaults to limit 20', async () => {
    for (let i = 0; i < 25; i++) {
      await tracer.save(makeTrace({ userMessage: `trace ${i}` }));
    }

    const result = await tracer.getRecent();
    expect(result).toHaveLength(20);
  });
});

// ─── count() ─────────────────────────────────────────────────────────────────

describe('ThoughtTracer.count()', () => {
  let cleanup: () => void;
  let tracer: ThoughtTracer;

  beforeEach(() => {
    const { db, cleanup: c } = makeTestDb();
    cleanup = c;
    tracer = new ThoughtTracer(db);
  });

  afterEach(() => cleanup());

  it('returns 0 when no traces exist', async () => {
    expect(await tracer.count()).toBe(0);
  });

  it('returns correct count after saving traces', async () => {
    await tracer.save(makeTrace());
    await tracer.save(makeTrace());
    await tracer.save(makeTrace());
    expect(await tracer.count()).toBe(3);
  });
});

// ─── Integration: runAgentLoop → ThoughtTracer ────────────────────────────────

const DEFAULT_CONFIG: AgentConfig = {
  maxSteps: 10,
  conversationHistoryLength: 10,
  memoryTokenBudget: 2000,
  enableFallbackIntent: false,
  actionOverrides: {},
};

function makeScriptedLLM(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    async chat() {
      const response = responses[callIndex++];
      if (!response) throw new Error(`Mock LLM exhausted (call #${callIndex})`);
      return response;
    },
    async generate() { return ''; },
  };
}

describe('ThoughtTracer: integration with runAgentLoop', () => {
  let cleanup: () => void;
  let tracer: ThoughtTracer;

  beforeEach(() => {
    const { db, cleanup: c } = makeTestDb();
    cleanup = c;
    tracer = new ThoughtTracer(db);
  });

  afterEach(() => cleanup());

  it('saves and fully restores a 2-tool-chain trace from a real agent run', async () => {
    const timerTool: ToolDefinition = {
      name: 'time-tracker.start',
      description: 'Start timer',
      parameters: { type: 'object', properties: { taskName: { type: 'string' } } },
      actionType: 'direct',
    };
    const notesTool: ToolDefinition = {
      name: 'notes.save',
      description: 'Save note',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      actionType: 'direct',
    };

    const llm = makeScriptedLLM([
      { type: 'tool_call', toolName: 'time-tracker.start', toolArgs: { taskName: 'integration test' }, toolCallId: 'call_1' },
      { type: 'tool_call', toolName: 'notes.save', toolArgs: { content: 'test session started' }, toolCallId: 'call_2' },
      { type: 'text', text: 'Timer started and note saved.' },
    ]);

    const result = await runAgentLoop({
      userMessage: 'Start a session and note it',
      conversationHistory: [],
      memories: [],
      availableTools: [timerTool, notesTool],
      selectedPlugins: ['time-tracker', 'notes'],
      config: DEFAULT_CONFIG,
      llmProvider: llm,
      executeTool: async (name) =>
        name === 'time-tracker.start' ? { sessionId: 'sess_1' } : { saved: true },
    });

    // Sanity check the live result
    expect(result.trace.steps).toHaveLength(5);
    expect(result.response).toBe('Timer started and note saved.');

    // Round-trip through the DB
    await tracer.save(result.trace);
    const loaded = await tracer.getById(result.trace.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.userMessage).toBe('Start a session and note it');
    expect(loaded?.finalResponse).toBe('Timer started and note saved.');
    expect(loaded?.modelUsed).toBe('mock');
    expect(loaded?.steps).toHaveLength(5);

    // Verify step order and types are preserved
    const types = loaded?.steps.map((s) => s.type);
    expect(types).toEqual(['tool_call', 'tool_result', 'tool_call', 'tool_result', 'reasoning']);

    // Verify tool call details survived the round-trip
    expect(loaded?.steps[0]?.toolName).toBe('time-tracker.start');
    expect(loaded?.steps[0]?.toolArgs).toEqual({ taskName: 'integration test' });
    expect(loaded?.steps[1]?.toolResult).toEqual({ sessionId: 'sess_1' });
    expect(loaded?.steps[2]?.toolName).toBe('notes.save');
    expect(loaded?.steps[3]?.toolResult).toEqual({ saved: true });
    expect(loaded?.steps[4]?.content).toBe('Timer started and note saved.');
  });

  it('saves a workflow-paused trace with null finalResponse', async () => {
    const workflowTool: ToolDefinition = {
      name: 'todoist.delete-task',
      description: 'Delete task',
      parameters: { type: 'object', properties: { taskId: { type: 'string' } } },
      actionType: 'workflow',
    };

    const llm = makeScriptedLLM([
      { type: 'tool_call', toolName: 'todoist.delete-task', toolArgs: { taskId: 'task_1' }, toolCallId: 'call_1' },
    ]);

    const result = await runAgentLoop({
      userMessage: 'Delete that task',
      conversationHistory: [],
      memories: [],
      availableTools: [workflowTool],
      selectedPlugins: ['todoist'],
      config: DEFAULT_CONFIG,
      llmProvider: llm,
      executeTool: async () => ({}),
    });

    expect(result.pendingApproval?.toolName).toBe('todoist.delete-task');
    expect(result.trace.finalResponse).toBeNull();

    await tracer.save(result.trace);
    const loaded = await tracer.getById(result.trace.id);

    expect(loaded?.finalResponse).toBeNull();
    expect(loaded?.steps[0]?.type).toBe('tool_call');
    expect(loaded?.steps[0]?.toolName).toBe('todoist.delete-task');
    expect(loaded?.steps[0]?.toolArgs).toEqual({ taskId: 'task_1' });
  });

  it('saves a plain text response trace with a single reasoning step', async () => {
    const llm = makeScriptedLLM([{ type: 'text', text: 'Hello! How can I help?' }]);

    const result = await runAgentLoop({
      userMessage: 'Hi',
      conversationHistory: [],
      memories: [],
      availableTools: [],
      selectedPlugins: [],
      config: DEFAULT_CONFIG,
      llmProvider: llm,
      executeTool: async () => ({}),
    });

    await tracer.save(result.trace);
    const loaded = await tracer.getById(result.trace.id);

    expect(loaded?.steps).toHaveLength(1);
    expect(loaded?.steps[0]?.type).toBe('reasoning');
    expect(loaded?.steps[0]?.content).toBe('Hello! How can I help?');
    expect(loaded?.finalResponse).toBe('Hello! How can I help?');
  });
});
