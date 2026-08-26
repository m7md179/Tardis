import type { Context, MiddlewareHandler } from 'hono';
import type { RateLimitConfig } from '@tardis/shared';

/**
 * Per-client sliding-window rate limiting.
 *
 * TARDIS is reachable from the internet through the Cloudflare tunnel, and a
 * single shared password guards every skill — including destructive ones. An
 * unlimited login endpoint makes that password a matter of time, so the login
 * limit here is deliberately far stricter than the general API limit.
 *
 * In-memory on purpose: this is a single-user, single-process deployment, so a
 * shared store would be complexity without benefit. The trade-off is that the
 * window resets on restart, which is acceptable for slowing a brute force.
 */

interface Hit {
  count: number;
  resetAt: number;
}

/**
 * Identifies the caller.
 *
 * Behind the tunnel every request arrives from cloudflared, so the socket
 * address is the same for all of them — limiting on it would throttle everyone
 * together the moment one client misbehaved. Cloudflare sets CF-Connecting-IP
 * with the real client, so prefer that.
 */
export function clientKey(c: Context): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;

  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();

  // Direct LAN access: no proxy headers. One bucket is fine — the tunnel is the
  // only path from outside.
  return 'direct';
}

export class SlidingWindow {
  private readonly hits = new Map<string, Hit>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Returns null when allowed, or the seconds to wait when blocked. */
  check(key: string, now = Date.now()): number | null {
    const hit = this.hits.get(key);

    if (!hit || now >= hit.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return null;
    }

    hit.count++;
    if (hit.count > this.limit) {
      return Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
    }
    return null;
  }

  /** Drops expired buckets so a long-running process does not grow unbounded. */
  prune(now = Date.now()): void {
    for (const [key, hit] of this.hits) {
      if (now >= hit.resetAt) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}

export interface RateLimiters {
  general: SlidingWindow;
  login: SlidingWindow;
}

export function createRateLimiters(config: RateLimitConfig): RateLimiters {
  return {
    general: new SlidingWindow(config.maxRequests, config.windowMs),
    login: new SlidingWindow(config.maxLoginAttempts, config.windowMs),
  };
}

/**
 * Middleware applying the stricter login limit to /api/auth/login and the
 * general limit to everything else under /api.
 */
export function rateLimitMiddleware(
  config: RateLimitConfig,
  limiters: RateLimiters
): MiddlewareHandler {
  let lastPrune = Date.now();

  return async (c, next) => {
    if (!config.enabled) return next();

    // Health has to stay reachable for monitoring even when a client is limited.
    if (c.req.path === '/api/health') return next();

    const now = Date.now();
    if (now - lastPrune > config.windowMs) {
      limiters.general.prune(now);
      limiters.login.prune(now);
      lastPrune = now;
    }

    const key = clientKey(c);
    const isLogin = c.req.path === '/api/auth/login';
    const retryAfter = isLogin
      ? limiters.login.check(key, now)
      : limiters.general.check(key, now);

    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: isLogin
            ? 'Too many login attempts. Try again shortly.'
            : 'Rate limit exceeded.',
          code: 'RATE_LIMITED',
        },
        429
      );
    }

    return next();
  };
}

/**
 * Compares two secrets without leaking their relationship through timing.
 *
 * `a !== b` short-circuits at the first differing byte, which over enough
 * samples reveals the prefix. Length is compared first and then every byte is
 * mixed in regardless, so the work done is independent of where they diverge.
 */
export function safeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}
