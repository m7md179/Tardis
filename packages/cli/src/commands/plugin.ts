import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { TARDIS_DIR } from '../storage/constants';
import { heading, error as errorStyle, success, warning } from '@tardis/shared';
import { PluginManifestSchema } from '@tardis/shared';
import type { PluginManifest } from '@tardis/shared';
import { withSpinner } from '../ui';
import { ServerClient } from '../api/client';

const PLUGINS_DIR = join(TARDIS_DIR, 'plugins');

function ensurePluginsDir(): void {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

function loadManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return PluginManifestSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function getInstalledPlugins(): { name: string; manifest: PluginManifest }[] {
  ensurePluginsDir();

  const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const plugins: { name: string; manifest: PluginManifest }[] = [];

  for (const dir of dirs) {
    const manifest = loadManifest(join(PLUGINS_DIR, dir));
    if (manifest) {
      plugins.push({ name: dir, manifest });
    }
  }

  return plugins;
}

/**
 * tardis plugin list
 * Queries the server for plugins. Falls back to local filesystem if server is unavailable.
 */
export async function pluginListCommand(): Promise<void> {
  const client = new ServerClient();

  if (client.isConfigured()) {
    try {
      const online = await client.isOnline();
      if (online) {
        const plugins = await client.listPlugins();

        if (plugins.length === 0) {
          console.log('No plugins installed on the server.');
          console.log(`\nAdd plugins to the repo's plugins/ directory and deploy.`);
          return;
        }

        console.log(heading(`\nServer Plugins (${plugins.length})`));
        console.log('');

        for (const plugin of plugins) {
          const status = plugin.enabled
            ? plugin.loaded
              ? success('loaded')
              : warning('enabled (not loaded)')
            : warning('disabled');
          const cmds = plugin.commands.map((c: any) => c.name).join(', ') || 'none';
          const hooks = plugin.hooks.join(', ') || 'none';

          console.log(`  ${plugin.displayName} v${plugin.version} [${status}]`);
          console.log(`    ${plugin.description || ''}`);
          console.log(`    Commands: ${cmds}`);
          console.log(`    Hooks: ${hooks}`);
          console.log('');
        }
        return;
      }
    } catch {
      // Fall through to local
    }
  }

  // Fallback: local filesystem
  const plugins = getInstalledPlugins();

  if (plugins.length === 0) {
    console.log('No plugins installed locally.');
    console.log(`\nInstall one with: tardis plugin install <git-url>`);
    console.log(`Or deploy to the server with: ./scripts/deploy.sh`);
    return;
  }

  console.log(heading(`\nLocal Plugins (${plugins.length})`));
  console.log(warning('(Showing local plugins — server not available)'));
  console.log('');

  for (const { manifest } of plugins) {
    const enabled = manifest.config.enabled !== false;
    const status = enabled ? success('enabled') : warning('disabled');
    const cmds = manifest.commands.map((c) => {
      const cmdArgs = c.args ? ` ${c.args}` : '';
      return `${c.name}${cmdArgs}`;
    }).join(', ') || 'none';
    const hooks = manifest.hooks.join(', ') || 'none';

    console.log(`  ${manifest.displayName} v${manifest.version} [${status}]`);
    console.log(`    ${manifest.description || ''}`);
    console.log(`    Commands: ${cmds}, help`);
    console.log(`    Hooks: ${hooks}`);
    console.log('');
  }
}

/**
 * tardis plugin install <git-url>
 */
export async function pluginInstallCommand(gitUrl: string): Promise<void> {
  ensurePluginsDir();

  // Extract plugin name from git URL
  const urlParts = gitUrl.replace(/\.git$/, '').split('/');
  const repoName = urlParts[urlParts.length - 1] || 'unknown-plugin';

  // Remove common prefixes
  const pluginName = repoName
    .replace(/^tardis-plugin-/, '')
    .replace(/^tardis-/, '');

  const pluginDir = join(PLUGINS_DIR, pluginName);

  if (existsSync(pluginDir)) {
    console.log(errorStyle(`Plugin "${pluginName}" is already installed.`));
    console.log(`To update: tardis plugin update ${pluginName}`);
    console.log(`To reinstall: tardis plugin uninstall ${pluginName} && tardis plugin install ${gitUrl}`);
    return;
  }

  await withSpinner(`Cloning ${repoName}`, async () => {
    execSync(`git clone ${gitUrl} ${pluginDir}`, { stdio: 'pipe' });
  });

  // Validate manifest
  const manifest = loadManifest(pluginDir);
  if (!manifest) {
    console.log(errorStyle('Invalid plugin: no valid plugin.json found'));
    rmSync(pluginDir, { recursive: true });
    return;
  }

  // Install dependencies if package.json exists
  if (existsSync(join(pluginDir, 'package.json'))) {
    await withSpinner('Installing dependencies', async () => {
      execSync('bun install', { cwd: pluginDir, stdio: 'pipe' });
    });
  }

  console.log(success(`\nInstalled: ${manifest.displayName} v${manifest.version}`));
  console.log(`Restart the TARDIS server to activate the plugin.`);
}

/**
 * tardis plugin uninstall <name>
 */
export async function pluginUninstallCommand(name: string): Promise<void> {
  const pluginDir = join(PLUGINS_DIR, name);

  if (!existsSync(pluginDir)) {
    console.log(errorStyle(`Plugin "${name}" is not installed.`));
    return;
  }

  rmSync(pluginDir, { recursive: true });
  console.log(success(`Uninstalled: ${name}`));
  console.log(`Restart the TARDIS server to apply changes.`);
}

/**
 * tardis plugin enable <name>
 */
export async function pluginEnableCommand(name: string): Promise<void> {
  const pluginDir = join(PLUGINS_DIR, name);
  const manifestPath = join(pluginDir, 'plugin.json');

  if (!existsSync(manifestPath)) {
    console.log(errorStyle(`Plugin "${name}" is not installed.`));
    return;
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);
  manifest.config = manifest.config || {};
  manifest.config.enabled = true;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(success(`Enabled: ${name}`));
  console.log(`Restart the TARDIS server to apply changes.`);
}

/**
 * tardis plugin disable <name>
 */
export async function pluginDisableCommand(name: string): Promise<void> {
  const pluginDir = join(PLUGINS_DIR, name);
  const manifestPath = join(pluginDir, 'plugin.json');

  if (!existsSync(manifestPath)) {
    console.log(errorStyle(`Plugin "${name}" is not installed.`));
    return;
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);
  manifest.config = manifest.config || {};
  manifest.config.enabled = false;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(warning(`Disabled: ${name}`));
  console.log(`Restart the TARDIS server to apply changes.`);
}

/**
 * tardis plugin update <name>
 */
export async function pluginUpdateCommand(name: string): Promise<void> {
  if (name === '--all') {
    const plugins = getInstalledPlugins();
    for (const { name: pName } of plugins) {
      await pluginUpdateSingle(pName);
    }
    return;
  }

  await pluginUpdateSingle(name);
}

async function pluginUpdateSingle(name: string): Promise<void> {
  const pluginDir = join(PLUGINS_DIR, name);

  if (!existsSync(pluginDir)) {
    console.log(errorStyle(`Plugin "${name}" is not installed.`));
    return;
  }

  // Check if it's a git repo
  if (!existsSync(join(pluginDir, '.git'))) {
    console.log(warning(`Plugin "${name}" is not a git repository. Cannot update.`));
    return;
  }

  await withSpinner(`Updating ${name}`, async () => {
    execSync('git pull', { cwd: pluginDir, stdio: 'pipe' });

    if (existsSync(join(pluginDir, 'package.json'))) {
      execSync('bun install', { cwd: pluginDir, stdio: 'pipe' });
    }
  });

  const manifest = loadManifest(pluginDir);
  console.log(success(`Updated: ${name} v${manifest?.version || '?'}`));
}

/**
 * tardis plugin run <name> <command> [...args]
 * Executes the command on the server via API.
 */
export async function pluginRunCommand(name: string, command: string, args: string[]): Promise<void> {
  // Handle help locally — doesn't need a running server
  if (command === 'help') {
    const pluginDir = join(PLUGINS_DIR, name);
    const manifest = loadManifest(pluginDir);
    if (!manifest) {
      console.log(errorStyle(`Plugin "${name}" not found.`));
      return;
    }
    console.log(heading(`\n${manifest.displayName} v${manifest.version}`));
    if (manifest.description) console.log(`  ${manifest.description}`);
    console.log('');
    console.log(heading('Commands:'));
    for (const cmd of manifest.commands) {
      const cmdArgs = cmd.args ? ` ${cmd.args}` : '';
      console.log(`  ${cmd.name}${cmdArgs}  ${cmd.description || ''}`);
    }
    console.log(`  help  Show this help`);
    if (manifest.hooks.length > 0) {
      console.log('');
      console.log(heading('Hooks:'));
      console.log(`  ${manifest.hooks.join(', ')}`);
    }
    const configKeys = Object.keys(manifest.config).filter((k) => k !== 'enabled');
    if (configKeys.length > 0) {
      console.log('');
      console.log(heading('Config keys:'));
      console.log(`  ${configKeys.join(', ')}`);
    }
    console.log('');
    console.log(`Usage: tardis plugin ${name} <command> [args]`);
    console.log('');
    return;
  }

  const client = new ServerClient();

  if (!client.isConfigured()) {
    console.log(errorStyle('Server not configured. Run: tardis config --server-url <url>'));
    return;
  }

  const online = await client.isOnline();
  if (!online) {
    console.log(errorStyle('Server is not running. Start it first.'));
    return;
  }

  try {
    await client.runPluginCommand(name, command, args);
    console.log(success(`Ran ${name}:${command}`));
  } catch (error: any) {
    console.log(errorStyle(error.message));
  }
}

/**
 * tardis plugin create <name>
 */
export async function pluginCreateCommand(name: string): Promise<void> {
  ensurePluginsDir();

  const pluginDir = join(PLUGINS_DIR, name);

  if (existsSync(pluginDir)) {
    console.log(errorStyle(`Directory already exists: ${pluginDir}`));
    return;
  }

  mkdirSync(pluginDir, { recursive: true });

  // Create plugin.json
  const manifest = {
    name,
    version: '1.0.0',
    displayName: name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    description: `A TARDIS plugin`,
    tardisVersion: '>=2.0.0',
    main: 'index.ts',
    permissions: ['sessions:read'],
    hooks: ['session:start'],
    commands: [
      {
        name: 'hello',
        args: '[name]',
        description: 'Say hello',
      },
    ],
    config: {
      enabled: true,
    },
  };

  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2));

  // Create index.ts
  const indexContent = `import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

const plugin: TardisPlugin = {
  name: '${name}',
  version: '1.0.0',

  async onActivate(api: PluginAPI) {
    api.logger.info('${manifest.displayName} activated!');
  },

  async onSessionStart(session: Session, api: PluginAPI) {
    api.logger.info(\`Session started: \${session.taskName}\`);
  },

  commands: {
    async hello(args: string[], api: PluginAPI) {
      api.logger.info('Hello from ${manifest.displayName}!');
    },
  },
};

export default plugin;
`;

  writeFileSync(join(pluginDir, 'index.ts'), indexContent);

  console.log(success(`\nCreated plugin: ${name}`));
  console.log(`  ${pluginDir}/`);
  console.log(`  ├── plugin.json`);
  console.log(`  └── index.ts`);
  console.log(`\nEdit index.ts to add your plugin logic.`);
  console.log(`Restart the TARDIS server to load the plugin.`);
}
