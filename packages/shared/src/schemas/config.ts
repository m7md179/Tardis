import { z } from 'zod';
import { AgentConfigSchema } from './agent.js';

export const LLMProviderConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  contextWindowSize: z.number().int().min(512).optional(),
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

/**
 * Brute-force protection. Matters because a single shared password guards every
 * skill, and the API is reachable from the internet through the Cloudflare tunnel.
 */
export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Sliding window length, milliseconds. */
  windowMs: z.number().int().min(1000).default(60_000),
  /** Requests per window per client for the API generally. */
  maxRequests: z.number().int().min(1).default(120),
  /** Requests per window per client for /api/auth/login. Deliberately far stricter. */
  maxLoginAttempts: z.number().int().min(1).default(5),
});

/**
 * The embedding service used for memory search.
 *
 * Optional on purpose. With no embedder configured, retrieval is keyword-only —
 * exactly the behaviour that shipped before vectors existed — so a service that
 * is down or was never set up degrades TARDIS rather than breaking it.
 */
export const EmbedderConfigSchema = z.object({
  /** OpenAI-compatible /api/embed host, e.g. http://127.0.0.1:11434 */
  baseUrl: z.string().url(),
  model: z.string().min(1),
  timeoutMs: z.number().int().min(100).optional(),
  /**
   * How long the runtime should hold the model in memory, e.g. "1h" or -1 for
   * forever. Ollama unloads after five idle minutes by default, and the reload
   * costs about 1.1 s on the first query after that — against ~20 ms warm.
   * Unset means "leave the runtime's default alone".
   */
  keepAlive: z.union([z.string(), z.number()]).optional(),
});

export const MemoryConfigSchema = z.object({
  embedder: EmbedderConfigSchema.optional(),
});

export const SystemConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  auth: AuthConfigSchema,
  llm: LLMProviderConfigSchema,
  agent: AgentConfigSchema.extend({ personality: z.string().optional() }).default({}),
  telegram: TelegramConfigSchema.optional(),
  proactive: ProactiveConfigSchema.default({}),
  rateLimit: RateLimitConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  plugins: z.record(z.string(), z.record(z.string(), z.any())).optional(),
});
