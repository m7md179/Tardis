import { eq, desc } from 'drizzle-orm';
import { thoughtTraces } from '@tardis/db';
import { ThoughtTraceSchema } from '@tardis/shared';
import type { TardisDB } from '@tardis/db';
import type { ThoughtTrace } from '@tardis/shared';

// ─── ThoughtTracer ────────────────────────────────────────────────────────────

/**
 * Persists agent thought traces to the database and provides query methods.
 *
 * Each agent run produces a ThoughtTrace (built by the agent loop). The tracer
 * stores it and exposes retrieval methods for inspection and debugging.
 */
export class ThoughtTracer {
  constructor(private readonly db: TardisDB) {}

  /**
   * Save a completed thought trace to the database.
   * Idempotent — inserting the same trace id twice will silently be ignored.
   */
  async save(trace: ThoughtTrace): Promise<void> {
    const row: typeof thoughtTraces.$inferInsert = {
      id: trace.id,
      userMessage: trace.userMessage,
      steps: JSON.stringify(trace.steps),
      finalResponse: trace.finalResponse,
      totalDurationMs: trace.totalDurationMs,
      modelUsed: trace.modelUsed,
      tokenCount: trace.tokenCount,
      timestamp: trace.timestamp,
    };

    await this.db.insert(thoughtTraces).values(row).onConflictDoNothing();
  }

  /**
   * Retrieve a thought trace by ID.
   * Returns null if not found or if the stored data is invalid.
   */
  async getById(id: string): Promise<ThoughtTrace | null> {
    const rows = await this.db
      .select()
      .from(thoughtTraces)
      .where(eq(thoughtTraces.id, id))
      .limit(1);

    const row = rows[0];
    return row ? parseRow(row) : null;
  }

  /**
   * Retrieve the most recent thought traces, newest first.
   */
  async getRecent(limit = 20): Promise<ThoughtTrace[]> {
    const rows = await this.db
      .select()
      .from(thoughtTraces)
      .orderBy(desc(thoughtTraces.timestamp))
      .limit(limit);

    return rows.map(parseRow).filter((t): t is ThoughtTrace => t !== null);
  }

  /**
   * Count total number of stored thought traces.
   */
  async count(): Promise<number> {
    const rows = await this.db.select({ id: thoughtTraces.id }).from(thoughtTraces);
    return rows.length;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TraceRow = typeof thoughtTraces.$inferSelect;

/**
 * Reconstruct a ThoughtTrace from a DB row.
 * Validates with the Zod schema so we never return invalid traces.
 * Returns null if the row data is corrupt / out of schema.
 */
function parseRow(row: TraceRow): ThoughtTrace | null {
  let steps: unknown;
  try {
    steps = JSON.parse(row.steps);
  } catch {
    return null;
  }

  const raw = {
    id: row.id,
    userMessage: row.userMessage,
    steps,
    finalResponse: row.finalResponse,
    totalDurationMs: row.totalDurationMs ?? 0,
    modelUsed: row.modelUsed ?? '',
    ...(row.tokenCount !== null && row.tokenCount !== undefined
      ? { tokenCount: row.tokenCount }
      : {}),
    timestamp: row.timestamp,
  };

  const result = ThoughtTraceSchema.safeParse(raw);
  return result.success ? result.data : null;
}
