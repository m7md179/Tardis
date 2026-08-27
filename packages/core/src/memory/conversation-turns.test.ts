import { describe, it, expect } from 'bun:test';
import { groupIntoTurns } from './conversation-store.js';

// ─── Rebuilding a transcript from stored rows ────────────────────────────────
//
// Refreshing the web app lost every message, because nothing exposed the
// history the server had been storing all along. Grouping lives here rather
// than in each client: there are three of them, and if two reassemble tool
// calls slightly differently, the web app and the terminal end up disagreeing
// about what you said — worse than showing nothing.

const row = (
  role: string,
  content: string,
  extra: Partial<{ id: string; toolName: string | null; toolCalls: string | null; timestamp: number }> = {}
) => ({
  id: extra.id ?? `${role}-${content.slice(0, 6)}`,
  role,
  content,
  toolName: extra.toolName ?? null,
  toolCalls: extra.toolCalls ?? null,
  timestamp: extra.timestamp ?? 1000,
});

const calls = (name: string, args: Record<string, unknown>) =>
  JSON.stringify([{ id: name, name, arguments: args }]);

describe('groupIntoTurns', () => {
  it('turns a plain exchange into one turn', () => {
    const turns = groupIntoTurns([
      row('user', 'hello'),
      row('assistant', 'Hi there.'),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.question).toBe('hello');
    expect(turns[0]?.answer).toBe('Hi there.');
    expect(turns[0]?.steps).toHaveLength(0);
  });

  it('rebuilds the ledger from tool call and result rows', () => {
    const turns = groupIntoTurns([
      row('user', 'i ate 2 sandwiches, 2 jod'),
      row('assistant', '', { toolCalls: calls('health.log-meal', { calories: 700 }) }),
      row('tool', '{"success":true,"message":"Logged 700 kcal."}', { toolName: 'health.log-meal' }),
      row('assistant', '', { toolCalls: calls('budget.add-entry', { amount: 2 }) }),
      row('tool', '{"success":true}', { toolName: 'budget.add-entry' }),
      row('assistant', 'Logged both.'),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.steps.map((s) => `${s.type}:${s.toolName}`)).toEqual([
      'tool_call:health.log-meal',
      'tool_result:health.log-meal',
      'tool_call:budget.add-entry',
      'tool_result:budget.add-entry',
    ]);
    expect(turns[0]?.steps[0]?.toolArgs).toEqual({ calories: 700 });
    expect((turns[0]?.steps[1]?.toolResult as { message: string }).message).toBe('Logged 700 kcal.');
    expect(turns[0]?.answer).toBe('Logged both.');
  });

  it('splits on each user message', () => {
    const turns = groupIntoTurns([
      row('user', 'first', { timestamp: 1 }),
      row('assistant', 'one'),
      row('user', 'second', { timestamp: 2 }),
      row('assistant', 'two'),
    ]);
    expect(turns.map((t) => t.question)).toEqual(['first', 'second']);
    expect(turns.map((t) => t.answer)).toEqual(['one', 'two']);
  });

  it('keeps a call with no result — the turn stopped for approval', () => {
    // Hiding the request that paused would misrepresent what happened.
    const turns = groupIntoTurns([
      row('user', 'delete my last entry'),
      row('assistant', '', { toolCalls: calls('budget.delete-entry', { id: 'e1' }) }),
    ]);
    expect(turns[0]?.steps).toHaveLength(1);
    expect(turns[0]?.steps[0]?.type).toBe('tool_call');
    expect(turns[0]?.answer).toBeNull();
  });

  it('drops rows orphaned by pagination rather than misattributing them', () => {
    // A page boundary can slice mid-turn. Attaching a stray tool result to the
    // next question would put it under the wrong message on screen.
    const turns = groupIntoTurns([
      row('tool', '{"success":true}', { toolName: 'budget.add-entry' }),
      row('assistant', 'orphaned answer'),
      row('user', 'a real question'),
      row('assistant', 'a real answer'),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.question).toBe('a real question');
    expect(turns[0]?.steps).toHaveLength(0);
  });

  it('survives a malformed tool_calls blob', () => {
    const turns = groupIntoTurns([
      row('user', 'x'),
      row('assistant', '', { toolCalls: '{not json' }),
      row('assistant', 'answered anyway'),
    ]);
    expect(turns[0]?.answer).toBe('answered anyway');
    expect(turns[0]?.steps).toHaveLength(0);
  });

  it('keeps a tool result that is a bare string', () => {
    const turns = groupIntoTurns([
      row('user', 'x'),
      row('tool', 'plain text result', { toolName: 'notes.get-note' }),
    ]);
    expect(turns[0]?.steps[0]?.toolResult).toBe('plain text result');
  });

  it('returns nothing for an empty history', () => {
    expect(groupIntoTurns([])).toEqual([]);
  });
});
