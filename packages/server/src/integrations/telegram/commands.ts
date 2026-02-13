import { Telegraf, Context } from 'telegraf';
import { SessionManager } from '../../core/session-manager';
import { TodoistClient } from '../todoist/client';
import { NotificationService } from '../notifications/service';
import { ServerConfig } from '../../config';
import { formatDurationHuman } from '@tardis/shared';
import { parseTimeWindow } from '@tardis/shared';
import { createSessionKeyboard } from './keyboards';
import type { PluginManager } from '../../plugins/manager';

const manager = new SessionManager();

/** Format ISO timestamp in user's timezone */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Riyadh',
  });
}

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
export function registerCommands(bot: Telegraf, config: ServerConfig, pluginManager?: PluginManager) {
  const todoist = new TodoistClient(config);

  // Telegram's built-in /start — welcome message
  bot.command('start', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    if (args) {
      // If they typed "/start taskname", handle as task start
      await handleStart(ctx, args, todoist);
      return;
    }
    await handleHelp(ctx);
  });

  // Handle callback queries for session selection
  bot.action(/^select_session_(.+)$/, async (ctx) => {
    const sessionId = ctx.match[1];

    try {
      const stopped = await manager.stopSession(sessionId, { sync: true });

      // Complete in Todoist
      if (stopped.taskId) {
        try {
          await todoist.completeTask(stopped.taskId);
          stopped.todoistSynced = true;
        } catch (err) {
          console.error('Failed to complete task in Todoist:', err);
        }
      }

      let reply = `✅ Stopped tracking: *${stopped.taskName}*\n`;
      reply += `📊 Duration: ${formatDurationHuman(stopped.duration)}\n`;
      reply += `🕐 Ended at: ${fmtTime(stopped.endTime!)}`;
      if (stopped.todoistSynced) reply += `\n✓ Completed in Todoist`;

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
        return handleStart(ctx, args, todoist);

      case 'stop':
        return handleStop(ctx, todoist);

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

      case 'test':
        return handleTest(ctx, todoist, config);

      case 'plugin':
        return handlePlugin(ctx, args, pluginManager);

      case 'help':
        return handleHelp(ctx);

      default:
        // Fallback to Gemini assistant for natural language processing
        if (pluginManager) {
          const gemini = pluginManager.getPlugin('gemini-assistant');
          if (gemini) {
            try {
              await pluginManager.runCommand('gemini-assistant', 'ask', [ctx.message.text]);
              return;
            } catch (e) {
              console.error('[Gemini fallback error]', e);
            }
          }
        }
        return ctx.reply(
          `Unknown command: "${command}"\n\nType help to see available commands.`
        );
    }
  });
}

// --- Command Handlers ---

async function handleStart(ctx: Context, taskName: string, todoist: TodoistClient) {
  try {
    // Fuzzy match against Todoist tasks (exact → prefix → contains)
    let resolvedName = taskName;
    let taskId: string | undefined;
    let timeWindow: { start: string; end: string } | undefined;

    try {
      const tasks = await todoist.getTasks();
      const query = taskName.toLowerCase().trim();

      let matches = tasks.filter((t) => t.content.toLowerCase() === query);
      if (!matches.length) matches = tasks.filter((t) => t.content.toLowerCase().startsWith(query));
      if (!matches.length) matches = tasks.filter((t) => t.content.toLowerCase().includes(query));

      if (matches.length === 1) {
        const matched = matches[0]!;
        resolvedName = matched.content;
        taskId = matched.id;

        // Extract time window from description
        if (matched.description) {
          const twMatches = matched.description.match(/\[([^\]]+)\]/g);
          if (twMatches) {
            for (const m of twMatches) {
              const tw = parseTimeWindow(m);
              if (tw) {
                timeWindow = tw;
                break;
              }
            }
          }
        }
      } else if (matches.length > 1) {
        // Show choices to user
        let reply = `Found ${matches.length} matching tasks:\n\n`;
        matches.forEach((t, i) => {
          reply += `${i + 1}. ${t.content}\n`;
        });
        reply += `\nPlease be more specific, e.g.:\nstart ${matches[0]!.content}`;
        return ctx.reply(reply);
      }
      // 0 matches: use literal taskName (no Todoist link)
    } catch (err) {
      // Todoist fetch failed, continue with literal name
      console.error('Todoist match failed, using literal name:', err);
    }

    // Check for existing active session
    const existing = await manager.getSessionByTask(resolvedName);
    if (existing) {
      return ctx.reply(
        `⚠️ Task '${existing.taskName}' is already active.\n` +
          `Started: ${fmtTime(existing.startTime)}\n\n` +
          `Use stop to end it first.`
      );
    }

    const session = await manager.startSession({ taskName: resolvedName, taskId, timeWindow });

    let reply = `✅ Started tracking: *${session.taskName}*\n`;
    reply += `⏰ Started at: ${fmtTime(session.startTime)}\n`;
    if (timeWindow) {
      reply += `📅 Window: ${timeWindow.start} - ${timeWindow.end}\n`;
    }
    reply += `📊 Duration: 0h 0m`;

    return ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in start command:', error);
    return ctx.reply('❌ Failed to start session. Please try again.');
  }
}

async function handleStop(ctx: Context, todoist: TodoistClient) {
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

    const session = activeSessions[0]!;
    const stopped = await manager.stopSession(session.id, { sync: true });

    // Complete in Todoist
    let synced = false;
    if (stopped.taskId) {
      try {
        await todoist.completeTask(stopped.taskId);
        synced = true;
      } catch (err) {
        console.error('Failed to complete task in Todoist:', err);
      }
    }

    let reply = `✅ Stopped tracking: *${stopped.taskName}*\n`;
    reply += `📊 Duration: ${formatDurationHuman(stopped.duration)}\n`;
    reply += `🕐 Ended at: ${fmtTime(stopped.endTime!)}`;
    if (synced) reply += `\n✓ Completed in Todoist`;

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
    reply += `⏰ Started: ${fmtTime(session.startTime)}\n`;
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
      reply += `   Started: ${fmtTime(session.startTime)}\n`;
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

async function handleTest(ctx: Context, todoist: TodoistClient, config: ServerConfig) {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[TEST] ${msg}`);
    logs.push(msg);
  };

  try {
    log('1. Starting notification pipeline test...');

    // Step 1: Fetch tasks from Todoist
    log('2. Fetching tasks from Todoist...');
    let tasks;
    try {
      tasks = await todoist.getTasks();
      log(`   ✅ Got ${tasks.length} tasks`);
    } catch (err: any) {
      log(`   ❌ Todoist API failed: ${err.message}`);
      return ctx.reply(`Test failed at step 2:\n\n${logs.join('\n')}`);
    }

    // Step 2: Find tasks with time windows
    log('3. Looking for tasks with time windows...');
    let testTask: any = null;
    for (const task of tasks) {
      if (!task.description) continue;
      const matches = task.description.match(/\[([^\]]+)\]/g);
      if (!matches) continue;
      for (const match of matches) {
        const tw = parseTimeWindow(match);
        if (tw) {
          testTask = { id: task.id, content: task.content, description: task.description, timeWindow: tw };
          break;
        }
      }
      if (testTask) break;
    }

    if (!testTask) {
      log('   ⚠️ No tasks with time windows found. Creating a fake one for testing...');
      testTask = {
        id: 'test-000',
        content: 'Test Notification Task',
        description: '[12:00-13:00]',
        timeWindow: { start: '12:00', end: '13:00' },
      };
    } else {
      log(`   ✅ Found: "${testTask.content}" [${testTask.timeWindow.start}-${testTask.timeWindow.end}]`);
    }

    // Step 3: Create NotificationService
    log('4. Creating NotificationService...');
    let notifService;
    try {
      notifService = new NotificationService(config);
      log('   ✅ NotificationService created');
    } catch (err: any) {
      log(`   ❌ NotificationService failed: ${err.message}`);
      return ctx.reply(`Test failed at step 4:\n\n${logs.join('\n')}`);
    }

    // Step 4: Check if Telegram channel is configured
    log('5. Checking Telegram config...');
    const tgConfig = config.notifications?.channels?.telegram;
    if (!tgConfig?.enabled) {
      log(`   ❌ Telegram not enabled in config (enabled=${tgConfig?.enabled})`);
      log(`   Fix: Set notifications.channels.telegram.enabled = true in config.json`);
      return ctx.reply(`Test failed at step 5:\n\n${logs.join('\n')}`);
    }
    if (!tgConfig.botToken || !tgConfig.chatId) {
      log(`   ❌ Missing botToken or chatId`);
      return ctx.reply(`Test failed at step 5:\n\n${logs.join('\n')}`);
    }
    log(`   ✅ Telegram enabled, chatId: ${tgConfig.chatId}`);

    // Step 5: Send test notification through the full pipeline
    log('6. Sending test notification via NotificationService.sendTimeWindowStarting()...');
    try {
      await notifService.sendTimeWindowStarting(testTask);
      log('   ✅ Notification sent successfully!');
    } catch (err: any) {
      log(`   ❌ Send failed: ${err.message}`);
      return ctx.reply(`Test failed at step 6:\n\n${logs.join('\n')}`);
    }

    log('7. ✅ Full pipeline test PASSED!');
    return ctx.reply(`🧪 Notification test results:\n\n${logs.join('\n')}\n\nYou should have received a separate notification message above.`);
  } catch (error: any) {
    log(`❌ Unexpected error: ${error.message}`);
    console.error('[TEST] Unexpected error:', error);
    return ctx.reply(`Test failed:\n\n${logs.join('\n')}`);
  }
}

async function handlePlugin(ctx: Context, args: string, pluginManager?: PluginManager) {
  if (!pluginManager) {
    return ctx.reply('Plugin system not available.');
  }

  if (!args) {
    // List plugins
    const plugins = pluginManager.getAllPlugins();
    if (plugins.length === 0) {
      return ctx.reply('No plugins loaded.');
    }

    let reply = `*Loaded Plugins (${plugins.length}):*\n\n`;
    for (const p of plugins) {
      const cmds = p.manifest.commands.map((c) => c.name).join(', ') || 'none';
      reply += `• ${p.manifest.displayName} v${p.manifest.version}\n`;
      reply += `  Commands: ${cmds}\n`;
    }
    reply += '\nUsage: plugin <name> <command> [args]';
    return ctx.reply(reply, { parse_mode: 'Markdown' });
  }

  // Parse: plugin <name> <command> [args...]
  const parts = args.split(' ');
  const pluginName = parts[0]!;
  const command = parts[1];
  const commandArgs = parts.slice(2);

  if (!command) {
    const loaded = pluginManager.getPlugin(pluginName);
    if (!loaded) {
      return ctx.reply(`Plugin not found: ${pluginName}`);
    }
    const cmds = loaded.manifest.commands.map((c) => `  • ${c.name} - ${c.description || ''}`).join('\n');
    return ctx.reply(`*${loaded.manifest.displayName}*\n\nCommands:\n${cmds || '  (none)'}`, { parse_mode: 'Markdown' });
  }

  try {
    await pluginManager.runCommand(pluginName, command, commandArgs);
    return ctx.reply(`✅ Ran ${pluginName}:${command}`);
  } catch (error: any) {
    return ctx.reply(`❌ ${error.message}`);
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
      'plugin [name] [cmd] - Run plugin commands\n' +
      'test - Test notification pipeline\n' +
      'help - Show this help\n\n' +
      '*Examples:*\n' +
      'start Write documentation\n' +
      'add Meeting [2pm-3pm] due:tomorrow\n' +
      'tasks\n\n' +
      '_No / prefix needed — just type the command._',
    { parse_mode: 'Markdown' }
  );
}
