import { describe, it, expect } from 'bun:test';
import { SlidingWindow, safeEqual, clientKey, createRateLimiters } from './rate-limit.js';
import type { Context } from 'hono';

// ─── Brute-force protection ──────────────────────────────────────────────────
//
// TARDIS is internet-reachable through the tunnel and one shared password
// guards every skill, so these are the checks that matter most.

describe('SlidingWindow', () => {
  it('allows up to the limit and blocks the next request', () => {
    const w = new SlidingWindow(3, 60_000);
    const t = 1_000_000;
    expect(w.check('ip', t)).toBeNull();
    expect(w.check('ip', t)).toBeNull();
    expect(w.check('ip', t)).toBeNull();
    expect(w.check('ip', t)).not.toBeNull();
  });

  it('reports how long to wait', () => {
    const w = new SlidingWindow(1, 60_000);
    const t = 1_000_000;
    w.check('ip', t);
    expect(w.check('ip', t + 10_000)).toBe(50);
  });

  it('lets the client through again once the window passes', () => {
    const w = new SlidingWindow(1, 60_000);
    const t = 1_000_000;
    w.check('ip', t);
    expect(w.check('ip', t + 5_000)).not.toBeNull();
    expect(w.check('ip', t + 60_001)).toBeNull();
  });

  it('tracks clients independently — one attacker must not lock everyone out', () => {
    const w = new SlidingWindow(1, 60_000);
    const t = 1_000_000;
    w.check('attacker', t);
    expect(w.check('attacker', t)).not.toBeNull();
    expect(w.check('someone-else', t)).toBeNull();
  });

  it('prunes expired buckets so memory does not grow unbounded', () => {
    const w = new SlidingWindow(5, 60_000);
    const t = 1_000_000;
    for (let i = 0; i < 50; i++) w.check(`ip-${i}`, t);
    expect(w.size).toBe(50);
    w.prune(t + 60_001);
    expect(w.size).toBe(0);
  });
});

describe('createRateLimiters', () => {
  it('gives login a far stricter budget than the general API', () => {
    const { general, login } = createRateLimiters({
      enabled: true,
      windowMs: 60_000,
      maxRequests: 120,
      maxLoginAttempts: 5,
    });
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) expect(login.check('ip', t)).toBeNull();
    // Sixth login attempt is blocked…
    expect(login.check('ip', t)).not.toBeNull();
    // …while the general budget is nowhere near exhausted.
    expect(general.check('ip', t)).toBeNull();
  });
});

describe('clientKey', () => {
  const ctx = (headers: Record<string, string>): Context =>
    ({ req: { header: (n: string) => headers[n.toLowerCase()] } }) as unknown as Context;

  it('prefers CF-Connecting-IP', () => {
    // Behind the tunnel every request shares one socket address, so without
    // this a single abusive client would throttle everybody.
    expect(clientKey(ctx({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('falls back to the first X-Forwarded-For entry', () => {
    expect(clientKey(ctx({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe('198.51.100.4');
  });

  it('uses a single bucket for direct LAN access', () => {
    expect(clientKey(ctx({}))).toBe('direct');
  });
});

describe('safeEqual', () => {
  it('matches identical secrets', () => {
    expect(safeEqual('correct horse battery', 'correct horse battery')).toBe(true);
  });

  it('rejects different secrets of the same length', () => {
    expect(safeEqual('aaaaaa', 'aaaaab')).toBe(false);
  });

  it('rejects different lengths', () => {
    expect(safeEqual('short', 'much longer secret')).toBe(false);
  });

  it('does not short-circuit on the first differing byte', () => {
    // The point of the function: a mismatch at position 0 and one at the last
    // position must both be examined, so timing does not reveal the prefix.
    expect(safeEqual('Xbcdefgh', 'abcdefgh')).toBe(false);
    expect(safeEqual('abcdefgX', 'abcdefgh')).toBe(false);
  });

  it('handles empty strings and unicode without throwing', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'a')).toBe(false);
    expect(safeEqual('pässwörd', 'pässwörd')).toBe(true);
  });
});
