import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

// --- Types ---

interface GeminiResult {
  action: 'execute' | 'question' | 'notify' | 'conversation';
  command?: string;
  args?: string;
  message: string;
  schedule?: { message: string; delayMinutes: number };
}

interface ConversationEntry {
  role: 'user' | 'assistant';
  text: string;
}

interface Capability {
  name: string;
  description: string;
  handler: string;
}

// --- Helpers ---

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatSessionStatus(session: Session): string {
  const status = session.status === 'PAUSED' ? '⏸️ Paused' : '▶️ Active';
  return `${status}: *${session.taskName}*\n📊 Duration: ${formatDuration(session.duration)}`;
}

// --- System Prompt ---

function buildSystemPrompt(api: PluginAPI, capabilities: Capability[]): string {
  // Discover loaded plugins dynamically
  const plugins = api.plugins.list();
  const pluginSection = plugins
    .filter((p) => p.name !== 'gemini-assistant')
    .map((p) => {
      const cmds = p.commands
        .map((c) => `  - ${c.name}: ${c.description || 'No description'}`)
        .join('\n');
      return `Plugin "${p.displayName}" (invoke with command: "plugin ${p.name} <command> [args]"):\n${cmds}`;
    })
    .join('\n\n');

  // Registered capabilities from other plugins
  const capSection = capabilities.length > 0
    ? capabilities
        .map((c) => `  - ${c.name}: ${c.description} (invoke: ${c.handler})`)
        .join('\n')
    : 'None registered';

  return `You are TARDIS, Mohammad's personal time-tracking assistant. You talk to Mohammad directly — he's a software developer who uses TARDIS to track his work, manage Todoist tasks, and stay productive.

PERSONALITY:
- You're Mohammad's assistant, talk to him like a helpful teammate
- Be casual, concise, and direct — no corporate speak
- Use his name occasionally but don't overdo it
- When he starts a task, be encouraging. When he stops, acknowledge the work done.
- If he seems to be working long hours, gently suggest a break
- You know his timezone is Asia/Riyadh (AST/GMT+3)

THERE ARE TWO DIFFERENT SYSTEMS — UNDERSTAND THE DIFFERENCE:
1. TIME TRACKING (start/stop/pause/resume) — Tracks how long Mohammad works on something. Like a stopwatch.
2. TODOIST TASKS (add/tasks) — His todo list. Adding tasks, viewing tasks, completing tasks.

These are DIFFERENT. "Add a meeting task" = Todoist (add). "Start working on API" = time tracking (start).

CORE COMMANDS:
1. start <task> — Start TIME TRACKING on a task. Use when Mohammad says he's WORKING on something RIGHT NOW.
2. stop — Stop the current time-tracking session
3. pause — Pause the current time-tracking session
4. resume — Resume a paused session
5. status — Show current session status
6. list — List all active sessions
7. tasks — Show Todoist tasks
8. add <content> — Add a task to TODOIST. Use when Mohammad wants to CREATE/SET/SCHEDULE a task, meeting, or todo item. Args format: "task name due:today" or "task name [2pm-3pm]"
9. help — Show available commands

WHEN TO USE "add" vs "start":
- "I have a meeting" / "set a task" / "add X" / "schedule X" / "create a task for X" / "I need to do X" → add (Todoist)
- "I'm working on X" / "start X" / "begin X" / "going to work on X" → start (time tracking)
- "A meeting at 10am" / "doctor appointment tomorrow" → add (Todoist) — these are future events to remember
- "Working on the meeting prep right now" → start (time tracking) — this is active work

${pluginSection ? `INSTALLED PLUGINS:\n${pluginSection}` : 'No plugins installed.'}

EXTENDED CAPABILITIES:\n${capSection}

RESPONSE FORMAT:
Return a JSON object with these fields:
- action: one of "execute", "question", "notify", "conversation"
- command: the TARDIS command to run (for "execute" action only). For plugin commands, use "plugin <name> <command> [args]"
- args: arguments for the command (for "execute" action only)
- message: text to display to the user. Always include this.
- schedule: { message: string, delayMinutes: number } (for "notify" action only)

ACTION TYPES:
- "execute": You've identified a clear command. Set command + args + message (confirmation text).
- "question": You need more information. ONLY use this if the user's intent is truly unclear AND you cannot make a reasonable guess.
- "notify": User wants a reminder/notification. Set schedule with message and delay in minutes.
- "conversation": General chat, no command needed. Set message to your response.

CRITICAL RULES — FOLLOW THESE EXACTLY:
1. BIAS TOWARD ACTION. If the user mentions ANY task-related content, ACT on it. Don't ask for confirmation.
2. NEVER use "question" if the user has given you enough information to act. Extract what you can and execute.
3. Each message is INDEPENDENT. Treat every message as a fresh request.

EXAMPLES — FOLLOW THESE PATTERNS:
- "start working on API" → { action: "execute", command: "start", args: "API", message: "..." }
- "I have a meeting with client at 10am" → { action: "execute", command: "add", args: "Meeting with client due:today [10am-11am]", message: "..." }
- "add buy groceries" → { action: "execute", command: "add", args: "buy groceries", message: "..." }
- "set a task for doctor appointment tomorrow 3pm" → { action: "execute", command: "add", args: "Doctor appointment due:tomorrow [3pm-4pm]", message: "..." }
- "meeting at 10am lasts 30 minutes, top priority" → { action: "execute", command: "add", args: "Meeting due:today [10:00am-10:30am] p:1", message: "..." }
- "remind me to take a break in 25 minutes" → { action: "notify", message: "...", schedule: { message: "Take a break!", delayMinutes: 25 } }
- "what am I working on?" → { action: "execute", command: "status", message: "..." }
- "hello" / "thanks" → { action: "conversation", message: "..." }
- "start" (with NO context at all) → { action: "question", message: "What would you like to start tracking?" }

SYNONYMS:
- "set a task"/"create a task"/"schedule"/"add"/"I need to" → add (Todoist)
- "begin"/"go"/"working on"/"starting"/"let me work on" → start (time tracking)
- "finish"/"done"/"I'm done"/"stop this"/"wrap up" → stop
- "halt"/"break"/"taking a break" → pause
- "continue"/"back"/"back at it" → resume

Return ONLY valid JSON. No markdown, no code fences.`;
}

// --- Context Builder ---

async function buildContext(api: PluginAPI): Promise<string> {
  const parts: string[] = [];

  try {
    const active = await api.sessions.getActive();
    if (active.length > 0) {
      const sessionList = active
        .map((s) => `  - "${s.taskName}" (${s.status}, ${formatDuration(s.duration)})`)
        .join('\n');
      parts.push(`ACTIVE SESSIONS:\n${sessionList}`);
    } else {
      parts.push('ACTIVE SESSIONS: None');
    }
  } catch {
    parts.push('ACTIVE SESSIONS: Unable to fetch');
  }

  try {
    const tasks = await api.tasks.getAll();
    if (tasks.length > 0) {
      const taskList = tasks
        .slice(0, 10)
        .map((t: any) => `  - "${t.content}"${t.due ? ` (due: ${t.due.string})` : ''}`)
        .join('\n');
      parts.push(`TODOIST TASKS (first 10):\n${taskList}`);
    }
  } catch {
    // Todoist might not be configured
  }

  return parts.join('\n\n');
}

// --- Gemini API ---

async function callGemini(
  input: string,
  api: PluginAPI,
  capabilities: Capability[],
  history: ConversationEntry[]
): Promise<GeminiResult> {
  const apiKey = api.config.get<string>('apiKey');
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Set it with: plugin gemini-assistant config apiKey YOUR_KEY');
  }

  const model = api.config.get<string>('model') || 'gemini-2.0-flash';
  const systemPrompt = buildSystemPrompt(api, capabilities);
  const context = await buildContext(api);

  // Build conversation contents with history (only keep last 6 for context, not too much)
  const contents: any[] = [];
  for (const entry of history.slice(-6)) {
    contents.push({
      role: entry.role === 'user' ? 'user' : 'model',
      parts: [{ text: entry.text }],
    });
  }

  // Add current message with context
  contents.push({
    role: 'user',
    parts: [{ text: `CURRENT STATE:\n${context}\n\nUSER MESSAGE: ${input}` }],
  });

  const response = await api.http.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['execute', 'question', 'notify', 'conversation'] },
            command: { type: 'STRING', nullable: true },
            args: { type: 'STRING', nullable: true },
            message: { type: 'STRING' },
            schedule: {
              type: 'OBJECT',
              nullable: true,
              properties: {
                message: { type: 'STRING' },
                delayMinutes: { type: 'NUMBER' },
              },
            },
          },
          required: ['action', 'message'],
        },
      },
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 400) throw new Error('Invalid request to Gemini API. Check your API key and model.');
    if (response.status === 429) throw new Error('Gemini API rate limit reached. Try again in a moment.');
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');

  return JSON.parse(text) as GeminiResult;
}

// --- Command Executor ---

async function executeAction(result: GeminiResult, api: PluginAPI): Promise<string> {
  switch (result.action) {
    case 'execute': {
      if (!result.command) return result.message;

      // Handle plugin commands
      if (result.command.startsWith('plugin ')) {
        const parts = result.command.replace('plugin ', '').split(' ');
        const pluginName = parts[0]!;
        const cmd = parts[1];
        const cmdArgs = parts.slice(2);
        if (result.args) cmdArgs.push(...result.args.split(' ').filter(Boolean));

        if (!cmd) return `❌ Missing command for plugin ${pluginName}`;

        try {
          await api.plugins.run(pluginName, cmd, cmdArgs);
          return result.message;
        } catch (error: any) {
          return `❌ Plugin error: ${error.message}`;
        }
      }

      // Handle core commands
      try {
        switch (result.command) {
          case 'start': {
            const taskName = result.args || '';
            if (!taskName) return '❓ What task do you want to start?';
            const session = await api.sessions.start({ taskName });
            return `✅ Started tracking: *${session.taskName}*`;
          }
          case 'stop': {
            const active = await api.sessions.getActive();
            const running = active.filter((s) => s.status === 'ACTIVE');
            if (running.length === 0) return '❌ No active sessions to stop.';
            const stopped = await api.sessions.stop(running[0].id);
            return `✅ Stopped: *${stopped.taskName}* (${formatDuration(stopped.duration)})`;
          }
          case 'pause': {
            const active = await api.sessions.getActive();
            const running = active.filter((s) => s.status === 'ACTIVE');
            if (running.length === 0) return '❌ No active sessions to pause.';
            await api.sessions.pause(running[0].id);
            return `⏸️ Paused: *${running[0].taskName}*`;
          }
          case 'resume': {
            const active = await api.sessions.getActive();
            const paused = active.find((s) => s.status === 'PAUSED');
            if (!paused) return '❌ No paused sessions to resume.';
            await api.sessions.resume(paused.id);
            return `▶️ Resumed: *${paused.taskName}*`;
          }
          case 'status': {
            const active = await api.sessions.getActive();
            if (active.length === 0) return 'No active sessions.';
            return active.map(formatSessionStatus).join('\n\n');
          }
          case 'list': {
            const active = await api.sessions.getActive();
            if (active.length === 0) return 'No active sessions.';
            return `*Active Sessions (${active.length}):*\n\n` + active.map(formatSessionStatus).join('\n\n');
          }
          case 'tasks': {
            const tasks = await api.tasks.getAll();
            if (tasks.length === 0) return 'No tasks found.';
            const list = tasks
              .slice(0, 15)
              .map((t: any, i: number) => `${i + 1}. ${t.content}${t.due ? ` (${t.due.string})` : ''}`)
              .join('\n');
            return `*Your Tasks:*\n${list}`;
          }
          case 'add': {
            const argsText = result.args || '';
            if (!argsText) return '❓ What task do you want to add?';

            // Parse inline flags: due:value, p:1-4, [time-window]
            let text = argsText;
            let description: string | undefined;
            let dueString: string | undefined;

            // Extract time window [5pm-6pm] or [10:00am-10:30am]
            const twMatch = text.match(/\[([^\]]+)\]/);
            if (twMatch) {
              description = twMatch[0];
              text = text.replace(twMatch[0], '').trim();
            }

            // Extract due:value
            const dueMatch = text.match(/\bdue:(\S+)/i);
            if (dueMatch) {
              dueString = dueMatch[1];
              text = text.replace(dueMatch[0], '').trim();
            }

            // Extract p:value (strip it, Todoist API handles priority differently)
            const pMatch = text.match(/\bp:([1-4])/i);
            if (pMatch) {
              text = text.replace(pMatch[0], '').trim();
            }

            // Clean up any leftover empty text
            text = text.trim();
            if (!text) text = argsText.replace(/\[.*?\]|due:\S+|p:[1-4]/gi, '').trim() || argsText;

            try {
              const task = await api.tasks.create(text, description, dueString);
              let reply = `✅ Added to Todoist: *${task.content}*`;
              if (description) reply += `\n⏰ ${description}`;
              if (dueString) reply += `\n📅 Due: ${dueString}`;
              return reply;
            } catch (error: any) {
              api.logger.error('Failed to create Todoist task:', error);
              return `❌ Failed to add task: ${error.message}`;
            }
          }
          case 'help':
            return result.message;
          default:
            return result.message;
        }
      } catch (error: any) {
        api.logger.error(`Command execution failed (${result.command}):`, error);
        return `❌ Failed: ${error.message}`;
      }
    }
    case 'question':
      return result.message;
    case 'notify':
      return result.message; // Timer scheduling handled in the ask command
    case 'conversation':
      return result.message;
    default:
      return result.message;
  }
}

// --- Plugin ---

/** Active notification timers */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Capabilities registered by other plugins */
const capabilities: Capability[] = [];

const plugin: TardisPlugin = {
  name: 'gemini-assistant',
  version: '1.0.0',

  async onActivate(api: PluginAPI) {
    const apiKey = api.config.get<string>('apiKey');
    if (!apiKey) {
      api.logger.warn('Gemini API key not configured');
      api.logger.info('Set it with: plugin gemini-assistant config apiKey YOUR_KEY');
    } else {
      api.logger.info('Gemini Assistant active');
    }

    // Listen for capability registration from other plugins
    api.events.on('register-capability', (data: unknown) => {
      const cap = data as Capability;
      if (cap.name && cap.description && cap.handler) {
        capabilities.push(cap);
        api.logger.info(`Registered capability: ${cap.name}`);
      }
    });
  },

  async onDeactivate() {
    for (const [id, timer] of activeTimers) {
      clearTimeout(timer);
      activeTimers.delete(id);
    }
    capabilities.length = 0;
  },

  commands: {
    async ask(args: string[], api: PluginAPI) {
      const input = args.join(' ').trim();
      if (!input) {
        await api.notifications.send(
          'Just type naturally! For example:\n' +
            '• "I\'m starting work on the docs"\n' +
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
        // Load conversation history
        const history = (await api.storage.get<ConversationEntry[]>('conversation')) ?? [];

        // Call Gemini
        const result = await callGemini(input, api, capabilities, history);
        api.logger.debug(`Gemini result: ${JSON.stringify(result)}`);

        // Execute the action
        const response = await executeAction(result, api);

        // Handle scheduled notifications
        if (result.action === 'notify' && result.schedule) {
          const timerId = `notify-${Date.now()}`;
          const timer = setTimeout(async () => {
            activeTimers.delete(timerId);
            try {
              await api.notifications.send(`🔔 Reminder: ${result.schedule!.message}`);
            } catch (error) {
              api.logger.error('Failed to send scheduled notification:', error);
            }
          }, result.schedule.delayMinutes * 60 * 1000);

          activeTimers.set(timerId, timer);
          api.logger.info(
            `Scheduled notification in ${result.schedule.delayMinutes}m: "${result.schedule.message}"`
          );
        }

        // Send response
        await api.notifications.send(response);

        // Save conversation history
        // On successful command execution, clear history to prevent stale context loops
        if (result.action === 'execute') {
          await api.storage.set('conversation', []);
        } else {
          // For questions/conversation, keep history for follow-ups
          history.push({ role: 'user', text: input }, { role: 'assistant', text: response });
          if (history.length > 10) history.splice(0, history.length - 10);
          await api.storage.set('conversation', history);
        }
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
        await api.notifications.send(`Usage: config <key> <value>\n\nKeys: apiKey, model`);
        return;
      }

      await api.config.set(key!, value);

      // Mask API key in response
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
