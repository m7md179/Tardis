import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  type TardisPlugin,
  type PluginManifest,
  type LoadedPlugin,
  type PluginAPI,
  PluginManifestSchema,
} from '@tardis/shared';
import type { SessionManager } from '../core/session-manager';
import type { TodoistClient } from '../integrations/todoist/client';
import type { NotificationService } from '../integrations/notifications/service';
import { EventBus } from './event-bus';
import { PluginStorage } from './storage';
import { createPluginAPI } from './api';

const HOOK_TO_METHOD: Record<string, keyof TardisPlugin> = {
  'session:start': 'onSessionStart',
  'session:stop': 'onSessionStop',
  'session:pause': 'onSessionPause',
  'session:resume': 'onSessionResume',
  'task:sync': 'onTaskSync',
  'notification:send': 'onNotificationSend',
};

export interface PluginManagerOptions {
  pluginsDir: string;
  sessionManager: SessionManager;
  todoistClient: TodoistClient;
  notificationService: NotificationService;
}

/**
 * Manages plugin discovery, loading, lifecycle, and event dispatch.
 */
export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();
  private eventBus = new EventBus();
  private pluginsDir: string;
  private sessionManager: SessionManager;
  private todoistClient: TodoistClient;
  private notificationService: NotificationService;

  constructor(options: PluginManagerOptions) {
    this.pluginsDir = options.pluginsDir;
    this.sessionManager = options.sessionManager;
    this.todoistClient = options.todoistClient;
    this.notificationService = options.notificationService;
  }

  /**
   * Discover all plugins by scanning the plugins directory for plugin.json manifests
   */
  async discover(): Promise<PluginManifest[]> {
    if (!existsSync(this.pluginsDir)) {
      console.log(`[PluginManager] Plugins directory not found: ${this.pluginsDir}`);
      return [];
    }

    const dirs = readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const manifests: PluginManifest[] = [];

    for (const dir of dirs) {
      const manifestPath = join(this.pluginsDir, dir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = readFileSync(manifestPath, 'utf-8');
        const manifest = PluginManifestSchema.parse(JSON.parse(raw));
        manifests.push(manifest);
      } catch (error) {
        console.error(`[PluginManager] Invalid manifest in ${dir}:`, error);
      }
    }

    return manifests;
  }

  /**
   * Load and activate a single plugin by name
   */
  async loadPlugin(name: string): Promise<void> {
    if (this.plugins.has(name)) {
      console.warn(`[PluginManager] Plugin already loaded: ${name}`);
      return;
    }

    const pluginPath = join(this.pluginsDir, name);
    const manifestPath = join(pluginPath, 'plugin.json');

    if (!existsSync(manifestPath)) {
      throw new Error(`Plugin manifest not found: ${manifestPath}`);
    }

    // Parse and validate manifest
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = PluginManifestSchema.parse(JSON.parse(raw));

    // Import plugin module
    const mainPath = join(pluginPath, manifest.main);
    const pluginModule = await import(mainPath);
    const plugin: TardisPlugin = pluginModule.default;

    if (!plugin || typeof plugin !== 'object') {
      throw new Error(`Plugin ${name} does not export a valid default object`);
    }

    // Create storage and API for this plugin
    const storage = new PluginStorage(this.pluginsDir, name);
    const api = createPluginAPI({
      pluginName: name,
      manifest,
      sessionManager: this.sessionManager,
      todoistClient: this.todoistClient,
      notificationService: this.notificationService,
      storage,
      eventBus: this.eventBus,
    });

    // Load persisted config overrides
    const savedConfig = await storage.get<Record<string, unknown>>('_plugin_config');
    if (savedConfig) {
      Object.assign(manifest.config, savedConfig);
    }

    // Activate plugin
    try {
      if (plugin.onActivate) {
        await plugin.onActivate(api);
      }
    } catch (error) {
      console.error(`[PluginManager] Failed to activate ${name}:`, error);
      throw error;
    }

    // Register event hooks
    for (const hook of manifest.hooks) {
      const methodName = HOOK_TO_METHOD[hook];
      if (!methodName) continue;

      const handler = plugin[methodName];
      if (typeof handler !== 'function') continue;

      this.eventBus.on(hook, name, async (data: unknown) => {
        try {
          await (handler as Function).call(plugin, data, api);
        } catch (error) {
          console.error(`[PluginManager] Hook error ${name}.${methodName}:`, error);
        }
      });
    }

    this.plugins.set(name, { manifest, instance: plugin, api });
    console.log(`[PluginManager] Loaded: ${manifest.displayName} v${manifest.version}`);
  }

  /**
   * Unload and deactivate a plugin
   */
  async unloadPlugin(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new Error(`Plugin not loaded: ${name}`);
    }

    try {
      if (loaded.instance.onDeactivate) {
        await loaded.instance.onDeactivate();
      }
    } catch (error) {
      console.error(`[PluginManager] Error deactivating ${name}:`, error);
    }

    this.eventBus.removeAllListeners(name);
    this.plugins.delete(name);
    console.log(`[PluginManager] Unloaded: ${name}`);
  }

  /**
   * Discover and load all enabled plugins
   */
  async loadAll(): Promise<void> {
    const manifests = await this.discover();
    console.log(`[PluginManager] Discovered ${manifests.length} plugin(s)`);

    for (const manifest of manifests) {
      if (manifest.config.enabled === false) {
        console.log(`[PluginManager] Skipping disabled plugin: ${manifest.name}`);
        continue;
      }

      try {
        await this.loadPlugin(manifest.name);
      } catch (error) {
        console.error(`[PluginManager] Failed to load ${manifest.name}:`, error);
      }
    }
  }

  /**
   * Emit an event to all plugins
   */
  async emitEvent(eventName: string, data: unknown): Promise<void> {
    await this.eventBus.emit(eventName, data);
  }

  /**
   * Run a plugin command
   */
  async runCommand(pluginName: string, command: string, args: string[] = []): Promise<void> {
    const loaded = this.plugins.get(pluginName);
    if (!loaded) {
      throw new Error(`Plugin not loaded: ${pluginName}`);
    }

    const handler = loaded.instance.commands?.[command];
    if (!handler) {
      throw new Error(`Command not found: ${pluginName}:${command}`);
    }

    await handler(args, loaded.api);
  }

  /**
   * Get a loaded plugin
   */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all loaded plugins
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get the event bus (for core system to emit events)
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }
}
