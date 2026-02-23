// TARDIS v2 Core — AI engine, plugin system, memory, events
export { loadConfig, DEFAULT_DATA_DIR } from './config/config.js';
export { ConfigError } from './config/errors.js';
export { EventBus } from './events/event-bus.js';
export { PluginManager, PluginLoadError } from './plugins/plugin-manager.js';
export { ManifestValidationError, validateManifest, validatePermissions, checkDuplicateToolNames } from './plugins/manifest-validator.js';
