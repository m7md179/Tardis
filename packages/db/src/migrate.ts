import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';

/**
 * Run migrations to create tables if they don't exist.
 * Uses CREATE TABLE IF NOT EXISTS for idempotency.
 */
export function runMigrations(db: BunSQLiteDatabase): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id),
      type TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      score REAL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      notes TEXT,
      todoist_task_id TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS weak_areas (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id),
      topic TEXT NOT NULL,
      severity REAL NOT NULL DEFAULT 0.5,
      detected_at INTEGER NOT NULL,
      resolved_at INTEGER
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS skill_snapshots (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id),
      level INTEGER NOT NULL,
      xp INTEGER NOT NULL,
      period TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS engine_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Useful indexes
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_training_skill ON training_sessions(skill_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_training_completed ON training_sessions(completed_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_weak_areas_skill ON weak_areas(skill_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_snapshots_skill ON skill_snapshots(skill_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_snapshots_recorded ON skill_snapshots(recorded_at)`);
}
