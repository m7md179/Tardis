import type { z } from 'zod';
import type {
  SystemConfigSchema,
  LLMProviderConfigSchema,
  TelegramConfigSchema,
  ProactiveConfigSchema,
  ServerConfigSchema,
  AuthConfigSchema,
} from '../schemas/config.js';

// Types are derived from Zod schemas to ensure compatibility with exactOptionalPropertyTypes
export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type ProactiveConfig = z.infer<typeof ProactiveConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type SystemConfig = z.infer<typeof SystemConfigSchema>;
