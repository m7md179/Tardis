import { eq, desc } from 'drizzle-orm';
import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { skillSnapshots } from '@tardis/db';
import type { PluginAPI } from '@tardis/shared';
import type { Skill, OverallStats, ProgressReport } from './types';
import { SkillRegistry } from './registry';
import { TrainingManager } from './training';
import { DifficultyEngine } from './difficulty';
import { generateId } from './utils';

export class AnalyticsEngine {
  constructor(
    private db: BunSQLiteDatabase,
    private registry: SkillRegistry,
    private training: TrainingManager,
    private difficulty: DifficultyEngine,
  ) {}

  /**
   * Take a snapshot of all skills' current levels
   */
  async takeSnapshot(period: 'daily' | 'weekly'): Promise<void> {
    const allSkills = await this.registry.listSkills();
    const now = new Date();

    for (const skill of allSkills) {
      await this.db.insert(skillSnapshots).values({
        id: generateId(),
        skillId: skill.id,
        level: skill.level,
        xp: skill.xp,
        period,
        recordedAt: now,
      });
    }
  }

  /**
   * Get progress report for a specific skill
   */
  async getProgress(skillId: string): Promise<ProgressReport | null> {
    const skill = await this.registry.getSkillById(skillId);
    if (!skill) return null;

    const recentSessions = await this.training.getHistory(skillId, 10);
    const performance = await this.difficulty.analyzePerformance(skillId);
    const weakAreas = await this.difficulty.getWeakAreas(skillId);
    const streak = await this.getSkillStreak(skillId);

    return { skill, recentSessions, performance, weakAreas, streak };
  }

  /**
   * Get overall stats across all skills
   */
  async getOverallStats(periodDays = 30): Promise<OverallStats> {
    const allSkills = await this.registry.listSkills();
    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    let totalSessions = 0;
    let totalXP = 0;
    let totalScore = 0;
    let scoredCount = 0;
    const skillBreakdown: { name: string; level: number; sessions: number }[] = [];

    for (const skill of allSkills) {
      const sessions = await this.training.getSessionsInPeriod(cutoff, now);
      const skillSessions = sessions.filter((s) => s.skillId === skill.id);
      const count = skillSessions.length;
      totalSessions += count;
      totalXP += skill.xp;

      for (const s of skillSessions) {
        if (s.score !== null) {
          totalScore += s.score;
          scoredCount++;
        }
      }

      skillBreakdown.push({ name: skill.name, level: skill.level, sessions: count });
    }

    const currentStreak = await this.getGlobalStreak();

    return {
      totalSkills: allSkills.length,
      totalSessions,
      totalXP,
      avgSuccessRate: scoredCount > 0 ? totalScore / scoredCount : 0,
      currentStreak,
      longestStreak: currentStreak, // Simplified; a full implementation would track historical max
      skillBreakdown,
    };
  }

  /**
   * Calculate consecutive training days (streak) for a skill
   */
  private async getSkillStreak(skillId: string): Promise<number> {
    const sessions = await this.training.getHistory(skillId, 90);
    return this.calculateStreak(sessions);
  }

  /**
   * Calculate global consecutive training days
   */
  private async getGlobalStreak(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const sessions = await this.training.getSessionsInPeriod(cutoff, new Date());
    return this.calculateStreak(sessions);
  }

  /**
   * Calculate streak from sessions by checking consecutive days
   */
  private calculateStreak(sessions: { completedAt: Date | null }[]): number {
    const completed = sessions.filter((s) => s.completedAt);
    if (completed.length === 0) return 0;

    // Get unique training days
    const days = new Set<string>();
    for (const s of completed) {
      if (s.completedAt) {
        const d = s.completedAt;
        days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      }
    }

    // Count backwards from today
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 90; i++) {
      const check = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
      if (days.has(key)) {
        streak++;
      } else if (i > 0) {
        // Allow skipping today (might not have trained yet)
        break;
      }
    }

    return streak;
  }

  /**
   * Create Todoist tasks for weak areas and stale skills
   */
  async createTrainingTasks(api: PluginAPI): Promise<string[]> {
    const created: string[] = [];

    // Task for unresolved weak areas
    const allWeakAreas = await this.difficulty.getWeakAreas();
    for (const wa of allWeakAreas) {
      const skill = await this.registry.getSkillById(wa.skillId);
      if (!skill) continue;

      const content = `Practice ${skill.name}: ${wa.topic}`;
      try {
        await api.tasks.create(content, `Weak area (severity: ${wa.severity.toFixed(1)})`, 'today');
        created.push(content);
      } catch {
        // Todoist might be unavailable
      }
    }

    // Tasks for skills not practiced in 3+ days
    const allSkills = await this.registry.listSkills();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    for (const skill of allSkills) {
      const recent = await this.training.getHistory(skill.id, 1);
      const lastSession = recent[0];
      if (!lastSession || (lastSession.completedAt && lastSession.completedAt < threeDaysAgo)) {
        const content = `Training reminder: Practice ${skill.name}`;
        try {
          await api.tasks.create(content, `No practice in 3+ days`, 'today');
          created.push(content);
        } catch {
          // Todoist might be unavailable
        }
      }
    }

    return created;
  }

  /**
   * Get recent snapshots for a skill
   */
  async getSnapshots(skillId: string, limit = 30): Promise<unknown[]> {
    return this.db
      .select()
      .from(skillSnapshots)
      .where(eq(skillSnapshots.skillId, skillId))
      .orderBy(desc(skillSnapshots.recordedAt))
      .limit(limit);
  }
}
