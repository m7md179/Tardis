import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { MemoryStore } from './memory-store.js';

function makeTestDb() {
  const path = `/tmp/tardis-memory-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

describe('MemoryStore', () => {
  let store: MemoryStore;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = makeTestDb();
    store = new MemoryStore(testDb.db);
    cleanup = testDb.cleanup;
  });

  afterEach(() => cleanup());

  it('should create and retrieve a memory by key', async () => {
    const entry = await store.create({
      type: 'user_fact',
      key: 'ahmad_email',
      value: 'ahmad@example.com',
      source: 'agent',
    });

    expect(entry.key).toBe('ahmad_email');
    expect(entry.value).toBe('ahmad@example.com');
    expect(entry.type).toBe('user_fact');
    expect(entry.id).toBeTruthy();

    const retrieved = await store.getByKey('ahmad_email');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.value).toBe('ahmad@example.com');
  });

  it('should retrieve a memory by id', async () => {
    const entry = await store.create({
      type: 'preference',
      key: 'theme',
      value: 'dark',
    });

    const retrieved = await store.getById(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.key).toBe('theme');
  });

  it('should return null for non-existent key', async () => {
    const result = await store.getByKey('nonexistent');
    expect(result).toBeNull();
  });

  it('should upsert by key (update existing)', async () => {
    await store.create({
      type: 'user_fact',
      key: 'favorite_color',
      value: 'blue',
    });

    const updated = await store.upsertByKey({
      type: 'user_fact',
      key: 'favorite_color',
      value: 'green',
    });

    expect(updated.value).toBe('green');

    const retrieved = await store.getByKey('favorite_color');
    expect(retrieved!.value).toBe('green');
  });

  it('should upsert by key (create new)', async () => {
    const entry = await store.upsertByKey({
      type: 'project',
      key: 'current_project',
      value: 'TARDIS v2',
    });

    expect(entry.key).toBe('current_project');
    const retrieved = await store.getByKey('current_project');
    expect(retrieved).not.toBeNull();
  });

  it('should delete by key', async () => {
    await store.create({
      type: 'user_fact',
      key: 'to_delete',
      value: 'bye',
    });

    const deleted = await store.delete('to_delete');
    expect(deleted).toBe(true);

    const retrieved = await store.getByKey('to_delete');
    expect(retrieved).toBeNull();
  });

  it('should return false when deleting non-existent key', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('should delete by id', async () => {
    const entry = await store.create({
      type: 'user_fact',
      key: 'to_delete_by_id',
      value: 'bye',
    });

    const deleted = await store.deleteById(entry.id);
    expect(deleted).toBe(true);

    const retrieved = await store.getById(entry.id);
    expect(retrieved).toBeNull();
  });

  it('should search by key and value', async () => {
    await store.create({ type: 'user_fact', key: 'ahmad_email', value: 'ahmad@example.com' });
    await store.create({ type: 'user_fact', key: 'sara_email', value: 'sara@example.com' });
    await store.create({ type: 'preference', key: 'theme', value: 'dark' });

    const results = await store.search('ahmad');
    expect(results.length).toBe(1);
    expect(results[0]!.key).toBe('ahmad_email');

    const emailResults = await store.search('email');
    expect(emailResults.length).toBe(2);
  });

  it('should get memories by type', async () => {
    await store.create({ type: 'user_fact', key: 'fact1', value: 'v1' });
    await store.create({ type: 'user_fact', key: 'fact2', value: 'v2' });
    await store.create({ type: 'preference', key: 'pref1', value: 'v3' });

    const facts = await store.getByType('user_fact');
    expect(facts.length).toBe(2);

    const prefs = await store.getByType('preference');
    expect(prefs.length).toBe(1);
  });

  it('should get all memories', async () => {
    await store.create({ type: 'user_fact', key: 'k1', value: 'v1' });
    await store.create({ type: 'preference', key: 'k2', value: 'v2' });

    const all = await store.getAll();
    expect(all.length).toBe(2);
  });

  it('should touch accessedAt timestamp', async () => {
    const entry = await store.create({
      type: 'user_fact',
      key: 'touch_test',
      value: 'hello',
    });

    expect(entry.accessedAt).toBeUndefined();

    await store.touchAccessed(entry.id);

    const retrieved = await store.getById(entry.id);
    expect(retrieved!.accessedAt).toBeDefined();
    expect(retrieved!.accessedAt).toBeGreaterThan(0);
  });

  it('should get memories by plugin name', async () => {
    await store.create({
      type: 'plugin',
      key: 'tt_setting',
      value: 'something',
      pluginName: 'time-tracker',
    });
    await store.create({
      type: 'plugin',
      key: 'notes_setting',
      value: 'else',
      pluginName: 'notes',
    });

    const ttMems = await store.getByPlugin('time-tracker');
    expect(ttMems.length).toBe(1);
    expect(ttMems[0]!.key).toBe('tt_setting');
  });
});
