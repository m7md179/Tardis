import { Database } from 'bun:sqlite';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_args TEXT,
    tool_result TEXT,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT,
    plugin_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    accessed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS thought_traces (
    id TEXT PRIMARY KEY,
    user_message TEXT NOT NULL,
    steps TEXT NOT NULL,
    final_response TEXT,
    total_duration_ms INTEGER,
    model_used TEXT,
    token_count INTEGER,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_storage (
    id TEXT PRIMARY KEY,
    plugin_name TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS proactive_settings (
    id TEXT PRIMARY KEY,
    plugin_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    schedule TEXT NOT NULL,
    config TEXT,
    quiet_hours_start TEXT,
    quiet_hours_end TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    task_name TEXT NOT NULL,
    status TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER,
    paused_at INTEGER,
    accumulated_time INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`,
];

export function migrate(dbPath: string): void {
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  for (const stmt of STATEMENTS) {
    sqlite.exec(stmt);
  }

  sqlite.close();
  console.log(`Migrated database at: ${dbPath}`);
}

// CLI entry point: bun run packages/db/src/migrate.ts [db-path]
if (import.meta.main) {
  const dbPath = process.argv[2] ?? './tardis.db';
  migrate(dbPath);
}
