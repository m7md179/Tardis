import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OllamaAdapter } from './ollama-adapter.js';
import { LLMProviderError } from './provider.js';
import type { LLMMessage } from './provider.js';
import type { ToolDefinition } from '@tardis/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTextResponse(text: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  return {
    choices: [{ message: { role: 'assistant', content: text } }],
    usage,
  };
}

function makeToolCallResponse(
  name: string,
  args: Record<string, unknown>,
  callId = 'call_test_001'
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: callId,
              type: 'function' as const,
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 42, completion_tokens: 8 },
  };
}

function mockFetchOk(body: unknown) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
}

function mockFetchError(status: number, text = '') {
  return mock(() =>
    Promise.resolve(new Response(text, { status }))
  );
}

function mockFetchThrow(message: string) {
  return mock(() => Promise.reject(new TypeError(message)));
}

// ─── OllamaAdapter construction ───────────────────────────────────────────────

describe('OllamaAdapter', () => {
  it('has name "ollama"', () => {
    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    expect(adapter.name).toBe('ollama');
  });

  it('uses default base URL http://localhost:11434', async () => {
    const fetched: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetched.push(typeof url === 'string' ? url : url.toString());
      return new Response(JSON.stringify(makeTextResponse('hi')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.generate({ systemPrompt: 'sys', userPrompt: 'hi' });
    expect(fetched[0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('uses configured base URL', async () => {
    const fetched: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetched.push(typeof url === 'string' ? url : url.toString());
      return new Response(JSON.stringify(makeTextResponse('hi')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ baseUrl: 'http://ollama.local:11434', model: 'llama3' });
    await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(fetched[0]).toBe('http://ollama.local:11434/v1/chat/completions');
  });

  it('strips trailing slash from base URL', async () => {
    const fetched: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetched.push(typeof url === 'string' ? url : url.toString());
      return new Response(JSON.stringify(makeTextResponse('hi')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434/', model: 'qwen3:4b' });
    await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(fetched[0]).toBe('http://localhost:11434/v1/chat/completions');
  });
});

// ─── chat() ──────────────────────────────────────────────────────────────────

describe('OllamaAdapter.chat()', () => {
  beforeEach(() => {
    // Reset to real fetch before each test that sets its own mock
    // (Bun doesn't auto-reset globalThis.fetch between tests)
  });

  it('returns text response', async () => {
    globalThis.fetch = mockFetchOk(makeTextResponse('Hello from Ollama!')) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'Hi' }] });

    expect(res.type).toBe('text');
    expect(res.text).toBe('Hello from Ollama!');
  });

  it('returns tool_call response', async () => {
    globalThis.fetch = mockFetchOk(
      makeToolCallResponse('time-tracker.start', { taskName: 'coding' }, 'call_abc')
    ) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'start timer' }] });

    expect(res.type).toBe('tool_call');
    expect(res.toolName).toBe('time-tracker.start');
    expect(res.toolArgs).toEqual({ taskName: 'coding' });
    expect(res.toolCallId).toBe('call_abc');
  });

  it('includes usage stats in response', async () => {
    globalThis.fetch = mockFetchOk(
      makeTextResponse('hi', { prompt_tokens: 100, completion_tokens: 20 })
    ) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.usage?.promptTokens).toBe(100);
    expect(res.usage?.completionTokens).toBe(20);
  });

  it('sends tools in OpenAI function format', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const tool: ToolDefinition = {
      name: 'time-tracker.start',
      description: 'Start a timer',
      parameters: {
        type: 'object',
        properties: { taskName: { type: 'string' } },
        required: ['taskName'],
      },
      actionType: 'direct',
    };

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.chat({ messages: [{ role: 'user', content: 'start' }], tools: [tool] });

    const tools = sentBody['tools'] as Array<{
      type: string;
      function: { name: string; description: string };
    }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.function.name).toBe('time-tracker.start');
    expect(tools[0]?.function.description).toBe('Start a timer');
  });

  it('does not send tools key when no tools provided', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(sentBody['tools']).toBeUndefined();
  });

  it('sends temperature override', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b', temperature: 0.9 });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0 });
    expect(sentBody['temperature']).toBe(0);
  });

  it('sends max_tokens when provided', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 256 });
    expect(sentBody['max_tokens']).toBe(256);
  });

  it('converts tool result messages with tool_call_id from name', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const messages: LLMMessage[] = [
      { role: 'user', content: 'start timer' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', name: 'time-tracker.start', arguments: { taskName: 'coding' } }],
      },
      { role: 'tool', content: '{"started":true}', name: 'time-tracker.start' },
    ];

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.chat({ messages });

    const sentMessages = sentBody['messages'] as Array<{
      role: string;
      tool_call_id?: string;
      content: string | null;
    }>;
    const toolMsg = sentMessages[2];
    expect(toolMsg?.role).toBe('tool');
    expect(toolMsg?.tool_call_id).toBe('time-tracker.start');
    expect(toolMsg?.content).toBe('{"started":true}');
  });

  it('serializes assistant tool_calls with JSON string arguments', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', name: 'notes.save', arguments: { key: 'foo', value: 'bar' } }],
      },
    ];

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.chat({ messages });

    const sentMessages = sentBody['messages'] as Array<{
      role: string;
      tool_calls?: Array<{ function: { arguments: string } }>;
    }>;
    const toolCall = sentMessages[0]?.tool_calls?.[0];
    const parsedArgs: unknown = JSON.parse(toolCall?.function.arguments ?? '{}');
    expect(parsedArgs).toEqual({ key: 'foo', value: 'bar' });
  });
});

// ─── generate() ──────────────────────────────────────────────────────────────

describe('OllamaAdapter.generate()', () => {
  it('returns plain text', async () => {
    globalThis.fetch = mockFetchOk(makeTextResponse('["time-tracker"]')) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    const result = await adapter.generate({
      systemPrompt: 'You are a router.',
      userPrompt: 'Start a timer',
    });
    expect(result).toBe('["time-tracker"]');
  });

  it('sends system + user messages in that order', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await adapter.generate({ systemPrompt: 'Be a router', userPrompt: 'Start timer' });

    const msgs = sentBody['messages'] as Array<{ role: string; content: string }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toBe('Be a router');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toBe('Start timer');
  });

  it('returns empty string when content is null', async () => {
    globalThis.fetch = mockFetchOk({
      choices: [{ message: { role: 'assistant', content: null } }],
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    const result = await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(result).toBe('');
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('OllamaAdapter error handling', () => {
  it('throws LLMProviderError with CONNECTION_REFUSED when Ollama is not running', async () => {
    globalThis.fetch = mockFetchThrow('Connection refused') as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('CONNECTION_REFUSED');
    expect((err as LLMProviderError).providerName).toBe('ollama');
    expect((err as LLMProviderError).message).toContain('Connection refused');
  });

  it('throws LLMProviderError with HTTP_404 on 404 response', async () => {
    globalThis.fetch = mockFetchError(404, 'Not Found') as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('HTTP_404');
  });

  it('throws LLMProviderError with HTTP_500 on server error', async () => {
    globalThis.fetch = mockFetchError(500, 'Internal Server Error') as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('HTTP_500');
  });

  it('throws LLMProviderError with EMPTY_RESPONSE when choices is empty', async () => {
    globalThis.fetch = mockFetchOk({ choices: [] }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('EMPTY_RESPONSE');
  });

  it('throws LLMProviderError with INVALID_TOOL_ARGS when tool arguments are not valid JSON', async () => {
    globalThis.fetch = mockFetchOk({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'some.tool', arguments: '{not valid json}' },
              },
            ],
          },
        },
      ],
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('INVALID_TOOL_ARGS');
  });

  it('generate() also throws CONNECTION_REFUSED when Ollama is not running', async () => {
    globalThis.fetch = mockFetchThrow('ECONNREFUSED') as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    let err: unknown;
    try {
      await adapter.generate({ systemPrompt: 'sys', userPrompt: 'user' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('CONNECTION_REFUSED');
  });
});
