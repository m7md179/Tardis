import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/ratelimit';
import { errorMiddleware } from './middleware/error';

import { ServerConfig } from '../config';
import { SessionManager } from '../core/session-manager';
import { TodoistClient } from '../integrations/todoist/client';
import { NotificationService } from '../integrations/notifications/service';
import type { PluginManager } from '../plugins/manager';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import { createSessionRoutes } from './routes/sessions';

export interface ServerDeps {
  config: ServerConfig;
  sessionManager: SessionManager;
  todoistClient: TodoistClient;
  notificationService: NotificationService;
  pluginManager?: PluginManager;
}

export function createServer(configOrDeps: ServerConfig | ServerDeps) {
  const app = new Hono();

  // Resolve dependencies
  let config: ServerConfig;
  let sessionManager: SessionManager;
  let todoistClient: TodoistClient;
  let pluginManager: PluginManager | undefined;

  if ('sessionManager' in configOrDeps) {
    config = configOrDeps.config;
    sessionManager = configOrDeps.sessionManager;
    todoistClient = configOrDeps.todoistClient;
    pluginManager = configOrDeps.pluginManager;
  } else {
    config = configOrDeps;
    sessionManager = new SessionManager();
    todoistClient = new TodoistClient(config);
  }

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
  app.route(
    '/api/sessions',
    createSessionRoutes({ config, sessionManager, todoistClient, pluginManager })
  );

  // Mount plugin routes under /api/plugins/<plugin-name>/
  if (pluginManager) {
    app.use('/api/plugins/*', authMiddleware);

    for (const loaded of pluginManager.getAllPlugins()) {
      const routes = loaded.instance.routes;
      if (!routes) continue;

      const pluginRouter = new Hono();
      for (const [path, handler] of Object.entries(routes)) {
        pluginRouter.all(path, async (c) => {
          try {
            const response = await handler(c.req.raw, loaded.api);
            return response;
          } catch (error) {
            console.error(`[Plugin:${loaded.manifest.name}] Route error:`, error);
            return c.json({ error: 'Plugin route error' }, 500);
          }
        });
      }

      app.route(`/api/plugins/${loaded.manifest.name}`, pluginRouter);
    }
  }

  return app;
}
