import { describe, it, expect } from 'bun:test';
import { allocate, sessionize } from './sessions.js';
import type { CommitEvent } from './sessions.js';

const OPTS = { gapSeconds: 45 * 60, leadInSeconds: 30 * 60 };
const H = 3600;

/** `at` in hours past midnight, for readability. */
function c(branch: string, hours: number, repo = 'org/repo'): CommitEvent {
  return { branch, repoFullName: repo, at: Math.round(hours * H) };
}

describe('sessionize', () => {
  it('groups commits closer together than the gap into one session', () => {
    const out = sessionize([c('a', 9), c('a', 9.5), c('a', 10)], OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]!.commits).toHaveLength(3);
  });

  it('splits when the gap is exceeded', () => {
    // 09:00 then 11:00 — two hours apart, well past 45 minutes.
    const out = sessionize([c('a', 9), c('a', 11)], OPTS);
    expect(out).toHaveLength(2);
  });

  it('measures a session as its span plus a lead-in for the first commit', () => {
    // You were working before you committed; the lead-in is the only
    // correction for that, and it is a guess by construction.
    //
    // 30 minutes apart, deliberately inside the 45-minute gap: an earlier
    // version of this test used a full hour, which is a NEW session, and it
    // was the fixture that was wrong rather than the code.
    const out = sessionize([c('a', 9), c('a', 9.5)], OPTS);
    expect(out[0]!.seconds).toBe(30 * 60 + 30 * 60);
  });

  it('gives a lone commit the lead-in and nothing else', () => {
    const out = sessionize([c('a', 9)], OPTS);
    expect(out[0]!.seconds).toBe(30 * 60);
  });

  it('returns nothing for a day with no commits, rather than inventing a day', () => {
    expect(sessionize([], OPTS)).toEqual([]);
  });

  it('sorts commits it was handed out of order', () => {
    const out = sessionize([c('a', 9.5), c('a', 9)], OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]!.seconds).toBe(30 * 60 + 30 * 60);
  });
});

describe('allocate', () => {
  it('splits a session between branches by commit count', () => {
    // One session, four commits on `x` and two on `y`, so 2:1. Every gap is
    // under 45 minutes on purpose — spread them wider and the tail becomes a
    // second session, which is a different (also correct) answer.
    const commits = [
      c('x', 9), c('x', 9.2), c('x', 9.4), c('x', 9.6),
      c('y', 9.8), c('y', 10),
    ];
    const out = allocate(sessionize(commits, OPTS), {});
    const byBranch = Object.fromEntries(out.map((a) => [a.branch, a.seconds]));
    expect(byBranch['x']! / byBranch['y']!).toBeCloseTo(2, 5);
  });

  it('NEVER totals more than the time actually worked — the whole point', () => {
    // Five branches touched all day. The AUTO timer would bill five parallel
    // 8h sessions; this must bill the day once, divided.
    const commits: CommitEvent[] = [];
    for (let i = 0; i < 40; i++) {
      commits.push(c(`branch-${i % 5}`, 9 + i * 0.2));
    }
    const sessions = sessionize(commits, OPTS);
    const worked = sessions.reduce((n, s) => n + s.seconds, 0);
    const billed = allocate(sessions, {}).reduce((n, a) => n + a.seconds, 0);

    expect(billed).toBeLessThanOrEqual(worked);
    expect(Math.abs(billed - worked)).toBeLessThanOrEqual(5); // rounding only
  });

  it('honours a daily cap by scaling the split, not by truncating one branch', () => {
    // A cap that lopped the last branch off would silently drop real work and
    // make the numbers depend on iteration order.
    const commits = [c('x', 6), c('x', 12), c('y', 12.2), c('y', 18)];
    const sessions = sessionize(commits, OPTS);
    const out = allocate(sessions, { maxDaySeconds: 4 * H });
    const total = out.reduce((n, a) => n + a.seconds, 0);

    expect(total).toBeLessThanOrEqual(4 * H);
    expect(out.every((a) => a.seconds > 0)).toBe(true);
  });

  it('keeps branches of the same name in different repos apart', () => {
    // `fix/x` exists in two repos and they are different work items.
    const out = allocate(
      sessionize([c('fix/x', 9, 'org/a'), c('fix/x', 9.5, 'org/b')], OPTS),
      {}
    );
    expect(out).toHaveLength(2);
    expect(new Set(out.map((a) => a.repoFullName)).size).toBe(2);
  });

  it('drops a branch whose share rounds to nothing rather than logging zero', () => {
    // A zero-second entry is noise on a timesheet.
    const commits = [c('big', 9)];
    for (let i = 0; i < 1; i++) commits.push(c('tiny', 9.01));
    const out = allocate(sessionize(commits, OPTS), { minSeconds: 600 });
    expect(out.every((a) => a.seconds >= 600)).toBe(true);
  });
});
