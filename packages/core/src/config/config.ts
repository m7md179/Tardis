import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SystemConfig } from '@tardis/shared';
import { SystemConfigSchema } from '@tardis/shared';
import { ConfigError } from './errors.js';

const DEFAULT_DATA_DIR =
  process.env['TARDIS_DATA_DIR'] ?? join(process.env['HOME'] ?? '/var/lib/tardis', '.tardis');

/**
 * Apply environment variable overrides to the raw config object.
 * Env vars take precedence over config.json values.
 */
function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const config = structuredClone(raw);

  // LLM
  if (process.env['TARDIS_LLM_API_KEY']) {
    const llm = (config['llm'] as Record<string, unknown> | undefined) ?? {};
    llm['apiKey'] = process.env['TARDIS_LLM_API_KEY'];
    config['llm'] = llm;
  }
  if (process.env['TARDIS_LLM_BASE_URL']) {
    const llm = (config['llm'] as Record<string, unknown> | undefined) ?? {};
    llm['baseUrl'] = process.env['TARDIS_LLM_BASE_URL'];
    config['llm'] = llm;
  }
  if (process.env['TARDIS_LLM_MODEL']) {
    const llm = (config['llm'] as Record<string, unknown> | undefined) ?? {};
    llm['model'] = process.env['TARDIS_LLM_MODEL'];
    config['llm'] = llm;
  }

  // Telegram
  if (process.env['TARDIS_TELEGRAM_TOKEN']) {
    const tg = (config['telegram'] as Record<string, unknown> | undefined) ?? {};
    tg['botToken'] = process.env['TARDIS_TELEGRAM_TOKEN'];
    config['telegram'] = tg;
  }

  // Auth
  if (process.env['TARDIS_JWT_SECRET']) {
    const auth = (config['auth'] as Record<string, unknown> | undefined) ?? {};
    auth['jwtSecret'] = process.env['TARDIS_JWT_SECRET'];
    config['auth'] = auth;
  }

  // Server
  if (process.env['TARDIS_PORT']) {
    const server = (config['server'] as Record<string, unknown> | undefined) ?? {};
    server['port'] = parseInt(process.env['TARDIS_PORT'], 10);
    config['server'] = server;
  }
  if (process.env['TARDIS_DATA_DIR']) {
    const server = (config['server'] as Record<string, unknown> | undefined) ?? {};
    server['dataDir'] = process.env['TARDIS_DATA_DIR'];
    config['server'] = server;
  }

  return config;
}

/**
 * Load and validate the TARDIS system config.
 *
 * Resolution order:
 * 1. Load config.json from dataDir
 * 2. Apply env var overrides
 * 3. Validate with Zod (fills defaults)
 *
 * @param dataDir - directory containing config.json (default: ~/.tardis)
 */
export function loadConfig(dataDir: string = DEFAULT_DATA_DIR): SystemConfig {
  const configPath = join(dataDir, 'config.json');

  let raw: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      raw = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      throw new ConfigError(
        `Failed to parse config.json at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        'CONFIG_PARSE_ERROR'
      );
    }
  }

  raw = applyEnvOverrides(raw);

  const result = SystemConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`, 'CONFIG_VALIDATION_ERROR');
  }

  return result.data;
}

export { DEFAULT_DATA_DIR };
