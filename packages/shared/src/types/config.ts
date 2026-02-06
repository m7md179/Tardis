import { z } from 'zod';

/**
 * Todoist configuration schema
 */
export const TodoistConfigSchema = z.object({
  apiToken: z.string().min(1, 'API token is required'),
  syncInterval: z.number().int().positive().default(300), // seconds
  projectId: z.string().optional(),
  labelFilter: z.array(z.string()).optional(),
});
export type TodoistConfig = z.infer<typeof TodoistConfigSchema>;

/**
 * Notification channel configurations
 */
export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string(),
  chatId: z.string(),
});
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const EmailConfigSchema = z.object({
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
});
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

/**
 * Notification configuration schema
 */
export const NotificationsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channels: z.object({
    telegram: TelegramConfigSchema.optional(),
    email: EmailConfigSchema.optional(),
  }),
  events: z.object({
    timeWindowStart: z.boolean().default(true),
    timeWindowEnd: z.boolean().default(true),
    taskOverdue: z.boolean().default(true),
  }),
});
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;

/**
 * Storage configuration schema
 */
export const StorageConfigSchema = z.object({
  type: z.enum(['json', 'sqlite']).default('json'),
  archiveAfterDays: z.number().int().positive().default(30),
});
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

/**
 * Server configuration schema (for CLI)
 */
export const ServerConfigSchema = z.object({
  url: z.string().url().optional(),
  token: z.string().optional(),
  expiresAt: z.string().optional(),
  apiKey: z.string().optional(),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

/**
 * Main application configuration schema
 */
export const ConfigSchema = z.object({
  todoist: TodoistConfigSchema,
  notifications: NotificationsConfigSchema,
  storage: StorageConfigSchema,
  server: ServerConfigSchema.optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Partial config for updates (all fields optional)
 */
export const PartialConfigSchema = ConfigSchema.partial();
export type PartialConfig = z.infer<typeof PartialConfigSchema>;
