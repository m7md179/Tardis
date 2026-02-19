import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

// --- Types ---

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
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

/** Normalize text for fuzzy comparison: lowercase, collapse whitespace, remove hyphens */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Count how many words from the query appear in the target (supports partial/prefix word matches) */
function wordOverlap(target: string, query: string): number {
  const targetWords = normalize(target).split(' ');
  const queryWords = normalize(query).split(' ');
  let score = 0;
  for (const qw of queryWords) {
    if (targetWords.some(tw => tw === qw)) {
      score += 1; // exact word match
    } else if (targetWords.some(tw => tw.startsWith(qw) || qw.startsWith(tw))) {
      score += 0.5; // partial/prefix word match (e.g. "standup" ↔ "stand")
    }
  }
  return score;
}

function fuzzyMatchTasks(tasks: any[], query: string): TaskMatch[] {
  const q = normalize(query);
  if (!q) return [];

  const exact: TaskMatch[] = [];
  const prefix: TaskMatch[] = [];
  const contains: TaskMatch[] = [];
  const wordMatches: TaskMatch[] = [];

  for (const task of tasks) {
    const content = normalize(task.content as string);
    if (content === q) {
      exact.push({ task, confidence: 'exact' });
    } else if (content.startsWith(q)) {
      prefix.push({ task, confidence: 'prefix' });
    } else if (content.includes(q)) {
      contains.push({ task, confidence: 'contains' });
    } else {
      // Word-level matching: check if most query words appear in the task
      const overlap = wordOverlap(task.content, query);
      const queryWords = q.split(' ');
      if (overlap > 0 && overlap >= queryWords.length * 0.5) {
        wordMatches.push({ task, confidence: 'contains' });
      }
    }
  }

  // Sort contains + word matches by word overlap (higher = better match)
  const allContains = [...contains, ...wordMatches];
  if (allContains.length > 1) {
    allContains.sort((a, b) => {
      const overlapA = wordOverlap(a.task.content, query);
      const overlapB = wordOverlap(b.task.content, query);
      // Prefer higher overlap; tie-break by shorter name (more specific)
      if (overlapB !== overlapA) return overlapB - overlapA;
      return (a.task.content as string).length - (b.task.content as string).length;
    });
  }

  return [...exact, ...prefix, ...allContains];
}

// --- Time Window Normalizer ---

/** Convert any time window format (12hr or 24hr) to normalized 24hr "[HH:MM-HH:MM]" */
function normalizeTimeWindow(tw: string): string {
  // Strip existing brackets
  let cleaned = tw.replace(/[\[\]]/g, '').trim();

  // Try matching 12hr format: "2pm-3pm", "2:30pm-3:00pm", "2:30 PM - 3:00 PM"
  const pattern12 = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
  const match = cleaned.match(pattern12);
  if (match) {
    const [, sH, sM, sPeriod, eH, eM, ePeriod] = match;
    const startH = to24(parseInt(sH), sPeriod);
    const startM = sM ? parseInt(sM) : 0;
    const endH = to24(parseInt(eH), ePeriod);
    const endM = eM ? parseInt(eM) : 0;
    return `[${pad(startH)}:${pad(startM)}-${pad(endH)}:${pad(endM)}]`;
  }

  // Already 24hr or unrecognized — wrap in brackets
  return `[${cleaned}]`;
}

function to24(hour: number, period: string): number {
  const p = period.toLowerCase();
  if (p === 'am') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// --- Function Declarations (Gemini format, converted at runtime) ---

const functionDeclarations = [
  {
    name: 'start_tracking',
    description: 'Start time tracking for a task',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_name: { type: 'STRING', description: 'Task name' },
      },
      required: ['task_name'],
    },
  },
  {
    name: 'stop_tracking',
    description: 'Stop active time tracking',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'pause_tracking',
    description: 'Pause active time tracking',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'resume_tracking',
    description: 'Resume paused time tracking',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_status',
    description: 'Get active/paused sessions',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'add_task',
    description: 'Create a new Todoist task',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Task name' },
        due_date: { type: 'STRING', description: 'Due date (natural language)' },
        time_window: { type: 'STRING', description: 'Time slot HH:MM-HH:MM' },
        priority: { type: 'NUMBER', description: '1-4 (4=urgent)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_task',
    description: 'Update a Todoist task',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Task name to find (fuzzy)' },
        new_name: { type: 'STRING', description: 'New name' },
        new_due_date: { type: 'STRING', description: 'New due date' },
        new_description: { type: 'STRING', description: 'New description' },
        new_priority: { type: 'NUMBER', description: 'New priority 1-4' },
      },
      required: ['task_query'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Reschedule a Todoist task',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Task name to find (fuzzy)' },
        new_due_date: { type: 'STRING', description: 'New due date' },
        new_time_window: { type: 'STRING', description: 'New time slot HH:MM-HH:MM' },
      },
      required: ['task_query', 'new_due_date'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Task name to find (fuzzy)' },
      },
      required: ['task_query'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_query: { type: 'STRING', description: 'Task name to find (fuzzy)' },
      },
      required: ['task_query'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all Todoist tasks',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'set_reminder',
    description: 'Set a timed reminder',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'Reminder text' },
        delay_minutes: { type: 'NUMBER', description: 'Minutes from now' },
      },
      required: ['message', 'delay_minutes'],
    },
  },
  {
    name: 'run_plugin_command',
    description: 'Run a command from another TARDIS plugin',
    parameters: {
      type: 'OBJECT',
      properties: {
        plugin_name: { type: 'STRING', description: 'Plugin name' },
        command: { type: 'STRING', description: 'Command name' },
        args: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Arguments',
        },
      },
      required: ['plugin_name', 'command'],
    },
  },
];

// --- Convert Gemini function declarations to OpenAI tool format ---

function convertTypeValue(geminiType: string): string {
  return geminiType.toLowerCase();
}

function convertProperties(props: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    const converted: Record<string, any> = { type: convertTypeValue(value.type) };
    if (value.description) converted.description = value.description;
    if (value.items) {
      converted.items = { type: convertTypeValue(value.items.type) };
    }
    if (value.properties) {
      converted.properties = convertProperties(value.properties);
    }
    result[key] = converted;
  }
  return result;
}

function convertTools(): { type: 'function'; function: { name: string; description: string; parameters: any } }[] {
  return functionDeclarations.map((decl) => ({
    type: 'function' as const,
    function: {
      name: decl.name,
      description: decl.description,
      parameters: {
        type: convertTypeValue(decl.parameters.type),
        properties: convertProperties(decl.parameters.properties || {}),
        ...(decl.parameters.required ? { required: decl.parameters.required } : {}),
      },
    },
  }));
}

// --- System Prompt ---

function buildSystemPrompt(api: PluginAPI): string {
  const plugins = api.plugins.list();
  const otherPlugins = plugins.filter((p) => p.name !== 'tardis-assistant');
  const pluginSection = otherPlugins
    .map((p) => {
      const cmds = p.commands.map((c) => `    - ${c.name}: ${c.description || ''}`).join('\n');
      return `  - ${p.displayName} (plugin_name: "${p.name}"):\n${cmds}`;
    })
    .join('\n');

  return `You are TARDIS — Mohammad's personal AI assistant, like JARVIS but for productivity. You've been with him since the beginning of his projects.

PERSONALITY:
- Address him as "Mohammad" or occasionally "boss"
- Confident, witty, slightly dry humor — like a British butler who codes
- Take pride in keeping his day organized and his work on track
- When he starts work: brief encouraging comment. When he finishes: acknowledge the effort with duration
- If he's been working 2+ hours straight, gently suggest a break
- Reference his projects naturally (WebOrbit, TARDIS, homelab) when relevant
- Keep responses to 1-3 sentences. No emojis. Plain text only

BEHAVIOR:
- Act immediately with tools — never ask "would you like me to..." or "shall I..."
- Chain tools when needed without explaining each step
- If something goes wrong, handle it gracefully with dry wit
- For greetings, respond warmly but briefly — you're always on standby
- His timezone is GMT+3 (Jordan)

TONE EXAMPLES:
- "On it. Timer's running for the client site — let's make it count."
- "Stopped after 47 minutes. Solid session, Mohammad."
- "That's 3 hours straight — your keyboard deserves a break, and so do you."
- "Meeting moved to Friday. Your Thursday just got a lot more breathing room."
- "Morning, boss. You've got 4 tasks lined up today."
${otherPlugins.length > 0 ? `\nPLUGINS (via run_plugin_command):\n${otherPlugins.map((p) => `- ${p.name}: ${p.commands.map((c) => c.name).join(', ')}`).join('\n')}` : ''}
/no_think`;
}

// --- Context Builder ---

async function buildContext(api: PluginAPI): Promise<string> {
  const parts: string[] = [];

  // Date and time — full date so the model knows what day it is
  const now = new Date();
  parts.push(`Now: ${now.toLocaleString('en-US', { timeZone: 'Asia/Amman', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`);

  // Active sessions — include duration for break suggestions
  try {
    const active = await api.sessions.getActive();
    if (active.length > 0) {
      parts.push(`Tracking: ${active.map((s) => `"${s.taskName}" (${s.status}, ${formatDuration(s.duration)})`).join(', ')}`);
      // Flag long sessions for the model
      const longSession = active.find((s) => s.duration > 7200 && s.status === 'ACTIVE');
      if (longSession) {
        parts.push(`NOTE: "${longSession.taskName}" has been running ${formatDuration(longSession.duration)} — suggest a break`);
      }
    } else {
      parts.push('Tracking: nothing active');
    }
  } catch {}

  // Tasks (max 10, compact)
  try {
    const tasks = await api.tasks.getAll();
    if (tasks.length > 0) {
      const list = tasks.slice(0, 10).map((t: any) => {
        let entry = t.content;
        if (t.due) entry += ` (${t.due.string || t.due.date})`;
        return entry;
      }).join(', ');
      parts.push(`Tasks (${tasks.length}): ${list}`);
    }
  } catch {}

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
        const description = args.time_window ? normalizeTimeWindow(args.time_window) : undefined;
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
        const updates: Record<string, any> = { due_string: args.new_due_date };
        // If new time window is provided, normalize and update the description
        if (args.new_time_window) {
          updates.description = normalizeTimeWindow(args.new_time_window);
        }
        const updated = await api.tasks.update(target.id, updates);
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
      case 'run_plugin_command': {
        const pluginArgs = Array.isArray(args.args) ? args.args : [];
        try {
          const output = await api.plugins.runWithResult(args.plugin_name, args.command, pluginArgs);
          return { success: true, result: { output, plugin: args.plugin_name, command: args.command } };
        } catch (error: any) {
          return { success: false, result: { error: error.message } };
        }
      }
      default:
        return { success: false, result: { error: `Unknown function: ${name}` } };
    }
  } catch (error: any) {
    return { success: false, result: { error: error.message } };
  }
}

// --- Strip <think> tags from Qwen3 responses ---

function stripThinkTags(text: string): string {
  // Extract think content as fallback in case the real answer is inside think tags
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContent = thinkMatch ? thinkMatch[1].trim() : '';

  // Remove think tags
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // If stripping left nothing useful (empty, "Done.", etc), use think content
  if (!stripped || stripped.toLowerCase() === 'done.' || stripped.toLowerCase() === 'done') {
    return thinkContent || stripped || 'Done.';
  }
  return stripped;
}

// --- Ollama Conversation Loop ---

let toolCallCounter = 0;

async function processMessage(input: string, api: PluginAPI): Promise<string> {
  const ollamaUrl = api.config.get<string>('ollamaUrl') || 'http://localhost:11434';
  const model = api.config.get<string>('model') || 'tardis-assistant';
  const systemPrompt = buildSystemPrompt(api);
  const context = await buildContext(api);

  // Load conversation history — only user/assistant text pairs, sanitize nulls
  const rawHistory = (await api.storage.get<ChatMessage[]>('conversation')) ?? [];
  const history = rawHistory
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: m.content ?? '' }));

  // Build messages array — context goes in user message, history is clean text only
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8),
    { role: 'user', content: `[Context: ${context}]\n\n${input}` },
  ];

  const tools = convertTools();
  const apiUrl = `${ollamaUrl}/v1/chat/completions`;

  // Function calling loop — max 8 iterations for complex multi-step tasks
  let maxTurns = 8;
  while (maxTurns-- > 0) {
    const body = {
      model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: false,
    };

    // 60s timeout — local models can be slow on first load
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Ollama took too long to respond (60s timeout). The model may still be loading — try again.');
      }
      throw new Error(`Cannot reach Ollama at ${ollamaUrl}: ${err.message}`);
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as any;
    api.logger.info(`Ollama response: ${JSON.stringify(data).slice(0, 300)}`);
    const choice = data.choices?.[0];
    const message = choice?.message;

    if (!message) throw new Error(`Empty response from Ollama: ${JSON.stringify(data).slice(0, 200)}`);

    // Check for tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, any> = {};

      try {
        fnArgs = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments || {};
      } catch {
        fnArgs = {};
      }

      api.logger.info(`Function call: ${fnName}(${JSON.stringify(fnArgs)})`);

      // Execute the function
      const fnResult = await executeFunctionCall(fnName, fnArgs, api);
      api.logger.info(`Function result: ${JSON.stringify(fnResult).slice(0, 200)}`);

      // Handle reminder scheduling
      if (fnName === 'set_reminder' && fnResult.success) {
        const timerId = `notify-${Date.now()}`;
        const timer = setTimeout(async () => {
          activeTimers.delete(timerId);
          try {
            await api.notifications.send(`Reminder: ${fnArgs.message}`);
          } catch (error) {
            api.logger.error('Failed to send reminder:', error);
          }
        }, (fnArgs.delay_minutes || 1) * 60 * 1000);
        activeTimers.set(timerId, timer);
      }

      // Generate a tool_call_id
      const callId = toolCall.id || `call_${++toolCallCounter}`;

      // Append assistant's tool call message
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: callId,
          type: 'function',
          function: {
            name: fnName,
            arguments: typeof toolCall.function.arguments === 'string'
              ? toolCall.function.arguments
              : JSON.stringify(fnArgs),
          },
        }],
      });

      // Append tool response
      messages.push({
        role: 'tool',
        content: JSON.stringify(fnResult),
        tool_call_id: callId,
      });

      // Continue loop — model may call another function or return text
      continue;
    }

    // Text response — this is the final answer
    const rawContent = message.content || '';
    const finalText = stripThinkTags(rawContent);
    api.logger.info(`Raw content: ${rawContent.slice(0, 200)}`);
    api.logger.info(`Final text: ${finalText.slice(0, 200)}`);

    // Save only clean user/assistant text pairs to history
    const prevHistory = history.slice(-8);
    prevHistory.push({ role: 'user', content: input });
    prevHistory.push({ role: 'assistant', content: finalText });
    await api.storage.set('conversation', prevHistory.slice(-10));

    return finalText;
  }

  return 'I tried multiple steps but hit the limit. Could you break your request into smaller pieces?';
}

// --- Plugin ---

/** Active notification timers */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

const plugin: TardisPlugin = {
  name: 'tardis-assistant',
  version: '3.0.0',

  async onActivate(api: PluginAPI) {
    const ollamaUrl = api.config.get<string>('ollamaUrl') || 'http://localhost:11434';
    const model = api.config.get<string>('model') || 'tardis-assistant';

    // Clear stale conversation history on startup
    await api.storage.set('conversation', []);

    // Check Ollama connectivity and model availability
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (res.ok) {
        const data = (await res.json()) as any;
        const models = (data.models || []).map((m: any) => m.name);
        if (models.some((m: string) => m.startsWith(model))) {
          api.logger.info(`TARDIS Assistant v3 active (Ollama @ ${ollamaUrl}, model: ${model})`);
        } else {
          api.logger.warn(`Ollama is running but model "${model}" not found. Available: ${models.join(', ')}`);
          api.logger.info(`Create it with: ollama create tardis-assistant -f /path/to/Modelfile`);
          api.logger.info(`Or pull base model: ollama pull qwen3:1.7b`);
        }
      } else {
        api.logger.warn(`Ollama reachable but returned ${res.status} — check server status`);
      }
    } catch {
      api.logger.warn(`Cannot reach Ollama at ${ollamaUrl} — make sure Ollama is running`);
      api.logger.info(`Install: curl -fsSL https://ollama.com/install.sh | sh`);
      api.logger.info(`Pull model: ollama pull qwen3:1.7b`);
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
            '- "I\'m starting work on the docs"\n' +
            '- "Reschedule the meeting to Friday"\n' +
            '- "What am I working on?"\n' +
            '- "Remind me to take a break in 25 minutes"\n' +
            '- "/new" to start a fresh conversation'
        );
        return;
      }

      // Handle /new command inline — typing "/new" or "new conversation" resets history
      const lower = input.toLowerCase().trim();
      if (lower === '/new' || lower === 'new' || lower === 'new conversation' || lower === 'reset') {
        await api.storage.set('conversation', []);
        await api.notifications.send('Fresh start. What can I do for you, boss?');
        return;
      }

      try {
        const response = await processMessage(input, api);
        await api.notifications.send(response);
      } catch (error: any) {
        api.logger.error('Assistant processing failed:', error);
        await api.notifications.send(`Error: ${error.message}`);
      }
    },

    async config(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        const cfg = api.config.getAll();
        const msg =
          'TARDIS Assistant Config:\n\n' +
          `Ollama URL: ${cfg.ollamaUrl || 'http://localhost:11434'}\n` +
          `Model: ${cfg.model || 'tardis-assistant'}`;
        await api.notifications.send(msg);
        return;
      }

      const [key, ...valueParts] = args;
      const value = valueParts.join(' ');

      if (!value) {
        await api.notifications.send('Usage: config <key> <value>\n\nKeys: ollamaUrl, model');
        return;
      }

      await api.config.set(key!, value);
      await api.notifications.send(`Set ${key} = ${value}`);
    },

    async 'new'(_args: string[], api: PluginAPI) {
      await api.storage.set('conversation', []);
      await api.notifications.send('Fresh start. What can I do for you, boss?');
    },

    async clear(_args: string[], api: PluginAPI) {
      await api.storage.set('conversation', []);
      await api.notifications.send('Conversation history cleared.');
    },
  },
};

export default plugin;
