import { success, error, heading, keyValue, dim, code } from '@tardis/shared';
import { isValidTodoistToken } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';
import { TodoistClient } from '../todoist';
import { input, confirm, spinner } from '../ui';

/**
 * Interactive setup wizard for TARDIS configuration
 */
export async function setupCommand(): Promise<void> {
  console.log(heading('\n🚀 TARDIS Setup Wizard\n'));

  const configStore = new ConfigStore();
  const existingConfig = configStore.exists();

  if (existingConfig) {
    console.log(dim('Existing configuration found.'));
    const reconfigure = await confirm('Do you want to reconfigure?', false);

    if (!reconfigure) {
      console.log('Setup cancelled.');
      process.exit(0);
    }
  }

  // Todoist API Token
  console.log(heading('\nTodoist Integration'));
  console.log('\nTo integrate with Todoist, you need an API token.');
  console.log(dim('Get your token from:'));
  console.log(code('https://todoist.com/app/settings/integrations/developer\n'));

  let apiToken = '';
  let tokenValid = false;

  while (!tokenValid) {
    apiToken = await input('Enter your Todoist API token (or skip to use offline):');

    if (!apiToken.trim()) {
      const skipTodoist = await confirm('Skip Todoist integration?', false);
      if (skipTodoist) {
        console.log(dim('\nSkipping Todoist integration. You can configure it later.'));
        break;
      }
      continue;
    }

    // Validate token format
    if (!isValidTodoistToken(apiToken)) {
      console.log(error('Invalid token format. Token should be 40 hexadecimal characters.'));
      continue;
    }

    // Test token by making API call
    const spin = spinner('Validating token...').start();

    try {
      const client = new TodoistClient(apiToken);
      await client.getTasks();
      spin.succeed('Token is valid!');
      tokenValid = true;
    } catch (err) {
      spin.fail('Token validation failed');
      console.log(error('Could not connect to Todoist with this token.'));
      console.log(dim('Please check your token and try again.\n'));
    }
  }

  // Save configuration
  const config = {
    todoist: {
      apiToken: apiToken || '',
      syncInterval: 300,
    },
    notifications: {
      enabled: false,
      channels: {},
      events: {
        timeWindowStart: true,
        timeWindowEnd: true,
        taskOverdue: true,
      },
    },
    storage: {
      type: 'json' as const,
      archiveAfterDays: 30,
    },
  };

  configStore.save(config);

  console.log('\n' + success('✓ Configuration saved!'));

  // Show configuration summary
  console.log(heading('\nConfiguration Summary:'));
  console.log(keyValue('Todoist', apiToken ? 'Configured' : 'Not configured'));
  console.log(keyValue('Storage', '~/.tardis/'));
  console.log(keyValue('Archive retention', '30 days'));

  console.log(heading('\nNext Steps:'));
  console.log('  1. Start a session:  ' + code('tardis start "task name"'));
  console.log('  2. View your tasks:  ' + code('tardis tasks'));
  console.log('  3. Check status:     ' + code('tardis status'));
  console.log('  4. Get help:         ' + code('tardis --help'));

  console.log('\n' + success('Setup complete! 🎉\n'));
}
