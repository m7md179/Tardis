/**
 * E2E Test: Complete Session Lifecycle
 * Tests the full start → pause → resume → stop flow
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from '../../src/storage/session-store';
import { startCommand } from '../../src/commands/start';
import { pauseCommand } from '../../src/commands/pause';
import { resumeCommand } from '../../src/commands/resume';
import { stopCommand } from '../../src/commands/stop';
import type { Session } from '@tardis/shared/types';

const TEST_DIR = join(process.cwd(), '.test-tardis-e2e');
const ACTIVE_DIR = join(TEST_DIR, 'active_sessions');
const SESSIONS_DIR = join(TEST_DIR, 'sessions');

describe('E2E: Session Lifecycle', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(ACTIVE_DIR, { recursive: true });
    mkdirSync(SESSIONS_DIR, { recursive: true });

    // Override TARDIS_DIR for testing
    process.env.TARDIS_DIR = TEST_DIR;
    store = new SessionStore(TEST_DIR);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    delete process.env.TARDIS_DIR;
  });

  test('Full lifecycle: start → pause → resume → stop', async () => {
    const taskName = 'E2E Test Task';

    // 1. Start session
    const session = await store.createSession({
      taskName,
      status: 'ACTIVE',
      timeWindow: { start: '09:00', end: '17:00' },
    });

    expect(session.status).toBe('ACTIVE');
    expect(session.taskName).toBe(taskName);
    expect(session.duration).toBe(0);

    // Wait 1 second to simulate work
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. Pause session
    const paused = store.pauseSession(session.id);
    expect(paused).toBeTruthy();
    expect(paused?.status).toBe('PAUSED');
    expect(paused?.pausedAt).toBeDefined();

    const duration1 = paused?.duration || 0;
    expect(duration1).toBeGreaterThan(0);

    // Wait during pause (should NOT increase duration)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 3. Resume session
    const resumed = store.resumeSession(session.id);
    expect(resumed).toBeTruthy();
    expect(resumed?.status).toBe('ACTIVE');
    expect(resumed?.resumedAt).toBeDefined();

    // Duration should be same as when paused (pause time excluded)
    expect(resumed?.duration).toBe(duration1);

    // Wait 1 more second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Stop session
    const stopped = store.stopSession(session.id);
    expect(stopped).toBeTruthy();
    expect(stopped?.status).toBe('COMPLETED');
    expect(stopped?.endTime).toBeDefined();

    // Duration should be ~2 seconds (excluding the 500ms pause)
    const finalDuration = stopped?.duration || 0;
    expect(finalDuration).toBeGreaterThan(1500); // At least 1.5s
    expect(finalDuration).toBeLessThan(2500); // Less than 2.5s

    // Session should be archived (moved to sessions/YYYY-MM-DD/)
    const activeSessions = store.getActiveSessions();
    expect(activeSessions).toHaveLength(0);

    const archived = store.getArchivedSessions();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(session.id);
  });

  test('Multiple sessions lifecycle', async () => {
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

    // All should be active
    let active = store.getActiveSessions();
    expect(active).toHaveLength(3);

    // Pause one
    store.pauseSession(session2.id);
    active = store.getActiveSessions();
    expect(active.filter((s) => s.status === 'ACTIVE')).toHaveLength(2);
    expect(active.filter((s) => s.status === 'PAUSED')).toHaveLength(1);

    // Stop one
    store.stopSession(session1.id);
    active = store.getActiveSessions();
    expect(active).toHaveLength(2); // session2 and session3

    // Resume paused
    store.resumeSession(session2.id);
    active = store.getActiveSessions();
    expect(active.filter((s) => s.status === 'ACTIVE')).toHaveLength(2);

    // Stop all remaining
    store.stopSession(session2.id);
    store.stopSession(session3.id);

    active = store.getActiveSessions();
    expect(active).toHaveLength(0);

    const archived = store.getArchivedSessions();
    expect(archived).toHaveLength(3);
  });

  test('Pause/resume multiple times', async () => {
    const session = await store.createSession({
      taskName: 'Multi-pause task',
      status: 'ACTIVE',
    });

    // Work → Pause → Resume → Pause → Resume → Stop
    await new Promise((resolve) => setTimeout(resolve, 500));

    store.pauseSession(session.id);
    await new Promise((resolve) => setTimeout(resolve, 200)); // Paused

    store.resumeSession(session.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    store.pauseSession(session.id);
    await new Promise((resolve) => setTimeout(resolve, 200)); // Paused

    store.resumeSession(session.id);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const stopped = store.stopSession(session.id);

    // Total duration should be ~1.5s (3x 500ms work, excluding 2x 200ms pauses)
    expect(stopped?.duration).toBeGreaterThan(1000);
    expect(stopped?.duration).toBeLessThan(2000);
  });

  test('Cannot pause already paused session', async () => {
    const session = await store.createSession({
      taskName: 'Test task',
      status: 'ACTIVE',
    });

    store.pauseSession(session.id);

    // Try to pause again
    const result = store.pauseSession(session.id);
    expect(result).toBeNull();
  });

  test('Cannot resume active session', async () => {
    const session = await store.createSession({
      taskName: 'Test task',
      status: 'ACTIVE',
    });

    // Try to resume active session
    const result = store.resumeSession(session.id);
    expect(result).toBeNull();
  });

  test('Cannot stop already stopped session', async () => {
    const session = await store.createSession({
      taskName: 'Test task',
      status: 'ACTIVE',
    });

    store.stopSession(session.id);

    // Try to stop again
    const result = store.stopSession(session.id);
    expect(result).toBeNull();
  });
});
