import { describe, it, expect } from 'bun:test';
import {
  BRANCH_KEY_PREFIX,
  branchKey,
  isExpired,
  isSettled,
  newRecord,
  parseBranchKey,
  branchUrl,
  repoFullNameFromRemote,
  partitionRecords,
} from './branch.js';

describe('branchKey', () => {
  it('round-trips a branch name containing slashes, which nearly all of them do', () => {
    // `feat/auto-submit-week-on-build` is the shape every branch in these
    // repos takes, and the repo name carries a slash too. A key that splits
    // naively on ':' is fine; one that splits on '/' loses the branch.
    const key = branchKey('taj-alsafa/internal-operation-server', 'feat/auto-submit-week');
    expect(parseBranchKey(key)).toEqual({
      provider: 'github',
      repoFullName: 'taj-alsafa/internal-operation-server',
      branch: 'feat/auto-submit-week',
    });
  });

  it('is scannable by the prefix storage.list is given', () => {
    expect(branchKey('a/b', 'main').startsWith(BRANCH_KEY_PREFIX)).toBe(true);
  });
});

describe('newRecord', () => {
  it('starts drafting, with nothing claimed about the server', () => {
    const r = newRecord('a/b', 'feat/x', 'main', '2026-09-06T00:00:00.000Z');
    expect(r.state).toBe('drafting');
    expect(r.itemId).toBeUndefined();
    expect(r.attempts).toBe(0);
  });
});

describe('isSettled', () => {
  it('treats a created record as settled, so a second push creates nothing', () => {
    // The whole idempotency story: a force push, a re-push, or a queued
    // request replayed after TARDIS came back must not make a second item.
    const r = newRecord('a/b', 'feat/x', 'main', '2026-09-06T00:00:00.000Z');
    expect(isSettled({ ...r, state: 'created', itemId: 143 })).toBe(true);
    expect(isSettled({ ...r, state: 'adopted', itemId: 143 })).toBe(true);
  });

  it('leaves a failed record unsettled, so a retry can still run', () => {
    const r = newRecord('a/b', 'feat/x', 'main', '2026-09-06T00:00:00.000Z');
    expect(isSettled({ ...r, state: 'failed', error: 'boom' })).toBe(false);
    expect(isSettled(r)).toBe(false);
  });
});

describe('isExpired', () => {
  const DAY = 86400000;
  const made = '2026-09-01T00:00:00.000Z';
  const base = newRecord('a/b', 'feat/x', 'main', made);
  const later = (days: number): string => new Date(Date.parse(made) + days * DAY).toISOString();

  it('expires a draft nobody ever pushed', () => {
    expect(isExpired(base, 14, later(15))).toBe(true);
    expect(isExpired(base, 14, later(13))).toBe(false);
  });

  it('never expires a created record — it is the branch to item mapping', () => {
    // Sweeping this would orphan the link and let a re-push duplicate the item.
    const created = { ...base, state: 'created' as const, itemId: 143 };
    expect(isExpired(created, 14, later(3650))).toBe(false);
  });
});

describe('branchUrl', () => {
  it('matches the URL the server builds for a branch link, exactly', () => {
    // workspace-git-link.service.ts builds
    //   `https://github.com/${repoFullName}/tree/${encodeURI(branch)}`
    // for a pushed branch. If ours differed, the same branch reached by push
    // and by us would parse to two different links on the same item.
    expect(branchUrl('taj-alsafa/internal-operation-server', 'feat/auto-submit-week')).toBe(
      'https://github.com/taj-alsafa/internal-operation-server/tree/feat/auto-submit-week'
    );
  });

  it('leaves the slashes in a branch name alone, as encodeURI does', () => {
    expect(branchUrl('a/b', 'feat/x/y')).toBe('https://github.com/a/b/tree/feat/x/y');
  });
});

describe('repoFullNameFromRemote', () => {
  it('reads an https remote', () => {
    expect(repoFullNameFromRemote('https://github.com/taj-alsafa/internal-operation-server.git')).toBe(
      'taj-alsafa/internal-operation-server'
    );
  });

  it('reads an ssh remote', () => {
    expect(repoFullNameFromRemote('git@github.com:taj-alsafa/io-website.git')).toBe(
      'taj-alsafa/io-website'
    );
  });

  it('returns null for a remote that is not GitHub, rather than guessing', () => {
    expect(repoFullNameFromRemote('https://gitlab.com/a/b.git')).toBeNull();
    expect(repoFullNameFromRemote('')).toBeNull();
  });
});

describe('partitionRecords', () => {
  const made = '2026-09-01T00:00:00.000Z';
  const now = '2026-09-20T00:00:00.000Z'; // 19 days later
  const draft = newRecord('a/b', 'feat/old', 'main', made);
  const linked = { ...newRecord('a/b', 'feat/done', 'main', made), state: 'created' as const, itemId: 1 };
  const failed = { ...newRecord('a/b', 'feat/bad', 'main', made), state: 'failed' as const, error: 'x' };

  it('expires only stale drafts, keeping links and failures', () => {
    // A failure is kept so it stays visible in branch-status; a link is kept
    // because it is the mapping. Only an abandoned draft is swept.
    const out = partitionRecords(
      [
        [branchKey('a/b', 'feat/old'), draft],
        [branchKey('a/b', 'feat/done'), linked],
        [branchKey('a/b', 'feat/bad'), failed],
      ],
      14,
      now
    );

    expect(out.expire).toEqual([branchKey('a/b', 'feat/old')]);
    expect(out.keep.map(([, r]) => r.branch).sort()).toEqual(['feat/bad', 'feat/done']);
  });
});
