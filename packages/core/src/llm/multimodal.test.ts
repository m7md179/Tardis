import { describe, it, expect } from 'bun:test';
import { OpenAIAdapter } from './openai-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { contentToText, countImages, LLMProviderError } from './provider.js';
import type { LLMMessage } from './provider.js';

// ─── Multimodal plumbing (Phase E) ───────────────────────────────────────────

const IMG = 'data:image/png;base64,iVBORw0KGgo=';

function imageMessage(text: string, images: string[]): LLMMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  };
}

describe('content helpers', () => {
  it('extracts text and ignores images', () => {
    expect(contentToText(imageMessage('what is this?', [IMG]).content)).toBe('what is this?');
  });

  it('passes plain strings through', () => {
    expect(contentToText('hello')).toBe('hello');
    expect(contentToText(null)).toBe('');
  });

  it('counts images', () => {
    expect(countImages(imageMessage('x', [IMG, IMG]).content)).toBe(2);
    expect(countImages('no images here')).toBe(0);
    expect(countImages(null)).toBe(0);
  });
});

describe('OpenAIAdapter: multimodal requests', () => {
  function capturingAdapter() {
    let sent: Record<string, unknown> | null = null;
    const fakeFetch = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    return {
      adapter: new OpenAIAdapter({ model: 'm', apiKey: '', baseUrl: 'http://x/v1' }),
      get sent() {
        return sent;
      },
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  it('sends image parts through untouched', async () => {
    const cap = capturingAdapter();
    try {
      await cap.adapter.chat({ messages: [imageMessage('what is this?', [IMG])] });
      const messages = (cap.sent as { messages: LLMMessage[] }).messages;
      const parts = messages[0]!.content as { type: string }[];
      expect(Array.isArray(parts)).toBe(true);
      expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
    } finally {
      cap.restore();
    }
  });

  it('refuses more than one image in a single request', async () => {
    const cap = capturingAdapter();
    try {
      // This model blends several images into one confident wrong answer, so
      // the adapter must refuse rather than let a caller find out the hard way.
      await expect(
        cap.adapter.chat({ messages: [imageMessage('name each', [IMG, IMG])] })
      ).rejects.toThrow(/blends them into a single wrong answer/);
    } finally {
      cap.restore();
    }
  });

  it('counts images across all messages, not just the last', async () => {
    const cap = capturingAdapter();
    try {
      await expect(
        cap.adapter.chat({
          messages: [imageMessage('first', [IMG]), imageMessage('second', [IMG])],
        })
      ).rejects.toThrow(/2 images in one request/);
    } finally {
      cap.restore();
    }
  });

  it('leaves text-only requests completely unchanged', async () => {
    const cap = capturingAdapter();
    try {
      await cap.adapter.chat({ messages: [{ role: 'user', content: 'plain text' }] });
      expect((cap.sent as { messages: LLMMessage[] }).messages[0]!.content).toBe('plain text');
    } finally {
      cap.restore();
    }
  });
});

describe('OllamaAdapter: images are refused, not silently dropped', () => {
  it('throws a clear error rather than sending a question about nothing', async () => {
    const adapter = new OllamaAdapter({ model: 'qwen3:4b' });
    await expect(adapter.chat({ messages: [imageMessage('what is this?', [IMG])] })).rejects.toThrow(
      /cannot send images/
    );
  });

  it('still handles multi-part text content', async () => {
    // No image: flattening to text is correct and must not throw.
    const msg: LLMMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    };
    expect(contentToText(msg.content)).toBe('line one\nline two');
  });
});

describe('LLMProviderError shape', () => {
  it('carries a code for callers to branch on', () => {
    const err = new LLMProviderError('local', 'TOO_MANY_IMAGES', 'too many');
    expect(err.code).toBe('TOO_MANY_IMAGES');
    expect(err.providerName).toBe('local');
  });
});
