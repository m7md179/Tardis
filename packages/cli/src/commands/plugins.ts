import { loadConfig, PluginManager, createPluginApi } from '@tardis/core';
import { createDb, migrate } from '@tardis/db';
import { join } from 'path';

/**
 * List all loaded plugins with their tier, name, and skill summary.
 * Used by `tardis plugins`.
 */
export async function runPlugins(dataDir: string): Promise<void> {
  const config = loadConfig(dataDir);
  const dbPath = join(dataDir, 'tardis.db');
  migrate(dbPath);
  const db = createDb(dbPath);

  const pluginsDir = join(dataDir, 'plugins');
  const pluginManager = new PluginManager(pluginsDir, (manifest) =>
    createPluginApi({ pluginName: manifest.name, permissions: manifest.permissions, db, config })
  );
  await pluginManager.loadAll();

  const manifests = pluginManager.getAllManifests();

  if (manifests.length === 0) {
    console.log('No plugins loaded.');
    console.log(`Plugin directory: ${pluginsDir}`);
    return;
  }

  console.log(`Loaded plugins (${manifests.length}):\n`);
  for (const m of manifests) {
    const tierLabel = `Tier ${m.tier}`;
    console.log(`  ${m.displayName} (${m.name})  [${tierLabel}]`);
    console.log(`    ${m.summary}`);
    console.log(`    Tools: ${m.tools.map((t) => t.name).join(', ') || '(none)'}`);
    console.log();
  }
}
