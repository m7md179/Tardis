import type { PluginAPI } from '@tardis/core';
import { fuzzyFindOne } from '@tardis/shared';

// ─── Types ───

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  due?: { string: string; date: string };
  priority: number; // 1 (normal) – 4 (urgent)
  labels: string[];
  url: string;
}

// ─── Plugin state ───

let api: PluginAPI;
let apiToken = '';
const BASE = 'https://api.todoist.com/rest/v2';

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  const token = await api.config.get<string>('apiToken');
  if (token) apiToken = token;

  // Also check storage (user may have saved it via a setup flow)
  if (!apiToken) {
    const stored = await api.storage.get<string>('apiToken');
    if (stored) apiToken = stored;
  }

  api.logger.info(`Todoist plugin activated${apiToken ? '' : ' (no API token — configure it first)'}`);
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Todoist plugin deactivated');
};

// ─── Helpers ───

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${apiToken}` };
}

function assertToken(): void {
  if (!apiToken) {
    throw new Error(
      'Todoist API token not configured. Set it in config or ask me to save it: "my Todoist token is <token>"'
    );
  }
}

async function fetchTasks(filter?: string): Promise<TodoistTask[]> {
  const url =
    filter
      ? `${BASE}/tasks?filter=${encodeURIComponent(filter)}`
      : `${BASE}/tasks`;
  const res = await api.http.get(url, { headers: headers() });
  if (!res.ok) throw new Error(`Todoist API error: ${res.status} ${res.statusText}`);
  return (await res.json()) as TodoistTask[];
}

async function findTaskByName(name: string): Promise<TodoistTask | null> {
  const tasks = await fetchTasks();
  return fuzzyFindOne(name, tasks, (t) => t.content);
}

function formatTask(t: TodoistTask): string {
  const priority = t.priority > 1 ? ` [P${5 - t.priority}]` : '';
  const due = t.due ? ` (due ${t.due.string})` : '';
  return `• ${t.content}${priority}${due}`;
}

// ─── Tool execution ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'todoist.list-tasks': {
      assertToken();
      const filter = typeof args['filter'] === 'string' ? args['filter'] : undefined;
      const tasks = await fetchTasks(filter);

      if (tasks.length === 0) {
        return { tasks: [], message: filter ? `No tasks matching "${filter}".` : 'No active tasks.' };
      }
      return {
        tasks: tasks.map((t) => ({
          id: t.id,
          content: t.content,
          description: t.description,
          due: t.due?.string,
          priority: t.priority,
        })),
        formatted: tasks.map(formatTask).join('\n'),
      };
    }

    case 'todoist.add-task': {
      assertToken();
      const content = String(args['content'] ?? '').trim();
      if (!content) return { success: false, message: 'Task content is required.' };

      const body: Record<string, unknown> = { content };
      if (typeof args['description'] === 'string') body['description'] = args['description'];
      if (typeof args['dueString'] === 'string') body['due_string'] = args['dueString'];
      if (typeof args['priority'] === 'number') body['priority'] = args['priority'];

      const res = await api.http.post(`${BASE}/tasks`, body, { headers: headers() });
      if (!res.ok) throw new Error(`Todoist API error: ${res.status} ${res.statusText}`);
      const task = (await res.json()) as TodoistTask;
      return { success: true, message: `Created task: "${task.content}"`, task };
    }

    case 'todoist.complete-task': {
      assertToken();
      const taskName = String(args['taskName'] ?? '').trim();
      const task = await findTaskByName(taskName);
      if (!task) return { success: false, message: `No task found matching "${taskName}".` };

      const res = await api.http.post(`${BASE}/tasks/${task.id}/close`, {}, { headers: headers() });
      if (!res.ok) throw new Error(`Todoist API error: ${res.status} ${res.statusText}`);
      return { success: true, message: `Completed: "${task.content}"` };
    }

    case 'todoist.update-task': {
      assertToken();
      const taskName = String(args['taskName'] ?? '').trim();
      const task = await findTaskByName(taskName);
      if (!task) return { success: false, message: `No task found matching "${taskName}".` };

      const updates: Record<string, unknown> = {};
      if (typeof args['content'] === 'string') updates['content'] = args['content'];
      if (typeof args['description'] === 'string') updates['description'] = args['description'];
      if (typeof args['dueString'] === 'string') updates['due_string'] = args['dueString'];
      if (typeof args['priority'] === 'number') updates['priority'] = args['priority'];

      if (Object.keys(updates).length === 0) {
        return { success: false, message: 'No updates provided.' };
      }

      const res = await api.http.post(`${BASE}/tasks/${task.id}`, updates, { headers: headers() });
      if (!res.ok) throw new Error(`Todoist API error: ${res.status} ${res.statusText}`);
      const updated = (await res.json()) as TodoistTask;
      return { success: true, message: `Updated: "${updated.content}"`, task: updated };
    }

    case 'todoist.delete-task': {
      assertToken();
      const taskName = String(args['taskName'] ?? '').trim();
      const task = await findTaskByName(taskName);
      if (!task) return { success: false, message: `No task found matching "${taskName}".` };

      const res = await api.http.delete(`${BASE}/tasks/${task.id}`, { headers: headers() });
      if (!res.ok) throw new Error(`Todoist API error: ${res.status} ${res.statusText}`);
      return { success: true, message: `Deleted: "${task.content}"` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};

// ─── Proactive handlers ───

export async function sendDailyBriefing(): Promise<void> {
  assertToken();
  const tasks = await fetchTasks('today | overdue');
  if (tasks.length === 0) {
    await api.notifications.send('📋 No tasks due today. Clear day!');
    return;
  }
  const lines = tasks.map(formatTask).join('\n');
  await api.notifications.send(`📋 Today's tasks:\n\n${lines}`);
}
