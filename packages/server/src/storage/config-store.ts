import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

export interface ServerConfig {
  apiKeys?: string[]; // Array of hashed API keys
  server?: {
    host?: string;
    port?: number;
    dataDir?: string;
  };
  auth?: {
    jwtSecret?: string;
    jwtExpiry?: string;
    apiKeyLength?: number;
  };
  rateLimit?: {
    enabled?: boolean;
    windowMs?: number;
    maxRequests?: number;
  };
  scheduler?: {
    enabled?: boolean;
    todoistSyncInterval?: number;
    timeWindowCheckInterval?: number;
  };
  todoist?: {
    apiToken?: string;
  };
  notifications?: {
    enabled?: boolean;
    channels?: {
      telegram?: {
        enabled?: boolean;
        botToken?: string;
        chatId?: string;
      };
      email?: {
        enabled?: boolean;
        smtp?: {
          host?: string;
          port?: number;
          secure?: boolean;
          auth?: {
            user?: string;
            pass?: string;
          };
        };
        from?: string;
        to?: string;
      };
    };
  };
}

/**
 * ConfigStore manages server configuration and API keys
 * Stores configuration in JSON format at a specified path
 */
export class ConfigStore {
  private configPath: string;

  constructor(configPath?: string) {
    // Use provided path or default to environment variable or default location
    this.configPath =
      configPath ||
      process.env.TARDIS_CONFIG ||
      join(process.env.HOME || '/var/lib/tardis', '.tardis', 'server-config.json');
  }

  /**
   * Load configuration from disk
   * Creates default config if file doesn't exist
   */
  async load(): Promise<ServerConfig> {
    try {
      if (!existsSync(this.configPath)) {
        // Create default config
        const defaultConfig: ServerConfig = {
          apiKeys: [],
          server: {
            host: '0.0.0.0',
            port: 3000,
            dataDir: '/var/lib/tardis',
          },
          auth: {
            jwtExpiry: '30d',
            apiKeyLength: 32,
          },
          rateLimit: {
            enabled: true,
            windowMs: 60000,
            maxRequests: 100,
          },
          scheduler: {
            enabled: true,
            todoistSyncInterval: 300,
            timeWindowCheckInterval: 60,
          },
          notifications: {
            enabled: false,
            channels: {},
          },
        };

        await this.save(defaultConfig);
        return defaultConfig;
      }

      const data = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading config:', error);
      throw error;
    }
  }

  /**
   * Save configuration to disk
   * Creates directory structure if it doesn't exist
   */
  async save(config: ServerConfig): Promise<void> {
    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }

  /**
   * Update specific configuration values
   * Merges new values with existing config
   */
  async update(updates: Partial<ServerConfig>): Promise<ServerConfig> {
    const config = await this.load();
    const updatedConfig = { ...config, ...updates };
    await this.save(updatedConfig);
    return updatedConfig;
  }

  /**
   * Get the configuration file path
   */
  getPath(): string {
    return this.configPath;
  }

  /**
   * Check if configuration file exists
   */
  exists(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Delete the configuration file
   */
  async delete(): Promise<void> {
    if (existsSync(this.configPath)) {
      const { unlinkSync } = await import('fs');
      unlinkSync(this.configPath);
    }
  }
}
