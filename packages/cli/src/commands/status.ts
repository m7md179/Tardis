import { loadConfig, PluginManager, createPluginApi } from '@tardis/core';
import { createDb, migrate } from '@tardis/db';
import { join } from 'path';

/**
 * Print a quick status overview: config summary, loaded plugins, DB path.
 * Used by `tardis status`.
 */
export async function runStatus(dataDir: string): Promise<void> {
  // Config
  let config;
  try {
    config = loadConfig(dataDir);
  } catch {
    console.log('TARDIS Status\n');
    console.log(`  Data dir : ${dataDir}`);
    console.log('  Config   : not found or invalid');
    return;
  }

  // DB
  const dbPath = join(dataDir, 'tardis.db');
  migrate(dbPath);
  const db = createDb(dbPath);
  void db;

  // Plugins
  const pluginsDir = join(dataDir, 'plugins');
  const pluginManager = new PluginManager(pluginsDir, (manifest) =>
    createPluginApi({ pluginName: manifest.name, permissions: manifest.permissions, db, config })
  );
  await pluginManager.loadAll();
  const manifests = pluginManager.getAllManifests();

  console.log('TARDIS Status\n');
  console.log(`  Data dir   : ${dataDir}`);
  console.log(`  LLM        : ${config.llm.provider} / ${config.llm.model}`);
  console.log(`  Base URL   : ${config.llm.baseUrl ?? '(default)'}`);
  console.log(`  Max steps  : ${config.agent.maxSteps}`);
  console.log(`  DB         : ${dbPath}`);
  console.log(`  Plugins    : ${manifests.length} loaded`);

  if (manifests.length > 0) {
    for (const m of manifests) {
      console.log(`    - ${m.name} v${m.version}`);
    }
  }
}
