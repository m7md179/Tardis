import { describe, it, expect } from 'bun:test';
import { applyTurnStart, applyTurnEnd } from './turn-filters.js';
import type { TurnFilter, FilterLogger } from './turn-filters.js';

function silentLogger(): FilterLogger & { messages: string[] } {
  const messages: string[] = [];
  return { messages, error: (m) => messages.push(m) };
}

const startCtx = { chatId: 'app', userMessage: 'hello' };
const endCtx = { chatId: 'app', userMessage: 'hello', response: 'hi', steps: [] };

describe('applyTurnStart', () => {
  it('leaves the message alone with no filters', async () => {
    expect(await applyTurnStart([], startCtx)).toBe('hello');
  });

  it('applies a rewrite', async () => {
    const f: TurnFilter = {
      plugin: 'expander',
      onTurnStart: async ({ userMessage }) => ({ userMessage: userMessage.toUpperCase() }),
    };
    expect(await applyTurnStart([f], startCtx)).toBe('HELLO');
  });

  it('threads each filter into the next, in order', async () => {
    const seen: string[] = [];
    const append = (plugin: string, suffix: string): TurnFilter => ({
      plugin,
      onTurnStart: async ({ userMessage }) => {
        seen.push(userMessage);
        return { userMessage: userMessage + suffix };
      },
    });
    expect(await applyTurnStart([append('a', '-a'), append('b', '-b')], startCtx)).toBe(
      'hello-a-b'
    );
    expect(seen).toEqual(['hello', 'hello-a']);
  });

  it('treats returning nothing as no change', async () => {
    const f: TurnFilter = { plugin: 'observer', onTurnStart: async () => {} };
    expect(await applyTurnStart([f], startCtx)).toBe('hello');
  });

  it('treats an empty object as no change', async () => {
    const f: TurnFilter = { plugin: 'observer', onTurnStart: async () => ({}) };
    expect(await applyTurnStart([f], startCtx)).toBe('hello');
  });

  it('ignores a rewrite to nothing', async () => {
    // An empty turn reaching the model is worse than an unmodified one, and a
    // filter blanking the message is far more likely a bug than an intent.
    const blank: TurnFilter = { plugin: 'blanker', onTurnStart: async () => ({ userMessage: '' }) };
    const spaces: TurnFilter = {
      plugin: 'blanker',
      onTurnStart: async () => ({ userMessage: '   ' }),
    };
    expect(await applyTurnStart([blank], startCtx)).toBe('hello');
    expect(await applyTurnStart([spaces], startCtx)).toBe('hello');
  });

  it('skips a throwing filter and keeps going', async () => {
    // A filter that can rewrite a turn can break every turn. This is the
    // isolation every other plugin call already gets.
    const logger = silentLogger();
    const boom: TurnFilter = {
      plugin: 'broken',
      onTurnStart: async () => {
        throw new Error('bad filter');
      },
    };
    const good: TurnFilter = {
      plugin: 'good',
      onTurnStart: async ({ userMessage }) => ({ userMessage: `${userMessage}!` }),
    };

    expect(await applyTurnStart([boom, good], startCtx, logger)).toBe('hello!');
    expect(logger.messages[0]).toContain('broken.onTurnStart');
  });

  it('keeps the previous filter\'s work when a later one throws', async () => {
    const logger = silentLogger();
    const good: TurnFilter = {
      plugin: 'good',
      onTurnStart: async () => ({ userMessage: 'rewritten' }),
    };
    const boom: TurnFilter = {
      plugin: 'broken',
      onTurnStart: async () => {
        throw new Error('bad filter');
      },
    };
    expect(await applyTurnStart([good, boom], startCtx, logger)).toBe('rewritten');
  });

  it('skips a filter that only registered the other hook', async () => {
    const f: TurnFilter = { plugin: 'end-only', onTurnEnd: async () => ({ response: 'x' }) };
    expect(await applyTurnStart([f], startCtx)).toBe('hello');
  });

  it('passes the chat id through, so a filter can be per-conversation', async () => {
    let seen = '';
    const f: TurnFilter = {
      plugin: 'peek',
      onTurnStart: async (ctx) => {
        seen = ctx.chatId;
      },
    };
    await applyTurnStart([f], startCtx);
    expect(seen).toBe('app');
  });
});

describe('applyTurnEnd', () => {
  it('applies a rewrite', async () => {
    const f: TurnFilter = {
      plugin: 'shouty',
      onTurnEnd: async ({ response }) => ({ response: response.toUpperCase() }),
    };
    expect(await applyTurnEnd([f], endCtx)).toBe('HI');
  });

  it('ignores a rewrite to nothing', async () => {
    // Telegram rejects empty message text outright, so a filter must not be
    // able to produce a turn that cannot be delivered.
    const f: TurnFilter = { plugin: 'blanker', onTurnEnd: async () => ({ response: '' }) };
    expect(await applyTurnEnd([f], endCtx)).toBe('hi');
  });

  it('skips a throwing filter', async () => {
    const logger = silentLogger();
    const boom: TurnFilter = {
      plugin: 'broken',
      onTurnEnd: async () => {
        throw new Error('nope');
      },
    };
    expect(await applyTurnEnd([boom], endCtx, logger)).toBe('hi');
    expect(logger.messages[0]).toContain('broken.onTurnEnd');
  });

  it('sees the steps the loop produced', async () => {
    // The point of onTurnEnd: cross-cutting checks over what actually happened,
    // which is what the hardcoded claim guard does today.
    let toolNames: string[] = [];
    const f: TurnFilter = {
      plugin: 'auditor',
      onTurnEnd: async (ctx) => {
        toolNames = ctx.steps.filter((s) => s.type === 'tool_call').map((s) => s.toolName ?? '');
      },
    };
    await applyTurnEnd([f], {
      ...endCtx,
      steps: [
        { type: 'tool_call', content: 'budget.add-entry', toolName: 'budget.add-entry', timestamp: 1 },
        { type: 'reasoning', content: 'done', timestamp: 2 },
      ],
    });
    expect(toolNames).toEqual(['budget.add-entry']);
  });

  it('sees the message the loop actually ran on, not the original', async () => {
    let seen = '';
    const f: TurnFilter = {
      plugin: 'peek',
      onTurnEnd: async (ctx) => {
        seen = ctx.userMessage;
      },
    };
    await applyTurnEnd([f], { ...endCtx, userMessage: 'rewritten by onTurnStart' });
    expect(seen).toBe('rewritten by onTurnStart');
  });
});
