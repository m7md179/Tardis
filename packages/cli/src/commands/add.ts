import { error, success, warning, keyValue, parseTimeWindow } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';
import { TodoistClient } from '../todoist/client';
import type { CreateTodoistTask } from '@tardis/shared';

interface AddOptions {
  description?: string;
  priority?: string;
  labels?: string;
  due?: string;
}

/**
 * Add a new task to Todoist
 */
export async function addCommand(content: string, options: AddOptions = {}): Promise<void> {
  const configStore = new ConfigStore();

  // Validate Todoist configuration
  if (!configStore.isTodoistConfigured()) {
    console.log(error('Todoist is not configured.'));
    console.log('\nRun: tardis setup');
    process.exit(1);
  }

  // Validate and parse priority
  let priority = 1;
  if (options.priority) {
    const parsedPriority = parseInt(options.priority);
    if (isNaN(parsedPriority) || parsedPriority < 1 || parsedPriority > 4) {
      console.log(error('Invalid priority. Must be between 1 and 4.'));
      console.log('\n  1 = Normal (lowest)');
      console.log('  2 = Medium');
      console.log('  3 = High');
      console.log('  4 = Urgent (highest)');
      process.exit(1);
    }
    priority = parsedPriority;
  }

  // Parse labels
  let labels: string[] = [];
  if (options.labels) {
    labels = options.labels.split(',').map((label) => label.trim());
  }

  // Validate time window in description if present
  if (options.description) {
    const timeWindowMatch = options.description.match(/\[([^\]]+)\]/);
    if (timeWindowMatch) {
      const timeWindow = parseTimeWindow(timeWindowMatch[0]);
      if (!timeWindow) {
        console.log(warning(`Invalid time window format: ${timeWindowMatch[0]}`));
        console.log('  Valid formats: [9am-5pm] or [09:00-17:00]');
        console.log('  Continuing with task creation...\n');
      } else {
        console.log(success('Time window detected: ' + `${timeWindow.start}-${timeWindow.end}`));
      }
    }
  }

  // Build task object
  const taskData: CreateTodoistTask = {
    content,
    description: options.description,
    priority,
    labels: labels.length > 0 ? labels : undefined,
    due_string: options.due,
  };

  try {
    const client = new TodoistClient();
    const task = await client.createTask(taskData);

    console.log(success('Task created successfully\n'));
    console.log(success('Task added to Todoist'));
    console.log(task.content);

    if (task.description) {
      console.log(keyValue('Description', task.description));
    }

    if (task.priority > 1) {
      console.log(keyValue('Priority', `P${task.priority}`));
    }

    if (task.due) {
      console.log(keyValue('Due', task.due.string));
    }

    if (task.labels.length > 0) {
      console.log(keyValue('Labels', task.labels.join(', ')));
    }

    console.log('\nView all tasks: tardis tasks');
    console.log(`Start this task: tardis start "${task.content}"`);
  } catch (err) {
    console.log(error('Failed to create task'));
    console.log(error(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
