import { Command } from 'commander';
import { join } from 'path';
import { runAsk } from './commands/ask.js';
import { runPlugins } from './commands/plugins.js';
import { runStatus } from './commands/status.js';
import { runConfigShow } from './commands/config.js';
import { runPluginCreate } from './commands/plugin-create.js';

const DEFAULT_DATA_DIR =
  process.env['TARDIS_DATA_DIR'] ?? join(process.env['HOME'] ?? '/var/lib/tardis', '.tardis');

const program = new Command();

program
  .name('tardis')
  .description('TARDIS v2 — AI assistant CLI')
  .version('2.0.0')
  .option('-d, --data-dir <path>', 'data directory', DEFAULT_DATA_DIR);

// ─── tardis ask "..." ─────────────────────────────────────────────────────────

program
  .command('ask <message>')
  .description('Send a message to the AI assistant')
  .action(async (message: string) => {
    const dataDir = program.opts()['dataDir'] as string;
    try {
      await runAsk(message, dataDir);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── tardis plugins ───────────────────────────────────────────────────────────

program
  .command('plugins')
  .description('List all installed plugins')
  .action(async () => {
    const dataDir = program.opts()['dataDir'] as string;
    try {
      await runPlugins(dataDir);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── tardis status ────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show TARDIS status and configuration summary')
  .action(async () => {
    const dataDir = program.opts()['dataDir'] as string;
    try {
      await runStatus(dataDir);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── tardis config --show ─────────────────────────────────────────────────────

program
  .command('config')
  .description('Manage TARDIS configuration')
  .option('--show', 'display the current configuration')
  .action((opts: { show?: boolean }) => {
    const dataDir = program.opts()['dataDir'] as string;
    if (opts.show) {
      try {
        runConfigShow(dataDir);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    } else {
      program.commands.find((c) => c.name() === 'config')?.help();
    }
  });

// ─── tardis plugin create <name> ──────────────────────────────────────────────

const pluginCmd = program.command('plugin').description('Manage plugins');

pluginCmd
  .command('create <name>')
  .description('Scaffold a new plugin from template')
  .option('-d, --plugins-dir <path>', 'plugins directory')
  .action((name: string, opts: { pluginsDir?: string }) => {
    const dataDir = program.opts()['dataDir'] as string;
    const pluginsDir = opts.pluginsDir ?? join(dataDir, 'plugins');
    runPluginCreate(name, pluginsDir);
  });

program.parse();
