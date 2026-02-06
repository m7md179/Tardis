import { serve } from 'bun';
import { createServer } from './api/server';
import { loadConfig } from './config';
import { startTelegramBot } from './integrations/telegram/bot';
import { startScheduler } from './core/scheduler';

async function main() {
  try {
    // Load configuration
    const config = await loadConfig();

    console.log('Starting TARDIS Server v2.0.0');

    // Create HTTP server
    const app = createServer();

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
      await startTelegramBot(config);
    }

    console.log('TARDIS Server ready!');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
