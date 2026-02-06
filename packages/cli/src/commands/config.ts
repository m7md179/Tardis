import { success, error, heading, keyValue, dim } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';

interface ConfigOptions {
  todoistToken?: string;
  serverUrl?: string;
  apiKey?: string;
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

  // Set server URL
  if (options.serverUrl) {
    const config = store.load();
    if (!config.server) {
      config.server = {};
    }
    config.server.url = options.serverUrl;
    store.save(config);
    console.log(success('✓ Server URL updated'));
    console.log(dim('\nSet your API key with: tardis config --api-key <key>'));
    return;
  }

  // Set API key
  if (options.apiKey) {
    const config = store.load();
    if (!config.server) {
      config.server = {};
    }
    config.server.apiKey = options.apiKey;

    // Try to authenticate and get JWT
    try {
      const { ServerClient } = await import('../api/client');
      const client = new ServerClient();
      await client.authenticate(options.apiKey);
      console.log(success('✓ API key configured and authenticated'));
      console.log(dim('\nTest the connection with: tardis status'));
    } catch (err) {
      console.log(error('Failed to authenticate with server'));
      console.log(dim('API key saved, but authentication failed. Check your server URL.'));
    }
    return;
  }

  // Show configuration
  if (options.show || Object.keys(options).length === 0) {
    const config = store.load();

    console.log(heading('\nTARDIS Configuration'));

    console.log(heading('\nServer:'));
    if (config.server?.url) {
      console.log(keyValue('URL', config.server.url));
      console.log(keyValue('API Key', config.server.apiKey ? '***configured***' : 'not set'));
      console.log(keyValue('Authenticated', config.server.token ? 'Yes' : 'No'));
    } else {
      console.log(dim('Not configured (local mode)'));
    }

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

    console.log('\n' + dim('Configuration options:'));
    console.log(dim('  --server-url <url>     Set TARDIS server URL'));
    console.log(dim('  --api-key <key>        Set server API key'));
    console.log(dim('  --todoist-token <token>  Set Todoist API token'));
    console.log(dim('  --show                 Show current configuration'));
    console.log(dim('\nOr run the setup wizard: tardis setup\n'));
  }
}
