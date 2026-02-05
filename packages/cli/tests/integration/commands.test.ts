/**
 * Integration Test: All Commands Working Together
 * Tests complete CLI workflows with all commands
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from '../../src/storage/session-store';

const TEST_DIR = join(process.cwd(), '.test-tardis-commands');

describe('Integration: Commands Working Together', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(join(TEST_DIR, 'active_sessions'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'sessions'), { recursive: true });

    process.env.TARDIS_DIR = TEST_DIR;
    store = new SessionStore(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    delete process.env.TARDIS_DIR;
  });

  test('Workflow: start → status → stop', async () => {
    // Start session
    const session = await store.createSession({
      taskName: 'Development work',
      status: 'ACTIVE',
      timeWindow: { start: '09:00', end: '17:00' },
    });

    // Check status
    const active = store.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('ACTIVE');

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Stop session
    const stopped = store.stopSession(session.id);
    expect(stopped?.status).toBe('COMPLETED');

    // Status should show no active sessions
    const afterStop = store.getActiveSessions();
    expect(afterStop).toHaveLength(0);
  });

  test('Workflow: start → pause → status → resume → stop', async () => {
    // Start
    const session = await store.createSession({
      taskName: 'Code review',
      status: 'ACTIVE',
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Pause
    const paused = store.pauseSession(session.id);
    expect(paused?.status).toBe('PAUSED');

    // Check status shows paused
    const status1 = store.getSessionById(session.id);
    expect(status1?.status).toBe('PAUSED');

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Resume
    const resumed = store.resumeSession(session.id);
    expect(resumed?.status).toBe('ACTIVE');

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Stop
    const stopped = store.stopSession(session.id);
    expect(stopped?.status).toBe('COMPLETED');
    expect(stopped?.duration).toBeGreaterThan(800); // ~1000ms work, ~200ms pause
  });

  test('Workflow: start multiple → list → stop specific', async () => {
    // Start 3 sessions
    const session1 = await store.createSession({
      taskName: 'Task 1',
      status: 'ACTIVE',
    });
    const session2 = await store.createSession({
      taskName: 'Task 2',
      status: 'ACTIVE',
    });
    const session3 = await store.createSession({
      taskName: 'Task 3',
      status: 'ACTIVE',
    });

    // List all
    const list = store.getActiveSessions();
    expect(list).toHaveLength(3);

    // Stop specific one
    store.stopSession(session2.id);

    // List should show 2
    const afterStop = store.getActiveSessions();
    expect(afterStop).toHaveLength(2);

    const remaining = afterStop.map((s) => s.taskName);
    expect(remaining).toContain('Task 1');
    expect(remaining).toContain('Task 3');
    expect(remaining).not.toContain('Task 2');
  });

  test('Workflow: start → stop → log', async () => {
    // Create and stop 3 sessions
    for (let i = 1; i <= 3; i++) {
      const session = await store.createSession({
        taskName: `Task ${i}`,
        status: 'ACTIVE',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      store.stopSession(session.id);
    }

    // Log should show all 3
    const today = new Date().toISOString().split('T')[0];
    const log = store.getArchivedSessionsByDate(today);

    expect(log).toHaveLength(3);
    const taskNames = log.map((s) => s.taskName).sort();
    expect(taskNames).toEqual(['Task 1', 'Task 2', 'Task 3']);
  });

  test('Workflow: start → stop → delete', async () => {
    const session = await store.createSession({
      taskName: 'Temporary task',
      status: 'ACTIVE',
    });

    store.stopSession(session.id);

    // Should be in archived
    const archived = store.getArchivedSessions();
    expect(archived).toHaveLength(1);

    // Delete
    const deleted = store.deleteSession(session.id);
    expect(deleted).toBe(true);

    // Should no longer be in archived
    const afterDelete = store.getArchivedSessions();
    expect(afterDelete).toHaveLength(0);
  });

  test('Workflow: start multiple → wipe all', async () => {
    // Create active sessions
    await store.createSession({ taskName: 'Active 1', status: 'ACTIVE' });
    await store.createSession({ taskName: 'Active 2', status: 'ACTIVE' });

    // Create archived sessions
    const session3 = await store.createSession({
      taskName: 'Completed 1',
      status: 'ACTIVE',
    });
    store.stopSession(session3.id);

    expect(store.getActiveSessions()).toHaveLength(2);
    expect(store.getArchivedSessions()).toHaveLength(1);

    // Wipe all
    const allSessions = [
      ...store.getActiveSessions(),
      ...store.getArchivedSessions(),
    ];

    for (const session of allSessions) {
      store.deleteSession(session.id);
    }

    // All should be gone
    expect(store.getActiveSessions()).toHaveLength(0);
    expect(store.getArchivedSessions()).toHaveLength(0);
  });

  test('Workflow: fuzzy task matching across commands', async () => {
    // Start with full name
    const session = await store.createSession({
      taskName: 'Write API documentation',
      status: 'ACTIVE',
    });

    // Find by exact match
    const match1 = store.getActiveSessionByTask('Write API documentation');
    expect(match1?.id).toBe(session.id);

    // Find by prefix
    const match2 = store.getActiveSessionByTask('Write');
    expect(match2?.id).toBe(session.id);

    // Find by contains
    const match3 = store.getActiveSessionByTask('docs');
    expect(match3?.id).toBe(session.id);

    // Pause using fuzzy match
    const paused = store.pauseSession(match3!.id);
    expect(paused?.status).toBe('PAUSED');

    // Resume using fuzzy match
    const resumed = store.resumeSession(match2!.id);
    expect(resumed?.status).toBe('ACTIVE');

    // Stop using fuzzy match
    const stopped = store.stopSession(match1!.id);
    expect(stopped?.status).toBe('COMPLETED');
  });

  test('Workflow: session with time window tracking', async () => {
    const timeWindow = { start: '09:00', end: '17:00' };

    const session = await store.createSession({
      taskName: 'Morning development',
      status: 'ACTIVE',
      timeWindow,
    });

    expect(session.timeWindow).toEqual(timeWindow);

    // Status should show time window
    const status = store.getSessionById(session.id);
    expect(status?.timeWindow).toEqual(timeWindow);

    // After stop, time window should persist
    store.stopSession(session.id);

    const archived = store.getArchivedSessions();
    expect(archived[0].timeWindow).toEqual(timeWindow);
  });

  test('Workflow: duplicate session detection', async () => {
    const taskName = 'Unique task';

    const session1 = await store.createSession({
      taskName,
      status: 'ACTIVE',
    });

    // Try to create duplicate
    const existing = store.getActiveSessionByTask(taskName);
    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(session1.id);

    // Should prevent duplicate
    expect(existing?.taskName).toBe(taskName);
  });

  test('Workflow: session duration calculation', async () => {
    const session = await store.createSession({
      taskName: 'Timed task',
      status: 'ACTIVE',
    });

    // Work for 500ms
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Pause (duration should be ~500ms)
    store.pauseSession(session.id);
    const paused = store.getSessionById(session.id);
    const duration1 = paused?.duration || 0;

    // Pause for 200ms (should NOT count)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Resume
    store.resumeSession(session.id);

    // Work for 500ms more
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Stop
    const stopped = store.stopSession(session.id);

    // Total duration should be ~1000ms (500 + 500, excluding 200ms pause)
    expect(stopped?.duration).toBeGreaterThan(800);
    expect(stopped?.duration).toBeLessThan(1200);
  });

  test('Workflow: archive organization by date', async () => {
    // Create and stop sessions
    const session1 = await store.createSession({
      taskName: 'Today task 1',
      status: 'ACTIVE',
    });
    const session2 = await store.createSession({
      taskName: 'Today task 2',
      status: 'ACTIVE',
    });

    store.stopSession(session1.id);
    store.stopSession(session2.id);

    // Check they're archived under today's date
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = store.getArchivedSessionsByDate(today);

    expect(todaySessions).toHaveLength(2);

    // Verify date folder structure
    const dateFolder = join(TEST_DIR, 'sessions', today);
    expect(existsSync(dateFolder)).toBe(true);
  });

  test('Workflow: session state transitions', async () => {
    const session = await store.createSession({
      taskName: 'State test',
      status: 'ACTIVE',
    });

    // ACTIVE → PAUSED
    const paused = store.pauseSession(session.id);
    expect(paused?.status).toBe('PAUSED');

    // PAUSED → ACTIVE (via resume)
    const resumed = store.resumeSession(session.id);
    expect(resumed?.status).toBe('ACTIVE');

    // ACTIVE → COMPLETED (via stop)
    const stopped = store.stopSession(session.id);
    expect(stopped?.status).toBe('COMPLETED');

    // Cannot transition from COMPLETED
    const cantPause = store.pauseSession(session.id);
    expect(cantPause).toBeNull();

    const cantResume = store.resumeSession(session.id);
    expect(cantResume).toBeNull();

    const cantStopAgain = store.stopSession(session.id);
    expect(cantStopAgain).toBeNull();
  });

  test('Workflow: persistence across restarts', async () => {
    // Create session with first store
    const session = await store.createSession({
      taskName: 'Persistent task',
      status: 'ACTIVE',
    });

    // Simulate restart with new store instance
    const newStore = new SessionStore(TEST_DIR);

    // Session should still exist
    const retrieved = newStore.getSessionById(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.taskName).toBe('Persistent task');

    // Should be able to continue operations
    newStore.pauseSession(session.id);
    const paused = newStore.getSessionById(session.id);
    expect(paused?.status).toBe('PAUSED');
  });

  test('Workflow: error handling for invalid operations', async () => {
    // Try to pause non-existent session
    const result1 = store.pauseSession('non-existent-id');
    expect(result1).toBeNull();

    // Try to stop non-existent session
    const result2 = store.stopSession('non-existent-id');
    expect(result2).toBeNull();

    // Try to delete non-existent session
    const result3 = store.deleteSession('non-existent-id');
    expect(result3).toBe(false);

    // Try to get non-existent session
    const result4 = store.getSessionById('non-existent-id');
    expect(result4).toBeNull();
  });
});
