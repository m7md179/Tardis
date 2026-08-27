import type { EmbedderConfig } from '@tardis/shared';

/**
 * Turns text into a vector.
 *
 * Deliberately an interface with one implementation. The embedder is the one
 * part of memory retrieval that needs a service, and TARDIS must keep working
 * without it — an unconfigured embedder means keyword-only search, which is
 * exactly what shipped before this file existed.
 */
export interface Embedder {
  /**
   * Identifies the vector space. Stored on every row this embedder writes, so
   * a row made by a different model can be excluded rather than compared —
   * cosine across two models' spaces is meaningless, not merely inaccurate.
   */
  readonly model: string;
  /** Embeds a batch. Order of results matches order of inputs. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * Ollama's /api/embed. Also the shape llama.cpp serves with `--embeddings`,
 * so a different local runtime is a config change rather than a code change.
 */
export class OllamaEmbedder implements Embedder {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly keepAlive: string | number | undefined;

  constructor(config: EmbedderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.keepAlive = config.keepAlive;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        // Omitted entirely when unset, so a runtime that does not know the
        // field never sees it.
        ...(this.keepAlive !== undefined ? { keep_alive: this.keepAlive } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Embedder ${this.model} returned ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as { embeddings?: number[][] };
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
      throw new Error(
        `Embedder ${this.model} returned ${body.embeddings?.length ?? 0} vectors for ${texts.length} inputs`
      );
    }

    return body.embeddings.map((v) => Float32Array.from(v));
  }
}

// ─── Storage codec ────────────────────────────────────────────────────────────
//
// A vector is stored as the raw little-endian float32 bytes of the row it
// describes. No JSON: 768 floats as text is ~9 KB and as bytes is 3 KB, and the
// bytes round-trip exactly.

export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToVector(blob: Buffer | Uint8Array | null | undefined): Float32Array | null {
  if (!blob || blob.byteLength === 0) return null;
  // A float32 array cannot have a byte length that is not a multiple of 4, so
  // anything else is a corrupt row rather than a short vector.
  if (blob.byteLength % 4 !== 0) return null;
  // Copy rather than view: Buffer instances share a pooled ArrayBuffer, so a
  // view would alias unrelated memory the moment the pool is reused.
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob instanceof Uint8Array ? blob : new Uint8Array(blob));
  return new Float32Array(copy.buffer);
}

// ─── Similarity ───────────────────────────────────────────────────────────────

/**
 * Cosine similarity. Returns 0 for mismatched or degenerate vectors rather than
 * NaN, so one bad row cannot poison a sort.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * The text a memory is embedded from.
 *
 * Key and value together, because keys carry real meaning — `car-savings` is
 * half the reason "what did I say about the car" finds it. Shared by writes and
 * by reindexing so the two can never disagree.
 */
export function embeddableText(memory: { key: string; value: string }): string {
  return `${memory.key}: ${memory.value}`;
}
