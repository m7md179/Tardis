import { Telegraf } from 'telegraf';
import { ServerConfig } from '../../config';
import { registerCommands } from './commands';
import type { PluginManager } from '../../plugins/manager';
import type { TodoistClient } from '../todoist/client';

export interface TelegramBotOptions {
  config: ServerConfig;
  pluginManager?: PluginManager;
  todoistClient?: TodoistClient;
}

/**
 * Start Telegram bot
 */
export async function startTelegramBot(configOrOpts: ServerConfig | TelegramBotOptions) {
  const config = 'config' in configOrOpts ? configOrOpts.config : configOrOpts;
  const pluginManager = 'pluginManager' in configOrOpts ? configOrOpts.pluginManager : undefined;
  const todoistClient = 'todoistClient' in configOrOpts ? configOrOpts.todoistClient : undefined;

  const telegram = config.notifications.channels.telegram;

  if (!telegram?.enabled || !telegram.botToken) {
    console.log('Telegram bot not configured, skipping...');
    return;
  }

  const bot = new Telegraf(telegram.botToken);

  // Register all commands with access to config and shared services
  registerCommands(bot, config, pluginManager, todoistClient);

  // Register command menu for Telegram autocomplete
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start tracking a task' },
    { command: 'stop', description: 'Stop current task' },
    { command: 'pause', description: 'Pause current task' },
    { command: 'resume', description: 'Resume paused task' },
    { command: 'status', description: 'Show current status' },
    { command: 'list', description: 'List active sessions' },
    { command: 'tasks', description: 'List Todoist tasks' },
    { command: 'add', description: 'Create a new task' },
    { command: 'config', description: 'Set Todoist token or show config' },
    { command: 'plugin', description: 'Run plugin commands' },
    { command: 'help', description: 'Show all commands' },
  ]);

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
