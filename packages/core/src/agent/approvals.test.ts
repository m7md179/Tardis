import { describe, it, expect } from 'bun:test';
import {
  isApprovalText,
  isDenialText,
  decideApproval,
  createPendingApprovalStore,
  cancellationMessage,
} from './approvals.js';

// ─── The soft lock ───────────────────────────────────────────────────────────
//
// Live: TARDIS offered to run workspace.delete-item. The user said "do it".
// It offered again. "do it" again — offered again. Two causes, and each alone
// was enough: the vocabulary rejected "do it", and no surface except Telegram
// stored the pending call at all.

describe('isApprovalText', () => {
  it('accepts the words that were rejected in the live lock', () => {
    for (const t of ['do it', 'go ahead', 'sure', 'yes please', 'run it', 'proceed']) {
      expect({ t, approved: isApprovalText(t) }).toMatchObject({ approved: true });
    }
  });

  it('still accepts the original six', () => {
    for (const t of ['yes', 'y', 'yep', 'ok', 'confirm', 'approve']) {
      expect({ t, approved: isApprovalText(t) }).toMatchObject({ approved: true });
    }
  });

  it('ignores case and trailing punctuation, which people type without thinking', () => {
    for (const t of ['Yes', 'YES!', 'do it.', '  ok,  ']) {
      expect({ t, approved: isApprovalText(t) }).toMatchObject({ approved: true });
    }
  });

  it('does not treat a fresh instruction as a yes', () => {
    // The safety property. A destructive action must not run because a message
    // happened to contain an agreeable word.
    for (const t of [
      'yes but change the title first',
      'ok so what about the other one',
      'do it tomorrow',
      'delete the other task instead',
      'sure, but first show me the parent',
    ]) {
      expect({ t, approved: isApprovalText(t) }).toMatchObject({ approved: false });
    }
  });
});

describe('isDenialText', () => {
  it('recognises a clear no', () => {
    for (const t of ['no', 'nope', 'cancel', 'stop', 'never mind', "don't"]) {
      expect({ t, denied: isDenialText(t) }).toMatchObject({ denied: true });
    }
  });
});

describe('decideApproval', () => {
  it('runs only on a clear yes', () => {
    expect(decideApproval('do it')).toBe('approve');
    expect(decideApproval('yes')).toBe('approve');
  });

  it('cancels on anything else, including a plain no', () => {
    // Not "ignore and carry on": an unanswered destructive action left pending
    // could be triggered by an unrelated message later.
    expect(decideApproval('no')).toBe('cancel');
    expect(decideApproval('actually show me the backlog first')).toBe('cancel');
    expect(decideApproval('')).toBe('cancel');
  });
});

describe('createPendingApprovalStore', () => {
  const approval = { toolName: 'workspace.delete-item', args: { itemId: 1148 }, preview: 'p' };

  it('keeps one pending action per chat', () => {
    const store = createPendingApprovalStore();
    store.set('app', approval);
    expect(store.get('app')).toEqual(approval);
    expect(store.get('telegram-1')).toBeUndefined();
  });

  it('forgets it once answered', () => {
    const store = createPendingApprovalStore();
    store.set('app', approval);
    store.delete('app');
    expect(store.get('app')).toBeUndefined();
  });

  it('replaces rather than queues, so an older offer cannot resurface', () => {
    const store = createPendingApprovalStore();
    store.set('app', approval);
    const newer = { toolName: 'workspace.archive-item', args: { itemId: 7 }, preview: 'p2' };
    store.set('app', newer);
    expect(store.get('app')).toEqual(newer);
  });
});

describe('cancellationMessage', () => {
  it('names the thing that did not run', () => {
    expect(cancellationMessage('workspace.delete-item', true)).toContain('workspace.delete-item');
    expect(cancellationMessage('workspace.delete-item', false)).toContain('not a yes');
  });
});
