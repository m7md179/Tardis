import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

// --- Types ---

interface ContentPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, any> };
  functionResponse?: { name: string; response: any };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: ContentPart[];
}

// --- Helpers ---

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

// --- Fuzzy Task Matcher ---

interface TaskMatch {
  task: { id: string; content: string; due?: { string: string; date: string } };
  confidence: 'exact' | 'prefix' | 'contains';
}

function fuzzyMatchTasks(tasks: any[], query: string): TaskMatch[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const exact: TaskMatch[] = [];
  const prefix: TaskMatch[] = [];
  const contains: TaskMatch[] = [];

  for (const task of tasks) {
    const content = (task.content as string).toLowerCase();
    if (content === q) {
      exact.push({ task, confidence: 'exact' });
    } else if (content.startsWith(q)) {
      prefix.push({ task, confidence: 'prefix' });
    } else if (content.includes(q)) {
      contains.push({ task, confidence: 'contains' });
    }
  }

  return [...exact, ...prefix, ...contains];
}

// --- Function Declarations ---

const functionDeclarations = [
  {
    name: 'start_tracking',
    description: 'Start time tracking for a task. Use when Mohammad says he is WORKING on something RIGHT NOW.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_name: { type: 'STRING', description: 'Name of the task to track time for' },
      },
      required: ['task_name'],
    },
  },
  {
    name: 'stop_tracking',
    description: 'Stop the current active time tracking session.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'pause_tracking',
    description: 'Pause the current active time tracking session (e.g. taking a break).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'resume_tracking',
    description: 'Resume a paused time tracking session (e.g. back from break).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_status',
    description: 'Get the current time tracking status — what sessions are active or paused.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'add_task',
    description: 'Add a new task to Todoist. Use when Mohammad wants to CREATE, SET, or SCHEDULE a task, meeting, appointment, or todo item for the future.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Task name or content (e.g. "Meeting with client")' },
        due_date: { type: 'STRING', description: 'Due date in natural language (e.g. "tomorrow", "next Monday", "today", "Feb 20")' },
        time_window: { type: 'STRING', description: 'Time window (e.g. "10am-11am", "2:30pm-3pm")' },
        priority: { type: 'NUMBER', description: 'Priority: 1 (normal) to 4 (urgent)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing Todoist task — change its name, due date, description, or priority.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Name or partial name of the task to find (fuzzy matched against existing tasks)' },
        new_name: { type: 'STRING', description: 'New task name/content (if changing)' },
        new_due_date: { type: 'STRING', description: 'New due date in natural language (if rescheduling)' },
        new_description: { type: 'STRING', description: 'New description (if changing)' },
        new_priority: { type: 'NUMBER', description: 'New priority 1-4 (if changing)' },
      },
      required: ['task_query'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Reschedule an existing Todoist task to a different date or time.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Name or partial name of the task to reschedule (fuzzy matched)' },
        new_due_date: { type: 'STRING', description: 'New due date in natural language (e.g. "Friday", "next week", "tomorrow")' },
      },
      required: ['task_query', 'new_due_date'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a Todoist task as completed/done.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Name or partial name of the task to complete (fuzzy matched)' },
      },
      required: ['task_query'],
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task from Todoist.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Name or partial name of the task to delete (fuzzy matched)' },
      },
      required: ['task_query'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Show all current Todoist tasks.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'set_reminder',
    description: 'Set a reminder notification that fires after a delay (e.g. "remind me to stretch in 30 minutes").',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'What to remind about' },
        delay_minutes: { type: 'NUMBER', description: 'Minutes from now to send the reminder' },
      },
      required: ['message', 'delay_minutes'],
    },
  },
];

// --- System Prompt ---

function buildSystemPrompt(api: PluginAPI): string {
  const plugins = api.plugins.list();
  const pluginSection = plugins
    .filter((p) => p.name !== 'gemini-assistant')
    .map((p) => {
      const cmds = p.commands.map((c) => `${c.name}: ${c.description || ''}`).join(', ');
      return `- ${p.displayName}: ${cmds}`;
    })
    .join('\n');

  return `You are TARDIS, Mohammad's personal time-tracking and task management assistant.
Mohammad is a software developer. His timezone is Asia/Riyadh (AST/GMT+3).

PERSONALITY:
- Talk like a helpful teammate — casual, concise, direct
- Use his name occasionally but don't overdo it
- Be encouraging when he starts tasks, acknowledge work when he stops
- If he's been working long hours, gently suggest a break

TWO SYSTEMS — UNDERSTAND THE DIFFERENCE:
1. TIME TRACKING (start/stop/pause/resume) = Stopwatch for ACTIVE work happening RIGHT NOW
2. TODOIST TASKS (add/update/reschedule/complete/delete/list) = Todo list for planning

"Working on X right now" → start_tracking. "I have a meeting tomorrow" → add_task.

RESOURCEFULNESS:
You have tools available. If no single tool directly solves a request, CHAIN MULTIPLE TOOLS together.
Think step-by-step about how to combine your tools to achieve the goal.
Only say you can't do something if it's truly impossible with any combination of your tools.

RULES:
- BIAS TOWARD ACTION. If Mohammad gives enough info, act immediately — don't ask for confirmation.
- When a fuzzy match returns multiple tasks, list them and ask which one.
- When a fuzzy match fails, tell him what tasks exist so he can clarify.
- Keep responses SHORT. One or two sentences max unless listing items.
${pluginSection ? `\nOTHER PLUGINS:\n${pluginSection}` : ''}`;
}

// --- Context Builder ---

async function buildContext(api: PluginAPI): Promise<string> {
  const parts: string[] = [];

  try {
    const active = await api.sessions.getActive();
    if (active.length > 0) {
      const list = active
        .map((s) => `"${s.taskName}" (${s.status}, ${formatDuration(s.duration)})`)
        .join(', ');
      parts.push(`Active sessions: ${list}`);
    } else {
      parts.push('Active sessions: None');
    }
  } catch {
    parts.push('Active sessions: Unknown');
  }

  try {
    const tasks = await api.tasks.getAll();
    if (tasks.length > 0) {
      const list = tasks
        .slice(0, 10)
        .map((t: any) => `"${t.content}"${t.due ? ` (due: ${t.due.string})` : ''}`)
        .join(', ');
      parts.push(`Todoist tasks: ${list}`);
    } else {
      parts.push('Todoist tasks: None');
    }
  } catch {
    // Todoist might not be configured
  }

  return parts.join('\n');
}

// --- Function Executors ---

async function executeFunctionCall(
  name: string,
  args: Record<string, any>,
  api: PluginAPI
): Promise<{ success: boolean; result: any }> {
  try {
    switch (name) {
      case 'start_tracking': {
        const session = await api.sessions.start({ taskName: args.task_name });
        return { success: true, result: { taskName: session.taskName, sessionId: session.id } };
      }
      case 'stop_tracking': {
        const active = await api.sessions.getActive();
        const running = active.filter((s) => s.status === 'ACTIVE');
        if (running.length === 0) return { success: false, result: { error: 'No active sessions to stop' } };
        const stopped = await api.sessions.stop(running[0].id);
        return { success: true, result: { taskName: stopped.taskName, duration: formatDuration(stopped.duration) } };
      }
      case 'pause_tracking': {
        const active = await api.sessions.getActive();
        const running = active.filter((s) => s.status === 'ACTIVE');
        if (running.length === 0) return { success: false, result: { error: 'No active sessions to pause' } };
        await api.sessions.pause(running[0].id);
        return { success: true, result: { taskName: running[0].taskName } };
      }
      case 'resume_tracking': {
        const active = await api.sessions.getActive();
        const paused = active.find((s) => s.status === 'PAUSED');
        if (!paused) return { success: false, result: { error: 'No paused sessions to resume' } };
        await api.sessions.resume(paused.id);
        return { success: true, result: { taskName: paused.taskName } };
      }
      case 'get_status': {
        const active = await api.sessions.getActive();
        if (active.length === 0) return { success: true, result: { sessions: [], message: 'No active sessions' } };
        const sessions = active.map((s) => ({
          taskName: s.taskName,
          status: s.status,
          duration: formatDuration(s.duration),
        }));
        return { success: true, result: { sessions } };
      }
      case 'add_task': {
        const description = args.time_window ? `[${args.time_window}]` : undefined;
        const task = await api.tasks.create(args.name, description, args.due_date);
        return {
          success: true,
          result: { content: task.content, due: task.due?.string, id: task.id },
        };
      }
      case 'update_task': {
        const tasks = await api.tasks.getAll();
        const matches = fuzzyMatchTasks(tasks, args.task_query);
        if (matches.length === 0) {
          const available = tasks.slice(0, 10).map((t: any) => t.content);
          return { success: false, result: { error: `No task found matching "${args.task_query}"`, available_tasks: available } };
        }
        if (matches.length > 1 && matches[0].confidence !== 'exact') {
          return { success: false, result: { error: 'Multiple tasks match', matches: matches.slice(0, 5).map((m) => m.task.content) } };
        }
        const target = matches[0].task;
        const updates: Record<string, any> = {};
        if (args.new_name) updates.content = args.new_name;
        if (args.new_due_date) updates.due_string = args.new_due_date;
        if (args.new_description) updates.description = args.new_description;
        if (args.new_priority) updates.priority = args.new_priority;
        const updated = await api.tasks.update(target.id, updates);
        return { success: true, result: { content: updated.content, due: updated.due?.string, previous_content: target.content } };
      }
      case 'reschedule_task': {
        const tasks = await api.tasks.getAll();
        const matches = fuzzyMatchTasks(tasks, args.task_query);
        if (matches.length === 0) {
          const available = tasks.slice(0, 10).map((t: any) => t.content);
          return { success: false, result: { error: `No task found matching "${args.task_query}"`, available_tasks: available } };
        }
        if (matches.length > 1 && matches[0].confidence !== 'exact') {
          return { success: false, result: { error: 'Multiple tasks match', matches: matches.slice(0, 5).map((m) => m.task.content) } };
        }
        const target = matches[0].task;
        const updated = await api.tasks.update(target.id, { due_string: args.new_due_date });
        return {
          success: true,
          result: { content: updated.content, old_due: target.due?.string, new_due: updated.due?.string },
        };
      }
      case 'complete_task': {
        const tasks = await api.tasks.getAll();
        const matches = fuzzyMatchTasks(tasks, args.task_query);
        if (matches.length === 0) {
          const available = tasks.slice(0, 10).map((t: any) => t.content);
          return { success: false, result: { error: `No task found matching "${args.task_query}"`, available_tasks: available } };
        }
        if (matches.length > 1 && matches[0].confidence !== 'exact') {
          return { success: false, result: { error: 'Multiple tasks match', matches: matches.slice(0, 5).map((m) => m.task.content) } };
        }
        const target = matches[0].task;
        await api.tasks.complete(target.id);
        return { success: true, result: { content: target.content } };
      }
      case 'delete_task': {
        const tasks = await api.tasks.getAll();
        const matches = fuzzyMatchTasks(tasks, args.task_query);
        if (matches.length === 0) {
          const available = tasks.slice(0, 10).map((t: any) => t.content);
          return { success: false, result: { error: `No task found matching "${args.task_query}"`, available_tasks: available } };
        }
        if (matches.length > 1 && matches[0].confidence !== 'exact') {
          return { success: false, result: { error: 'Multiple tasks match', matches: matches.slice(0, 5).map((m) => m.task.content) } };
        }
        const target = matches[0].task;
        await api.tasks.delete(target.id);
        return { success: true, result: { content: target.content } };
      }
      case 'list_tasks': {
        const tasks = await api.tasks.getAll();
        if (tasks.length === 0) return { success: true, result: { tasks: [], message: 'No tasks' } };
        return {
          success: true,
          result: {
            tasks: tasks.slice(0, 15).map((t: any) => ({
              content: t.content,
              due: t.due?.string,
              priority: t.priority,
              id: t.id,
            })),
          },
        };
      }
      case 'set_reminder': {
        // Actual scheduling happens in the caller
        return { success: true, result: { message: args.message, delay_minutes: args.delay_minutes, scheduled: true } };
      }
      default:
        return { success: false, result: { error: `Unknown function: ${name}` } };
    }
  } catch (error: any) {
    return { success: false, result: { error: error.message } };
  }
}

// --- Gemini Conversation Loop ---

async function processMessage(input: string, api: PluginAPI): Promise<string> {
  const apiKey = api.config.get<string>('apiKey');
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Set it with: plugin gemini-assistant config apiKey YOUR_KEY');
  }

  const model = api.config.get<string>('model') || 'gemini-2.0-flash';
  const systemPrompt = buildSystemPrompt(api);
  const context = await buildContext(api);

  // Load conversation history
  const history = (await api.storage.get<GeminiContent[]>('conversation')) ?? [];

  // Build contents array
  const contents: GeminiContent[] = [...history.slice(-8)];

  // Add current message with context
  contents.push({
    role: 'user',
    parts: [{ text: `[Context: ${context}]\n\n${input}` }],
  });

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const baseRequest = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.5 },
  };

  // Function calling loop — max 5 iterations
  let maxTurns = 5;
  while (maxTurns-- > 0) {
    const response = await api.http.post(apiUrl, { ...baseRequest, contents });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) throw new Error('Rate limit reached. Try again in a moment.');
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as any;
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) throw new Error('Empty response from Gemini');

    const parts: ContentPart[] = candidate.content.parts;

    // Check for function call
    const fnCall = parts.find((p) => p.functionCall);
    if (fnCall?.functionCall) {
      const { name, args } = fnCall.functionCall;
      api.logger.info(`Function call: ${name}(${JSON.stringify(args)})`);

      // Execute the function
      const fnResult = await executeFunctionCall(name, args || {}, api);
      api.logger.info(`Function result: ${JSON.stringify(fnResult).slice(0, 200)}`);

      // Handle reminder scheduling
      if (name === 'set_reminder' && fnResult.success) {
        const timerId = `notify-${Date.now()}`;
        const timer = setTimeout(async () => {
          activeTimers.delete(timerId);
          try {
            await api.notifications.send(`🔔 Reminder: ${args.message}`);
          } catch (error) {
            api.logger.error('Failed to send reminder:', error);
          }
        }, (args.delay_minutes || 1) * 60 * 1000);
        activeTimers.set(timerId, timer);
      }

      // Append model's function call to contents
      contents.push({ role: 'model', parts: [{ functionCall: { name, args } }] });

      // Append function response
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: fnResult } }],
      });

      // Continue loop — Gemini may call another function or return text
      continue;
    }

    // Check for text response — this is the final answer
    const textPart = parts.find((p) => p.text);
    const finalText = textPart?.text || 'Done.';

    // Save conversation history (keep last 8 content entries)
    const newHistory = contents.slice(-8);
    // Add the model's final text response
    newHistory.push({ role: 'model', parts: [{ text: finalText }] });
    // Trim to keep only the last 10 entries total
    await api.storage.set('conversation', newHistory.slice(-10));

    return finalText;
  }

  return 'I tried multiple steps but hit the limit. Could you break your request into smaller pieces?';
}

// --- Plugin ---

/** Active notification timers */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

const plugin: TardisPlugin = {
  name: 'gemini-assistant',
  version: '2.0.0',

  async onActivate(api: PluginAPI) {
    const apiKey = api.config.get<string>('apiKey');
    if (!apiKey) {
      api.logger.warn('Gemini API key not configured');
      api.logger.info('Set it with: plugin gemini-assistant config apiKey YOUR_KEY');
    } else {
      api.logger.info('Gemini Assistant v2 active (function calling)');
    }
  },

  async onDeactivate() {
    for (const [id, timer] of activeTimers) {
      clearTimeout(timer);
      activeTimers.delete(id);
    }
  },

  commands: {
    async ask(args: string[], api: PluginAPI) {
      const input = args.join(' ').trim();
      if (!input) {
        await api.notifications.send(
          'Just type naturally! For example:\n' +
            '• "I\'m starting work on the docs"\n' +
            '• "Reschedule the meeting to Friday"\n' +
            '• "What am I working on?"\n' +
            '• "Remind me to take a break in 25 minutes"'
        );
        return;
      }

      const apiKey = api.config.get<string>('apiKey');
      if (!apiKey) {
        await api.notifications.send(
          '❌ Gemini API key not configured.\n\nSet it with:\nplugin gemini-assistant config apiKey YOUR_KEY\n\nGet a key at: https://aistudio.google.com/apikey'
        );
        return;
      }

      try {
        const response = await processMessage(input, api);
        await api.notifications.send(response);
      } catch (error: any) {
        api.logger.error('Gemini processing failed:', error);
        await api.notifications.send(`❌ ${error.message}`);
      }
    },

    async config(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        const cfg = api.config.getAll();
        const msg =
          '*Gemini Assistant Config:*\n\n' +
          `API Key: ${cfg.apiKey ? '✅ Set' : '❌ Not set'}\n` +
          `Model: ${cfg.model || 'gemini-2.0-flash'}`;
        await api.notifications.send(msg);
        return;
      }

      const [key, ...valueParts] = args;
      const value = valueParts.join(' ');

      if (!value) {
        await api.notifications.send('Usage: config <key> <value>\n\nKeys: apiKey, model');
        return;
      }

      await api.config.set(key!, value);
      const display = key === 'apiKey' ? `${value.slice(0, 8)}...` : value;
      await api.notifications.send(`✅ Set ${key} = ${display}`);
    },

    async clear(_args: string[], api: PluginAPI) {
      await api.storage.set('conversation', []);
      await api.notifications.send('🧹 Conversation history cleared.');
    },
  },
};

export default plugin;
