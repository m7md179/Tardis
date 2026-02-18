import { eq, desc, and, isNull } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { trainingSessions } from './schema';
import type { TrainingSession, TrainingType } from './types';
import { generateId } from './utils';

export class TrainingManager {
  constructor(private db: BunSQLiteDatabase) {}

  async startTraining(
    skillId: string,
    type: TrainingType,
    difficulty: number,
  ): Promise<TrainingSession> {
    const id = generateId();
    const now = new Date();

    await this.db.insert(trainingSessions).values({
      id,
      skillId,
      type,
      difficulty: Math.max(1, Math.min(10, difficulty)),
      score: null,
      startedAt: now,
      completedAt: null,
      notes: null,
      todoistTaskId: null,
    });

    return {
      id,
      skillId,
      type,
      difficulty: Math.max(1, Math.min(10, difficulty)),
      score: null,
      startedAt: now,
      completedAt: null,
      notes: null,
      todoistTaskId: null,
    };
  }

  async completeTraining(
    sessionId: string,
    score: number,
    notes?: string,
  ): Promise<TrainingSession> {
    const normalizedScore = Math.max(0, Math.min(1, score));
    const now = new Date();

    await this.db
      .update(trainingSessions)
      .set({
        score: normalizedScore,
        completedAt: now,
        notes: notes ?? null,
      })
      .where(eq(trainingSessions.id, sessionId));

    const rows = await this.db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, sessionId));

    return rows[0] as TrainingSession;
  }

  async getActiveTraining(): Promise<TrainingSession | null> {
    const rows = await this.db
      .select()
      .from(trainingSessions)
      .where(isNull(trainingSessions.completedAt))
      .orderBy(desc(trainingSessions.startedAt))
      .limit(1);

    return (rows[0] as TrainingSession | undefined) ?? null;
  }

  async getHistory(skillId: string, limit = 20): Promise<TrainingSession[]> {
    return this.db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.skillId, skillId))
      .orderBy(desc(trainingSessions.startedAt))
      .limit(limit) as Promise<TrainingSession[]>;
  }

  async getRecentCompleted(skillId: string, count = 10): Promise<TrainingSession[]> {
    return this.db
      .select()
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.skillId, skillId),
          // Only completed sessions (score is not null)
        ),
      )
      .orderBy(desc(trainingSessions.completedAt))
      .limit(count) as Promise<TrainingSession[]>;
  }

  async getTotalSessionCount(skillId?: string): Promise<number> {
    if (skillId) {
      const rows = await this.db
        .select()
        .from(trainingSessions)
        .where(eq(trainingSessions.skillId, skillId));
      return rows.length;
    }
    const rows = await this.db.select().from(trainingSessions);
    return rows.length;
  }

  async getSessionsInPeriod(startDate: Date, endDate: Date): Promise<TrainingSession[]> {
    // Get all completed sessions and filter in JS for date range
    const rows = await this.db
      .select()
      .from(trainingSessions)
      .orderBy(desc(trainingSessions.completedAt));

    return (rows as TrainingSession[]).filter(
      (s) =>
        s.completedAt &&
        s.completedAt >= startDate &&
        s.completedAt <= endDate,
    );
  }
}
