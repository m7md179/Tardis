import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { MemoryStore } from './memory-store.js';
import { MemoryIndexer } from './memory-indexer.js';
import { MemoryRetriever } from './memory-retriever.js';
import type { Embedder } from './embeddings.js';

function makeTestDb() {
  const path = `/tmp/tardis-indexer-test-${randomUUID()}.db`;
  migrate(path);
  return {
    db: createDb(path),
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

/**
 * A deterministic stand-in for a real embedding model.
 *
 * Each listed token owns one dimension, so texts sharing tokens end up near
 * each other and unrelated texts end up orthogonal. That is enough to exercise
 * every decision this code makes; whether *nomic-embed-text* puts "car" near
 * "vehicle" is a question about the model, and is answered by measuring the
 * real one rather than by asserting against a mock.
 */
const AXES = ['car', 'vehicle', 'gym', 'rent', 'coffee', 'zebra'];

class FakeEmbedder implements Embedder {
  calls = 0;
  batches: string[][] = [];
  failNext = false;

  constructor(readonly model = 'fake-embed-v1') {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    this.batches.push(texts);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('embedder unreachable');
    }
    return texts.map((text) => {
      const lower = text.toLowerCase();
      const vec = new Float32Array(AXES.length);
      AXES.forEach((axis, i) => {
        if (lower.includes(axis)) vec[i] = 1;
      });
      // "car" and "vehicle" are treated as the same concept by this fake, so
      // one can find the other — the paraphrase case, in miniature.
      if (vec[0] || vec[1]) {
        vec[0] = 1;
        vec[1] = 1;
      }
      // A vector of all zeros has no direction; give it a distinct one so
      // cosine stays meaningful for unrelated text.
      if (vec.every((v) => v === 0)) vec[AXES.length - 1] = 0.5;
      return vec;
    });
  }
}

describe('MemoryIndexer', () => {
  let store: MemoryStore;
  let embedder: FakeEmbedder;
  let indexer: MemoryIndexer;
  let cleanup: () => void;

  beforeEach(() => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    store = new MemoryStore(t.db);
    embedder = new FakeEmbedder();
    indexer = new MemoryIndexer(store, embedder);
  });

  afterEach(() => cleanup());

  it('embeds one memory and stores the vector against the model that made it', async () => {
    const m = await store.create({ type: 'user_fact', key: 'car-savings', value: 'Saving up' });
    expect(await indexer.indexOne(m)).toBe(true);

    const embedded = await store.getEmbedded('fake-embed-v1');
    expect(embedded).toHaveLength(1);
    expect(embedded[0]!.memory.id).toBe(m.id);
    expect(embedded[0]!.vector.length).toBe(AXES.length);
  });

  it('reports failure instead of throwing when the embedder is down', async () => {
    // A save must never fail because an optional index was unreachable.
    const m = await store.create({ type: 'user_fact', key: 'k', value: 'v' });
    embedder.failNext = true;
    expect(await indexer.indexOne(m)).toBe(false);
    expect(await store.getEmbedded('fake-embed-v1')).toHaveLength(0);
  });

  it('ignores vectors made by a different model', async () => {
    // Cosine between two models' spaces is meaningless, not merely inaccurate,
    // so a stale row must be excluded rather than compared.
    const m = await store.create({ type: 'user_fact', key: 'k', value: 'v' });
    await indexer.indexOne(m);

    const other = new MemoryIndexer(store, new FakeEmbedder('other-model'));
    expect(await store.getEmbedded('other-model')).toHaveLength(0);
    expect(await other.similar('anything')).toEqual([]);
  });

  describe('reindexAll', () => {
    it('embeds everything that has no vector', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ type: 'user_fact', key: `k${i}`, value: `car number ${i}` });
      }
      const result = await indexer.reindexAll();
      expect(result).toMatchObject({ indexed: 5, failed: 0, model: 'fake-embed-v1' });
      expect(await store.getEmbedded('fake-embed-v1')).toHaveLength(5);
    });

    it('is idempotent — a second run has nothing to do', async () => {
      await store.create({ type: 'user_fact', key: 'k', value: 'v' });
      await indexer.reindexAll();
      const callsAfterFirst = embedder.calls;

      expect((await indexer.reindexAll()).indexed).toBe(0);
      expect(embedder.calls).toBe(callsAfterFirst);
    });

    it('catches up rows a previous run could not reach', async () => {
      // The shape of an embedder outage: some rows made it, some did not.
      const a = await store.create({ type: 'user_fact', key: 'a', value: 'car' });
      await store.create({ type: 'user_fact', key: 'b', value: 'gym' });
      await indexer.indexOne(a);

      expect((await indexer.reindexAll()).indexed).toBe(1);
      expect(await store.getEmbedded('fake-embed-v1')).toHaveLength(2);
    });

    it('re-embeds everything under `full`, for a model that changed behind its name', async () => {
      await store.create({ type: 'user_fact', key: 'k', value: 'v' });
      await indexer.reindexAll();
      expect((await indexer.reindexAll(true)).indexed).toBe(1);
    });

    it('stops rather than spinning when the embedder is unreachable', async () => {
      await store.create({ type: 'user_fact', key: 'k', value: 'v' });
      embedder.failNext = true;

      const result = await indexer.reindexAll();
      expect(result.indexed).toBe(0);
      expect(result.failed).toBe(1);
      // One attempt, not an infinite loop over an unchanged pending set.
      expect(embedder.calls).toBe(1);
    });

    it('loses time, never data — the rows survive a full rebuild', async () => {
      await store.create({ type: 'user_fact', key: 'k', value: 'the only copy' });
      await indexer.reindexAll();
      await indexer.reindexAll(true);
      expect((await store.getByKey('k'))?.value).toBe('the only copy');
    });
  });

  describe('similar', () => {
    it('finds a paraphrase the keyword scorer would miss', async () => {
      const car = await store.create({
        type: 'user_fact',
        key: 'savings',
        value: 'Putting aside money for a vehicle',
      });
      await store.create({ type: 'user_fact', key: 'fitness', value: 'gym on Mondays' });
      await indexer.reindexAll();

      const found = await indexer.similar('what did I say about the car');
      expect(found.map((m) => m.id)).toEqual([car.id]);
    });

    it('returns nothing when no memory stands out', async () => {
      // Two equally-close memories mean the field is undifferentiated, and
      // guessing between them is worse than saying nothing.
      await store.create({ type: 'user_fact', key: 'a', value: 'car one' });
      await store.create({ type: 'user_fact', key: 'b', value: 'car two' });
      await indexer.reindexAll();

      expect(await indexer.similar('tell me about the vehicle')).toEqual([]);
    });

    it('returns nothing when there is nothing embedded', async () => {
      await store.create({ type: 'user_fact', key: 'k', value: 'car' });
      expect(await indexer.similar('car')).toEqual([]);
    });

    it('returns nothing rather than throwing when the embedder is down', async () => {
      await store.create({ type: 'user_fact', key: 'k', value: 'car' });
      await indexer.reindexAll();
      embedder.failNext = true;
      expect(await indexer.similar('car')).toEqual([]);
    });
  });
});

// ─── The hybrid, end to end ──────────────────────────────────────────────────

describe('MemoryRetriever: hybrid', () => {
  let store: MemoryStore;
  let indexer: MemoryIndexer;
  let cleanup: () => void;

  beforeEach(() => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    store = new MemoryStore(t.db);
    indexer = new MemoryIndexer(store, new FakeEmbedder());
  });

  afterEach(() => cleanup());

  it('behaves exactly as before when no indexer is configured', async () => {
    // The property that makes the embedding service optional rather than a
    // dependency: without it, this is the retriever that already shipped.
    await store.create({ type: 'user_fact', key: 'savings', value: 'Saving for a vehicle' });
    const keywordOnly = new MemoryRetriever(store, 2000);

    expect(await keywordOnly.getRelevant('what did I say about the car')).toEqual([]);
    expect((await keywordOnly.getRelevant('how are my savings')).map((m) => m.key)).toEqual([
      'savings',
    ]);
  });

  it('recovers the memory the keyword scorer cannot reach', async () => {
    // The failure this whole feature exists for.
    await store.create({ type: 'user_fact', key: 'savings', value: 'Saving for a vehicle' });
    await indexer.reindexAll();

    const hybrid = new MemoryRetriever(store, 2000, indexer);
    const found = await hybrid.getRelevant('what did I say about the car');
    expect(found.map((m) => m.key)).toEqual(['savings']);
  });

  it('puts literal matches ahead of inferred ones', async () => {
    // A keyword hit is evidence the user named this memory; a vector hit is an
    // inference about what they meant.
    await store.create({ type: 'user_fact', key: 'car-note', value: 'The car is red' });
    await store.create({ type: 'user_fact', key: 'savings', value: 'Saving for a vehicle' });
    await indexer.reindexAll();

    const hybrid = new MemoryRetriever(store, 2000, indexer);
    const found = await hybrid.getRelevant('what about the car');
    expect(found[0]!.key).toBe('car-note');
  });

  it('never returns the same memory twice when both halves find it', async () => {
    await store.create({ type: 'user_fact', key: 'car-savings', value: 'Saving for a car' });
    await indexer.reindexAll();

    const hybrid = new MemoryRetriever(store, 2000, indexer);
    const found = await hybrid.getRelevant('car');
    expect(found).toHaveLength(1);
  });

  it('still returns nothing for a message no memory answers', async () => {
    await store.create({ type: 'user_fact', key: 'a', value: 'car one' });
    await store.create({ type: 'user_fact', key: 'b', value: 'car two' });
    await indexer.reindexAll();

    const hybrid = new MemoryRetriever(store, 2000, indexer);
    expect(await hybrid.getRelevant('completely unrelated question')).toEqual([]);
  });
});
