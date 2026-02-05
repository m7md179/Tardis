import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Config, ConfigSchema, PartialConfig, TodoistConfig } from '@tardis/shared';
import { CONFIG_FILE, TARDIS_DIR } from './constants';
import { ensureDirectoryExists } from './file-utils';

/**
 * Configuration storage manager
 */
export class ConfigStore {
  constructor() {
    ensureDirectoryExists(TARDIS_DIR);
  }

  /**
   * Check if config file exists
   */
  exists(): boolean {
    return existsSync(CONFIG_FILE);
  }

  /**
   * Load configuration from file
   * Returns default config if file doesn't exist
   */
  load(): Config {
    if (!this.exists()) {
      return this.getDefaultConfig();
    }

    try {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const data = JSON.parse(content);
      return ConfigSchema.parse(data);
    } catch (error) {
      console.error('Failed to load config, using defaults:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Save configuration to file
   */
  save(config: Config): void {
    // Validate config before saving
    const validated = ConfigSchema.parse(config);

    writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Update configuration (partial update)
   */
  update(partial: PartialConfig): void {
    const current = this.load();
    const updated = this.mergeConfig(current, partial);
    this.save(updated);
  }

  /**
   * Set Todoist API token
   */
  setTodoistToken(token: string): void {
    const config = this.load();
    config.todoist.apiToken = token;
    this.save(config);
  }

  /**
   * Get Todoist configuration
   */
  getTodoistConfig(): TodoistConfig {
    const config = this.load();
    return config.todoist;
  }

  /**
   * Check if Todoist is configured (has API token)
   */
  isTodoistConfigured(): boolean {
    const config = this.load();
    return config.todoist.apiToken.length > 0;
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): Config {
    return {
      todoist: {
        apiToken: '',
        syncInterval: 300,
      },
      notifications: {
        enabled: false,
        channels: {},
        events: {
          timeWindowStart: true,
          timeWindowEnd: true,
          taskOverdue: true,
        },
      },
      storage: {
        type: 'json',
        archiveAfterDays: 30,
      },
    };
  }

  /**
   * Merge partial config into current config
   */
  private mergeConfig(current: Config, partial: PartialConfig): Config {
    return {
      todoist: {
        ...current.todoist,
        ...partial.todoist,
      },
      notifications: {
        ...current.notifications,
        ...partial.notifications,
        channels: {
          ...current.notifications?.channels,
          ...partial.notifications?.channels,
        },
        events: {
          ...current.notifications?.events,
          ...partial.notifications?.events,
        },
      },
      storage: {
        ...current.storage,
        ...partial.storage,
      },
    };
  }
}
