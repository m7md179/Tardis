import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema.js';

export type TardisDB = ReturnType<typeof createDb>;

export function createDb(dbPath: string): ReturnType<typeof drizzle<typeof schema>> {
  const sqlite = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  return drizzle(sqlite, { schema });
}
