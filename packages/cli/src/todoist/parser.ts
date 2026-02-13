import { parseTimeWindow } from '@tardis/shared';
import { TimeWindow, TodoistTask } from '@tardis/shared';

/**
 * Parsed task with extracted time window
 */
export interface ParsedTask {
  id: string;
  content: string;
  description: string;
  timeWindow?: TimeWindow;
  due?: TodoistTask['due'];
  labels: string[];
  priority: number;
  projectId: string;
  createdAt?: string;
}

/**
 * Parse time window from task description
 * Looks for patterns like [1pm-3pm] or [09:00-12:00] in description
 */
export function parseTaskTimeWindow(description: string): TimeWindow | undefined {
  if (!description) {
    return undefined;
  }

  // Look for patterns in brackets like [1pm-3pm] or [09:00-12:00]
  const matches = description.match(/\[([^\]]+)\]/g);

  if (!matches) {
    return undefined;
  }

  // Try to parse each bracketed segment as a time window
  for (const match of matches) {
    const timeWindow = parseTimeWindow(match);
    if (timeWindow) {
      return timeWindow;
    }
  }

  return undefined;
}

/**
 * Parse Todoist task into our format with extracted time window
 */
export function parseTask(task: TodoistTask): ParsedTask {
  return {
    id: task.id,
    content: task.content,
    description: task.description,
    timeWindow: parseTaskTimeWindow(task.description),
    due: task.due,
    labels: task.labels,
    priority: task.priority,
    projectId: task.project_id,
    createdAt: task.added_at,
  };
}

/**
 * Remove time window from task description
 * Useful for cleaning up descriptions when creating sessions
 */
export function removeTimeWindowFromDescription(description: string): string {
  if (!description) {
    return '';
  }

  // Remove time window patterns like [1pm-3pm] or [09:00-12:00]
  return description
    .replace(/\[\d{1,2}(am|pm|AM|PM)-\d{1,2}(am|pm|AM|PM)\]/g, '')
    .replace(/\[\d{1,2}:\d{2}-\d{1,2}:\d{2}\]/g, '')
    .trim();
}

/**
 * Extract task name without time window
 */
export function extractTaskName(task: TodoistTask): string {
  return task.content.trim();
}

/**
 * Check if task has a time window in its description
 */
export function hasTimeWindow(task: TodoistTask): boolean {
  return parseTaskTimeWindow(task.description) !== undefined;
}

/**
 * Get task summary for display
 */
export function getTaskSummary(task: TodoistTask): string {
  const parsed = parseTask(task);
  const parts: string[] = [parsed.content];

  if (parsed.timeWindow) {
    parts.push(`[${parsed.timeWindow.start}-${parsed.timeWindow.end}]`);
  }

  if (parsed.priority > 1) {
    parts.push(`(P${parsed.priority})`);
  }

  if (parsed.labels.length > 0) {
    parts.push(`@${parsed.labels.join(', @')}`);
  }

  return parts.join(' ');
}
