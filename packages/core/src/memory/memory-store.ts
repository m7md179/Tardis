import { eq, and, or, like, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { memories } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { MemoryEntry, MemoryType } from '@tardis/shared';

// ─── Types ───

export interface CreateMemoryParams {
  type: MemoryType;
  key: string;
  value: string;
  source?: string;
  pluginName?: string;
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
          updatedAt: now,
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

  // ─── Helpers ───

  private rowToEntry(row: typeof memories.$inferSelect): MemoryEntry {
    return {
      id: row.id,
      type: row.type as MemoryType,
      key: row.key,
      value: row.value,
      source: row.source ?? 'unknown',
      ...(row.pluginName !== null ? { pluginName: row.pluginName } : {}),
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
      createdAt: now,
      updatedAt: now,
    };
  }
}
