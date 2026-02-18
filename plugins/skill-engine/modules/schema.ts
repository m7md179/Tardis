import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Local copy of the skill-engine DB schema.
 * Tables are created by @tardis/db migrations on the server.
 * This file only defines Drizzle table references for querying.
 */

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  subcategory: text('subcategory'),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const trainingSessions = sqliteTable('training_sessions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  type: text('type').notNull(),
  difficulty: integer('difficulty').notNull(),
  score: real('score'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  notes: text('notes'),
  todoistTaskId: text('todoist_task_id'),
});

export const weakAreas = sqliteTable('weak_areas', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  topic: text('topic').notNull(),
  severity: real('severity').notNull().default(0.5),
  detectedAt: integer('detected_at', { mode: 'timestamp_ms' }).notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
});

export const skillSnapshots = sqliteTable('skill_snapshots', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  level: integer('level').notNull(),
  xp: integer('xp').notNull(),
  period: text('period').notNull(),
  recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
});

export const engineConfig = sqliteTable('engine_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
