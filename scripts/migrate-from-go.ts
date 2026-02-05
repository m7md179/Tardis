#!/usr/bin/env bun
/**
 * Migration script to convert Go TARDIS data to TypeScript format
 * Automatically detects and migrates:
 * - Legacy current_session.json
 * - Old session format in sessions/
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { Session, SessionSchema } from '@tardis/shared';

const TARDIS_DIR = join(homedir(), '.tardis');
const LEGACY_SESSION_FILE = join(TARDIS_DIR, 'current_session.json');
const ACTIVE_SESSIONS_DIR = join(TARDIS_DIR, 'active_sessions');
const SESSIONS_DIR = join(TARDIS_DIR, 'sessions');
const BACKUP_SUFFIX = '.backup';

interface MigrationStats {
  activeMigrated: number;
  archivedMigrated: number;
  errors: number;
  skipped: number;
}

/**
 * Main migration function
 */
async function migrate(): Promise<void> {
  console.log('🔄 TARDIS Go → TypeScript Migration\n');

  if (!existsSync(TARDIS_DIR)) {
    console.log('✓ No TARDIS data found. Nothing to migrate.');
    process.exit(0);
  }

  const stats: MigrationStats = {
    activeMigrated: 0,
    archivedMigrated: 0,
    errors: 0,
    skipped: 0,
  };

  // Step 1: Migrate legacy current_session.json
  console.log('Step 1: Checking for legacy current_session.json...');
  await migrateLegacySession(stats);

  // Step 2: Migrate old archived sessions
  console.log('\nStep 2: Checking archived sessions...');
  await migrateArchivedSessions(stats);

  // Step 3: Show summary
  console.log('\n' + '='.repeat(50));
  console.log('Migration Summary:');
  console.log('='.repeat(50));
  console.log(`✓ Active sessions migrated:   ${stats.activeMigrated}`);
  console.log(`✓ Archived sessions migrated: ${stats.archivedMigrated}`);
  console.log(`⚠ Skipped (invalid):          ${stats.skipped}`);
  console.log(`✗ Errors:                     ${stats.errors}`);

  if (stats.activeMigrated > 0 || stats.archivedMigrated > 0) {
    console.log('\n✓ Migration completed successfully!');
    console.log('\nBackup files created with .backup extension');
    console.log('You can safely delete them after verifying the migration.');
  } else {
    console.log('\n✓ No data needed migration.');
  }
}

/**
 * Migrate legacy current_session.json to active_sessions/
 */
async function migrateLegacySession(stats: MigrationStats): Promise<void> {
  if (!existsSync(LEGACY_SESSION_FILE)) {
    console.log('  No legacy current_session.json found.');
    return;
  }

  try {
    // Read and backup
    const content = readFileSync(LEGACY_SESSION_FILE, 'utf-8');
    writeFileSync(LEGACY_SESSION_FILE + BACKUP_SUFFIX, content);

    const data = JSON.parse(content);

    // Convert from Go format
    const session = convertGoSession(data);

    // Validate
    const validated = SessionSchema.parse(session);

    // Only migrate if not completed
    if (validated.status !== 'COMPLETED') {
      // Ensure active_sessions directory exists
      if (!existsSync(ACTIVE_SESSIONS_DIR)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(ACTIVE_SESSIONS_DIR, { recursive: true });
      }

      const filename = `${sanitizeTaskName(validated.taskName)}_${new Date(validated.startTime).getTime()}.json`;
      const targetPath = join(ACTIVE_SESSIONS_DIR, filename);

      writeFileSync(targetPath, JSON.stringify(validated, null, 2));

      console.log(`  ✓ Migrated active session: ${validated.taskName}`);
      stats.activeMigrated++;
    } else {
      console.log(`  ⚠ Skipped completed session: ${validated.taskName}`);
      stats.skipped++;
    }

    // Remove original file (backup exists)
    const { unlinkSync } = await import('fs');
    unlinkSync(LEGACY_SESSION_FILE);
  } catch (error) {
    console.error(`  ✗ Error migrating current_session.json:`, error);
    stats.errors++;
  }
}

/**
 * Migrate archived sessions from old format
 */
async function migrateArchivedSessions(stats: MigrationStats): Promise<void> {
  if (!existsSync(SESSIONS_DIR)) {
    console.log('  No archived sessions directory found.');
    return;
  }

  try {
    const items = readdirSync(SESSIONS_DIR);

    for (const item of items) {
      const itemPath = join(SESSIONS_DIR, item);
      const stat = statSync(itemPath);

      if (stat.isDirectory()) {
        // This is already a date directory (new format)
        continue;
      }

      if (!item.endsWith('.json') || item.endsWith('.backup')) {
        continue;
      }

      // Old format: flat JSON files in sessions/
      try {
        const content = readFileSync(itemPath, 'utf-8');
        writeFileSync(itemPath + BACKUP_SUFFIX, content);

        const data = JSON.parse(content);
        const session = convertGoSession(data);
        const validated = SessionSchema.parse(session);

        // Create date directory
        const date = new Date(validated.startTime);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const dateDir = join(SESSIONS_DIR, dateStr);

        if (!existsSync(dateDir)) {
          const { mkdirSync } = await import('fs');
          mkdirSync(dateDir, { recursive: true });
        }

        // Move to date directory with new filename
        const filename = `${sanitizeTaskName(validated.taskName)}_${date.getTime()}.json`;
        const targetPath = join(dateDir, filename);

        writeFileSync(targetPath, JSON.stringify(validated, null, 2));

        // Remove old file (backup exists)
        const { unlinkSync } = await import('fs');
        unlinkSync(itemPath);

        console.log(`  ✓ Migrated: ${validated.taskName} (${dateStr})`);
        stats.archivedMigrated++;
      } catch (error) {
        console.error(`  ✗ Error migrating ${item}:`, error);
        stats.errors++;
      }
    }
  } catch (error) {
    console.error(`  ✗ Error scanning sessions directory:`, error);
    stats.errors++;
  }
}

/**
 * Convert Go session format to TypeScript format
 */
function convertGoSession(data: any): Session {
  // Handle both Go (PascalCase) and mixed formats
  const id = data.ID || data.id || generateUUID();
  const taskId = data.TaskID || data.taskId;
  const taskName = data.Task || data.taskName || 'Unknown Task';
  const status = mapStatus(data.Status || data.status || 'COMPLETED');
  const startTime = convertTimestamp(data.StartTime || data.startTime || Date.now() / 1000);
  const endTime = data.EndTime || data.endTime
    ? convertTimestamp(data.EndTime || data.endTime)
    : undefined;
  const pausedAt = data.PausedAt || data.pausedAt
    ? convertTimestamp(data.PausedAt || data.pausedAt)
    : undefined;
  const resumedAt = data.ResumedAt || data.resumedAt
    ? convertTimestamp(data.ResumedAt || data.resumedAt)
    : undefined;
  const duration = data.Duration || data.duration || 0;
  const timeWindow = data.TimeWindow || data.timeWindow;
  const todoistSynced = data.TodoistSynced || data.todoistSynced || false;
  const createdAt =
    data.CreatedAt || data.createdAt
      ? convertTimestamp(data.CreatedAt || data.createdAt)
      : startTime;
  const updatedAt = new Date().toISOString();

  return {
    id,
    taskId,
    taskName,
    status,
    startTime,
    endTime,
    pausedAt,
    resumedAt,
    duration,
    timeWindow,
    todoistSynced,
    createdAt,
    updatedAt,
  };
}

/**
 * Convert Unix timestamp to ISO string
 */
function convertTimestamp(timestamp: number | string): string {
  if (typeof timestamp === 'string') {
    // Already ISO format or invalid
    return timestamp;
  }

  // Unix timestamp (seconds)
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Map Go status to TypeScript status
 */
function mapStatus(status: string): 'ACTIVE' | 'PAUSED' | 'COMPLETED' {
  const upper = status.toUpperCase();
  if (upper === 'ACTIVE' || upper === 'RUNNING') {
    return 'ACTIVE';
  }
  if (upper === 'PAUSED') {
    return 'PAUSED';
  }
  return 'COMPLETED';
}

/**
 * Sanitize task name for use in filename
 */
function sanitizeTaskName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .substring(0, 50);
}

/**
 * Generate a simple UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Run migration
migrate().catch((error) => {
  console.error('\n✗ Migration failed:', error);
  process.exit(1);
});
