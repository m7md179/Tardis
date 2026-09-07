import { describe, it, expect } from 'bun:test';
import { fitToContextWindow } from './context-manager.js';
import type { LLMMessage } from '../llm/provider.js';

const SYSTEM = 'You are TARDIS.';
const USER = 'remind me to walk';

function fit(history: LLMMessage[], contextWindowSize: number): LLMMessage[] {
  return fitToContextWindow({
    systemPrompt: SYSTEM,
    conversationHistory: history,
    userMessage: USER,
    contextWindowSize,
  });
}

/** A complete tool turn: user → assistant(tool_calls) → tool → assistant(text). */
function toolTurn(label: string): LLMMessage[] {
  return [
    { role: 'user', content: `${label} request` },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'reminders.set', name: 'reminders.set', arguments: { label } }],
    },
    { role: 'tool', content: '{"success":true}', name: 'reminders.set' },
    { role: 'assistant', content: `${label} done` },
  ];
}

describe('fitToContextWindow', () => {
  it('returns history untouched when everything fits', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(fit(history, 4096)).toEqual(history);
  });

  it('returns empty history when the reserved content alone exceeds the budget', () => {
    const history: LLMMessage[] = [{ role: 'user', content: 'hi' }];
    // 512 is the schema minimum; system + user + margin leaves nothing.
    expect(fit(history, 512).length).toBeLessThanOrEqual(history.length);
  });

  it('trims oldest messages when history exceeds the budget', () => {
    const history: LLMMessage[] = [];
    for (let i = 0; i < 40; i++) {
      history.push({ role: 'user', content: `message number ${i} with some padding text` });
      history.push({ role: 'assistant', content: `reply number ${i} with some padding text` });
    }
    const result = fit(history, 1000);
    expect(result.length).toBeLessThan(history.length);
    // Newest content survives, oldest is dropped.
    expect(result.at(-1)).toEqual(history.at(-1)!);
    expect(result[0]).not.toEqual(history[0]!);
  });

  // ─── Turn-boundary safety ───────────────────────────────────────────────────
  // Regression guard: once tool calls are persisted into history, naive
  // one-at-a-time trimming can leave an orphaned `tool` message at the head,
  // which providers reject.

  it('never returns history starting with an orphaned tool message', () => {
    const history = [...toolTurn('first'), ...toolTurn('second'), ...toolTurn('third')];

    // Sweep a wide range of budgets so every possible cut point is exercised.
    for (let ctx = 512; ctx <= 3000; ctx += 20) {
      const result = fit(history, ctx);
      if (result.length === 0) continue;
      expect(result[0]!.role).toBe('user');
      expect(result[0]!.tool_calls).toBeUndefined();
    }
  });

  it('never returns history starting with an assistant tool_calls message', () => {
    const history = [...toolTurn('alpha'), ...toolTurn('beta')];

    for (let ctx = 512; ctx <= 3000; ctx += 20) {
      const result = fit(history, ctx);
      if (result.length === 0) continue;
      // A leading assistant tool_calls message would have lost its tool result
      // to the trim, leaving an unanswered call.
      expect(result[0]!.role).not.toBe('tool');
      expect(result[0]!.role).not.toBe('assistant');
    }
  });

  it('keeps complete tool turns intact when they fit', () => {
    const history = toolTurn('only');
    const result = fit(history, 4096);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(result[1]?.tool_calls?.[0]?.name).toBe('reminders.set');
  });

  it('returns empty rather than a fragment when no whole turn survives', () => {
    // Only a trailing fragment with no user message at its head.
    const fragment: LLMMessage[] = [
      { role: 'tool', content: '{"success":true}', name: 'reminders.set' },
      { role: 'assistant', content: 'done' },
    ];
    expect(fit(fragment, 4096)).toEqual([]);
  });
});
