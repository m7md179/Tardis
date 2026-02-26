import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { MemoryStore } from './memory-store.js';
import { MemoryRetriever } from './memory-retriever.js';

function makeTestDb() {
  const path = `/tmp/tardis-retriever-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

describe('MemoryRetriever', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;
  let cleanup: () => void;

  beforeEach(async () => {
    const testDb = makeTestDb();
    store = new MemoryStore(testDb.db);
    retriever = new MemoryRetriever(store, 2000);
    cleanup = testDb.cleanup;
  });

  afterEach(() => cleanup());

  it('should return empty array when no memories exist', async () => {
    const results = await retriever.getRelevant('hello world');
    expect(results).toEqual([]);
  });

  it('should return relevant memories matching keywords in key', async () => {
    await store.create({ type: 'user_fact', key: 'ahmad_email', value: 'ahmad@example.com' });
    await store.create({ type: 'user_fact', key: 'sara_phone', value: '+1234567890' });

    const results = await retriever.getRelevant('What is Ahmad email address?');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe('ahmad_email');
  });

  it('should return relevant memories matching keywords in value', async () => {
    await store.create({ type: 'user_fact', key: 'colleague_info', value: 'Ahmad works at Acme Corp' });
    await store.create({ type: 'preference', key: 'theme', value: 'dark mode preferred' });

    const results = await retriever.getRelevant('Tell me about Ahmad');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.key === 'colleague_info')).toBe(true);
  });

  it('should respect token budget', async () => {
    // Create many memories — budget of 50 tokens should limit results
    for (let i = 0; i < 20; i++) {
      await store.create({
        type: 'user_fact',
        key: `project_detail_${i}`,
        value: `This is a detailed description for project item number ${i} with lots of text`,
      });
    }

    const smallBudget = new MemoryRetriever(store, 50);
    const results = await smallBudget.getRelevant('project detail');
    expect(results.length).toBeLessThan(20);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should score key matches higher than value matches', async () => {
    await store.create({ type: 'user_fact', key: 'meeting_with_sara', value: 'Discuss budget' });
    await store.create({ type: 'user_fact', key: 'budget_notes', value: 'Sara mentioned extra funding' });

    const results = await retriever.getRelevant('meeting sara');
    // 'meeting_with_sara' has keyword match on key for both 'meeting' and 'sara'
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe('meeting_with_sara');
  });

  it('should return empty when no keywords match any memory', async () => {
    await store.create({ type: 'preference', key: 'color', value: 'blue' });

    // Message with only stop words produces no keywords → no keyword matches
    // But recency + type priority can still produce a score > 2 for very recent memories
    // So test with a truly irrelevant message that produces keywords
    const results = await retriever.getRelevant('dinosaur spaceship quantum');
    expect(results).toEqual([]);
  });

  it('should prioritize user_fact and preference types when keyword scores are equal', async () => {
    // Both have same keyword match on 'test' in key — type priority breaks the tie
    await store.create({ type: 'plugin', key: 'test_plugin', value: 'some info' });
    await store.create({ type: 'user_fact', key: 'test_fact', value: 'some info' });

    const results = await retriever.getRelevant('test');
    expect(results.length).toBe(2);
    // user_fact gets +2 type priority, plugin gets +0 → user_fact first
    expect(results[0]!.type).toBe('user_fact');
  });
});
