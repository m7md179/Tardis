import { error, heading, formatTaskName, dim, keyValue, formatDueDate } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';
import { TodoistClient, parseTask, getTasksWithTimeWindows } from '../todoist';
import { spinner, table } from '../ui';
import type { TableColumn } from '../ui';

interface TasksOptions {
  tomorrow?: boolean;
  week?: boolean;
}

/**
 * View tasks from Todoist
 */
export async function tasksCommand(options: TasksOptions = {}): Promise<void> {
  const configStore = new ConfigStore();

  if (!configStore.isTodoistConfigured()) {
    console.log(error('Todoist is not configured.'));
    console.log(`\nRun: tardis setup`);
    process.exit(1);
  }

  const spin = spinner('Fetching tasks from Todoist...').start();

  try {
    const client = new TodoistClient();
    const tasks = await client.getTasks();

    spin.succeed(`Found ${tasks.length} tasks`);

    if (tasks.length === 0) {
      console.log('\nNo tasks found in Todoist.');
      process.exit(0);
    }

    // Parse all tasks
    const parsedTasks = tasks.map(parseTask);

    // Filter based on options
    let filteredTasks = parsedTasks;

    if (options.tomorrow || options.week) {
      // Filter tasks with time windows
      const tasksWithWindows = await getTasksWithTimeWindows(client);
      filteredTasks = tasksWithWindows;

      if (filteredTasks.length === 0) {
        console.log('\nNo tasks with time windows found.');
        console.log(dim('Add time windows to task descriptions like: [9am-5pm]'));
        process.exit(0);
      }
    }

    // Display tasks in table
    console.log(heading(`\nTodoist Tasks (${filteredTasks.length})`));

    type TaskRow = {
      content: string;
      dueDate: string;
      timeWindow: string;
      priority: string;
      labels: string;
    };

    const taskTable = table<TaskRow>([
      {
        header: 'Task',
        formatter: (row) => formatTaskName(row.content),
        align: 'left',
      },
      {
        header: 'Due Date',
        key: 'dueDate',
        align: 'center',
        width: 12,
      },
      {
        header: 'Time Window',
        key: 'timeWindow',
        align: 'center',
        width: 15,
      },
      {
        header: 'Priority',
        key: 'priority',
        align: 'center',
        width: 8,
      },
      {
        header: 'Labels',
        formatter: (row) => dim(row.labels),
        align: 'left',
      },
    ]);

    for (const task of filteredTasks) {
      const timeWindowStr = task.timeWindow
        ? `${task.timeWindow.start}-${task.timeWindow.end}`
        : '-';

      const priorityStr = task.priority > 1 ? `P${task.priority}` : '-';

      const labelsStr = task.labels.length > 0 ? task.labels.join(', ') : '-';

      const dueDateStr = formatDueDate(task.due);

      taskTable.addRow({
        content: task.content,
        dueDate: dueDateStr,
        timeWindow: timeWindowStr,
        priority: priorityStr,
        labels: labelsStr,
      });
    }

    taskTable.print();

    console.log(dim(`\nStart a task with: tardis start "<task name>"`));
  } catch (err) {
    spin.fail('Failed to fetch tasks');
    console.log(error(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
