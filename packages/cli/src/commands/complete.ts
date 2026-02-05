import { success, error, formatTaskName } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';
import { TodoistClient, findBestMatch, parseTask } from '../todoist';
import { spinner, selectTask } from '../ui';

/**
 * Mark a task as complete in Todoist
 */
export async function completeCommand(taskQuery?: string): Promise<void> {
  const configStore = new ConfigStore();

  if (!configStore.isTodoistConfigured()) {
    console.log(error('Todoist is not configured.'));
    console.log(`\nRun: tardis setup`);
    process.exit(1);
  }

  if (!taskQuery) {
    console.log(error('Please specify a task name.'));
    console.log(`\nUsage: tardis complete "<task name>"`);
    process.exit(1);
  }

  const spin = spinner('Searching for task in Todoist...').start();

  try {
    const client = new TodoistClient();
    const match = await findBestMatch(client, taskQuery);

    if (!match) {
      spin.warn('No matching task found');
      console.log(error(`No task found matching: "${taskQuery}"`));
      console.log(`\nView available tasks with: tardis tasks`);
      process.exit(1);
    }

    spin.text(`Completing task: ${match.content}`);

    await client.completeTask(match.id);

    spin.succeed('Task completed in Todoist');
    console.log(success(`✓ ${formatTaskName(match.content)}`));
  } catch (err) {
    spin.fail('Failed to complete task');

    if (err instanceof Error && err.message.includes('Multiple tasks')) {
      // Multiple matches - extract task names and show picker
      console.log(error(err.message));
      console.log(`\nPlease be more specific with the task name.`);
    } else {
      console.log(error(err instanceof Error ? err.message : String(err)));
    }

    process.exit(1);
  }
}
