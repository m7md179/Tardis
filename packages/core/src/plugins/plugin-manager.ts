import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { PluginManifest, PluginInstance, ToolDefinition } from '@tardis/shared';
import {
  validateManifest,
  validatePermissions,
  checkDuplicateToolNames,
  ManifestValidationError,
} from './manifest-validator.js';

export class PluginLoadError extends Error {
  readonly code = 'PLUGIN_LOAD_ERROR';
  readonly pluginName: string;

  constructor(message: string, pluginName: string) {
    super(message);
    this.name = 'PluginLoadError';
    this.pluginName = pluginName;
  }
}

interface ActivePlugin {
  manifest: PluginManifest;
  instance: PluginInstance;
  /** Raw module exports — used to extract proactive handler functions. */
  moduleExports: Record<string, unknown>;
}

export class PluginManager {
  private readonly activePlugins = new Map<string, ActivePlugin>();
  private readonly pluginsDir: string;
  private readonly pluginApiFactory: (manifest: PluginManifest) => unknown;

  constructor(pluginsDir: string, pluginApiFactory: (manifest: PluginManifest) => unknown) {
    this.pluginsDir = resolve(pluginsDir);
    this.pluginApiFactory = pluginApiFactory;
  }

  /**
   * Discover and load all plugins in the plugins directory.
   * Invalid or erroring plugins are skipped with a warning — they don't crash the system.
   */
  async loadAll(): Promise<void> {
    if (!existsSync(this.pluginsDir)) {
      console.warn(`[PluginManager] Plugins directory not found: ${this.pluginsDir}`);
      return;
    }

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    const pluginDirs = entries
      .filter((e) => {
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          try {
            return statSync(join(this.pluginsDir, e.name)).isDirectory();
          } catch {
             return false;
          }
        }
        return false;
      })
      .map((e) => e.name);

    const manifests: PluginManifest[] = [];
    const toLoad: { dir: string; manifest: PluginManifest }[] = [];

    // First pass: validate all manifests before activating any
    for (const dirName of pluginDirs) {
      const pluginDir = join(this.pluginsDir, dirName);
      const manifestPath = join(pluginDir, 'manifest.json');

      if (!existsSync(manifestPath)) {
        console.warn(`[PluginManager] No manifest.json in ${pluginDir}, skipping.`);
        continue;
      }

      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
        const manifest = validateManifest(raw, pluginDir);
        validatePermissions(manifest);
        manifests.push(manifest);
        toLoad.push({ dir: pluginDir, manifest });
      } catch (err) {
        if (err instanceof ManifestValidationError) {
          console.warn(`[PluginManager] ${err.message}`);
        } else {
          console.warn(`[PluginManager] Failed to read manifest in ${pluginDir}:`, err);
        }
      }
    }

    // Check for duplicate tool names across all valid plugins
    try {
      checkDuplicateToolNames(manifests);
    } catch (err) {
      console.warn(`[PluginManager] ${err instanceof Error ? err.message : String(err)}`);
    }

    // Second pass: activate validated plugins
    for (const { dir, manifest } of toLoad) {
      await this.activatePlugin(dir, manifest);
    }
  }

  /**
   * Load and activate a single plugin.
   */
  private async activatePlugin(pluginDir: string, manifest: PluginManifest): Promise<void> {
    const entryPath = join(pluginDir, manifest.main);

    if (!existsSync(entryPath)) {
      console.warn(
        `[PluginManager] Entry point not found: ${entryPath}, skipping plugin "${manifest.name}".`
      );
      return;
    }

    try {
      const module = (await import(entryPath)) as Record<string, unknown>;

      const onDeactivate = module['onDeactivate'] as PluginInstance['onDeactivate'] | undefined;
      const instance: PluginInstance = {
        manifest,
        onActivate: (module['onActivate'] as PluginInstance['onActivate']) ?? (async () => {}),
        ...(onDeactivate !== undefined ? { onDeactivate } : {}),
        executeTool:
          (module['executeTool'] as PluginInstance['executeTool']) ??
          (async (name: string) => {
            throw new Error(`Tool ${name} not implemented`);
          }),
      };

      const api = this.pluginApiFactory(manifest);
      await instance.onActivate(api);

      this.activePlugins.set(manifest.name, { manifest, instance, moduleExports: module });
      console.log(`[PluginManager] Activated plugin: ${manifest.name} v${manifest.version}`);
    } catch (err) {
      console.warn(
        `[PluginManager] Failed to activate plugin "${manifest.name}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /**
   * Deactivate all plugins and clear the registry. Called on shutdown.
   */
  async unloadAll(): Promise<void> {
    for (const [name, { instance }] of this.activePlugins) {
      try {
        await instance.onDeactivate?.();
        console.log(`[PluginManager] Deactivated plugin: ${name}`);
      } catch (err) {
        console.warn(`[PluginManager] Error deactivating plugin "${name}":`, err);
      }
    }
    this.activePlugins.clear();
  }

  /**
   * Execute a tool on the appropriate plugin.
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const [pluginName] = toolName.split('.');
    if (!pluginName) {
      throw new PluginLoadError(
        `Invalid tool name format: "${toolName}" (expected "plugin.tool")`,
        ''
      );
    }

    const active = this.activePlugins.get(pluginName);
    if (!active) {
      throw new PluginLoadError(`Plugin "${pluginName}" is not loaded`, pluginName);
    }

    return active.instance.executeTool(toolName, args);
  }

  /**
   * Get all loaded plugin manifests (lightweight summary cards for skill router).
   */
  getAllManifests(): PluginManifest[] {
    return Array.from(this.activePlugins.values()).map((p) => p.manifest);
  }

  /**
   * Get skill summary cards for all active plugins (used by skill router).
   */
  getSkillSummaries(): { name: string; skillSummary: string }[] {
    return this.getAllManifests().map((m) => ({
      name: m.name,
      skillSummary: m.skillSummary,
    }));
  }

  /**
   * Get full tool definitions for a specific set of plugin names.
   */
  getToolsForPlugins(pluginNames: string[]): ToolDefinition[] {
    return this.getAllManifests()
      .filter((m) => pluginNames.includes(m.name))
      .flatMap((m) => m.tools);
  }

  isLoaded(pluginName: string): boolean {
    return this.activePlugins.has(pluginName);
  }

  getPlugin(pluginName: string): ActivePlugin | undefined {
    return this.activePlugins.get(pluginName);
  }

  /**
   * Extract proactive handler functions from a plugin's module exports.
   * Returns a map of handler name → async function, matching the names
   * declared in the plugin's manifest.proactive[].handler.
   */
  getProactiveHandlers(pluginName: string): Record<string, () => Promise<void>> {
    const active = this.activePlugins.get(pluginName);
    if (!active) return {};

    const handlers: Record<string, () => Promise<void>> = {};
    const triggers = active.manifest.proactive ?? [];

    for (const trigger of triggers) {
      const fn = active.moduleExports[trigger.handler];
      if (typeof fn === 'function') {
        handlers[trigger.handler] = fn as () => Promise<void>;
      }
    }

    return handlers;
  }
}
