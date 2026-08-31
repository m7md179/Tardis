import { describe, it, expect } from 'bun:test';
import {
  OllamaEmbedder,
  blobToVector,
  cosine,
  embeddableText,
  vectorToBlob,
} from './embeddings.js';

// ─── Storage codec ───────────────────────────────────────────────────────────

describe('vectorToBlob / blobToVector', () => {
  it('round-trips a vector exactly', () => {
    const vec = Float32Array.from([0.1, -0.2, 0.3, 1, -1, 0]);
    const back = blobToVector(vectorToBlob(vec));
    expect(back).not.toBeNull();
    expect(Array.from(back!)).toEqual(Array.from(vec));
  });

  it('round-trips a realistic 768-dimension vector', () => {
    const vec = new Float32Array(768);
    for (let i = 0; i < vec.length; i++) vec[i] = Math.sin(i) / 2;
    const blob = vectorToBlob(vec);
    expect(blob.byteLength).toBe(768 * 4);
    expect(Array.from(blobToVector(blob)!)).toEqual(Array.from(vec));
  });

  it('survives the pooled-buffer trap', () => {
    // Buffer.from(arrayBuffer) views a shared pool. If the codec returned a
    // view rather than a copy, writing an unrelated buffer afterwards could
    // rewrite a vector that had already been read out.
    const vec = Float32Array.from([1, 2, 3, 4]);
    const decoded = blobToVector(vectorToBlob(vec))!;
    Buffer.alloc(4096).fill(0xff);
    expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
  });

  it('treats an absent or empty blob as no vector', () => {
    expect(blobToVector(null)).toBeNull();
    expect(blobToVector(undefined)).toBeNull();
    expect(blobToVector(Buffer.alloc(0))).toBeNull();
  });

  it('rejects a blob that cannot be a float32 array', () => {
    // A length that is not a multiple of four is a corrupt row, not a short
    // vector — decoding it would throw deep inside a sort.
    expect(blobToVector(Buffer.alloc(7))).toBeNull();
  });
});

// ─── Similarity ──────────────────────────────────────────────────────────────

describe('cosine', () => {
  it('is 1 for identical direction and -1 for opposite', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([2, 0]))).toBeCloseTo(1, 6);
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6);
  });

  it('returns 0 rather than NaN for degenerate input', () => {
    // One zero vector or one mismatched row must not poison an entire sort.
    expect(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
    expect(cosine(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2]))).toBe(0);
    expect(cosine(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});

describe('embeddableText', () => {
  it('embeds the key alongside the value', () => {
    // The key carries real meaning: "car-savings" is half the reason
    // "what did I say about the car" finds a memory that never says "car".
    expect(embeddableText({ key: 'car-savings', value: 'Saving for a vehicle' })).toBe(
      'car-savings: Saving for a vehicle'
    );
  });
});

// ─── OllamaEmbedder ──────────────────────────────────────────────────────────

function withFetch<T>(handler: (req: Request) => Promise<Response>, fn: () => Promise<T>) {
  const original = globalThis.fetch;
  // The embedder calls fetch(url, init), so the stub normalises the two-argument
  // form into a Request rather than assuming one was passed.
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    handler(new Request(String(input), init))) as unknown as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

describe('OllamaEmbedder', () => {
  const config = { baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' };

  it('sends one batched request and preserves input order', async () => {
    let seen: unknown;
    const vectors = await withFetch(
      async (req) => {
        seen = await req.json();
        return Response.json({ embeddings: [[1, 0], [0, 1]] });
      },
      () => new OllamaEmbedder(config).embed(['first', 'second'])
    );

    expect(seen).toEqual({ model: 'nomic-embed-text', input: ['first', 'second'] });
    expect(Array.from(vectors[0]!)).toEqual([1, 0]);
    expect(Array.from(vectors[1]!)).toEqual([0, 1]);
  });

  it('does not call the service at all for an empty batch', async () => {
    let called = false;
    const out = await withFetch(
      async () => {
        called = true;
        return Response.json({ embeddings: [] });
      },
      () => new OllamaEmbedder(config).embed([])
    );
    expect(called).toBe(false);
    expect(out).toEqual([]);
  });

  it('tolerates a trailing slash on the base url', async () => {
    let url = '';
    await withFetch(
      async (req) => {
        url = req.url;
        return Response.json({ embeddings: [[1]] });
      },
      () => new OllamaEmbedder({ ...config, baseUrl: 'http://127.0.0.1:11434///' }).embed(['x'])
    );
    expect(url).toBe('http://127.0.0.1:11434/api/embed');
  });

  it('omits keep_alive entirely unless it was configured', async () => {
    // A runtime that does not know the field must never see it.
    let sent: Record<string, unknown> = {};
    await withFetch(
      async (req) => {
        sent = (await req.json()) as Record<string, unknown>;
        return Response.json({ embeddings: [[1]] });
      },
      () => new OllamaEmbedder(config).embed(['x'])
    );
    expect(sent).not.toHaveProperty('keep_alive');

    await withFetch(
      async (req) => {
        sent = (await req.json()) as Record<string, unknown>;
        return Response.json({ embeddings: [[1]] });
      },
      () => new OllamaEmbedder({ ...config, keepAlive: '1h' }).embed(['x'])
    );
    expect(sent['keep_alive']).toBe('1h');
  });

  it('throws on an error status', async () => {
    await expect(
      withFetch(
        async () => new Response('model not found', { status: 404 }),
        () => new OllamaEmbedder(config).embed(['x'])
      )
    ).rejects.toThrow(/404/);
  });

  it('throws when the count does not match the batch', async () => {
    // Silently accepting a short reply would misalign every vector with its
    // memory — a wrong answer rather than a missing one.
    await expect(
      withFetch(
        async () => Response.json({ embeddings: [[1, 0]] }),
        () => new OllamaEmbedder(config).embed(['a', 'b', 'c'])
      )
    ).rejects.toThrow(/3 inputs/);
  });
});
