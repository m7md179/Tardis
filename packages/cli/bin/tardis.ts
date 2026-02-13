#!/usr/bin/env bun
import { Command } from 'commander';
import {
  startCommand,
  stopCommand,
  pauseCommand,
  resumeCommand,
  statusCommand,
  listCommand,
  logCommand,
  deleteCommand,
  wipeCommand,
  tasksCommand,
  syncCommand,
  completeCommand,
  addCommand,
  setupCommand,
  configCommand,
  pluginListCommand,
  pluginInstallCommand,
  pluginUninstallCommand,
  pluginEnableCommand,
  pluginDisableCommand,
  pluginUpdateCommand,
  pluginRunCommand,
  pluginCreateCommand,
} from '../src/commands';

const program = new Command();

program
  .name('tardis')
  .description('TARDIS - Time tracking CLI that syncs with Todoist')
  .version('2.0.0');

// Session management commands
program
  .command('start <task>')
  .description('Start tracking a task')
  .option('-t, --time-window <window>', 'Time window (e.g., [9am-5pm])')
  .action(async (task, options) => {
    try {
      await startCommand(task, options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('stop [task]')
  .description('Stop tracking a task (uses current session if task not specified)')
  .option('--no-sync', 'Skip syncing to Todoist')
  .action(async (task, options) => {
    try {
      await stopCommand(task, options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('pause [task]')
  .description('Pause a task (uses current session if task not specified)')
  .action(async (task) => {
    try {
      await pauseCommand(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('resume [task]')
  .description('Resume a paused task')
  .action(async (task) => {
    try {
      await resumeCommand(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('status [task]')
  .description('Show status of current or specific task')
  .action(async (task) => {
    try {
      await statusCommand(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('List all active sessions')
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// History and logging
program
  .command('log [date]')
  .description('View session logs (default: today, "all" for all history)')
  .action(async (date) => {
    try {
      await logCommand(date);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Data management
program
  .command('delete <task>')
  .description('Delete a session by task name')
  .action(async (task) => {
    try {
      await deleteCommand(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('wipe')
  .description('Delete all sessions (requires confirmation)')
  .action(async () => {
    try {
      await wipeCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Todoist integration
program
  .command('tasks')
  .description('View tasks from Todoist')
  .option('--tomorrow', 'Show tomorrow\'s tasks')
  .option('--week', 'Show this week\'s tasks')
  .action(async (options) => {
    try {
      await tasksCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Manually sync with Todoist')
  .action(async () => {
    try {
      await syncCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('complete [task]')
  .description('Mark task as complete in Todoist')
  .action(async (task) => {
    try {
      await completeCommand(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('add <content>')
  .description('Add a new task to Todoist')
  .option('-d, --description <text>', 'Task description (supports [HH:MM-HH:MM] time windows)')
  .option('-p, --priority <level>', 'Priority level (1-4, default: 1)', '1')
  .option('-l, --labels <labels>', 'Comma-separated labels')
  .option('--due <date>', 'Due date (natural language or YYYY-MM-DD)')
  .action(async (content, options) => {
    try {
      await addCommand(content, options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Configuration
program
  .command('setup')
  .description('Run interactive setup wizard')
  .action(async () => {
    try {
      await setupCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show or update configuration')
  .option('--server-url <url>', 'Set TARDIS server URL')
  .option('--api-key <key>', 'Set server API key')
  .option('--todoist-token <token>', 'Set Todoist API token')
  .option('--show', 'Show current configuration')
  .action(async (options) => {
    try {
      await configCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Plugin management
const pluginCmd = program
  .command('plugin')
  .description('Manage TARDIS plugins');

pluginCmd
  .command('list')
  .description('List installed plugins')
  .action(async () => {
    try {
      await pluginListCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('install <git-url>')
  .description('Install a plugin from a git repository')
  .action(async (gitUrl) => {
    try {
      await pluginInstallCommand(gitUrl);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('uninstall <name>')
  .description('Uninstall a plugin')
  .action(async (name) => {
    try {
      await pluginUninstallCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('enable <name>')
  .description('Enable a plugin')
  .action(async (name) => {
    try {
      await pluginEnableCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('disable <name>')
  .description('Disable a plugin')
  .action(async (name) => {
    try {
      await pluginDisableCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('update <name>')
  .description('Update a plugin (use --all to update all)')
  .action(async (name) => {
    try {
      await pluginUpdateCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('run <name> <command> [args...]')
  .description('Run a plugin command')
  .action(async (name, command, args) => {
    try {
      await pluginRunCommand(name, command, args);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

pluginCmd
  .command('create <name>')
  .description('Scaffold a new plugin from template')
  .action(async (name) => {
    try {
      await pluginCreateCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Catch-all: `tardis plugin <name> <command> [args...]` → delegates to `plugin run`
// This allows `tardis plugin gemini-assistant config apiKey X` as shorthand
pluginCmd.on('command:*', async (operands: string[]) => {
  const [name, command, ...args] = operands;
  if (name && command) {
    try {
      await pluginRunCommand(name, command, args);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    console.error(`Usage: tardis plugin <name> <command> [args...]`);
    console.error(`Or:    tardis plugin run <name> <command> [args...]`);
    process.exit(1);
  }
});

// Parse command line arguments
program.parse();
