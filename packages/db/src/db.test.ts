import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb } from './connection.js';
import { migrate } from './migrate.js';
import {
  conversations,
  memories,
  thoughtTraces,
  pluginStorage,
  proactiveSettings,
  sessions,
} from './schema.js';
import { eq } from 'drizzle-orm';
import { Database } from 'bun:sqlite';

const TEST_DB_PATH = `/tmp/tardis-test-${randomUUID()}.db`;

beforeEach(() => {
  migrate(TEST_DB_PATH);
});

afterEach(() => {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
});

describe('conversations', () => {
  it('inserts and queries a conversation message', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();

    await db.insert(conversations).values({
      id,
      chatId: 'test-chat-1',
      role: 'user',
      content: 'Hello, TARDIS!',
      timestamp: Date.now(),
    });

    const rows = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('Hello, TARDIS!');
    expect(rows[0]!.role).toBe('user');
  });
});

describe('memories', () => {
  it('inserts and queries a memory entry', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();
    const now = Date.now();

    await db.insert(memories).values({
      id,
      type: 'user_fact',
      key: 'user_name',
      value: 'Mohammad',
      source: 'user',
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(memories).where(eq(memories.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('user_name');
    expect(rows[0]!.value).toBe('Mohammad');
  });

  it('updates a memory entry', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();
    const now = Date.now();

    await db.insert(memories).values({
      id,
      type: 'preference',
      key: 'theme',
      value: 'dark',
      source: 'user',
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(memories)
      .set({ value: 'light', updatedAt: Date.now() })
      .where(eq(memories.id, id));

    const rows = await db.select().from(memories).where(eq(memories.id, id));
    expect(rows[0]!.value).toBe('light');
  });
});

describe('thoughtTraces', () => {
  it('inserts and queries a thought trace', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();

    await db.insert(thoughtTraces).values({
      id,
      userMessage: 'Start a timer for coding',
      steps: JSON.stringify([
        {
          type: 'tool_call',
          toolName: 'time-tracker.start',
          timestamp: Date.now(),
          content: 'Starting timer',
        },
      ]),
      finalResponse: 'Timer started for coding.',
      totalDurationMs: 150,
      modelUsed: 'qwen3:4b',
      timestamp: Date.now(),
    });

    const rows = await db.select().from(thoughtTraces).where(eq(thoughtTraces.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userMessage).toBe('Start a timer for coding');
    expect(JSON.parse(rows[0]!.steps)).toHaveLength(1);
  });
});

describe('pluginStorage', () => {
  it('inserts, updates, and deletes plugin storage entries', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();

    await db.insert(pluginStorage).values({
      id,
      pluginName: 'time-tracker',
      key: 'last_session',
      value: JSON.stringify({ id: 'abc', taskName: 'test' }),
      updatedAt: Date.now(),
    });

    const rows = await db.select().from(pluginStorage).where(eq(pluginStorage.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pluginName).toBe('time-tracker');

    await db.delete(pluginStorage).where(eq(pluginStorage.id, id));
    const after = await db.select().from(pluginStorage).where(eq(pluginStorage.id, id));
    expect(after).toHaveLength(0);
  });
});

describe('proactiveSettings', () => {
  it('inserts and queries proactive settings', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();

    await db.insert(proactiveSettings).values({
      id,
      pluginName: 'time-tracker',
      triggerName: 'daily-summary',
      enabled: 0,
      schedule: '0 18 * * *',
    });

    const rows = await db.select().from(proactiveSettings).where(eq(proactiveSettings.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.schedule).toBe('0 18 * * *');
    expect(rows[0]!.enabled).toBe(0);
  });
});

describe('sessions', () => {
  it('inserts and queries a session', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();
    const now = Date.now();

    await db.insert(sessions).values({
      id,
      taskName: 'Write unit tests',
      status: 'active',
      startTime: now,
      accumulatedTime: 0,
      createdAt: now,
    });

    const rows = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskName).toBe('Write unit tests');
    expect(rows[0]!.status).toBe('active');
  });

  it('updates session to completed with duration', async () => {
    const db = createDb(TEST_DB_PATH);
    const id = randomUUID();
    const startTime = Date.now() - 3600_000; // 1 hour ago

    await db.insert(sessions).values({
      id,
      taskName: 'Coding session',
      status: 'active',
      startTime,
      accumulatedTime: 0,
      createdAt: startTime,
    });

    const endTime = Date.now();
    await db
      .update(sessions)
      .set({
        status: 'completed',
        endTime,
        duration: 3600,
        accumulatedTime: 3600,
      })
      .where(eq(sessions.id, id));

    const rows = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.duration).toBe(3600);
  });
});

// ─── The upgrade path ────────────────────────────────────────────────────────
//
// Every other test here starts from CREATE TABLE, which already declares the
// newest columns — so the ALTER statements that will actually run against the
// production database are otherwise never exercised. This builds a database in
// its pre-upgrade shape and migrates it, the way the server will.

describe('migrate: upgrading an existing database', () => {
  const path = `/tmp/tardis-upgrade-${randomUUID()}.db`;

  function buildOldSchema(): void {
    const db = new Database(path, { create: true });
    db.exec(`CREATE TABLE memories (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      source TEXT, plugin_name TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, accessed_at INTEGER)`);
    db.exec(`CREATE TABLE proactive_settings (
      id TEXT PRIMARY KEY, plugin_name TEXT NOT NULL, trigger_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0, schedule TEXT NOT NULL, config TEXT,
      quiet_hours_start TEXT, quiet_hours_end TEXT)`);
    db.run(
      `INSERT INTO memories VALUES ('m1','user_fact','car-savings','Saving for a vehicle','user',NULL,1,1,NULL)`
    );
    db.run(`INSERT INTO proactive_settings VALUES ('p1','budget','daily',1,'0 9 * * *',NULL,NULL,NULL)`);
    db.close();
  }

  function columns(table: string): string[] {
    const db = new Database(path);
    const rows = db
      .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
      .all();
    db.close();
    return rows.map((r) => r.name);
  }

  afterEach(() => {
    if (existsSync(path)) unlinkSync(path);
  });

  it('adds the new columns without touching existing rows', () => {
    buildOldSchema();
    migrate(path);

    expect(columns('memories')).toEqual(
      expect.arrayContaining(['path', 'embedding', 'embedding_model'])
    );
    expect(columns('proactive_settings')).toContain('next_run_at');

    const db = new Database(path);
    const memory = db
      .query<Record<string, unknown>, []>(`SELECT * FROM memories WHERE id = 'm1'`)
      .get();
    const trigger = db
      .query<Record<string, unknown>, []>(`SELECT * FROM proactive_settings WHERE id = 'p1'`)
      .get();
    db.close();

    expect(memory!['value']).toBe('Saving for a vehicle');
    expect(memory!['embedding']).toBeNull();
    expect(trigger!['schedule']).toBe('0 9 * * *');
    expect(trigger!['next_run_at']).toBeNull();
  });

  it('is idempotent — a second run is a no-op, not a duplicate-column error', () => {
    buildOldSchema();
    migrate(path);
    expect(() => migrate(path)).not.toThrow();
  });
});
