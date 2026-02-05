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
  setupCommand,
  configCommand,
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

// Parse command line arguments
program.parse();
