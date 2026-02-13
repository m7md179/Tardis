import { Telegraf } from 'telegraf';
import { ServerConfig } from '../../config';
import { registerCommands } from './commands';
import type { PluginManager } from '../../plugins/manager';

export interface TelegramBotOptions {
  config: ServerConfig;
  pluginManager?: PluginManager;
}

/**
 * Start Telegram bot
 */
export async function startTelegramBot(configOrOpts: ServerConfig | TelegramBotOptions) {
  const config = 'config' in configOrOpts ? configOrOpts.config : configOrOpts;
  const pluginManager = 'pluginManager' in configOrOpts ? configOrOpts.pluginManager : undefined;

  const telegram = config.notifications.channels.telegram;

  if (!telegram?.enabled || !telegram.botToken) {
    console.log('Telegram bot not configured, skipping...');
    return;
  }

  const bot = new Telegraf(telegram.botToken);

  // Register all commands with access to config
  registerCommands(bot, config, pluginManager);

  // Error handling
  bot.catch((err, ctx) => {
    console.error('Telegram bot error:', err);
    ctx.reply('An error occurred. Please try again.').catch(() => {});
  });

  // Start bot
  await bot.launch();
  console.log('Telegram bot started successfully');

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}
