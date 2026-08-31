import { describe, it, expect } from 'bun:test';
import { isMine } from './permissions.js';

const ME = 42;

describe('isMine', () => {
  it('is mine when I am an assignee', () => {
    expect(isMine({ assignees: [{ account_id: ME }], reporter_account_id: 7 }, ME)).toBe(true);
  });

  it('is mine when I reported it', () => {
    expect(isMine({ assignees: [{ account_id: 9 }], reporter_account_id: ME }, ME)).toBe(true);
  });

  it('is not mine when I am neither', () => {
    expect(isMine({ assignees: [{ account_id: 9 }], reporter_account_id: 7 }, ME)).toBe(false);
  });

  it('handles a null assignee list, which is what create returns', () => {
    expect(isMine({ assignees: null, reporter_account_id: ME }, ME)).toBe(true);
    expect(isMine({ assignees: null, reporter_account_id: 7 }, ME)).toBe(false);
  });

  it('is not mine when the account id is unknown', () => {
    // -1 is the "not logged in yet" sentinel. It must never match a real item,
    // and it must never match an item whose reporter id is also negative.
    expect(isMine({ assignees: [{ account_id: 9 }], reporter_account_id: 7 }, -1)).toBe(false);
    expect(isMine({ assignees: [{ account_id: -1 }], reporter_account_id: -1 }, -1)).toBe(false);
  });
});
