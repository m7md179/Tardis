/**
 * E2E Test: Go → TypeScript Data Migration
 * Tests automatic migration of legacy Go session format
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from '../../src/storage/session-store';
import type { Session } from '@tardis/shared/types';

const TEST_DIR = join(process.cwd(), '.test-tardis-migration');

// Legacy Go session format (from current_session.json)
const legacyGoSession = {
  ID: '550e8400-e29b-41d4-a716-446655440000',
  Task: 'Write documentation',
  TaskID: 'todoist-123',
  Status: 'ACTIVE',
  StartTime: 1705305600, // Unix timestamp: 2024-01-15 09:00:00
  EndTime: 0,
  Duration: 3600, // 1 hour in seconds
  TimeWindow: {
    Start: '09:00',
    End: '17:00',
  },
  TodoistSynced: false,
  CreatedAt: 1705305600,
  UpdatedAt: 1705309200,
};

// Another Go session with pauses
const legacyGoSessionWithPauses = {
  ID: '660e8400-e29b-41d4-a716-446655440001',
  Task: 'Code review',
  Status: 'PAUSED',
  StartTime: 1705305600,
  PausedAt: 1705307400, // 30 minutes after start
  Duration: 1800, // 30 minutes
  CreatedAt: 1705305600,
  UpdatedAt: 1705307400,
};

// Completed Go session
const legacyGoSessionCompleted = {
  ID: '770e8400-e29b-41d4-a716-446655440002',
  Task: 'Team meeting',
  Status: 'COMPLETED',
  StartTime: 1705305600,
  EndTime: 1705309200, // 1 hour after start
  Duration: 3600,
  TodoistSynced: true,
  CreatedAt: 1705305600,
  UpdatedAt: 1705309200,
};

describe('E2E: Data Migration from Go', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(join(TEST_DIR, 'active_sessions'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'sessions'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('Migrate active session from Go format', () => {
    // Write legacy Go session
    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(legacyPath, JSON.stringify(legacyGoSession, null, 2));

    // Initialize store (should auto-migrate)
    const store = new SessionStore(TEST_DIR);

    // Check migration happened
    expect(existsSync(legacyPath)).toBe(false); // Original deleted
    expect(existsSync(legacyPath + '.backup')).toBe(true); // Backup created

    // Verify migrated session
    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(1);

    const migrated = sessions[0];
    expect(migrated.id).toBe(legacyGoSession.ID);
    expect(migrated.taskName).toBe(legacyGoSession.Task);
    expect(migrated.taskId).toBe(legacyGoSession.TaskID);
    expect(migrated.status).toBe('ACTIVE');
    expect(migrated.duration).toBe(3600);
    expect(migrated.timeWindow).toEqual({
      start: '09:00',
      end: '17:00',
    });
    expect(migrated.todoistSynced).toBe(false);

    // Check timestamps converted to ISO
    expect(migrated.startTime).toContain('2024-01-15');
    expect(migrated.startTime).toContain('T');
  });

  test('Migrate paused session from Go format', () => {
    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(
      legacyPath,
      JSON.stringify(legacyGoSessionWithPauses, null, 2)
    );

    const store = new SessionStore(TEST_DIR);

    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(1);

    const migrated = sessions[0];
    expect(migrated.status).toBe('PAUSED');
    expect(migrated.pausedAt).toBeDefined();
    expect(migrated.pausedAt).toContain('T'); // ISO format
    expect(migrated.duration).toBe(1800);
  });

  test('Migrate completed session to archive', () => {
    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(
      legacyPath,
      JSON.stringify(legacyGoSessionCompleted, null, 2)
    );

    const store = new SessionStore(TEST_DIR);

    // Should not be in active sessions
    const active = store.getActiveSessions();
    expect(active).toHaveLength(0);

    // Should be archived
    const archived = store.getArchivedSessions();
    expect(archived).toHaveLength(1);

    const migrated = archived[0];
    expect(migrated.status).toBe('COMPLETED');
    expect(migrated.todoistSynced).toBe(true);
    expect(migrated.endTime).toBeDefined();
  });

  test('Migration creates backup', () => {
    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(legacyPath, JSON.stringify(legacyGoSession, null, 2));

    new SessionStore(TEST_DIR);

    // Backup should exist
    const backupPath = legacyPath + '.backup';
    expect(existsSync(backupPath)).toBe(true);

    // Backup content should match original
    const backup = JSON.parse(
      require('node:fs').readFileSync(backupPath, 'utf-8')
    );
    expect(backup.ID).toBe(legacyGoSession.ID);
    expect(backup.Task).toBe(legacyGoSession.Task);
  });

  test('No migration if no legacy file exists', () => {
    // Don't create any legacy file
    const store = new SessionStore(TEST_DIR);

    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(0);

    // No backup created
    const backupPath = join(TEST_DIR, 'current_session.json.backup');
    expect(existsSync(backupPath)).toBe(false);
  });

  test('Handle malformed legacy JSON gracefully', () => {
    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(legacyPath, '{ invalid json }');

    // Should not throw, just skip migration
    const store = new SessionStore(TEST_DIR);

    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(0);
  });

  test('Migrate session with minimal fields', () => {
    // Go session with only required fields
    const minimal = {
      ID: '880e8400-e29b-41d4-a716-446655440003',
      Task: 'Minimal task',
      Status: 'ACTIVE',
      StartTime: 1705305600,
      Duration: 0,
    };

    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(legacyPath, JSON.stringify(minimal, null, 2));

    const store = new SessionStore(TEST_DIR);

    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(1);

    const migrated = sessions[0];
    expect(migrated.id).toBe(minimal.ID);
    expect(migrated.taskName).toBe(minimal.Task);
    expect(migrated.status).toBe('ACTIVE');
    expect(migrated.duration).toBe(0);
    expect(migrated.taskId).toBeUndefined();
    expect(migrated.timeWindow).toBeUndefined();
  });

  test('Convert Unix timestamp to ISO 8601', () => {
    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(legacyPath, JSON.stringify(legacyGoSession, null, 2));

    const store = new SessionStore(TEST_DIR);

    const sessions = store.getActiveSessions();
    const migrated = sessions[0];

    // Unix timestamp 1705305600 = 2024-01-15T09:00:00Z
    expect(migrated.startTime).toContain('2024-01-15');
    expect(migrated.startTime).toMatch(/T\d{2}:\d{2}:\d{2}/);
    expect(migrated.createdAt).toContain('2024-01-15');
    expect(migrated.updatedAt).toContain('2024-01-15');
  });

  test('Convert status strings correctly', () => {
    const statuses = ['ACTIVE', 'PAUSED', 'COMPLETED'];

    for (const status of statuses) {
      // Clean test directory
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
      mkdirSync(join(TEST_DIR, 'active_sessions'), { recursive: true });
      mkdirSync(join(TEST_DIR, 'sessions'), { recursive: true });

      const session = {
        ...legacyGoSession,
        Status: status,
        ID: `${status}-id`,
      };

      const legacyPath = join(TEST_DIR, 'current_session.json');
      writeFileSync(legacyPath, JSON.stringify(session, null, 2));

      const store = new SessionStore(TEST_DIR);

      if (status === 'COMPLETED') {
        const archived = store.getArchivedSessions();
        expect(archived[0].status).toBe(status);
      } else {
        const active = store.getActiveSessions();
        expect(active[0].status).toBe(status);
      }
    }
  });

  test('Migrate session preserves all optional fields', () => {
    const fullSession = {
      ID: '990e8400-e29b-41d4-a716-446655440004',
      Task: 'Full session',
      TaskID: 'todoist-999',
      Status: 'ACTIVE',
      StartTime: 1705305600,
      EndTime: 0,
      Duration: 7200,
      TimeWindow: {
        Start: '08:00',
        End: '18:00',
      },
      PausedAt: 1705309200,
      ResumedAt: 1705310800,
      TodoistSynced: false,
      CreatedAt: 1705305600,
      UpdatedAt: 1705310800,
    };

    const legacyPath = join(TEST_DIR, 'current_session.json');
    writeFileSync(legacyPath, JSON.stringify(fullSession, null, 2));

    const store = new SessionStore(TEST_DIR);

    const sessions = store.getActiveSessions();
    const migrated = sessions[0];

    expect(migrated.taskId).toBe('todoist-999');
    expect(migrated.timeWindow).toEqual({ start: '08:00', end: '18:00' });
    expect(migrated.pausedAt).toBeDefined();
    expect(migrated.resumedAt).toBeDefined();
    expect(migrated.todoistSynced).toBe(false);
  });
});
