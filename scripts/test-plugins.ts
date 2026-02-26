/**
 * TARDIS Plugin Integration Test Script
 * Run with: bun run scripts/test-plugins.ts
 */

import { join } from 'path';
import { PluginManager, createPluginApi, ToolRouter } from '@tardis/core';
import { createDb, migrate } from '@tardis/db';
import { loadConfig, DEFAULT_DATA_DIR } from '@tardis/core';

// ─── Setup ────────────────────────────────────────────────────────────────────

const dataDir = process.env['TARDIS_DATA_DIR'] ?? DEFAULT_DATA_DIR;
const dbPath = join(dataDir, 'tardis.db');
migrate(dbPath);
const db = createDb(dbPath);
const config = loadConfig(dataDir);

const pluginsDir = join(dataDir, 'plugins');
const pluginManager = new PluginManager(pluginsDir, (manifest) =>
  createPluginApi({
    pluginName: manifest.name,
    permissions: manifest.permissions,
    db,
    config,
    notificationSender: async (msg) => {
      console.log(`  📣 Notification: ${msg}`);
    },
  })
);
await pluginManager.loadAll();
const router = new ToolRouter(pluginManager);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('✅');
    passed++;
  } catch (err) {
    console.log(`❌  ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function call(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = await router.execute(toolName, args);
  if (!result.success) throw new Error(`Tool failed: ${result.error}`);
  return result.data;
}

// ─── Time Tracker ─────────────────────────────────────────────────────────────

console.log('\n⏱  time-tracker');

let sessionId = '';

await test('start session', async () => {
  const data = await call('time-tracker.start', { taskName: 'test task' }) as Record<string, unknown>;
  assert(data['success'] === true, 'start failed');
  const session = data['session'] as Record<string, unknown>;
  assert(typeof session['id'] === 'string', 'session.id missing');
  sessionId = session['id'] as string;
});

await test('get status (active)', async () => {
  const data = await call('time-tracker.status') as Record<string, unknown>;
  assert(Array.isArray(data['sessions']), 'sessions missing');
  assert((data['sessions'] as unknown[]).length > 0, 'no active sessions');
});

await test('pause session', async () => {
  const data = await call('time-tracker.pause', { taskName: 'test task' }) as Record<string, unknown>;
  assert(data['success'] === true, 'pause failed');
});

await test('resume session', async () => {
  const data = await call('time-tracker.resume', { taskName: 'test task' }) as Record<string, unknown>;
  assert(data['success'] === true, 'resume failed');
});

await test('stop session', async () => {
  const data = await call('time-tracker.stop', { taskName: 'test task' }) as Record<string, unknown>;
  assert(data['success'] === true, 'stop failed');
});

await test('get history', async () => {
  const data = await call('time-tracker.history', { limit: 5 }) as Record<string, unknown>;
  assert(Array.isArray(data['sessions']), 'sessions missing');
  assert((data['sessions'] as unknown[]).length > 0, 'no sessions in history');
});

// ─── Notes ────────────────────────────────────────────────────────────────────

console.log('\n📝  notes');

await test('save note', async () => {
  const data = await call('notes.save-note', {
    title: '__test_note__',
    content: 'This is a test note for TARDIS plugin testing.',
    tags: ['test', 'automated'],
  }) as Record<string, unknown>;
  assert(data['success'] === true, 'save failed');
});

await test('get note', async () => {
  const data = await call('notes.get-note', { title: '__test_note__' }) as Record<string, unknown>;
  assert(data['success'] === true, 'get failed');
  const note = data['note'] as Record<string, unknown>;
  assert(typeof note['content'] === 'string', 'note.content missing');
  assert((note['content'] as string).includes('TARDIS'), 'content mismatch');
});

await test('search notes', async () => {
  const data = await call('notes.search-notes', { query: 'TARDIS' }) as Record<string, unknown>;
  assert(Array.isArray(data['notes']), 'notes missing');
  assert((data['notes'] as unknown[]).length > 0, 'no results found');
});

await test('list notes', async () => {
  const data = await call('notes.list-notes') as Record<string, unknown>;
  assert(Array.isArray(data['notes']), 'notes missing');
});

await test('delete note', async () => {
  const data = await call('notes.delete-note', { title: '__test_note__' }) as Record<string, unknown>;
  assert(data['success'] === true, 'delete failed');
});

// ─── Reminders ────────────────────────────────────────────────────────────────

console.log('\n⏰  reminders');

let reminderId = '';

await test('set reminder (60 min)', async () => {
  const data = await call('reminders.set-reminder', {
    message: 'Test reminder — automated',
    delayMinutes: 60,
  }) as Record<string, unknown>;
  assert(data['success'] === true, 'set failed');
  const reminder = data['reminder'] as Record<string, unknown>;
  assert(typeof reminder['id'] === 'string', 'reminder.id missing');
  reminderId = reminder['id'] as string;
});

await test('list reminders', async () => {
  const data = await call('reminders.list-reminders') as Record<string, unknown>;
  assert(Array.isArray(data['reminders']), 'reminders missing');
  assert((data['reminders'] as unknown[]).length > 0, 'no reminders found');
});

await test('cancel reminder', async () => {
  const data = await call('reminders.cancel-reminder', { id: reminderId }) as Record<string, unknown>;
  assert(data['success'] === true, 'cancel failed');
});

// ─── Todoist ──────────────────────────────────────────────────────────────────

console.log('\n✅  todoist');

let testTaskId = '';

await test('add task', async () => {
  const data = await call('todoist.add-task', {
    content: '__TARDIS test task__',
    dueString: 'today',
    priority: 1,
  }) as Record<string, unknown>;
  assert(data['success'] === true, 'add failed');
  const task = data['task'] as Record<string, unknown>;
  testTaskId = task['id'] as string;
});

await test('list tasks', async () => {
  const data = await call('todoist.list-tasks') as Record<string, unknown>;
  assert(Array.isArray(data['tasks']), 'tasks missing');
});

await test('update task', async () => {
  const data = await call('todoist.update-task', {
    taskName: '__TARDIS test task__',
    content: '__TARDIS test task (updated)__',
  }) as Record<string, unknown>;
  assert(data['success'] === true, 'update failed');
});

await test('complete task', async () => {
  const data = await call('todoist.complete-task', {
    taskName: '__TARDIS test task',
  }) as Record<string, unknown>;
  assert(data['success'] === true, `complete failed: ${data['message']}`);
});

// ─── Google Calendar ──────────────────────────────────────────────────────────

console.log('\n📅  google-calendar');

await test('list events (today)', async () => {
  try {
    const data = await call('google-calendar.list-events', { date: 'today' }) as Record<string, unknown>;
    assert(Array.isArray(data['events']) || typeof data['message'] === 'string', 'unexpected response');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not authorized')) throw new Error('Not authorized — complete OAuth first');
    throw err;
  }
});

await test('check schedule', async () => {
  try {
    const today = new Date().toISOString().split('T')[0]!;
    const data = await call('google-calendar.check-schedule', {
      date: today,
      startTime: '23:00',
      endTime: '23:30',
    }) as Record<string, unknown>;
    assert(typeof data['free'] === 'boolean', 'free field missing');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not authorized')) throw new Error('Not authorized — complete OAuth first');
    throw err;
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

await pluginManager.unloadAll();
process.exit(failed > 0 ? 1 : 0);
