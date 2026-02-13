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

  return `You are TARDIS Assistant, a natural language interface for the TARDIS time-tracking system. You translate human language into TARDIS commands.

CORE COMMANDS:
1. start <task> — Start tracking a task. Example: "start Write documentation"
2. stop — Stop the current active task
3. pause — Pause the current task
4. resume — Resume a paused task
5. status — Show current session status
6. list — List all active sessions
7. tasks — Show Todoist tasks
8. add <content> [due:date] [p:priority] [[time-window]] — Add a Todoist task
   Example: "add Meeting [2pm-3pm] due:tomorrow p:4"
9. help — Show available commands

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
- "question": You need more information from the user. Set message to your question.
- "notify": User wants a reminder/notification. Set schedule with message and delay in minutes.
- "conversation": General chat, no command needed. Set message to your response.

RULES:
- Synonyms: "begin"/"go" = start, "finish"/"done"/"I'm done" = stop, "halt"/"break" = pause, "continue"/"back" = resume
- If the user says something like "stop this" or "I'm done", use the stop command
- If the request is ambiguous (e.g. "start" with no task), use "question" to ask for clarification
- For reminders like "remind me in 30 minutes to take a break", use the "notify" action
- When the user mentions a plugin by name or functionality, route to that plugin's commands
- Keep messages concise and friendly
- Use the current context (active sessions, tasks) to make smart decisions
- If a user says "actually" or corrects themselves, handle it by stopping/changing the current action

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

  // Build conversation contents with history
  const contents: any[] = [];
  for (const entry of history.slice(-10)) {
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

        // Save conversation history (keep last 10 entries)
        history.push({ role: 'user', text: input }, { role: 'assistant', text: response });
        if (history.length > 10) history.splice(0, history.length - 10);
        await api.storage.set('conversation', history);
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
  },
};

export default plugin;
