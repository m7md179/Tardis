import { TodoistTask, TaskMatch } from '@tardis/shared';
import { TodoistClient } from './client';
import { parseTask, ParsedTask } from './parser';

/**
 * Match type for task search results
 */
export type MatchType = 'exact' | 'prefix' | 'contains';

/**
 * Task match result
 */
export interface TaskMatchResult {
  task: TodoistTask;
  confidence: 'exact' | 'prefix' | 'contains';
}

/**
 * Fuzzy match task query against Todoist tasks
 * Returns matches sorted by match quality (exact > prefix > contains)
 */
export async function matchTask(client: TodoistClient, query: string): Promise<TaskMatchResult[]> {
  const tasks = await client.getTasks();
  const queryLower = query.toLowerCase().trim();
  const matches: TaskMatchResult[] = [];

  // 1. Exact match (case-insensitive)
  for (const task of tasks) {
    if (task.content.toLowerCase() === queryLower) {
      matches.push({ task, confidence: 'exact' });
    }
  }

  if (matches.length > 0) {
    return matches;
  }

  // 2. Prefix match
  for (const task of tasks) {
    if (task.content.toLowerCase().startsWith(queryLower)) {
      matches.push({ task, confidence: 'prefix' });
    }
  }

  if (matches.length > 0) {
    return matches;
  }

  // 3. Contains match
  for (const task of tasks) {
    if (task.content.toLowerCase().includes(queryLower)) {
      matches.push({ task, confidence: 'contains' });
    }
  }

  return matches;
}

/**
 * Find best match for a task query
 * Returns null if no match or throws error if multiple matches
 */
export async function findBestMatch(
  client: TodoistClient,
  query: string
): Promise<ParsedTask | null> {
  const matches = await matchTask(client, query);

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  // Multiple matches - throw error with suggestions
  throw new Error(
    `Multiple tasks match "${query}":\n${matches.map((t, i) => `  ${i + 1}. ${t.content}`).join('\n')}\nPlease be more specific.`
  );
}

/**
 * Match tasks with detailed match information
 */
export async function matchTasksWithDetails(
  client: TodoistClient,
  query: string
): Promise<TaskMatch[]> {
  const tasks = await client.getTasks();
  const queryLower = query.toLowerCase().trim();
  const matches: TaskMatch[] = [];

  for (const task of tasks) {
    const contentLower = task.content.toLowerCase();
    let matchType: MatchType | null = null;
    let confidence = 0;

    // Exact match
    if (contentLower === queryLower) {
      matchType = 'exact';
      confidence = 1.0;
    }
    // Prefix match
    else if (contentLower.startsWith(queryLower)) {
      matchType = 'prefix';
      // Confidence based on how much of the string matches
      confidence = queryLower.length / contentLower.length;
    }
    // Contains match
    else if (contentLower.includes(queryLower)) {
      matchType = 'contains';
      // Lower confidence for contains matches
      confidence = (queryLower.length / contentLower.length) * 0.7;
    }

    if (matchType) {
      matches.push({
        task,
        matchType,
        confidence,
      });
    }
  }

  // Sort by confidence (highest first)
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get all tasks with time windows
 */
export async function getTasksWithTimeWindows(client: TodoistClient): Promise<ParsedTask[]> {
  const tasks = await client.getTasks();
  const parsedTasks = tasks.map(parseTask);

  return parsedTasks.filter((task) => task.timeWindow !== undefined);
}

/**
 * Get tasks for a specific label
 */
export async function getTasksByLabel(client: TodoistClient, label: string): Promise<ParsedTask[]> {
  const tasks = await client.getTasks();
  const parsedTasks = tasks.map(parseTask);

  const labelLower = label.toLowerCase();
  return parsedTasks.filter((task) =>
    task.labels.some((l) => l.toLowerCase() === labelLower)
  );
}

/**
 * Get high priority tasks (priority 3 or 4)
 */
export async function getHighPriorityTasks(client: TodoistClient): Promise<ParsedTask[]> {
  const tasks = await client.getTasks();
  const parsedTasks = tasks.map(parseTask);

  return parsedTasks.filter((task) => task.priority >= 3);
}
