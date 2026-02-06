import { Telegraf, Context } from 'telegraf';
import { SessionManager } from '../../core/session-manager';
import { formatDurationHuman } from '@tardis/shared';
import { createTaskKeyboard, createSessionKeyboard } from './keyboards';

const manager = new SessionManager();

/**
 * Register all bot commands
 */
export function registerCommands(bot: Telegraf) {
  // /start command - Start tracking a task
  bot.command('start', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1).join(' ');

    if (!args) {
      return ctx.reply('Usage: /start <task name>\n\nExample: /start "Write documentation"');
    }

    try {
      // Check for duplicates
      const existing = await manager.getSessionByTask(args);
      if (existing) {
        return ctx.reply(
          `⚠️ Task '${existing.taskName}' is already active.\n` +
            `Started: ${new Date(existing.startTime).toLocaleString()}\n\n` +
            `Use /stop to end it first.`
        );
      }

      // Start new session
      const session = await manager.startSession({
        taskName: args,
      });

      let reply = `✅ Started tracking: *${session.taskName}*\n`;
      reply += `⏰ Started at: ${new Date(session.startTime).toLocaleTimeString()}\n`;
      reply += `📊 Duration: 0h 0m`;

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in /start command:', error);
      return ctx.reply('❌ Failed to start session. Please try again.');
    }
  });

  // /stop command - Stop tracking current task
  bot.command('stop', async (ctx) => {
    try {
      const activeSessions = await manager.getActiveSessions();

      if (activeSessions.length === 0) {
        return ctx.reply('❌ No active sessions found.');
      }

      if (activeSessions.length > 1) {
        // Multiple active - show keyboard
        return ctx.reply(
          'Multiple active sessions. Select one to stop:',
          createSessionKeyboard(activeSessions)
        );
      }

      // Stop the only session
      const session = activeSessions[0];
      const stopped = await manager.stopSession(session.id, { sync: true });

      let reply = `✅ Stopped tracking: *${stopped.taskName}*\n`;
      reply += `📊 Duration: ${formatDurationHuman(stopped.duration)}\n`;
      reply += `🕐 Ended at: ${new Date(stopped.endTime!).toLocaleTimeString()}`;

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in /stop command:', error);
      return ctx.reply('❌ Failed to stop session. Please try again.');
    }
  });

  // /pause command - Pause current task
  bot.command('pause', async (ctx) => {
    try {
      const session = await manager.getMostRecentSession();

      if (!session) {
        return ctx.reply('❌ No active sessions found.');
      }

      if (session.status !== 'ACTIVE') {
        return ctx.reply(`❌ Session '${session.taskName}' is not active.`);
      }

      const paused = await manager.pauseSession(session.id);

      return ctx.reply(
        `⏸️ Paused: *${paused.taskName}*\n` +
          `Duration before pause: ${formatDurationHuman(paused.duration)}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error in /pause command:', error);
      return ctx.reply('❌ Failed to pause session. Please try again.');
    }
  });

  // /resume command - Resume paused task
  bot.command('resume', async (ctx) => {
    try {
      const sessions = await manager.getActiveSessions();
      const paused = sessions.filter((s) => s.status === 'PAUSED');

      if (paused.length === 0) {
        return ctx.reply('❌ No paused sessions found.');
      }

      const session = paused[0];
      const resumed = await manager.resumeSession(session.id);

      return ctx.reply(
        `▶️ Resumed: *${resumed.taskName}*\n` +
          `Current duration: ${formatDurationHuman(resumed.duration)}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error in /resume command:', error);
      return ctx.reply('❌ Failed to resume session. Please try again.');
    }
  });

  // /status command - Show current status
  bot.command('status', async (ctx) => {
    try {
      const session = await manager.getMostRecentSession();

      if (!session) {
        return ctx.reply('No active sessions.');
      }

      const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);

      let reply = `📊 *Status: ${session.status}*\n`;
      reply += `📝 Task: ${session.taskName}\n`;
      reply += `⏰ Started: ${new Date(session.startTime).toLocaleTimeString()}\n`;
      reply += `⌛ Duration: ${formatDurationHuman(duration)}`;

      if (session.timeWindow) {
        reply += `\n📅 Window: ${session.timeWindow.start} - ${session.timeWindow.end}`;
      }

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in /status command:', error);
      return ctx.reply('❌ Failed to get status. Please try again.');
    }
  });

  // /list command - List all active sessions
  bot.command('list', async (ctx) => {
    try {
      const sessions = await manager.getActiveSessions();

      if (sessions.length === 0) {
        return ctx.reply('No active sessions.');
      }

      let reply = `*Active Sessions (${sessions.length}):*\n\n`;

      for (const session of sessions) {
        const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
        reply += `📝 ${session.taskName}\n`;
        reply += `   Status: ${session.status}\n`;
        reply += `   Started: ${new Date(session.startTime).toLocaleTimeString()}\n`;
        reply += `   Duration: ${formatDurationHuman(duration)}\n\n`;
      }

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in /list command:', error);
      return ctx.reply('❌ Failed to list sessions. Please try again.');
    }
  });

  // /help command - Show help
  bot.help((ctx) => {
    return ctx.reply(
      '*TARDIS Bot Commands:*\n\n' +
        '/start <task> - Start tracking a task\n' +
        '/stop - Stop current task\n' +
        '/pause - Pause current task\n' +
        '/resume - Resume paused task\n' +
        '/status - Show current status\n' +
        '/list - List all active sessions\n' +
        '/help - Show this help message\n\n' +
        '*Examples:*\n' +
        '/start "Write documentation"\n' +
        '/start Team meeting',
      { parse_mode: 'Markdown' }
    );
  });

  // Handle callback queries for task/session selection
  bot.action(/^select_session_(.+)$/, async (ctx) => {
    const sessionId = ctx.match[1];

    try {
      const stopped = await manager.stopSession(sessionId, { sync: true });

      let reply = `✅ Stopped tracking: *${stopped.taskName}*\n`;
      reply += `📊 Duration: ${formatDurationHuman(stopped.duration)}\n`;
      reply += `🕐 Ended at: ${new Date(stopped.endTime!).toLocaleTimeString()}`;

      await ctx.answerCbQuery();
      await ctx.editMessageText(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error handling session selection:', error);
      await ctx.answerCbQuery('Failed to stop session');
    }
  });
}
