import { Database } from 'bun:sqlite';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_calls TEXT,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT,
    plugin_name TEXT,
    path TEXT,
    embedding BLOB,
    embedding_model TEXT,
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
    quiet_hours_end TEXT,
    next_run_at INTEGER
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
  `CREATE TABLE IF NOT EXISTS proactive_logs (
    id TEXT PRIMARY KEY,
    plugin_name TEXT NOT NULL,
    trigger_name TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    timestamp INTEGER NOT NULL,
    duration_ms INTEGER
  )`,
];

// Incremental migrations for existing databases
const ALTER_STATEMENTS: Array<{ check: string; alter: string }> = [
  {
    // Add chat_id column to conversations if missing (existing DBs)
    check: `SELECT COUNT(*) as cnt FROM pragma_table_info('conversations') WHERE name='chat_id'`,
    alter: `ALTER TABLE conversations ADD COLUMN chat_id TEXT NOT NULL DEFAULT ''`,
  },
  {
    // Add tool_calls column to conversations if missing (replaces tool_args)
    check: `SELECT COUNT(*) as cnt FROM pragma_table_info('conversations') WHERE name='tool_calls'`,
    alter: `ALTER TABLE conversations ADD COLUMN tool_calls TEXT`,
  },
  {
    // When this trigger next fires, so "when will you next tell me about my
    // spending?" is a lookup rather than a simulation of the matcher.
    check: `SELECT COUNT(*) as cnt FROM pragma_table_info('proactive_settings') WHERE name='next_run_at'`,
    alter: `ALTER TABLE proactive_settings ADD COLUMN next_run_at INTEGER`,
  },
  {
    // Hierarchy for memories. Costs one nullable column now and is painful to
    // retrofit later, so it goes in while the schema is open.
    check: `SELECT COUNT(*) as cnt FROM pragma_table_info('memories') WHERE name='path'`,
    alter: `ALTER TABLE memories ADD COLUMN path TEXT`,
  },
  {
    // The vector lives on the row it describes. There is no separate index to
    // drift out of sync — the row is the truth and the embedding is derived,
    // rebuildable at any time from `value` via POST /api/memories/reindex.
    check: `SELECT COUNT(*) as cnt FROM pragma_table_info('memories') WHERE name='embedding'`,
    alter: `ALTER TABLE memories ADD COLUMN embedding BLOB`,
  },
  {
    // Which model produced the blob. A row embedded by a different model than
    // the one now configured is stale and must be ignored, not compared —
    // cosine between two models' spaces is meaningless, not merely inaccurate.
    check: `SELECT COUNT(*) as cnt FROM pragma_table_info('memories') WHERE name='embedding_model'`,
    alter: `ALTER TABLE memories ADD COLUMN embedding_model TEXT`,
  },
];

export function migrate(dbPath: string): void {
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  for (const stmt of STATEMENTS) {
    sqlite.exec(stmt);
  }

  // Incremental: add columns to existing tables
  for (const { check, alter } of ALTER_STATEMENTS) {
    const row = sqlite.query<{ cnt: number }, []>(check).get();
    if (row && row.cnt === 0) {
      sqlite.exec(alter);
    }
  }

  // Index for efficient per-chat history lookup
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS conversations_chat_ts ON conversations (chat_id, timestamp)`
  );

  sqlite.close();
  console.log(`Migrated database at: ${dbPath}`);
}

// CLI entry point: bun run packages/db/src/migrate.ts [db-path]
if (import.meta.main) {
  const dbPath = process.argv[2] ?? './tardis.db';
  migrate(dbPath);
}
