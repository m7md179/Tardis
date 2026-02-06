import { Context, Next } from 'hono';

const requests = new Map<string, { count: number; resetAt: number }>();

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();

  const record = requests.get(ip);

  if (!record || now > record.resetAt) {
    // Reset window
    requests.set(ip, {
      count: 1,
      resetAt: now + 60000, // 1 minute
    });
    await next();
    return;
  }

  if (record.count >= 100) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  record.count++;
  await next();
}
