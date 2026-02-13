import { serve } from 'bun';
import { join } from 'path';
import { createServer } from './api/server';
import { loadConfig } from './config';
import { SessionManager } from './core/session-manager';
import { TodoistClient } from './integrations/todoist/client';
import { NotificationService } from './integrations/notifications/service';
import { PluginManager } from './plugins/manager';
import { startTelegramBot } from './integrations/telegram/bot';
import { startScheduler } from './core/scheduler';

async function main() {
  try {
    // Load configuration
    const config = await loadConfig();

    console.log('Starting TARDIS Server v2.0.0');

    // Create shared service instances
    const sessionManager = new SessionManager();
    const todoistClient = new TodoistClient(config);
    const notificationService = new NotificationService(config);

    // Initialize plugin system
    const pluginsDir = join(config.server.dataDir, 'plugins');
    const pluginManager = new PluginManager({
      pluginsDir,
      sessionManager,
      todoistClient,
      notificationService,
    });

    await pluginManager.loadAll();

    // Create HTTP server
    const app = createServer({
      config,
      sessionManager,
      todoistClient,
      notificationService,
      pluginManager,
    });

    // Start server
    const server = serve({
      fetch: app.fetch,
      port: config.server.port,
      hostname: config.server.host,
    });

    console.log(`Server listening on ${config.server.host}:${config.server.port}`);

    // Start background scheduler if enabled
    if (config.scheduler.enabled) {
      await startScheduler(config);
    }

    // Start Telegram bot if enabled
    if (config.notifications.channels.telegram?.enabled) {
      console.log('Starting Telegram bot...');
      await startTelegramBot({ config, pluginManager });
    }

    console.log('TARDIS Server ready!');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');

      // Unload all plugins
      for (const plugin of pluginManager.getAllPlugins()) {
        try {
          await pluginManager.unloadPlugin(plugin.manifest.name);
        } catch (error) {
          console.error(`Failed to unload plugin ${plugin.manifest.name}:`, error);
        }
      }

      server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
