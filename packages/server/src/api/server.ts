import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/ratelimit';
import { errorMiddleware } from './middleware/error';

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessions';

export function createServer() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      origin: '*', // Only Tailscale IPs in production
      credentials: true,
    })
  );
  app.use('*', errorMiddleware);

  // Public routes (no auth required)
  app.route('/api/health', healthRoutes);
  app.route('/api/auth', authRoutes);

  // Protected routes (auth required)
  app.use('/api/sessions/*', authMiddleware);
  app.use('/api/sessions/*', rateLimitMiddleware);
  app.route('/api/sessions', sessionRoutes);

  return app;
}
