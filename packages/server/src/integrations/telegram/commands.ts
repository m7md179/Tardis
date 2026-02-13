import { Telegraf, Context } from 'telegraf';
import { SessionManager } from '../../core/session-manager';
import { TodoistClient } from '../todoist/client';
import { ServerConfig } from '../../config';
import { formatDurationHuman } from '@tardis/shared';
import { parseTimeWindow } from '@tardis/shared';
import { createSessionKeyboard } from './keyboards';

const manager = new SessionManager();

/**
 * Parse a message into command + args.
 * Supports both "/command args" and plain "command args".
 */
function parseMessage(text: string): { command: string; args: string } {
  const trimmed = text.trim();
  const firstSpace = trimmed.indexOf(' ');

  let command: string;
  let args: string;

  if (firstSpace === -1) {
    command = trimmed;
    args = '';
  } else {
    command = trimmed.substring(0, firstSpace);
    args = trimmed.substring(firstSpace + 1).trim();
  }

  // Strip leading / and @botname suffix
  command = command.replace(/^\//, '').replace(/@\S+$/, '').toLowerCase();

  return { command, args };
}

/**
 * Parse inline flags from add command args.
 * Extracts due:<value> and p:<1-4> from the text.
 */
function parseAddFlags(text: string): {
  content: string;
  description?: string;
  dueString?: string;
  priority?: number;
} {
  let dueString: string | undefined;
  let priority: number | undefined;
  let description: string | undefined;

  // Extract time window [5pm-6pm] → goes into description
  const twMatch = text.match(/\[([^\]]+)\]/);
  if (twMatch) {
    description = twMatch[0]; // Keep brackets e.g. "[5pm-6pm]"
    text = text.replace(twMatch[0], '').trim();
  }

  // Extract due:value
  const dueMatch = text.match(/\bdue:(\S+)/i);
  if (dueMatch) {
    dueString = dueMatch[1];
    text = text.replace(dueMatch[0], '').trim();
  }

  // Extract p:value
  const pMatch = text.match(/\bp:([1-4])/i);
  if (pMatch) {
    priority = parseInt(pMatch[1]);
    text = text.replace(pMatch[0], '').trim();
  }

  return { content: text, description, dueString, priority };
}

/**
 * Register all bot commands
 */
export function registerCommands(bot: Telegraf, config: ServerConfig) {
  const todoist = new TodoistClient(config);

  // Telegram's built-in /start — welcome message
  bot.command('start', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    if (args) {
      // If they typed "/start taskname", handle as task start
      await handleStart(ctx, args);
      return;
    }
    await handleHelp(ctx);
  });

  // Handle callback queries for session selection
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

  // Plain text handler — routes all non-command messages
  bot.on('text', async (ctx) => {
    const { command, args } = parseMessage(ctx.message.text);

    switch (command) {
      case 'start':
      case 'begin':
        if (!args) {
          return ctx.reply('Usage: start <task name>\n\nExample: start Write documentation');
        }
        return handleStart(ctx, args);

      case 'stop':
        return handleStop(ctx);

      case 'pause':
        return handlePause(ctx);

      case 'resume':
        return handleResume(ctx);

      case 'status':
        return handleStatus(ctx);

      case 'list':
        return handleList(ctx);

      case 'tasks':
        return handleTasks(ctx, todoist);

      case 'add':
        if (!args) {
          return ctx.reply(
            'Usage: add <task name> [time window] [due:value] [p:1-4]\n\n' +
              'Examples:\n' +
              '  add Buy groceries\n' +
              '  add Meeting [2pm-3pm] due:tomorrow\n' +
              '  add Urgent fix [14:00-16:00] p:4'
          );
        }
        return handleAdd(ctx, todoist, args);

      case 'help':
        return handleHelp(ctx);

      default:
        return ctx.reply(
          `Unknown command: "${command}"\n\nType help to see available commands.`
        );
    }
  });
}

// --- Command Handlers ---

async function handleStart(ctx: Context, taskName: string) {
  try {
    const existing = await manager.getSessionByTask(taskName);
    if (existing) {
      return ctx.reply(
        `⚠️ Task '${existing.taskName}' is already active.\n` +
          `Started: ${new Date(existing.startTime).toLocaleString()}\n\n` +
          `Use stop to end it first.`
      );
    }

    const session = await manager.startSession({ taskName });

    let reply = `✅ Started tracking: *${session.taskName}*\n`;
    reply += `⏰ Started at: ${new Date(session.startTime).toLocaleTimeString()}\n`;
    reply += `📊 Duration: 0h 0m`;

    return ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in start command:', error);
    return ctx.reply('❌ Failed to start session. Please try again.');
  }
}

async function handleStop(ctx: Context) {
  try {
    const activeSessions = await manager.getActiveSessions();

    if (activeSessions.length === 0) {
      return ctx.reply('❌ No active sessions found.');
    }

    if (activeSessions.length > 1) {
      return ctx.reply(
        'Multiple active sessions. Select one to stop:',
        createSessionKeyboard(activeSessions)
      );
    }

    const session = activeSessions[0];
    const stopped = await manager.stopSession(session.id, { sync: true });

    let reply = `✅ Stopped tracking: *${stopped.taskName}*\n`;
    reply += `📊 Duration: ${formatDurationHuman(stopped.duration)}\n`;
    reply += `🕐 Ended at: ${new Date(stopped.endTime!).toLocaleTimeString()}`;

    return ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in stop command:', error);
    return ctx.reply('❌ Failed to stop session. Please try again.');
  }
}

async function handlePause(ctx: Context) {
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
    console.error('Error in pause command:', error);
    return ctx.reply('❌ Failed to pause session. Please try again.');
  }
}

async function handleResume(ctx: Context) {
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
    console.error('Error in resume command:', error);
    return ctx.reply('❌ Failed to resume session. Please try again.');
  }
}

async function handleStatus(ctx: Context) {
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
    console.error('Error in status command:', error);
    return ctx.reply('❌ Failed to get status. Please try again.');
  }
}

async function handleList(ctx: Context) {
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
    console.error('Error in list command:', error);
    return ctx.reply('❌ Failed to list sessions. Please try again.');
  }
}

async function handleTasks(ctx: Context, todoist: TodoistClient) {
  try {
    const tasks = await todoist.getTasks();

    if (tasks.length === 0) {
      return ctx.reply('No tasks found in Todoist.');
    }

    let reply = `*Todoist Tasks (${tasks.length}):*\n\n`;

    for (const task of tasks) {
      const priority = task.priority > 1 ? ` p${task.priority}` : '';
      const due = task.due ? ` 📅 ${task.due.string || task.due.date}` : '';

      let timeWindow = '';
      if (task.description) {
        const matches = task.description.match(/\[([^\]]+)\]/g);
        if (matches) {
          for (const match of matches) {
            const tw = parseTimeWindow(match);
            if (tw) {
              timeWindow = ` ⏰ ${tw.start}-${tw.end}`;
              break;
            }
          }
        }
      }

      reply += `• ${task.content}${priority}${due}${timeWindow}\n`;
    }

    reply += `\nStart a task: start <task name>`;

    return ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in tasks command:', error);
    return ctx.reply('❌ Failed to fetch tasks. Please try again.');
  }
}

async function handleAdd(ctx: Context, todoist: TodoistClient, argsText: string) {
  try {
    const { content, description, dueString, priority } = parseAddFlags(argsText);

    if (!content) {
      return ctx.reply(
        '❌ Task name is required.\n\n' +
          'Usage: add <task name> [time window] [due:value] [p:1-4]\n\n' +
          'Examples:\n' +
          '  add Buy groceries\n' +
          '  add Meeting [2pm-3pm] due:tomorrow\n' +
          '  add Urgent fix [14:00-16:00] p:4'
      );
    }

    const task = await todoist.createTask(content, description, dueString);

    let reply = `✅ Task created: *${task.content}*`;
    if (description) reply += `\n⏰ Time window: ${description}`;
    if (dueString) reply += `\n📅 Due: ${dueString}`;
    if (priority) reply += `\n🔴 Priority: ${priority}`;

    return ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in add command:', error);
    return ctx.reply('❌ Failed to create task. Please try again.');
  }
}

async function handleHelp(ctx: Context) {
  return ctx.reply(
    '*TARDIS Bot Commands:*\n\n' +
      'start <task> - Start tracking a task\n' +
      'stop - Stop current task\n' +
      'pause - Pause current task\n' +
      'resume - Resume paused task\n' +
      'status - Show current status\n' +
      'list - List active sessions\n' +
      'tasks - List Todoist tasks\n' +
      'add <task> [time] - Create a new task\n' +
      'help - Show this help\n\n' +
      '*Examples:*\n' +
      'start Write documentation\n' +
      'add Meeting [2pm-3pm] due:tomorrow\n' +
      'tasks\n\n' +
      '_No / prefix needed — just type the command._',
    { parse_mode: 'Markdown' }
  );
}
