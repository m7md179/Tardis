import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { ConversationStore } from './conversation-store.js';

function makeTestDb() {
  const path = `/tmp/tardis-conv-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

const CHAT = 'chat-1';

describe('ConversationStore', () => {
  let store: ConversationStore;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = makeTestDb();
    store = new ConversationStore(testDb.db);
    cleanup = testDb.cleanup;
  });

  afterEach(() => cleanup());

  it('round-trips a plain user/assistant exchange', async () => {
    await store.appendMessage(CHAT, { role: 'user', content: 'hi' });
    await store.appendMessage(CHAT, { role: 'assistant', content: 'hello' });

    const history = await store.getHistory(CHAT, 10);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(history[1]?.content).toBe('hello');
  });

  it('round-trips a tool call and its result', async () => {
    await store.appendMessage(CHAT, { role: 'user', content: 'remind me to walk' });
    await store.appendMessage(CHAT, {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'reminders.set-reminder',
          name: 'reminders.set-reminder',
          arguments: { message: 'walk', delayMinutes: 5 },
        },
      ],
    });
    await store.appendMessage(CHAT, {
      role: 'tool',
      content: JSON.stringify({ ok: true }),
      name: 'reminders.set-reminder',
    });
    await store.appendMessage(CHAT, { role: 'assistant', content: 'Reminder set.' });

    const history = await store.getHistory(CHAT, 10);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    // The tool call survives the round-trip with null content, as the
    // OpenAI-format adapters require.
    expect(history[1]?.content).toBeNull();
    expect(history[1]?.tool_calls?.[0]?.name).toBe('reminders.set-reminder');
    expect(history[1]?.tool_calls?.[0]?.arguments).toEqual({ message: 'walk', delayMinutes: 5 });
    expect(history[2]?.name).toBe('reminders.set-reminder');
  });

  it('never returns history that starts mid-turn', async () => {
    // A full tool turn, then a later plain turn. Asking for a window small
    // enough to slice the tool turn apart must not yield a leading `tool`
    // message or an assistant tool_call with no result.
    await store.appendMessage(CHAT, { role: 'user', content: 'remind me' });
    await store.appendMessage(CHAT, {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 't', name: 't', arguments: {} }],
    });
    await store.appendMessage(CHAT, { role: 'tool', content: '{}', name: 't' });
    await store.appendMessage(CHAT, { role: 'assistant', content: 'done' });
    await store.appendMessage(CHAT, { role: 'user', content: 'thanks' });
    await store.appendMessage(CHAT, { role: 'assistant', content: 'welcome' });

    // limit 4 would otherwise start at the `tool` message.
    const history = await store.getHistory(CHAT, 4);
    expect(history[0]?.role).toBe('user');
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('returns empty when the window contains no user message', async () => {
    await store.appendMessage(CHAT, { role: 'assistant', content: 'orphan' });
    expect(await store.getHistory(CHAT, 10)).toEqual([]);
  });

  it('keeps histories separate per chat', async () => {
    await store.appendMessage('a', { role: 'user', content: 'from a' });
    await store.appendMessage('b', { role: 'user', content: 'from b' });

    const a = await store.getHistory('a', 10);
    expect(a).toHaveLength(1);
    expect(a[0]?.content).toBe('from a');
  });

  it('clears history for a chat', async () => {
    await store.appendMessage(CHAT, { role: 'user', content: 'hi' });
    await store.clearHistory(CHAT);
    expect(await store.getHistory(CHAT, 10)).toEqual([]);
  });
});
