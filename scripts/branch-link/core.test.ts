import { describe, it, expect } from 'bun:test';
import {
  parseCommitLog,
  parsePrePushRefs,
  resolveTimeoutMs,
  shouldAct,
  DEFAULT_PROTECTED,
} from './core.js';

describe('parsePrePushRefs', () => {
  it('reads a branch being pushed', () => {
    const out = parsePrePushRefs(
      'refs/heads/feat/auto-submit abc123 refs/heads/feat/auto-submit 0000000000000000000000000000000000000000\n'
    );
    expect(out).toEqual([{ branch: 'feat/auto-submit', sha: 'abc123' }]);
  });

  it('skips a deleted ref, which pushes an all-zero local sha', () => {
    // `git push --delete` must not create a work item for the branch it removes.
    const out = parsePrePushRefs(
      'refs/heads/gone 0000000000000000000000000000000000000000 refs/heads/gone abc123\n'
    );
    expect(out).toEqual([]);
  });

  it('skips tags — only branches become work items', () => {
    const out = parsePrePushRefs('refs/tags/v1 abc123 refs/tags/v1 0000000\n');
    expect(out).toEqual([]);
  });

  it('reads several refs and ignores blank lines', () => {
    const out = parsePrePushRefs(
      'refs/heads/a 111 refs/heads/a 000\n\nrefs/heads/b 222 refs/heads/b 000\n'
    );
    expect(out.map((r) => r.branch)).toEqual(['a', 'b']);
  });

  it('returns nothing for empty stdin rather than throwing', () => {
    // `git push` with nothing to push still runs the hook with empty stdin.
    expect(parsePrePushRefs('')).toEqual([]);
  });
});

describe('shouldAct', () => {
  it('refuses the branches everyone shares', () => {
    for (const b of DEFAULT_PROTECTED) expect(shouldAct(b, DEFAULT_PROTECTED)).toBe(false);
  });

  it('allows an ordinary feature branch', () => {
    expect(shouldAct('feat/auto-submit-week', DEFAULT_PROTECTED)).toBe(true);
  });

  it('does not treat a branch merely containing a protected name as protected', () => {
    // `fix/main-menu` is not `main`.
    expect(shouldAct('fix/main-menu', DEFAULT_PROTECTED)).toBe(true);
  });
});

describe('parseCommitLog', () => {
  const SEP = '\x00';
  const REC = '\x1e';

  it('reads subject, body and sha per commit', () => {
    const raw = `Auto-submit the week${SEP}Because Monday${SEP}abc123${REC}Add a test${SEP}${SEP}def456${REC}`;
    expect(parseCommitLog(raw)).toEqual([
      { subject: 'Auto-submit the week', body: 'Because Monday', sha: 'abc123' },
      { subject: 'Add a test', body: '', sha: 'def456' },
    ]);
  });

  it('returns nothing for an empty log, which a first push of an empty branch gives', () => {
    expect(parseCommitLog('')).toEqual([]);
  });

  it('drops a record with no subject rather than emitting a blank commit', () => {
    expect(parseCommitLog(`${SEP}body${SEP}abc${REC}`)).toEqual([]);
  });
});

describe('resolveTimeoutMs', () => {
  it('defaults generously, because branch-create makes two LLM calls', () => {
    // Measured live: compose + re-rank against a real model took longer than
    // the original 30s, the client gave up, and the request was queued as an
    // outage — while the server went on to create the item successfully.
    expect(resolveTimeoutMs(undefined)).toBeGreaterThanOrEqual(120000);
  });

  it('honours an explicit value', () => {
    expect(resolveTimeoutMs(45000)).toBe(45000);
  });

  it('ignores nonsense rather than disabling the timeout', () => {
    // A zero or negative timeout would abort instantly; a non-number would
    // make AbortSignal.timeout throw inside a detached process nobody watches.
    expect(resolveTimeoutMs(0)).toBe(resolveTimeoutMs(undefined));
    expect(resolveTimeoutMs(-1)).toBe(resolveTimeoutMs(undefined));
    expect(resolveTimeoutMs('soon' as unknown as number)).toBe(resolveTimeoutMs(undefined));
  });
});

describe('parseCommitLog — author time', () => {
  const SEP = '\x00';
  const REC = '\x1e';

  it('carries each commit’s author time, which is the clock time is divided by', () => {
    // Without `at` the server has commit text but no idea when you worked, so
    // it can only log time for branches pushed in the same breath as the ask.
    const raw = `Subject${SEP}body${SEP}abc123${SEP}1788700000${REC}`;
    expect(parseCommitLog(raw)).toEqual([
      { subject: 'Subject', body: 'body', sha: 'abc123', at: 1788700000 },
    ]);
  });

  it('tolerates a record with no timestamp rather than dropping the commit', () => {
    // The text is still worth having for composing a title.
    const out = parseCommitLog(`Subject${SEP}${SEP}abc${REC}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toBeUndefined();
  });
});
