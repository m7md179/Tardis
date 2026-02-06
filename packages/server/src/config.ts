import { existsSync, readFileSync } from 'fs';
import { z } from 'zod';

const ServerConfigSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().int().positive().default(3000),
    dataDir: z.string().default('/var/lib/tardis'),
  }),
  auth: z.object({
    jwtSecret: z.string().min(32),
    jwtExpiry: z.string().default('30d'),
    apiKeyLength: z.number().int().default(32),
  }),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().int().default(60000), // 1 minute
    maxRequests: z.number().int().default(100),
  }),
  scheduler: z.object({
    enabled: z.boolean().default(true),
    todoistSyncInterval: z.number().int().default(300), // 5 minutes (seconds)
    timeWindowCheckInterval: z.number().int().default(60), // 1 minute (seconds)
  }),
  todoist: z.object({
    apiToken: z.string(),
  }),
  notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          botToken: z.string(),
          chatId: z.string(),
        })
        .optional(),
      email: z
        .object({
          enabled: z.boolean().default(false),
          smtp: z.object({
            host: z.string(),
            port: z.number().int().positive(),
            secure: z.boolean(),
            auth: z.object({
              user: z.string(),
              pass: z.string(),
            }),
          }),
          from: z.string().email(),
          to: z.string().email(),
        })
        .optional(),
    }),
  }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export async function loadConfig(): Promise<ServerConfig> {
  const configPath = process.env.TARDIS_CONFIG || '/var/lib/tardis/config.json';

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const configFile = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configFile);

  return ServerConfigSchema.parse(config);
}
