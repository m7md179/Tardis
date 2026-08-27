import { describe, it, expect } from 'bun:test';
import { baselineFor, matchesGlob, resolvePermission } from './permissions.js';

// ─── Baselines ───────────────────────────────────────────────────────────────

describe('baselineFor', () => {
  it('treats a direct skill as allowed', () => {
    expect(baselineFor('direct')).toBe('allow');
  });

  it('treats a workflow skill as needing a yes', () => {
    expect(baselineFor('workflow')).toBe('ask');
  });
});

// ─── Globs ───────────────────────────────────────────────────────────────────
//
// Every tool name contains a dot, so an unescaped pattern would make `budget.x`
// match `budgetax` — and worse, `*` in a naive implementation would match across
// the dot and turn a per-plugin rule into a global one.

describe('matchesGlob', () => {
  it('matches an exact name', () => {
    expect(matchesGlob('budget.delete-goal', 'budget.delete-goal')).toBe(true);
    expect(matchesGlob('budget.delete-goal', 'budget.delete-card')).toBe(false);
  });

  it('matches a whole plugin with a trailing star', () => {
    expect(matchesGlob('budget.*', 'budget.add-entry')).toBe(true);
    expect(matchesGlob('budget.*', 'health.log-meal')).toBe(false);
  });

  it('matches every tool with a bare star', () => {
    expect(matchesGlob('*', 'anything.at-all')).toBe(true);
  });

  it('matches a verb across plugins', () => {
    expect(matchesGlob('*.delete-*', 'budget.delete-goal')).toBe(true);
    expect(matchesGlob('*.delete-*', 'notes.delete-note')).toBe(true);
    expect(matchesGlob('*.delete-*', 'notes.save-note')).toBe(false);
  });

  it('treats the dot as a literal, not as "any character"', () => {
    expect(matchesGlob('budget.cards', 'budgetxcards')).toBe(false);
  });

  it('anchors both ends', () => {
    expect(matchesGlob('budget.cards', 'my-budget.cards-extra')).toBe(false);
  });

  it('matches exactly one character with ?', () => {
    expect(matchesGlob('note?.list-notes', 'notes.list-notes')).toBe(true);
    expect(matchesGlob('note?.list-notes', 'note.list-notes')).toBe(false);
  });
});

// ─── Resolution ──────────────────────────────────────────────────────────────

describe('resolvePermission', () => {
  it('falls back to the declared baseline with no rules', () => {
    expect(resolvePermission('budget.this-month', 'direct')).toBe('allow');
    expect(resolvePermission('budget.delete-goal', 'workflow')).toBe('ask');
  });

  it('raises a direct skill to ask', () => {
    expect(
      resolvePermission('budget.add-entry', 'direct', { 'budget.add-entry': 'ask' })
    ).toBe('ask');
  });

  it('forbids outright — the thing the old model could not express', () => {
    expect(
      resolvePermission('budget.delete-goal', 'workflow', { '*.delete-*': 'deny' })
    ).toBe('deny');
  });

  it('lets the last matching rule win, so broad-then-narrow reads naturally', () => {
    const rules = { 'budget.*': 'ask', 'budget.this-month': 'allow' };
    expect(resolvePermission('budget.this-month', 'direct', rules)).toBe('allow');
    expect(resolvePermission('budget.habits', 'direct', rules)).toBe('ask');
  });

  it('ignores rules that do not match', () => {
    expect(
      resolvePermission('health.log-meal', 'direct', { 'budget.*': 'deny' })
    ).toBe('allow');
  });

  // ─── The invariant that must survive ───────────────────────────────────────

  it('cannot silence a workflow skill', () => {
    // A plugin author marking something as needing approval is making a safety
    // claim. Configuration may tighten it and may never void it.
    expect(
      resolvePermission('budget.delete-goal', 'workflow', { '*': 'allow' })
    ).toBe('ask');
  });

  it('cannot silence a workflow skill even by exact name', () => {
    expect(
      resolvePermission('notes.delete-note', 'workflow', { 'notes.delete-note': 'allow' })
    ).toBe('ask');
  });

  it('still allows raising a workflow skill to deny', () => {
    expect(
      resolvePermission('notes.delete-note', 'workflow', { 'notes.delete-note': 'deny' })
    ).toBe('deny');
  });

  // ─── Backward compatibility ────────────────────────────────────────────────

  it('reads the pre-grading vocabulary rather than breaking a live config', () => {
    expect(resolvePermission('budget.add-entry', 'direct', { 'budget.*': 'workflow' })).toBe('ask');
    expect(resolvePermission('notes.list-notes', 'direct', { 'notes.*': 'direct' })).toBe('allow');
  });

  it('ignores a value that means nothing', () => {
    expect(
      resolvePermission('budget.add-entry', 'direct', { 'budget.*': 'sometimes' })
    ).toBe('allow');
  });
});
