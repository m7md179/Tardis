/**
 * E2E Test: Todoist Integration & Sync
 * Tests the full Todoist workflow with mocked API
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore } from '../../src/storage/session-store';
import { TodoistClient } from '../../src/todoist/client';
import { matchTask } from '../../src/todoist/matcher';
import { syncCommand } from '../../src/commands/sync';
import type { TodoistTask } from '@tardis/shared/types';

const TEST_DIR = join(process.cwd(), '.test-tardis-todoist');

// Mock Todoist API responses
const mockTasks: TodoistTask[] = [
  {
    id: 'task-1',
    content: 'Write documentation',
    description: '[9am-5pm] Complete API documentation for v2',
    project_id: 'proj-1',
    labels: ['work', 'docs'],
    priority: 3,
    due: undefined,
    url: 'https://todoist.com/app/task/task-1',
    created_at: new Date().toISOString(),
    order: 0,
    comment_count: 0,
    is_completed: false,
  },
  {
    id: 'task-2',
    content: 'Code review',
    description: 'Review PR #123',
    project_id: 'proj-1',
    labels: ['work'],
    priority: 2,
    due: undefined,
    url: 'https://todoist.com/app/task/task-2',
    created_at: new Date().toISOString(),
    order: 0,
    comment_count: 0,
    is_completed: false,
  },
  {
    id: 'task-3',
    content: 'Team meeting',
    description: '[14:00-15:00] Weekly standup',
    project_id: 'proj-1',
    labels: ['meeting'],
    priority: 1,
    due: undefined,
    url: 'https://todoist.com/app/task/task-3',
    created_at: new Date().toISOString(),
    order: 0,
    comment_count: 0,
    is_completed: false,
  },
];

describe('E2E: Todoist Integration', () => {
  let store: SessionStore;
  let todoist: TodoistClient;

  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(join(TEST_DIR, 'active_sessions'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'sessions'), { recursive: true });

    process.env.TARDIS_DIR = TEST_DIR;
    store = new SessionStore(TEST_DIR);

    // Mock Todoist client
    todoist = new TodoistClient('test-token');

    // Mock fetch for Todoist API
    global.fetch = mock(async (url: string, options?: any) => {
      if (url.includes('/tasks') && options?.method !== 'POST') {
        return new Response(JSON.stringify(mockTasks), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/tasks/') && options?.method === 'POST') {
        // Task completion
        const taskId = url.split('/tasks/')[1].split('/')[0];
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 404 });
    });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    delete process.env.TARDIS_DIR;
  });

  test('Fetch and parse Todoist tasks', async () => {
    const tasks = await todoist.getTasks();

    expect(tasks).toHaveLength(3);
    expect(tasks[0].content).toBe('Write documentation');
    expect(tasks[0].id).toBe('task-1');
  });

  test('Match task by exact name', async () => {
    const matches = await matchTask(todoist, 'Write documentation');

    expect(matches).toHaveLength(1);
    expect(matches[0].task.id).toBe('task-1');
    expect(matches[0].confidence).toBe('exact');
  });

  test('Match task by prefix', async () => {
    const matches = await matchTask(todoist, 'Write');

    expect(matches).toHaveLength(1);
    expect(matches[0].task.id).toBe('task-1');
    expect(matches[0].confidence).toBe('prefix');
  });

  test('Match task by contains', async () => {
    const matches = await matchTask(todoist, 'docs');

    expect(matches.length).toBeGreaterThan(0);
    const docTask = matches.find((m) => m.task.id === 'task-1');
    expect(docTask).toBeDefined();
    expect(docTask?.confidence).toBe('contains');
  });

  test('Multiple matches return all', async () => {
    const matches = await matchTask(todoist, 'work');

    // "work" is in labels of task-1 and task-2
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('Extract time window from task description', async () => {
    const tasks = await todoist.getTasks();
    const task1 = tasks.find((t) => t.id === 'task-1');

    expect(task1?.description).toContain('[9am-5pm]');

    // Parser should extract this
    const { parseTimeWindow } = await import('@tardis/shared/utils/time');
    const timeWindow = parseTimeWindow(task1?.description || '');

    expect(timeWindow).not.toBeNull();
    expect(timeWindow?.start).toBe('09:00');
    expect(timeWindow?.end).toBe('17:00');
  });

  test('Start session with Todoist task', async () => {
    const matches = await matchTask(todoist, 'Write documentation');
    const selectedTask = matches[0].task;

    // Extract time window
    const { parseTimeWindow } = await import('@tardis/shared/utils/time');
    const timeWindow = parseTimeWindow(selectedTask.description);

    // Create session
    const session = await store.createSession({
      taskId: selectedTask.id,
      taskName: selectedTask.content,
      status: 'ACTIVE',
      timeWindow: timeWindow || undefined,
    });

    expect(session.taskId).toBe('task-1');
    expect(session.taskName).toBe('Write documentation');
    expect(session.timeWindow).toEqual({ start: '09:00', end: '17:00' });
  });

  test('Stop session and sync to Todoist', async () => {
    // Create session with Todoist task
    const session = await store.createSession({
      taskId: 'task-1',
      taskName: 'Write documentation',
      status: 'ACTIVE',
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Stop session
    const stopped = store.stopSession(session.id);
    expect(stopped?.status).toBe('COMPLETED');
    expect(stopped?.todoistSynced).toBe(false);

    // Sync to Todoist
    await todoist.completeTask('task-1');

    // Mark as synced in store
    store.markSynced(session.id);

    const updated = store.getSessionById(session.id);
    expect(updated?.todoistSynced).toBe(true);
  });

  test('Sync multiple unsynced sessions', async () => {
    // Create 3 sessions with Todoist tasks
    const sessions = [];
    for (let i = 1; i <= 3; i++) {
      const session = await store.createSession({
        taskId: `task-${i}`,
        taskName: mockTasks[i - 1].content,
        status: 'ACTIVE',
      });
      sessions.push(session);
    }

    // Stop all
    for (const session of sessions) {
      store.stopSession(session.id);
    }

    // Get unsynced
    const unsynced = store.getUnsyncedCompletedSessions();
    expect(unsynced).toHaveLength(3);

    // Sync all
    for (const session of unsynced) {
      if (session.taskId) {
        await todoist.completeTask(session.taskId);
        store.markSynced(session.id);
      }
    }

    // Verify all synced
    const stillUnsynced = store.getUnsyncedCompletedSessions();
    expect(stillUnsynced).toHaveLength(0);
  });

  test('Session without Todoist ID is not synced', async () => {
    // Create session without taskId
    const session = await store.createSession({
      taskName: 'Local task',
      status: 'ACTIVE',
    });

    store.stopSession(session.id);

    const unsynced = store.getUnsyncedCompletedSessions();

    // Should not appear in unsynced list (no taskId)
    const found = unsynced.find((s) => s.id === session.id);
    expect(found).toBeUndefined();
  });

  test('Offline mode: session created without Todoist', async () => {
    // Simulate offline by making fetch fail
    global.fetch = mock(async () => {
      throw new Error('Network error');
    });

    // Create session without Todoist
    const session = await store.createSession({
      taskName: 'Offline task',
      status: 'ACTIVE',
    });

    expect(session.taskId).toBeUndefined();
    expect(session.taskName).toBe('Offline task');

    // Should still work normally
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stopped = store.stopSession(session.id);

    expect(stopped?.status).toBe('COMPLETED');
  });
});
