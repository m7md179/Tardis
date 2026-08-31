import { describe, it, expect } from 'bun:test';
import { nextQuestion, describeDraft } from './questions.js';
import { createDraft, setSlots } from './draft.js';
import type { Draft } from './draft.js';

const NOW = '2026-08-27T10:00:00.000Z';
const base = (): Draft =>
  createDraft({
    id: 'd_1',
    workspaceId: 1,
    sourceText: 'rate limit the login endpoint',
    myAccountId: 42,
    now: NOW,
  });

describe('nextQuestion', () => {
  it('asks for the type first', () => {
    const q = nextQuestion(base());
    expect(q).toContain('epic');
    expect(q).toContain('story');
    expect(q).toContain('sub-task');
  });

  it('asks for a title once the type is known', () => {
    const q = nextQuestion(setSlots(base(), { type: 'SUB_TASK' }, 'user', NOW));
    expect(q?.toLowerCase()).toContain('call it');
  });

  it('names the parent kind correctly for a STORY', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    expect(nextQuestion(d)).toContain('epic');
  });

  it('names the parent kind correctly for a SUB_TASK', () => {
    const d = setSlots(base(), { type: 'SUB_TASK', title: 'T' }, 'user', NOW);
    expect(nextQuestion(d)).toContain('story');
  });

  it('lists candidates with reasons when it has them', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    const q = nextQuestion(d, [
      { id: 3, title: 'Login rate limits', reason: 'about login' },
      { id: 1, title: 'Authentication hardening', reason: null },
    ]);
    expect(q).toContain('Login rate limits');
    expect(q).toContain('about login');
    expect(q).toContain('Authentication hardening');
  });

  it('always offers an escape from the candidate list', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    const q = nextQuestion(d, [{ id: 3, title: 'Login rate limits', reason: null }]);
    expect(q?.toLowerCase()).toContain('none of these');
  });

  it('demands a description when the status has left BACKLOG', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', status: 'TODO' }, 'user', NOW);
    const q = nextQuestion(d);
    expect(q?.toLowerCase()).toContain('description');
    expect(q).toContain('Backlog');
  });

  it('moves on to optional fields once nothing is blocking', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(nextQuestion(d)?.toLowerCase()).toContain('description');
  });

  it('returns null when there is nothing left worth asking', () => {
    const d = setSlots(
      base(),
      {
        type: 'EPIC',
        title: 'T',
        description: 'why',
        story_points: 3,
        estimate_hours: 4,
        due_date: '2026-09-04',
        priority: 'HIGH',
        assignee_account_ids: [42],
      },
      'user',
      NOW
    );
    expect(nextQuestion(d)).toBeNull();
  });

  it('asks one question, not several', () => {
    const q = nextQuestion(base()) ?? '';
    expect(q.split('?').filter((s) => s.trim() !== '').length).toBe(1);
  });
});

describe('describeDraft', () => {
  it('shows what is set and marks what was assumed', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'Rate limiting' }, 'user', NOW);
    const out = describeDraft(d);
    expect(out).toContain('Rate limiting');
    expect(out).toContain('EPIC');
    expect(out.toLowerCase()).toContain('assumed');
  });

  it('does not print null for unset fields', () => {
    expect(describeDraft(base())).not.toContain('null');
  });
});
