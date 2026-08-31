import type { MemoryEntry } from '@tardis/shared';
import type { MemoryStore } from './memory-store.js';
import type { Embedder } from './embeddings.js';
import { cosine, embeddableText } from './embeddings.js';
import { leadingCluster } from './vector-search.js';

/** How many memories to embed per request when rebuilding. */
const REINDEX_BATCH = 32;

export interface ReindexResult {
  indexed: number;
  failed: number;
  model: string;
}

/**
 * Owns everything vector: writing embeddings, rebuilding them, and searching
 * with them.
 *
 * Both consumers — the automatic per-turn retriever and the `memory.recall`
 * tool the model calls explicitly — go through `similar()` here, so there is
 * one definition of "close enough to believe" rather than two that drift.
 *
 * **The row is the truth.** Every embedding is derived from the row's own text
 * and can be thrown away and rebuilt at any time. Nothing in this class can
 * lose a memory; the worst it can do is cost time.
 */
export class MemoryIndexer {
  constructor(
    private readonly store: MemoryStore,
    private readonly embedder: Embedder
  ) {}

  get model(): string {
    return this.embedder.model;
  }

  /**
   * Embed one memory. Safe to call fire-and-forget from a write path: a save
   * must not fail because an optional index was unreachable, so this resolves
   * false rather than throwing.
   */
  async indexOne(memory: Pick<MemoryEntry, 'id' | 'key' | 'value'>): Promise<boolean> {
    try {
      const [vector] = await this.embedder.embed([embeddableText(memory)]);
      if (!vector) return false;
      await this.store.setEmbedding(memory.id, this.embedder.model, vector);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Embed everything that needs it — never embedded, or embedded by a different
   * model. Idempotent, so it doubles as catch-up after an embedder outage.
   *
   * `full` drops every stored vector first, for when the model itself changed
   * under the same name.
   */
  async reindexAll(full = false): Promise<ReindexResult> {
    if (full) await this.store.clearEmbeddings();

    let indexed = 0;
    let failed = 0;

    // Re-queried each round rather than paged: successful rows drop out of the
    // pending set, so a fixed offset would skip work.
    for (;;) {
      const pending = await this.store.getUnembedded(this.embedder.model, REINDEX_BATCH);
      if (pending.length === 0) break;

      try {
        const vectors = await this.embedder.embed(pending.map(embeddableText));
        for (let i = 0; i < pending.length; i++) {
          const vector = vectors[i];
          const memory = pending[i]!;
          if (!vector) {
            failed++;
            continue;
          }
          await this.store.setEmbedding(memory.id, this.embedder.model, vector);
          indexed++;
        }
      } catch {
        // The batch is unreachable, not merely awkward. Stop rather than
        // spinning: the pending set is unchanged, so the next call resumes.
        failed += pending.length;
        break;
      }
    }

    return { indexed, failed, model: this.embedder.model };
  }

  /**
   * Memories that stand out as a match for this text, or none.
   *
   * See `vector-search.ts` for why the gate is a margin rather than a
   * similarity floor — measured, not assumed.
   *
   * Never throws. Retrieval is an enhancement to a turn; a turn that failed
   * because an optional index was down would be a worse product than one that
   * answers without it.
   */
  async similar(text: string): Promise<MemoryEntry[]> {
    try {
      const embedded = await this.store.getEmbedded(this.embedder.model);
      if (embedded.length === 0) return [];

      const [query] = await this.embedder.embed([text]);
      if (!query) return [];

      // A plain scan. Measured at 0.26 ms for 500 memories and 19 ms for
      // 50,000, against a turn that already costs seconds of inference — so an
      // index would buy nothing here, and sqlite-vec cannot load into
      // bun:sqlite regardless ("This build of sqlite3 does not support dynamic
      // extension loading").
      const ranked = embedded
        .map(({ memory, vector }) => ({ item: memory, score: cosine(query, vector) }))
        .sort((a, b) => b.score - a.score);

      return leadingCluster(ranked);
    } catch {
      return [];
    }
  }
}
