import { Context, Next } from 'hono';
import { verify } from 'jsonwebtoken';
import { loadConfig } from '../../config';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const config = await loadConfig();

  try {
    const decoded = verify(token, config.auth.jwtSecret);
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401);
  }
}
