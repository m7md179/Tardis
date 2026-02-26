import { z } from 'zod';
import { AgentConfigSchema } from './agent.js';

export const LLMProviderConfigSchema = z.object({
  provider: z.enum(['ollama', 'openai', 'anthropic', 'google']),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const TelegramConfigSchema = z.object({
  botToken: z.string().min(1),
  allowedChatIds: z.array(z.string()),
});

export const ProactiveConfigSchema = z.object({
  enabled: z.boolean().default(true),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

export const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(3000),
  dataDir: z.string().min(1).default('/var/lib/tardis'),
});

export const AuthConfigSchema = z.object({
  jwtSecret: z.string().min(32),
  jwtExpiry: z.string().default('30d'),
  adminPassword: z.string().min(1).optional(),
});

export const SystemConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  auth: AuthConfigSchema,
  llm: LLMProviderConfigSchema,
  agent: AgentConfigSchema.extend({ personality: z.string().optional() }).default({}),
  telegram: TelegramConfigSchema.optional(),
  proactive: ProactiveConfigSchema.default({}),
});
