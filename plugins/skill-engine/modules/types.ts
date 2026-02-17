/** Skill category */
export type SkillCategory = 'tech' | 'non-tech';

/** Training session type */
export type TrainingType = 'practice' | 'quiz' | 'challenge' | 'review';

/** Snapshot period */
export type SnapshotPeriod = 'daily' | 'weekly';

/** Skill record from DB */
export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  subcategory: string | null;
  level: number;
  xp: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Training session record from DB */
export interface TrainingSession {
  id: string;
  skillId: string;
  type: TrainingType;
  difficulty: number;
  score: number | null;
  startedAt: Date;
  completedAt: Date | null;
  notes: string | null;
  todoistTaskId: string | null;
}

/** Weak area record from DB */
export interface WeakArea {
  id: string;
  skillId: string;
  topic: string;
  severity: number;
  detectedAt: Date;
  resolvedAt: Date | null;
}

/** XP award result */
export interface XPResult {
  xpEarned: number;
  newXP: number;
  newLevel: number;
  previousLevel: number;
  leveledUp: boolean;
}

/** Performance analysis result */
export interface PerformanceAnalysis {
  successRate: number;
  trend: 'improving' | 'stable' | 'declining';
  sessionCount: number;
  recommendedDifficulty: number;
}

/** Progress report for a skill */
export interface ProgressReport {
  skill: Skill;
  recentSessions: TrainingSession[];
  performance: PerformanceAnalysis;
  weakAreas: WeakArea[];
  streak: number;
}

/** Overall stats */
export interface OverallStats {
  totalSkills: number;
  totalSessions: number;
  totalXP: number;
  avgSuccessRate: number;
  currentStreak: number;
  longestStreak: number;
  skillBreakdown: { name: string; level: number; sessions: number }[];
}
