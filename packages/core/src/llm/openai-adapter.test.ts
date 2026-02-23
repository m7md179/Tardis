import { describe, it, expect, mock } from 'bun:test';
import { OpenAIAdapter } from './openai-adapter.js';
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

function makeToolCallResponse(name: string, args: Record<string, unknown>, callId = 'call_001') {
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
    usage: { prompt_tokens: 80, completion_tokens: 12 },
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

function mockFetchError(status: number, body: unknown = '') {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return mock(() => Promise.resolve(new Response(bodyStr, { status })));
}

function mockFetchThrow(message: string) {
  return mock(() => Promise.reject(new TypeError(message)));
}

// ─── Provider name derivation ─────────────────────────────────────────────────

describe('OpenAIAdapter provider name', () => {
  it('derives "openai" from api.openai.com', () => {
    const adapter = new OpenAIAdapter({ apiKey: 'test', model: 'gpt-4o-mini' });
    expect(adapter.name).toBe('openai');
  });

  it('derives "groq" from api.groq.com', () => {
    const adapter = new OpenAIAdapter({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk_test',
      model: 'llama-3.1-8b-instant',
    });
    expect(adapter.name).toBe('groq');
  });

  it('derives "together" from api.together.xyz', () => {
    const adapter = new OpenAIAdapter({
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: 'test',
      model: 'mistralai/Mixtral-8x7B',
    });
    expect(adapter.name).toBe('together');
  });

  it('derives "local" for localhost URLs', () => {
    const adapter = new OpenAIAdapter({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: 'local-model',
    });
    expect(adapter.name).toBe('local');
  });

  it('uses "openai-compatible" for unknown base URLs', () => {
    const adapter = new OpenAIAdapter({
      baseUrl: 'https://my-custom-api.example.com/v1',
      apiKey: 'key',
      model: 'model',
    });
    expect(adapter.name).toBe('openai-compatible');
  });
});

// ─── URL construction ─────────────────────────────────────────────────────────

describe('OpenAIAdapter URL construction', () => {
  it('uses /chat/completions path on base URL', async () => {
    const fetched: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetched.push(typeof url === 'string' ? url : url.toString());
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(fetched[0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('strips trailing slash from base URL', async () => {
    const fetched: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetched.push(typeof url === 'string' ? url : url.toString());
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({
      baseUrl: 'https://api.groq.com/openai/v1/',
      apiKey: 'key',
      model: 'llama3',
    });
    await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(fetched[0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

// ─── Authorization header ─────────────────────────────────────────────────────

describe('OpenAIAdapter authorization', () => {
  it('sends Authorization: Bearer header with API key', async () => {
    let sentHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'sk-test-key-123', model: 'gpt-4o-mini' });
    await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(sentHeaders['Authorization']).toBe('Bearer sk-test-key-123');
  });

  it('omits Authorization header when apiKey is empty', async () => {
    let sentHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: 'local',
    });
    await adapter.generate({ systemPrompt: 's', userPrompt: 'u' });
    expect(sentHeaders['Authorization']).toBeUndefined();
  });
});

// ─── chat() ──────────────────────────────────────────────────────────────────

describe('OpenAIAdapter.chat()', () => {
  it('returns text response', async () => {
    globalThis.fetch = mockFetchOk(makeTextResponse('Hello from OpenAI!')) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'Hi' }] });

    expect(res.type).toBe('text');
    expect(res.text).toBe('Hello from OpenAI!');
  });

  it('returns tool_call response', async () => {
    globalThis.fetch = mockFetchOk(
      makeToolCallResponse('todoist.add-task', { content: 'Buy milk' }, 'call_xyz')
    ) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'add task' }] });

    expect(res.type).toBe('tool_call');
    expect(res.toolName).toBe('todoist.add-task');
    expect(res.toolArgs).toEqual({ content: 'Buy milk' });
    expect(res.toolCallId).toBe('call_xyz');
  });

  it('includes usage stats', async () => {
    globalThis.fetch = mockFetchOk(
      makeTextResponse('hi', { prompt_tokens: 200, completion_tokens: 50 })
    ) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.usage?.promptTokens).toBe(200);
    expect(res.usage?.completionTokens).toBe(50);
  });

  it('sends tools in OpenAI function format', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const tool: ToolDefinition = {
      name: 'todoist.add-task',
      description: 'Create a task',
      parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
      actionType: 'direct',
    };

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    await adapter.chat({ messages: [{ role: 'user', content: 'add task' }], tools: [tool] });

    const tools = sentBody['tools'] as Array<{
      type: string;
      function: { name: string; description: string };
    }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.function.name).toBe('todoist.add-task');
  });

  it('does not include tools key when no tools provided', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(sentBody['tools']).toBeUndefined();
  });

  it('passes temperature override per call', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0 });
    expect(sentBody['temperature']).toBe(0);
  });

  it('converts tool result messages correctly', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const messages: LLMMessage[] = [
      { role: 'user', content: 'add task' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', name: 'todoist.add-task', arguments: { content: 'Buy milk' } }],
      },
      { role: 'tool', content: '{"id":"123"}', name: 'todoist.add-task' },
    ];

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    await adapter.chat({ messages });

    const sentMessages = sentBody['messages'] as Array<{
      role: string;
      tool_call_id?: string;
      content: string | null;
    }>;
    expect(sentMessages[2]?.role).toBe('tool');
    expect(sentMessages[2]?.tool_call_id).toBe('todoist.add-task');
  });
});

// ─── generate() ──────────────────────────────────────────────────────────────

describe('OpenAIAdapter.generate()', () => {
  it('returns plain text', async () => {
    globalThis.fetch = mockFetchOk(makeTextResponse('["google-calendar"]')) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    const result = await adapter.generate({
      systemPrompt: 'You are a router.',
      userPrompt: "What do I have tomorrow?",
    });
    expect(result).toBe('["google-calendar"]');
  });

  it('sends system and user messages', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(makeTextResponse('ok')), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    await adapter.generate({ systemPrompt: 'Pick plugins', userPrompt: 'Start timer' });

    const msgs = sentBody['messages'] as Array<{ role: string; content: string }>;
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toBe('Start timer');
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('OpenAIAdapter error handling', () => {
  it('throws LLMProviderError with CONNECTION_REFUSED on network failure', async () => {
    globalThis.fetch = mockFetchThrow('Connection refused') as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('CONNECTION_REFUSED');
    expect((err as LLMProviderError).providerName).toBe('openai');
  });

  it('throws LLMProviderError with HTTP_401 and includes error message', async () => {
    globalThis.fetch = mockFetchError(401, {
      error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' },
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'bad-key', model: 'gpt-4o-mini' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('HTTP_401');
    expect((err as LLMProviderError).message).toContain('Invalid API key');
  });

  it('throws LLMProviderError with HTTP_429 on rate limit', async () => {
    globalThis.fetch = mockFetchError(429, {
      error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('HTTP_429');
  });

  it('throws LLMProviderError with EMPTY_RESPONSE when choices is empty', async () => {
    globalThis.fetch = mockFetchOk({ choices: [] }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('EMPTY_RESPONSE');
  });

  it('throws LLMProviderError with INVALID_TOOL_ARGS for bad JSON in tool arguments', async () => {
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
                function: { name: 'some.tool', arguments: 'not json at all' },
              },
            ],
          },
        },
      ],
    }) as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({ apiKey: 'key', model: 'gpt-4o-mini' });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).code).toBe('INVALID_TOOL_ARGS');
  });

  it('providerName in error reflects the actual provider (groq)', async () => {
    globalThis.fetch = mockFetchThrow('ECONNREFUSED') as unknown as typeof fetch;

    const adapter = new OpenAIAdapter({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'key',
      model: 'llama3',
    });
    let err: unknown;
    try {
      await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      err = e;
    }
    expect((err as LLMProviderError).providerName).toBe('groq');
  });
});
