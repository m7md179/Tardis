import { eq, and, isNull } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { weakAreas } from './schema';
import type { TrainingSession, WeakArea, PerformanceAnalysis } from './types';
import { TrainingManager } from './training';
import { generateId } from './utils';

export class DifficultyEngine {
  private targetSuccessRate: number;

  constructor(
    private db: BunSQLiteDatabase,
    private trainingManager: TrainingManager,
    targetRate = 0.85,
  ) {
    this.targetSuccessRate = targetRate;
  }

  setTargetRate(rate: number): void {
    this.targetSuccessRate = Math.max(0.5, Math.min(0.95, rate));
  }

  getTargetRate(): number {
    return this.targetSuccessRate;
  }

  /**
   * Analyze performance for a skill based on recent completed sessions
   */
  async analyzePerformance(skillId: string): Promise<PerformanceAnalysis> {
    const sessions = await this.trainingManager.getRecentCompleted(skillId, 10);
    const completed = sessions.filter((s) => s.score !== null);

    if (completed.length === 0) {
      return {
        successRate: 0,
        trend: 'stable',
        sessionCount: 0,
        recommendedDifficulty: 5,
      };
    }

    const scores = completed.map((s) => s.score!);
    const successRate = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    // Determine trend by comparing first half vs second half
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (scores.length >= 4) {
      const mid = Math.floor(scores.length / 2);
      const firstHalf = scores.slice(mid).reduce((sum, s) => sum + s, 0) / (scores.length - mid);
      const secondHalf = scores.slice(0, mid).reduce((sum, s) => sum + s, 0) / mid;
      const diff = secondHalf - firstHalf;
      if (diff > 0.1) trend = 'improving';
      else if (diff < -0.1) trend = 'declining';
    }

    // Calculate recommended difficulty
    const currentDifficulty = completed[0]?.difficulty ?? 5;
    let recommended = currentDifficulty;

    if (successRate > 0.90) recommended = Math.min(10, currentDifficulty + 1);
    else if (successRate < 0.75) recommended = Math.max(1, currentDifficulty - 1);

    return {
      successRate,
      trend,
      sessionCount: completed.length,
      recommendedDifficulty: recommended,
    };
  }

  /**
   * Get recommended difficulty for the next training session
   */
  async getRecommendedDifficulty(skillId: string): Promise<number> {
    const analysis = await this.analyzePerformance(skillId);
    return analysis.recommendedDifficulty;
  }

  /**
   * Detect weak areas from low-score patterns
   * Flags topics where score < 0.5 on 3+ sessions
   */
  async detectWeakAreas(skillId: string, topic: string, score: number): Promise<WeakArea | null> {
    if (score >= 0.5) {
      // Check if this topic was previously weak and should be resolved
      await this.checkResolveWeakArea(skillId, topic, score);
      return null;
    }

    // Check existing weak area
    const existing = await this.db
      .select()
      .from(weakAreas)
      .where(
        and(
          eq(weakAreas.skillId, skillId),
          eq(weakAreas.topic, topic),
          isNull(weakAreas.resolvedAt),
        ),
      );

    if (existing.length > 0) {
      // Increase severity
      const area = existing[0]!;
      const newSeverity = Math.min(1, (area as any).severity + 0.15);
      await this.db
        .update(weakAreas)
        .set({ severity: newSeverity })
        .where(eq(weakAreas.id, (area as any).id));
      return { ...(area as unknown as WeakArea), severity: newSeverity };
    }

    // Create new weak area
    const id = generateId();
    const now = new Date();
    await this.db.insert(weakAreas).values({
      id,
      skillId,
      topic,
      severity: 0.5,
      detectedAt: now,
      resolvedAt: null,
    });

    return { id, skillId, topic, severity: 0.5, detectedAt: now, resolvedAt: null };
  }

  /**
   * Check if a weak area should be resolved (score > 0.8 consistently)
   */
  private async checkResolveWeakArea(skillId: string, topic: string, score: number): Promise<void> {
    if (score <= 0.8) return;

    const existing = await this.db
      .select()
      .from(weakAreas)
      .where(
        and(
          eq(weakAreas.skillId, skillId),
          eq(weakAreas.topic, topic),
          isNull(weakAreas.resolvedAt),
        ),
      );

    if (existing.length > 0) {
      const area = existing[0]!;
      const newSeverity = (area as any).severity - 0.2;
      if (newSeverity <= 0) {
        // Resolve the weak area
        await this.db
          .update(weakAreas)
          .set({ resolvedAt: new Date(), severity: 0 })
          .where(eq(weakAreas.id, (area as any).id));
      } else {
        await this.db
          .update(weakAreas)
          .set({ severity: newSeverity })
          .where(eq(weakAreas.id, (area as any).id));
      }
    }
  }

  /**
   * Get all unresolved weak areas for a skill
   */
  async getWeakAreas(skillId?: string): Promise<WeakArea[]> {
    if (skillId) {
      return this.db
        .select()
        .from(weakAreas)
        .where(
          and(eq(weakAreas.skillId, skillId), isNull(weakAreas.resolvedAt)),
        ) as Promise<WeakArea[]>;
    }
    return this.db
      .select()
      .from(weakAreas)
      .where(isNull(weakAreas.resolvedAt)) as Promise<WeakArea[]>;
  }
}
