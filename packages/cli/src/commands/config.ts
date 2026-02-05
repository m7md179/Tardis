import { success, error, heading, keyValue, dim } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';

interface ConfigOptions {
  todoistToken?: string;
  show?: boolean;
}

/**
 * Show or update configuration
 */
export async function configCommand(options: ConfigOptions = {}): Promise<void> {
  const store = new ConfigStore();

  // Set Todoist token
  if (options.todoistToken) {
    store.setTodoistToken(options.todoistToken);
    console.log(success('✓ Todoist API token updated'));
    console.log(dim('\nTest the connection with: tardis tasks'));
    return;
  }

  // Show configuration
  if (options.show || Object.keys(options).length === 0) {
    const config = store.load();

    console.log(heading('\nTARDIS Configuration'));

    console.log(heading('\nTodoist:'));
    console.log(keyValue('API Token', config.todoist.apiToken ? '***configured***' : 'not set'));
    console.log(keyValue('Sync Interval', `${config.todoist.syncInterval}s`));
    if (config.todoist.projectId) {
      console.log(keyValue('Project ID', config.todoist.projectId));
    }

    console.log(heading('\nStorage:'));
    console.log(keyValue('Type', config.storage.type));
    console.log(keyValue('Archive after', `${config.storage.archiveAfterDays} days`));
    console.log(keyValue('Location', '~/.tardis/'));

    console.log(heading('\nNotifications:'));
    console.log(keyValue('Enabled', config.notifications.enabled ? 'Yes' : 'No'));

    console.log('\n' + dim('To update configuration, use: tardis config --todoist-token <token>'));
    console.log(dim('Or run the setup wizard: tardis setup\n'));
  }
}
