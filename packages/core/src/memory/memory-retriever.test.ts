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

  // ─── 10 memories, query matches exactly 3 ─────────────────────────────

  it('should return exactly the 3 matching memories out of 10', async () => {
    // 3 Ahmad-related memories
    await store.create({ type: 'user_fact', key: 'ahmad_email', value: 'ahmad@example.com' });
    await store.create({ type: 'user_fact', key: 'ahmad_birthday', value: 'March 15' });
    await store.create({ type: 'project', key: 'ahmad_project', value: 'Ahmad is working on the mobile app' });

    // 7 unrelated memories
    await store.create({ type: 'user_fact', key: 'sara_phone', value: '+1234567890' });
    await store.create({ type: 'preference', key: 'theme', value: 'dark mode' });
    await store.create({ type: 'preference', key: 'language', value: 'English' });
    await store.create({ type: 'project', key: 'server_migration', value: 'Move to AWS by Q2' });
    await store.create({ type: 'user_fact', key: 'office_address', value: '123 Main St' });
    await store.create({ type: 'plugin', key: 'todoist_token', value: 'abc123' });
    await store.create({ type: 'user_fact', key: 'car_model', value: 'Tesla Model 3' });

    const results = await retriever.getRelevant('Prepare for Ahmad meeting');
    const keys = results.map((r) => r.key);

    expect(results.length).toBe(3);
    expect(keys).toContain('ahmad_email');
    expect(keys).toContain('ahmad_birthday');
    expect(keys).toContain('ahmad_project');

    // None of the unrelated ones should be present
    expect(keys).not.toContain('sara_phone');
    expect(keys).not.toContain('theme');
    expect(keys).not.toContain('todoist_token');
  });

  // ─── Recency scoring: recently accessed memories rank higher ──────────

  it('should rank recently accessed memories higher than stale ones', async () => {
    // Create two memories with same keyword match strength
    await store.create({
      type: 'user_fact',
      key: 'project_alpha',
      value: 'Alpha project deadline is Friday',
    });
    const recent = await store.create({
      type: 'user_fact',
      key: 'project_beta',
      value: 'Beta project started last week',
    });

    // Touch "beta" so it has a recent accessedAt, leave "alpha" untouched
    await store.touchAccessed(recent.id);

    // Both match "project" in key — but beta was recently accessed
    const results = await retriever.getRelevant('project status');

    expect(results.length).toBe(2);
    // The recently accessed one should be first (higher recency bonus)
    expect(results[0]!.key).toBe('project_beta');
    expect(results[1]!.key).toBe('project_alpha');
  });

  // ─── Token budget truncation ──────────────────────────────────────────

  it('should truncate results when memories exceed token budget', async () => {
    // Create 10 memories that all match "report", each ~30 chars => ~8 tokens each
    // "- report_N: Monthly report for department N\n" ≈ 46 chars ≈ 12 tokens
    for (let i = 0; i < 10; i++) {
      await store.create({
        type: 'project',
        key: `report_${i}`,
        value: `Monthly report for department ${i}`,
      });
    }

    // With budget of 2000 tokens, all 10 fit (~120 tokens total)
    const allResults = await retriever.getRelevant('report department');
    expect(allResults.length).toBe(10);

    // With budget of 50 tokens, only ~4 fit (12 tokens each)
    const tightRetriever = new MemoryRetriever(store, 50);
    const tightResults = await tightRetriever.getRelevant('report department');
    expect(tightResults.length).toBeGreaterThan(0);
    expect(tightResults.length).toBeLessThan(10);

    // With budget of 12, exactly 1 should fit
    const tinyRetriever = new MemoryRetriever(store, 12);
    const tinyResults = await tinyRetriever.getRelevant('report department');
    expect(tinyResults.length).toBe(1);
  });

  // ─── Explicit references: "Ahmad" pulls Ahmad memories ────────────────

  it('should pull Ahmad-related memories when message mentions Ahmad', async () => {
    await store.create({ type: 'user_fact', key: 'ahmad_email', value: 'ahmad@example.com' });
    await store.create({ type: 'user_fact', key: 'ahmad_role', value: 'Ahmad is the team lead' });
    await store.create({ type: 'preference', key: 'coffee_order', value: 'double espresso' });
    await store.create({ type: 'project', key: 'budget_2026', value: 'Approved at 50k' });
    await store.create({ type: 'user_fact', key: 'sara_phone', value: '+1234567890' });

    const results = await retriever.getRelevant("What's Ahmad's email?");
    const keys = results.map((r) => r.key);

    // Both Ahmad memories should be returned
    expect(keys).toContain('ahmad_email');
    expect(keys).toContain('ahmad_role');

    // Non-Ahmad memories should not
    expect(keys).not.toContain('coffee_order');
    expect(keys).not.toContain('budget_2026');
    expect(keys).not.toContain('sara_phone');
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  it('should return empty when no keywords match any memory', async () => {
    await store.create({ type: 'preference', key: 'color', value: 'blue' });

    const results = await retriever.getRelevant('dinosaur spaceship quantum');
    expect(results).toEqual([]);
  });

  it('should score key matches higher than value matches', async () => {
    await store.create({ type: 'user_fact', key: 'meeting_with_sara', value: 'Discuss budget' });
    await store.create({ type: 'user_fact', key: 'budget_notes', value: 'Sara mentioned extra funding' });

    const results = await retriever.getRelevant('meeting sara');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe('meeting_with_sara');
  });

  it('should prioritize user_fact over plugin type when keyword scores are equal', async () => {
    await store.create({ type: 'plugin', key: 'test_plugin', value: 'some info' });
    await store.create({ type: 'user_fact', key: 'test_fact', value: 'some info' });

    const results = await retriever.getRelevant('test');
    expect(results.length).toBe(2);
    expect(results[0]!.type).toBe('user_fact');
  });
});
