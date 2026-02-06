import { Hono } from 'hono';
import { sign } from 'jsonwebtoken';
import { loadConfig } from '../../config';
import { validateApiKey } from '../../utils/auth';

const auth = new Hono();

auth.post('/init', async (c) => {
  const body = await c.req.json();
  const { apiKey } = body;

  if (!apiKey) {
    return c.json({ error: 'API key required' }, 400);
  }

  const config = await loadConfig();

  // Validate API key
  const isValid = await validateApiKey(apiKey);
  if (!isValid) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  // Generate JWT
  const token = sign({ userId: 'default' }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiry,
  });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return c.json({
    token,
    expiresAt,
  });
});

auth.post('/refresh', async (c) => {
  const user = c.get('user');
  const config = await loadConfig();

  // Generate new token
  const token = sign({ userId: user.userId }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiry,
  });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return c.json({
    token,
    expiresAt,
  });
});

export default auth;
