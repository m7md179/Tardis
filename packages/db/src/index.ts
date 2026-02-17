import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from './migrate';

export * from './schema';
export { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

const DB_DIR = process.env['TARDIS_DATA_DIR'] || '/var/lib/tardis';
const DB_PATH = process.env['TARDIS_DB_PATH'] || `${DB_DIR}/tardis.db`;

let _db: BunSQLiteDatabase | null = null;

/**
 * Get the shared database instance. Creates and migrates on first call.
 */
export function getDb(): BunSQLiteDatabase {
  if (!_db) {
    const sqlite = new Database(DB_PATH, { create: true });
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA foreign_keys = ON');
    _db = drizzle(sqlite);
    runMigrations(_db);
  }
  return _db;
}

/**
 * Close the database connection. Used for clean shutdown.
 */
export function closeDb(): void {
  _db = null;
}
