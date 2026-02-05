/**
 * Integration Test: Storage Layer
 * Tests SessionStore with real file system operations
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from '../../src/storage/session-store';
import type { Session } from '@tardis/shared/types';

const TEST_DIR = join(process.cwd(), '.test-tardis-storage');

describe('Integration: Storage Layer', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(join(TEST_DIR, 'active_sessions'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'sessions'), { recursive: true });

    store = new SessionStore(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('Create and save active session', async () => {
    const session = await store.createSession({
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    expect(session.id).toBeDefined();
    expect(session.taskName).toBe('Test Task');
    expect(session.status).toBe('ACTIVE');

    // Verify file was created
    const activeDir = join(TEST_DIR, 'active_sessions');
    const files = readdirSync(activeDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(session.id);
  });

  test('Retrieve active session by ID', async () => {
    const created = await store.createSession({
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    const retrieved = store.getSessionById(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.taskName).toBe('Test Task');
  });

  test('List all active sessions', async () => {
    await store.createSession({ taskName: 'Task 1', status: 'ACTIVE' });
    await store.createSession({ taskName: 'Task 2', status: 'ACTIVE' });
    await store.createSession({ taskName: 'Task 3', status: 'PAUSED' });

    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(3);

    const taskNames = sessions.map((s) => s.taskName).sort();
    expect(taskNames).toEqual(['Task 1', 'Task 2', 'Task 3']);
  });

  test('Fuzzy matching: exact match', async () => {
    await store.createSession({ taskName: 'Write documentation', status: 'ACTIVE' });
    await store.createSession({ taskName: 'Code review', status: 'ACTIVE' });

    const match = store.getActiveSessionByTask('Write documentation');
    expect(match).not.toBeNull();
    expect(match?.taskName).toBe('Write documentation');
  });

  test('Fuzzy matching: case-insensitive exact', async () => {
    await store.createSession({ taskName: 'Write Documentation', status: 'ACTIVE' });

    const match = store.getActiveSessionByTask('write documentation');
    expect(match).not.toBeNull();
    expect(match?.taskName).toBe('Write Documentation');
  });

  test('Fuzzy matching: prefix match', async () => {
    await store.createSession({ taskName: 'Write documentation', status: 'ACTIVE' });

    const match = store.getActiveSessionByTask('Write');
    expect(match).not.toBeNull();
    expect(match?.taskName).toBe('Write documentation');
  });

  test('Fuzzy matching: contains match', async () => {
    await store.createSession({ taskName: 'Write API documentation', status: 'ACTIVE' });

    const match = store.getActiveSessionByTask('docs');
    expect(match).not.toBeNull();
    expect(match?.taskName).toBe('Write API documentation');
  });

  test('Fuzzy matching: no match returns null', async () => {
    await store.createSession({ taskName: 'Write documentation', status: 'ACTIVE' });

    const match = store.getActiveSessionByTask('nonexistent');
    expect(match).toBeNull();
  });

  test('Archive session on stop', async () => {
    const session = await store.createSession({
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    const stopped = store.stopSession(session.id);
    expect(stopped?.status).toBe('COMPLETED');

    // Should no longer be in active sessions
    const active = store.getActiveSessions();
    expect(active).toHaveLength(0);

    // Should be in archived sessions
    const archived = store.getArchivedSessions();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(session.id);

    // Verify file moved to date folder
    const today = new Date().toISOString().split('T')[0];
    const archiveDir = join(TEST_DIR, 'sessions', today);
    expect(existsSync(archiveDir)).toBe(true);

    const files = readdirSync(archiveDir);
    expect(files).toHaveLength(1);
  });

  test('Get archived sessions by date', async () => {
    const session1 = await store.createSession({
      taskName: 'Task 1',
      status: 'ACTIVE',
    });
    const session2 = await store.createSession({
      taskName: 'Task 2',
      status: 'ACTIVE',
    });

    store.stopSession(session1.id);
    store.stopSession(session2.id);

    const today = new Date().toISOString().split('T')[0];
    const sessions = store.getArchivedSessionsByDate(today);

    expect(sessions).toHaveLength(2);
  });

  test('Get all archived sessions', async () => {
    const session1 = await store.createSession({
      taskName: 'Task 1',
      status: 'ACTIVE',
    });
    const session2 = await store.createSession({
      taskName: 'Task 2',
      status: 'ACTIVE',
    });

    store.stopSession(session1.id);
    store.stopSession(session2.id);

    const all = store.getArchivedSessions();
    expect(all).toHaveLength(2);
  });

  test('Delete session by ID', async () => {
    const session = await store.createSession({
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    const result = store.deleteSession(session.id);
    expect(result).toBe(true);

    const retrieved = store.getSessionById(session.id);
    expect(retrieved).toBeNull();

    // File should be deleted
    const activeDir = join(TEST_DIR, 'active_sessions');
    const files = readdirSync(activeDir);
    expect(files).toHaveLength(0);
  });

  test('Delete non-existent session returns false', () => {
    const result = store.deleteSession('non-existent-id');
    expect(result).toBe(false);
  });

  test('Mark session as synced', async () => {
    const session = await store.createSession({
      taskId: 'todoist-123',
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    store.stopSession(session.id);

    expect(session.todoistSynced).toBe(false);

    store.markSynced(session.id);

    const updated = store.getSessionById(session.id);
    expect(updated?.todoistSynced).toBe(true);
  });

  test('Get unsynced completed sessions', async () => {
    // Create 3 sessions with Todoist IDs
    const session1 = await store.createSession({
      taskId: 'task-1',
      taskName: 'Task 1',
      status: 'ACTIVE',
    });
    const session2 = await store.createSession({
      taskId: 'task-2',
      taskName: 'Task 2',
      status: 'ACTIVE',
    });
    const session3 = await store.createSession({
      taskName: 'Local Task',
      status: 'ACTIVE',
    });

    // Stop all
    store.stopSession(session1.id);
    store.stopSession(session2.id);
    store.stopSession(session3.id);

    // Get unsynced (only session1 and session2, not session3 without taskId)
    const unsynced = store.getUnsyncedCompletedSessions();
    expect(unsynced).toHaveLength(2);

    const taskIds = unsynced.map((s) => s.taskId);
    expect(taskIds).toContain('task-1');
    expect(taskIds).toContain('task-2');
  });

  test('Update session duration', async () => {
    const session = await store.createSession({
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    expect(session.duration).toBe(0);

    // Wait a bit and update
    await new Promise((resolve) => setTimeout(resolve, 100));

    store.updateSessionDuration(session.id);

    const updated = store.getSessionById(session.id);
    expect(updated?.duration).toBeGreaterThan(0);
  });

  test('Concurrent session operations', async () => {
    // Create multiple sessions concurrently
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        store.createSession({
          taskName: `Task ${i}`,
          status: 'ACTIVE',
        })
      );
    }

    const sessions = await Promise.all(promises);
    expect(sessions).toHaveLength(10);

    // Verify all were saved
    const active = store.getActiveSessions();
    expect(active).toHaveLength(10);

    // Verify all have unique IDs
    const ids = new Set(sessions.map((s) => s.id));
    expect(ids.size).toBe(10);
  });

  test('Session persistence across store instances', async () => {
    const session = await store.createSession({
      taskName: 'Persistent Task',
      status: 'ACTIVE',
    });

    // Create new store instance
    const newStore = new SessionStore(TEST_DIR);

    const retrieved = newStore.getSessionById(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.taskName).toBe('Persistent Task');
  });

  test('Handle corrupted session file gracefully', async () => {
    const session = await store.createSession({
      taskName: 'Test Task',
      status: 'ACTIVE',
    });

    // Corrupt the file
    const filePath = join(TEST_DIR, 'active_sessions', `${session.id}.json`);
    require('node:fs').writeFileSync(filePath, '{ invalid json }');

    // Should skip corrupted file
    const sessions = store.getActiveSessions();
    expect(sessions).toHaveLength(0);
  });
});
