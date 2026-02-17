import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Skills the user is tracking
 */
export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(), // 'tech' | 'non-tech'
  subcategory: text('subcategory'),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Individual training/practice sessions
 */
export const trainingSessions = sqliteTable('training_sessions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  type: text('type').notNull(), // 'practice' | 'quiz' | 'challenge' | 'review'
  difficulty: integer('difficulty').notNull(), // 1-10
  score: real('score'), // 0.0-1.0, null if in progress
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  notes: text('notes'), // JSON blob for extra data
  todoistTaskId: text('todoist_task_id'),
});

/**
 * Tracks weak areas for adaptive difficulty
 */
export const weakAreas = sqliteTable('weak_areas', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  topic: text('topic').notNull(),
  severity: real('severity').notNull().default(0.5), // 0.0-1.0
  detectedAt: integer('detected_at', { mode: 'timestamp_ms' }).notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
});

/**
 * Daily/weekly snapshots for analytics
 */
export const skillSnapshots = sqliteTable('skill_snapshots', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  level: integer('level').notNull(),
  xp: integer('xp').notNull(),
  period: text('period').notNull(), // 'daily' | 'weekly'
  recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Engine configuration and calibration data
 */
export const engineConfig = sqliteTable('engine_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON-encoded
});
