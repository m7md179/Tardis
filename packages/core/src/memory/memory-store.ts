import { eq, ne, and, or, like, desc, isNull, isNotNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { memories } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { MemoryEntry, MemoryType } from '@tardis/shared';
import { blobToVector, vectorToBlob } from './embeddings.js';

// ─── Types ───

export interface CreateMemoryParams {
  type: MemoryType;
  key: string;
  value: string;
  source?: string;
  pluginName?: string;
  /** Optional hierarchy, e.g. "finance/goals". */
  path?: string;
}

/** A memory with its stored vector, for search. */
export interface EmbeddedMemory {
  memory: MemoryEntry;
  vector: Float32Array;
}

// ─── MemoryStore ───

export class MemoryStore {
  constructor(private readonly db: TardisDB) {}

  async create(params: CreateMemoryParams): Promise<MemoryEntry> {
    const now = Date.now();
    const id = randomUUID();
    await this.db.insert(memories).values({
      id,
      type: params.type,
      key: params.key,
      value: params.value,
      source: params.source ?? null,
      pluginName: params.pluginName ?? null,
      path: params.path ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return this.toEntry(id, params, now);
  }

  async getByKey(key: string): Promise<MemoryEntry | null> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(eq(memories.key, key))
      .limit(1);
    return rows.length > 0 ? this.rowToEntry(rows[0]!) : null;
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(eq(memories.id, id))
      .limit(1);
    return rows.length > 0 ? this.rowToEntry(rows[0]!) : null;
  }

  async upsertByKey(params: CreateMemoryParams): Promise<MemoryEntry> {
    const existing = await this.getByKey(params.key);
    if (existing) {
      const now = Date.now();
      await this.db
        .update(memories)
        .set({
          value: params.value,
          type: params.type,
          source: params.source ?? null,
          pluginName: params.pluginName ?? null,
          path: params.path ?? null,
          updatedAt: now,
          // The vector described the *old* value. Leaving it would make the
          // memory findable by what it used to say, which is worse than not
          // being findable at all.
          embedding: null,
          embeddingModel: null,
        })
        .where(eq(memories.key, params.key));
      return { ...existing, value: params.value, type: params.type, updatedAt: now };
    }
    return this.create(params);
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.getByKey(key);
    if (!existing) return false;
    await this.db.delete(memories).where(eq(memories.key, key));
    return true;
  }

  async deleteById(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await this.db.delete(memories).where(eq(memories.id, id));
    return true;
  }

  async search(query: string, limit = 20): Promise<MemoryEntry[]> {
    const pattern = `%${query}%`;
    const rows = await this.db
      .select()
      .from(memories)
      .where(or(like(memories.key, pattern), like(memories.value, pattern)))
      .orderBy(desc(memories.updatedAt))
      .limit(limit);
    return rows.map((r) => this.rowToEntry(r));
  }

  async getByType(type: MemoryType, limit = 50): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(eq(memories.type, type))
      .orderBy(desc(memories.updatedAt))
      .limit(limit);
    return rows.map((r) => this.rowToEntry(r));
  }

  async getAll(limit = 200): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .orderBy(desc(memories.updatedAt))
      .limit(limit);
    return rows.map((r) => this.rowToEntry(r));
  }

  async touchAccessed(id: string): Promise<void> {
    await this.db
      .update(memories)
      .set({ accessedAt: Date.now() })
      .where(eq(memories.id, id));
  }

  async getByPlugin(pluginName: string, limit = 50): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.type, 'plugin'), eq(memories.pluginName, pluginName)))
      .orderBy(desc(memories.updatedAt))
      .limit(limit);
    return rows.map((r) => this.rowToEntry(r));
  }

  // ─── Embeddings ───
  //
  // The row is the truth and the vector is derived. Nothing here fails a write
  // because an embedder was unavailable; a row without a vector simply does not
  // participate in vector search until it is reindexed.

  /** Attach (or replace) the vector for one memory. */
  async setEmbedding(id: string, model: string, vector: Float32Array): Promise<void> {
    await this.db
      .update(memories)
      .set({ embedding: vectorToBlob(vector), embeddingModel: model })
      .where(eq(memories.id, id));
  }

  /**
   * Every memory carrying a usable vector *from this model*.
   *
   * Rows embedded by a different model are excluded rather than converted:
   * cosine between two models' spaces is meaningless, not merely inaccurate,
   * so a stale row would contribute confident nonsense.
   */
  async getEmbedded(model: string, limit = 500): Promise<EmbeddedMemory[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.embeddingModel, model), isNotNull(memories.embedding)))
      .orderBy(desc(memories.updatedAt))
      .limit(limit);

    const out: EmbeddedMemory[] = [];
    for (const row of rows) {
      const vector = blobToVector(row.embedding as Buffer | null);
      if (vector) out.push({ memory: this.rowToEntry(row), vector });
    }
    return out;
  }

  /**
   * Memories that need embedding: never embedded, or embedded by another model.
   * Drives both the reindex endpoint and catch-up after an embedder outage.
   */
  async getUnembedded(model: string, limit = 500): Promise<MemoryEntry[]> {
    // Filtered in SQL, not after the limit. Filtering afterwards would return
    // nothing whenever the newest `limit` rows happen to be up to date, which
    // is precisely when a catch-up run still has older rows to do.
    //
    // The two null checks are not redundant: in SQL `embedding_model != 'x'`
    // is NULL — and therefore false — when the column is NULL, so a row that
    // was never embedded would not match the inequality on its own.
    const rows = await this.db
      .select()
      .from(memories)
      .where(
        or(
          isNull(memories.embedding),
          isNull(memories.embeddingModel),
          ne(memories.embeddingModel, model)
        )
      )
      .orderBy(desc(memories.updatedAt))
      .limit(limit);
    return rows.map((r) => this.rowToEntry(r));
  }

  /** Drop every stored vector. Loses time, never data — see getUnembedded. */
  async clearEmbeddings(): Promise<void> {
    await this.db.update(memories).set({ embedding: null, embeddingModel: null });
  }

  // ─── Helpers ───

  private rowToEntry(row: typeof memories.$inferSelect): MemoryEntry {
    return {
      id: row.id,
      type: row.type as MemoryType,
      key: row.key,
      value: row.value,
      source: row.source ?? 'unknown',
      ...(row.pluginName !== null ? { pluginName: row.pluginName } : {}),
      ...(row.path !== null ? { path: row.path } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.accessedAt !== null ? { accessedAt: row.accessedAt } : {}),
    };
  }

  private toEntry(id: string, params: CreateMemoryParams, now: number): MemoryEntry {
    return {
      id,
      type: params.type,
      key: params.key,
      value: params.value,
      source: params.source ?? 'unknown',
      ...(params.pluginName !== undefined ? { pluginName: params.pluginName } : {}),
      ...(params.path !== undefined ? { path: params.path } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }
}
