import { describe, it, expect } from 'bun:test';
import { LLMProviderError } from './provider.js';
import type { LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from './provider.js';

// ─── Helpers — build a minimal mock provider ───────────────────────────────

function makeMockProvider(response: LLMResponse): LLMProvider {
  return {
    name: 'mock',
    async chat() {
      return response;
    },
    async generate() {
      return response.text ?? '';
    },
  };
}

// ─── LLMProviderError ───────────────────────────────────────────────────────

describe('LLMProviderError', () => {
  it('has correct name, code, and providerName', () => {
    const err = new LLMProviderError('ollama', 'CONNECTION_REFUSED', 'Cannot connect to Ollama');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.name).toBe('LLMProviderError');
    expect(err.code).toBe('CONNECTION_REFUSED');
    expect(err.providerName).toBe('ollama');
    expect(err.message).toBe('Cannot connect to Ollama');
  });

  it('is catchable as a generic Error', () => {
    let caught: unknown;
    try {
      throw new LLMProviderError('openai', 'AUTH_ERROR', 'Invalid API key');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(LLMProviderError);
  });
});

// ─── LLMProvider contract (interface compliance via mock) ───────────────────

describe('LLMProvider interface', () => {
  it('chat() returns a text response', async () => {
    const provider = makeMockProvider({ type: 'text', text: 'Hello!' });
    const messages: LLMMessage[] = [{ role: 'user', content: 'Hi' }];
    const response = await provider.chat({ messages });
    expect(response.type).toBe('text');
    expect(response.text).toBe('Hello!');
  });

  it('chat() returns a tool_call response', async () => {
    const toolResponse: LLMResponse = {
      type: 'tool_call',
      toolName: 'time-tracker.start',
      toolArgs: { taskName: 'coding' },
      toolCallId: 'call_abc123',
    };
    const provider = makeMockProvider(toolResponse);
    const response = await provider.chat({ messages: [{ role: 'user', content: 'start timer' }] });
    expect(response.type).toBe('tool_call');
    expect(response.toolName).toBe('time-tracker.start');
    expect(response.toolArgs).toEqual({ taskName: 'coding' });
    expect(response.toolCallId).toBe('call_abc123');
  });

  it('chat() response with usage tokens', async () => {
    const provider = makeMockProvider({
      type: 'text',
      text: 'Done.',
      usage: { promptTokens: 50, completionTokens: 10 },
    });
    const response = await provider.chat({ messages: [{ role: 'user', content: 'test' }] });
    expect(response.usage?.promptTokens).toBe(50);
    expect(response.usage?.completionTokens).toBe(10);
  });

  it('generate() returns a plain string', async () => {
    const provider = makeMockProvider({ type: 'text', text: '["time-tracker"]' });
    const result = await provider.generate({
      systemPrompt: 'Pick plugins.',
      userPrompt: 'Start a timer',
    });
    expect(typeof result).toBe('string');
    expect(result).toBe('["time-tracker"]');
  });

  it('provider has a name property', () => {
    const provider = makeMockProvider({ type: 'text', text: '' });
    expect(typeof provider.name).toBe('string');
    expect(provider.name.length).toBeGreaterThan(0);
  });
});

// ─── LLMMessage shape ──────────────────────────────────────────────────────

describe('LLMMessage', () => {
  it('accepts all valid roles', () => {
    const roles: LLMMessage['role'][] = ['system', 'user', 'assistant', 'tool'];
    for (const role of roles) {
      const msg: LLMMessage = { role, content: 'test' };
      expect(msg.role).toBe(role);
    }
  });

  it('allows null content (for assistant messages with tool calls)', () => {
    const msg: LLMMessage = { role: 'assistant', content: null, tool_calls: [] };
    expect(msg.content).toBeNull();
  });

  it('allows name on tool messages', () => {
    const msg: LLMMessage = { role: 'tool', content: '{"result":"ok"}', name: 'time-tracker.start' };
    expect(msg.name).toBe('time-tracker.start');
  });

  it('allows tool_calls on assistant messages', () => {
    const call: LLMToolCall = { id: 'call_1', name: 'time-tracker.start', arguments: { taskName: 'coding' } };
    const msg: LLMMessage = { role: 'assistant', content: null, tool_calls: [call] };
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls?.[0]?.name).toBe('time-tracker.start');
  });
});

// ─── LLMToolCall shape ─────────────────────────────────────────────────────

describe('LLMToolCall', () => {
  it('has id, name, and arguments', () => {
    const call: LLMToolCall = {
      id: 'call_xyz',
      name: 'notes.save',
      arguments: { content: 'remember this', key: 'reminder' },
    };
    expect(call.id).toBe('call_xyz');
    expect(call.name).toBe('notes.save');
    expect(call.arguments['content']).toBe('remember this');
  });

  it('allows empty arguments object', () => {
    const call: LLMToolCall = { id: 'call_1', name: 'time-tracker.status', arguments: {} };
    expect(call.arguments).toEqual({});
  });
});

// ─── LLMResponse shape ─────────────────────────────────────────────────────

describe('LLMResponse', () => {
  it('text response has type and text', () => {
    const res: LLMResponse = { type: 'text', text: 'Hello, world!' };
    expect(res.type).toBe('text');
    expect(res.text).toBe('Hello, world!');
  });

  it('tool_call response has type, toolName, toolArgs, and toolCallId', () => {
    const res: LLMResponse = {
      type: 'tool_call',
      toolName: 'todoist.add-task',
      toolArgs: { content: 'Buy milk', dueString: 'tomorrow' },
      toolCallId: 'call_001',
    };
    expect(res.type).toBe('tool_call');
    expect(res.toolName).toBe('todoist.add-task');
    expect(res.toolArgs?.['content']).toBe('Buy milk');
    expect(res.toolCallId).toBe('call_001');
  });

  it('usage is optional', () => {
    const withUsage: LLMResponse = {
      type: 'text',
      text: 'Hi',
      usage: { promptTokens: 100, completionTokens: 20 },
    };
    const withoutUsage: LLMResponse = { type: 'text', text: 'Hi' };
    expect(withUsage.usage?.promptTokens).toBe(100);
    expect(withoutUsage.usage).toBeUndefined();
  });
});
