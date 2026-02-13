import { Hono } from 'hono';
import type { PluginManager } from '../../plugins/manager';

export function createPluginRoutes(pluginManager: PluginManager) {
  const router = new Hono();

  // GET /api/plugins - List all plugins (discovered + loaded)
  router.get('/', async (c) => {
    const discovered = await pluginManager.discover();
    const loaded = pluginManager.getAllPlugins();
    const loadedNames = new Set(loaded.map((p) => p.manifest.name));

    const plugins = discovered.map((manifest) => ({
      name: manifest.name,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      enabled: manifest.config.enabled !== false,
      loaded: loadedNames.has(manifest.name),
      hooks: manifest.hooks,
      commands: manifest.commands,
      permissions: manifest.permissions,
    }));

    return c.json({ plugins });
  });

  // POST /api/plugins/:name/run - Run a plugin command
  router.post('/:name/run', async (c) => {
    const { name } = c.req.param();
    const body = await c.req.json();
    const { command, args = [] } = body;

    if (!command) {
      return c.json({ error: 'Missing command' }, 400);
    }

    try {
      await pluginManager.runCommand(name, command, args);
      return c.json({ ok: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  return router;
}
