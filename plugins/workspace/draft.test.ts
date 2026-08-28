import { describe, it, expect } from 'bun:test';
import {
  createDraft,
  setSlots,
  blockingSlots,
  optionalSlots,
  validateForCommit,
  toCreatePayload,
} from './draft.js';

const NOW = '2026-08-27T10:00:00.000Z';

function base() {
  return createDraft({
    id: 'd_1',
    workspaceId: 1,
    sourceText: 'rate limit the login endpoint',
    myAccountId: 42,
    now: NOW,
  });
}

describe('createDraft', () => {
  it('starts OPEN with the source text kept', () => {
    const d = base();
    expect(d.status).toBe('OPEN');
    expect(d.sourceText).toBe('rate limit the login endpoint');
  });

  it('defaults priority, status and assignees, marked as defaults not user choices', () => {
    const d = base();
    expect(d.slots.priority).toEqual({ value: 'MEDIUM', source: 'default' });
    expect(d.slots.status).toEqual({ value: 'BACKLOG', source: 'default' });
    expect(d.slots.assignee_account_ids).toEqual({ value: [42], source: 'default' });
  });

  it('leaves everything else unset', () => {
    const d = base();
    expect(d.slots.title).toEqual({ value: null, source: 'unset' });
    expect(d.slots.parent_id).toEqual({ value: null, source: 'unset' });
  });
});

describe('setSlots', () => {
  it('records the source so a default can be told from a choice', () => {
    const d = setSlots(base(), { priority: 'HIGH' }, 'user', NOW);
    expect(d.slots.priority).toEqual({ value: 'HIGH', source: 'user' });
  });

  it('does not let an inference overwrite something the user said', () => {
    const said = setSlots(base(), { title: 'What I said' }, 'user', NOW);
    const guessed = setSlots(said, { title: 'What it guessed' }, 'inferred', NOW);
    expect(guessed.slots.title.value).toBe('What I said');
  });

  it('lets the user overwrite an inference', () => {
    const guessed = setSlots(base(), { title: 'Guess' }, 'inferred', NOW);
    const said = setSlots(guessed, { title: 'Correction' }, 'user', NOW);
    expect(said.slots.title.value).toBe('Correction');
  });

  it('does not mutate the draft it was given', () => {
    const before = base();
    setSlots(before, { title: 'X' }, 'user', NOW);
    expect(before.slots.title.value).toBeNull();
  });
});

describe('blockingSlots', () => {
  it('wants type and title first', () => {
    expect(blockingSlots(base())).toEqual(['type', 'title']);
  });

  it('wants a parent for a STORY', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual(['parent_id']);
  });

  it('wants a parent for a SUB_TASK', () => {
    const d = setSlots(base(), { type: 'SUB_TASK', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual(['parent_id']);
  });

  it('never wants a parent for an EPIC', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual([]);
  });

  it('requires a description once the target status leaves BACKLOG', () => {
    // Server: 400 "A work item needs a description before it can enter To Do".
    const d = setSlots(base(), { type: 'EPIC', title: 'T', status: 'TODO' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual(['description']);
  });

  it('does not require a description while the item stays in BACKLOG', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).not.toContain('description');
  });
});

describe('optionalSlots', () => {
  it('offers the fields worth asking about, in order', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(optionalSlots(d)).toEqual([
      'description',
      'story_points',
      'estimate_hours',
      'due_date',
      'priority',
      'assignee_account_ids',
    ]);
  });

  it('stops offering a field once the user has set it', () => {
    const d = setSlots(
      base(),
      { type: 'EPIC', title: 'T', story_points: 5, priority: 'HIGH' },
      'user',
      NOW
    );
    expect(optionalSlots(d)).not.toContain('story_points');
    expect(optionalSlots(d)).not.toContain('priority');
  });

  it('still offers a field that only holds a default', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(optionalSlots(d)).toContain('priority');
  });
});

describe('validateForCommit', () => {
  it('reports every blocking slot at once, not one at a time', () => {
    const errors = validateForCommit(base());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('type');
  });

  it('rejects an EPIC that somehow acquired a parent', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', parent_id: 5 }, 'user', NOW);
    expect(validateForCommit(d).join(' ')).toContain('Epic');
  });

  it('passes a complete BACKLOG epic', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(validateForCommit(d)).toEqual([]);
  });

  it('passes a complete TODO sub-task', () => {
    const d = setSlots(
      base(),
      { type: 'SUB_TASK', title: 'T', parent_id: 2, description: 'why', status: 'TODO' },
      'user',
      NOW
    );
    expect(validateForCommit(d)).toEqual([]);
  });
});

describe('toCreatePayload', () => {
  it('emits only the fields that are set', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    const p = toCreatePayload(d);
    expect(p['type']).toBe('EPIC');
    expect(p['title']).toBe('T');
    expect(p).not.toHaveProperty('due_date');
    expect(p).not.toHaveProperty('parent_id');
  });

  it('never sends a parent_id for an EPIC even if one is set', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', parent_id: 9 }, 'user', NOW);
    expect(toCreatePayload(d)).not.toHaveProperty('parent_id');
  });

  it('sends assignee_account_ids as an array', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(toCreatePayload(d)['assignee_account_ids']).toEqual([42]);
  });

  it('omits an empty assignee list rather than sending []', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', assignee_account_ids: [] }, 'user', NOW);
    expect(toCreatePayload(d)).not.toHaveProperty('assignee_account_ids');
  });
});
